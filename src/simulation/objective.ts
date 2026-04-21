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
import { computeTaskPlacementCost, computeDistanceKm, computeLatencyMs } from './physics'

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
  deferral: 0.15,   // higher to respect deadlines
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
  const submitHour = task.submit_minute_frac
  const deferralHours = Math.max(0, scheduledHour - submitHour)
  const deadlineHours = task.deadline_hours

  if (deadlineHours <= 0) return 1  // already past deadline
  return Math.min(1, deferralHours / deadlineHours)
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

  // Utilization penalty: ramps from 0 at 40% util to 0.5 at 100% util
  // Kicks in earlier and harder than before to spread load across DCs
  const utilPenalty = currentUtilPct > 40
    ? ((currentUtilPct - 40) / 60) * 0.5
    : 0

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

// ── Solar Investment Ranking (Mode 3) ─────────────────────────────────────────

export interface SolarInvestmentScore {
  dcId: string
  dcName: string
  annualCostDisplacementUsd: number   // value of solar-displaced grid energy at LMP
  annualCarbonDisplacementKg: number  // carbon avoided by solar
  storageMultiplier: number           // bonus if solar peak ≠ price peak (storage helps)
  investmentScore: number             // composite rank score (higher = invest here first)
  roofUtilizationPct: number          // how much roof is available (always 100% here)
  paybackYearsEstimate: number        // rough estimate at $1/W installed
}

/**
 * Rank data centers by solar + storage investment value.
 * Higher score = better ROI from solar/storage deployment.
 *
 * Methodology:
 *   1. Cost displacement = solar_kwh/day × avg_peak_lmp × 365
 *   2. Carbon displacement = solar_kwh/day × avg_peak_carbon × 365 / 1000
 *   3. Storage multiplier = ratio of evening LMP to midday LMP
 *      (high ratio → storage lets you shift cheap midday solar to expensive evening)
 *   4. Score = α×costDisplacement + β×carbonDisplacement + γ×storageMultiplier
 *
 * @param dcs    All data centers
 * @param grids  Map of utility_id → GridProfile
 * @returns      Ranked array, best investment first
 */
export function rankSolarInvestments(
  dcs: DataCenter[],
  grids: Map<string, GridProfile>,
): SolarInvestmentScore[] {
  const ALPHA = 0.50  // weight on cost displacement
  const BETA  = 0.35  // weight on carbon displacement
  const GAMMA = 0.15  // weight on storage multiplier

  // Solar production hours: 9am-4pm (peak generation window)
  const SOLAR_HOURS = [9, 10, 11, 12, 13, 14, 15, 16]
  // Evening peak hours (storage would shift to here)
  const EVENING_HOURS = [18, 19, 20, 21]
  // Solar install cost assumption: $1.00/W (utility-scale commercial)
  const INSTALL_COST_PER_W = 1.00

  const results: SolarInvestmentScore[] = []

  for (const dc of dcs) {
    const grid = grids.get(dc.utility_id)
    if (!grid) continue

    const avgSolarLmp = SOLAR_HOURS.reduce((s, h) => s + grid.lmp_usd_per_mwh[h], 0) / SOLAR_HOURS.length
    const avgSolarCarbon = SOLAR_HOURS.reduce((s, h) => s + grid.carbon_g_co2_per_kwh[h], 0) / SOLAR_HOURS.length
    const avgEveningLmp = EVENING_HOURS.reduce((s, h) => s + grid.lmp_usd_per_mwh[h], 0) / EVENING_HOURS.length

    // kWh displaced per day → annual
    const dailyKwh   = dc.solar_potential_kwh_per_day
    const annualKwh  = dailyKwh * 365

    // Storage multiplier: evening LMP / solar LMP ratio
    // High ratio = strong economic case for time-shifting solar to evening peak
    // CAISO example: evening $138/MWh / midday $8/MWh = 17.25x (very high)
    // PacifiCorp: evening $90/MWh / midday $60/MWh = 1.5x (low, flat profile)
    // Cap at 20x to prevent extreme outliers from dominating the score
    const rawStorageMult = avgEveningLmp / Math.max(1, avgSolarLmp)
    const storageMultiplier = Math.min(20.0, Math.max(1.0, rawStorageMult))

    const annualCostDisplacementUsd   = annualKwh * (avgSolarLmp / 1000)
    const annualCarbonDisplacementKg  = annualKwh * avgSolarCarbon / 1000

    // Normalize each component across the fleet for scoring
    // (raw values used; caller normalizes across results)
    const rawScore =
      ALPHA * annualCostDisplacementUsd +
      BETA  * annualCarbonDisplacementKg * 0.1 +  // scale carbon to similar magnitude
      GAMMA * storageMultiplier * annualCostDisplacementUsd  // storage bonus

    // Payback: install cost / annual savings
    const installCostUsd = dc.solar_potential_kw_peak * 1000 * INSTALL_COST_PER_W
    const paybackYearsEstimate = installCostUsd / Math.max(1, annualCostDisplacementUsd)

    results.push({
      dcId:                       dc.id,
      dcName:                     dc.name,
      annualCostDisplacementUsd:  Math.round(annualCostDisplacementUsd),
      annualCarbonDisplacementKg: Math.round(annualCarbonDisplacementKg),
      storageMultiplier:          Math.round(storageMultiplier * 100) / 100,
      investmentScore:            rawScore,
      roofUtilizationPct:         100,
      paybackYearsEstimate:       Math.round(paybackYearsEstimate * 10) / 10,
    })
  }

  // Sort best investment first; normalize scores to [0, 100]
  results.sort((a, b) => b.investmentScore - a.investmentScore)
  const maxScore = results[0]?.investmentScore ?? 1
  results.forEach(r => {
    r.investmentScore = Math.round((r.investmentScore / maxScore) * 100)
  })

  return results
}