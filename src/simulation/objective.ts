/**
 * objective.ts
 *
 * Scoring and objective function for the AI workload scheduler.
 * Determines which (DC, hour) combination minimizes cost for each task,
 * subject to carbon, latency, and deadline constraints.
 *
 * Objective (minimize):
 *   Score = w_cost   × NormalizedLMP(dc, t)
 *         + w_carbon × NormalizedCarbon(dc, t)
 *         + w_latency × NormalizedLatency(task, dc)     [Flex 1 only]
 *         + w_deferral × DeferralPenalty(task, t)       [scales toward deadline]
 *
 * Weights: cost=0.55, carbon=0.30, latency=0.10, deferral=0.05
 * Cost is primary, carbon secondary. When cheapest ≠ cleanest, cheapest wins
 * and a conflict flag is raised for dashboard display.
 */

import type { Task, DataCenter, GridProfile, TaskPlacementCost } from './physics'
import { computeTaskPlacementCost, computeDistanceKm, computeLatencyMs, computeSolarOutputKw } from './physics'

// ── Objective Weights ─────────────────────────────────────────────────────────
//
// Flex 1 (hard real-time inference): latency dominates — nearest DC wins.
//   A 50ms cross-country latency penalty scores ~0.70 on the latency term,
//   easily overcoming a $150/MWh LMP advantage from a distant cheap grid.
//
// Flex 2/3 (deferrable): cost primary, carbon secondary, no latency penalty.

export const WEIGHTS_FLEX1 = {
  cost:     0.15,   // cheap grid matters less than proximity
  carbon:   0.10,   // carbon matters least for real-time
  latency:  0.70,   // dominant — route to nearest DC with capacity
  deferral: 0.05,
} as const

export const WEIGHTS_FLEX23 = {
  cost:     0.55,   // cost primary
  carbon:   0.30,   // carbon secondary
  latency:  0.00,   // no latency penalty for deferrable tasks
  deferral: 0.15,   // deferral urgency
} as const

// Keep WEIGHTS as alias for Flex 2/3 (used in comments/docs)
export const WEIGHTS = WEIGHTS_FLEX23

// ── Normalization Bounds ──────────────────────────────────────────────────────
// These are the realistic min/max across all grids on Aug 15.
// Used to normalize raw values to [0, 1] for the objective function.

export const NORM = {
  lmp_min:    4,    // $/MWh  — CAISO solar glut minimum
  lmp_max:    195,  // $/MWh  — ERCOT evening spike maximum
  carbon_min: 38,   // gCO₂/kWh — CAISO solar midday
  carbon_max: 460,  // gCO₂/kWh — PacifiCorp coal peak
  latency_min: 5,   // ms — co-located (same city)
  latency_max: 60,  // ms — cross-continent (~5,500km, e.g. NYC→San Jose)
} as const

// ── Normalization Helpers ─────────────────────────────────────────────────────

function normalize(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

function normalizeLMP(lmp: number): number {
  return normalize(lmp, NORM.lmp_min, NORM.lmp_max)
}

function normalizeCarbon(carbon: number): number {
  return normalize(carbon, NORM.carbon_min, NORM.carbon_max)
}

function normalizeLatency(latencyMs: number): number {
  return normalize(latencyMs, NORM.latency_min, NORM.latency_max)
}

// ── Deferral Penalty ──────────────────────────────────────────────────────────

/**
 * Deferral urgency penalty — increases as deadline approaches.
 * Returns 0 when no deferral has occurred (task runs immediately).
 * Returns 1 when the task is at its deadline with no slack.
 *
 * @param task            The workload task
 * @param scheduledHour   Hour the task would actually run
 * @returns               Normalized urgency 0–1
 */
export function computeDeferralPenalty(task: Task, scheduledHour: number): number {
  const submitHour    = task.submit_minute_frac
  const deferralHours = Math.max(0, scheduledHour - submitHour)
  const deadlineHours = task.deadline_hours

  if (deadlineHours <= 0) return 1
  const t = Math.min(1, deferralHours / deadlineHours)

  // Convex curve: penalty is front-loaded so even 1-2hr deferrals cost meaningfully.
  // This prevents the scheduler deferring everything to the cheapest window.
  // t=0.1 (short defer) → 0.28 penalty   (was 0.10 linear)
  // t=0.3 (moderate)    → 0.55 penalty   (was 0.30 linear)
  // t=0.5 (half window) → 0.71 penalty   (was 0.50 linear)
  // t=1.0 (at deadline) → 1.00 penalty   (same)
  return Math.sqrt(t)
}

// ── Core Objective Score ──────────────────────────────────────────────────────

export interface ObjectiveScore {
  totalScore: number          // lower = better placement
  costScore: number           // normalized LMP component
  carbonScore: number         // normalized carbon component
  latencyScore: number        // normalized latency component (0 for Flex 2/3)
  deferralScore: number       // urgency component
  placement: TaskPlacementCost
}

/**
 * Compute the objective score for placing a task at a given DC at a given hour.
 * Lower score = better placement.
 *
 * @param task           Workload task to score
 * @param dc             Candidate data center
 * @param grid           Grid profile for that DC
 * @param scheduledHour  Hour the task would start
 * @param includeSolar   Mode 3: offset cost/carbon with rooftop solar
 * @returns              Objective score breakdown
 */
export function scoreTaskPlacement(
  task: Task,
  dc: DataCenter,
  grid: GridProfile,
  scheduledHour: number,
  includeSolar = false,
  currentUtilPct = 0,  // 0-100: current GPU utilization % at this DC/hour
): ObjectiveScore {
  const placement = computeTaskPlacementCost(task, dc, grid, scheduledHour, includeSolar)

  // Use flex-type-specific weights
  const W = task.flex_type === 1 ? WEIGHTS_FLEX1 : WEIGHTS_FLEX23

  const costScore     = normalizeLMP(placement.lmpUsdPerMwh)
  const carbonScore   = normalizeCarbon(placement.carbonGCo2PerKwh)
  const latencyScore  = normalizeLatency(placement.latencyMs)
  const deferralScore = computeDeferralPenalty(task, scheduledHour)

  // Utilization penalty: quadratic curve that discourages over-concentrating load.
  // Kicks in at 40%, strong above 70%. This spreads load across DCs without
  // forcing work onto expensive grids when cheaper ones still have headroom.
  // Note: Flex 1 never reaches this code (hard-routed in scheduler.ts).
  let utilPenalty = 0
  if (currentUtilPct > 40) {
    const t = (currentUtilPct - 40) / 60   // 0 at 40%, 1 at 100%
    utilPenalty = t * t * 1.2
  }

  const totalScore =
    W.cost     * costScore +
    W.carbon   * carbonScore +
    W.latency  * latencyScore +
    W.deferral * deferralScore +
    utilPenalty

  return { totalScore, costScore, carbonScore, latencyScore, deferralScore, placement }
}

// ── Conflict Detection ────────────────────────────────────────────────────────

export interface ConflictCheck {
  hasConflict: boolean
  cheapestDcId: string   // DC with lowest LMP at scheduled hour
  cleanestDcId: string   // DC with lowest carbon at scheduled hour
  chosenDcId: string     // what the algorithm actually chose (cheapest wins)
  lmpDiff: number        // $/MWh difference between cheapest and cleanest
  carbonDiff: number     // gCO₂/kWh difference
}

/**
 * Detect whether the cheapest DC choice conflicts with the cleanest DC choice.
 * Called after the scheduler selects a placement to flag dashboard conflicts.
 *
 * @param task            The workload task
 * @param chosenDcId      DC the scheduler selected
 * @param candidates      All feasible (dc, grid, hour) options considered
 */
export function detectConflict(
  chosenDcId: string,
  candidateScores: Array<{ dcId: string; lmp: number; carbon: number }>,
): ConflictCheck {
  if (candidateScores.length === 0) {
    return { hasConflict: false, cheapestDcId: chosenDcId, cleanestDcId: chosenDcId,
             chosenDcId, lmpDiff: 0, carbonDiff: 0 }
  }

  const cheapest = candidateScores.reduce((a, b) => a.lmp < b.lmp ? a : b)
  const cleanest = candidateScores.reduce((a, b) => a.carbon < b.carbon ? a : b)

  const hasConflict = cheapest.dcId !== cleanest.dcId

  return {
    hasConflict,
    cheapestDcId: cheapest.dcId,
    cleanestDcId: cleanest.dcId,
    chosenDcId,
    lmpDiff:    Math.abs(cheapest.lmp - cleanest.lmp),
    carbonDiff: Math.abs(cheapest.carbon - cleanest.carbon),
  }
}

// ── Deferral Window Search ────────────────────────────────────────────────────

/**
 * For Flex 2 and Flex 3 tasks, find the best (DC, hour) combination
 * within the task's deferral window that minimizes the objective score.
 *
 * Search space:
 *   - Hours: from submitHour to submitHour + deadlineHours (capped at 23)
 *   - DCs: all provided candidates
 *
 * @param task        Task to schedule
 * @param dcs         All data centers
 * @param grids       Map of utility_id → GridProfile
 * @param includeSolar Mode 3 flag
 * @returns           Best (dcId, scheduledHour, score) found
 */
export interface BestPlacement {
  dcId: string
  scheduledHour: number
  score: ObjectiveScore
  conflict: ConflictCheck
}

export function findBestPlacement(
  task: Task,
  dcs: DataCenter[],
  grids: Map<string, GridProfile>,
  includeSolar = false,
  // capacity[dcId][hour] = GPUs currently committed — used for utilization penalty
  capacity?: Record<string, number[]>,
): BestPlacement | null {
  const submitHour = task.submit_minute_frac
  const maxHour    = Math.min(23, Math.floor(submitHour + task.deadline_hours))

  // Flex 1: must start within 5 min — only current hour is eligible
  const hoursToSearch: number[] = task.flex_type === 1
    ? [Math.floor(submitHour)]
    : Array.from(
        { length: maxHour - Math.floor(submitHour) + 1 },
        (_, i) => Math.floor(submitHour) + i,
      )

  let bestPlacement: BestPlacement | null = null

  for (const hour of hoursToSearch) {
    const candidateScores: Array<{ dcId: string; lmp: number; carbon: number }> = []

    for (const dc of dcs) {
      const grid = grids.get(dc.utility_id)
      if (!grid) continue

      // Compute current utilization % at this DC/hour for load-spreading penalty
      const gpusUsed    = capacity?.[dc.id]?.[hour] ?? 0
      const utilPct     = dc.gpu_count > 0 ? (gpusUsed / dc.gpu_count) * 100 : 0

      const score = scoreTaskPlacement(task, dc, grid, hour, includeSolar, utilPct)

      candidateScores.push({
        dcId:   dc.id,
        lmp:    score.placement.lmpUsdPerMwh,
        carbon: score.placement.carbonGCo2PerKwh,
      })

      if (bestPlacement === null || score.totalScore < bestPlacement.score.totalScore) {
        const conflict = detectConflict(dc.id, candidateScores)
        bestPlacement = { dcId: dc.id, scheduledHour: hour, score, conflict }
      }
    }

    // After evaluating all DCs for this hour, update conflict on best
    if (bestPlacement && bestPlacement.scheduledHour === hour) {
      const conflict = detectConflict(bestPlacement.dcId, candidateScores)
      bestPlacement = { ...bestPlacement, conflict }
    }
  }

  return bestPlacement
}

// ── Grid-specific DR and coincident peak parameters ─────────────────────────

interface GridEconomics {
  drPaymentPerMwEvent:     number
  drEventsPerYear:         number
  coincidentPeakPerKwYear: number
  drWindowHours:           number[]
  coincidentPeakHour:      number
}

const GRID_ECONOMICS: Record<string, GridEconomics> = {
  pjm_comed:       { drPaymentPerMwEvent: 12500, drEventsPerYear: 4, coincidentPeakPerKwYear: 150, drWindowHours: [13,14,15], coincidentPeakHour: 14 },
  pjm_dom:         { drPaymentPerMwEvent: 12500, drEventsPerYear: 4, coincidentPeakPerKwYear: 150, drWindowHours: [13,14,15], coincidentPeakHour: 14 },
  pjm_pseg:        { drPaymentPerMwEvent: 12500, drEventsPerYear: 4, coincidentPeakPerKwYear: 150, drWindowHours: [13,14,15], coincidentPeakHour: 14 },
  ercot_north:     { drPaymentPerMwEvent:  8750, drEventsPerYear: 4, coincidentPeakPerKwYear: 100, drWindowHours: [11,12,13], coincidentPeakHour: 12 },
  pacificorp_pace: { drPaymentPerMwEvent:  5000, drEventsPerYear: 4, coincidentPeakPerKwYear:  80, drWindowHours: [13,14,15], coincidentPeakHour: 14 },
  caiso_pge:       { drPaymentPerMwEvent: 10000, drEventsPerYear: 4, coincidentPeakPerKwYear: 120, drWindowHours: [20,21,22], coincidentPeakHour: 21 },
}

// ── Solar Investment Ranking (Mode 3) ─────────────────────────────────────────

export interface SolarInvestmentScore {
  dcId:                       string
  dcName:                     string
  annualCostDisplacementUsd:  number
  annualCarbonDisplacementKg: number
  storageMultiplier:          number
  drEligible:                 boolean
  drAnnualValueUsd:           number
  drShedPct:                  number
  coincidentPeakSavingsUsd:   number
  investmentScore:            number
  roofUtilizationPct:         number
  paybackYearsEstimate:       number
  totalAnnualValueUsd:        number
}

export function rankSolarInvestments(
  dcs: DataCenter[],
  grids: Map<string, GridProfile>,
): SolarInvestmentScore[] {
  const ALPHA   = 0.40
  const BETA    = 0.25
  const GAMMA   = 0.15
  const DELTA   = 0.12
  const EPSILON = 0.08

  const SOLAR_HOURS   = [9, 10, 11, 12, 13, 14, 15, 16]
  const EVENING_HOURS = [18, 19, 20, 21]
  const INSTALL_COST_PER_W = 1.00

  const results: SolarInvestmentScore[] = []

  for (const dc of dcs) {
    const grid = grids.get(dc.utility_id)
    if (!grid) continue
    const econ = GRID_ECONOMICS[dc.utility_id]

    // Core solar metrics
    const avgSolarLmp    = SOLAR_HOURS.reduce((s, h) => s + grid.lmp_usd_per_mwh[h], 0) / SOLAR_HOURS.length
    const avgSolarCarbon = SOLAR_HOURS.reduce((s, h) => s + grid.carbon_g_co2_per_kwh[h], 0) / SOLAR_HOURS.length
    const avgEveningLmp  = EVENING_HOURS.reduce((s, h) => s + grid.lmp_usd_per_mwh[h], 0) / EVENING_HOURS.length

    const dailyKwh  = dc.solar_potential_kwh_per_day
    const annualKwh = dailyKwh * 365

    const rawStorageMult  = avgEveningLmp / Math.max(1, avgSolarLmp)
    const storageMultiplier = Math.min(20.0, Math.max(1.0, rawStorageMult))

    const annualCostDisplacementUsd  = annualKwh * (avgSolarLmp / 1000)
    const annualCarbonDisplacementKg = annualKwh * avgSolarCarbon / 1000

    // Demand response
    // Battery (2× solar peak capacity) must shed >50% of peak window load to qualify
    let drEligible = false, drAnnualValueUsd = 0, drShedPct = 0
    if (econ) {
      const estimatedLoadKw   = dc.capacity_mw * 1000 * 0.70 * 1.35
      const batteryCapacityKw = dc.solar_potential_kw_peak * 2
      drShedPct  = Math.min(100, (batteryCapacityKw / estimatedLoadKw) * 100)
      drEligible = drShedPct >= 50
      if (drEligible) {
        const mwCommitted = batteryCapacityKw / 1000
        drAnnualValueUsd  = econ.drPaymentPerMwEvent * mwCommitted * econ.drEventsPerYear
      }
    }

    // Coincident peak capacity charge avoidance
    // Solar output at the coincident peak hour reduces billable peak demand
    let coincidentPeakSavingsUsd = 0
    if (econ) {
      const solarAtPeak = computeSolarOutputKw(dc, econ.coincidentPeakHour)
      coincidentPeakSavingsUsd = solarAtPeak * econ.coincidentPeakPerKwYear
    }

    const totalAnnualValueUsd = annualCostDisplacementUsd + drAnnualValueUsd + coincidentPeakSavingsUsd

    const rawScore =
      ALPHA   * annualCostDisplacementUsd +
      BETA    * annualCarbonDisplacementKg * 0.1 +
      GAMMA   * storageMultiplier * annualCostDisplacementUsd +
      DELTA   * drAnnualValueUsd +
      EPSILON * coincidentPeakSavingsUsd

    const installCostUsd       = dc.solar_potential_kw_peak * 1000 * INSTALL_COST_PER_W
    const paybackYearsEstimate = installCostUsd / Math.max(1, totalAnnualValueUsd)

    results.push({
      dcId:                       dc.id,
      dcName:                     dc.name,
      annualCostDisplacementUsd:  Math.round(annualCostDisplacementUsd),
      annualCarbonDisplacementKg: Math.round(annualCarbonDisplacementKg),
      storageMultiplier:          Math.round(storageMultiplier * 100) / 100,
      drEligible,
      drAnnualValueUsd:           Math.round(drAnnualValueUsd),
      drShedPct:                  Math.round(drShedPct),
      coincidentPeakSavingsUsd:   Math.round(coincidentPeakSavingsUsd),
      investmentScore:            rawScore,
      roofUtilizationPct:         100,
      paybackYearsEstimate:       Math.round(paybackYearsEstimate * 10) / 10,
      totalAnnualValueUsd:        Math.round(totalAnnualValueUsd),
    })
  }

  results.sort((a, b) => b.investmentScore - a.investmentScore)
  const maxScore = results[0]?.investmentScore ?? 1
  results.forEach(r => {
    r.investmentScore = Math.round((r.investmentScore / maxScore) * 100)
  })

  return results
}