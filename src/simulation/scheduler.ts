/**
 * scheduler.ts
 *
 * Core routing algorithm for the AI workload scheduler.
 * Implements three simulation modes:
 *
 * Mode 1 — Baseline (no optimization)
 *   Flex 1: nearest DC by distance, run immediately
 *   Flex 2/3: first DC with available capacity, run immediately
 *   No deferral, no cost/carbon awareness
 *
 * Mode 2 — Optimized routing
 *   All tasks: scored by objective function across all DCs + deferral windows
 *   Flex 1: latency-weighted, no deferral beyond 5min deadline
 *   Flex 2: deferred up to 4hr to find cheaper/cleaner window
 *   Flex 3: deferred up to 24hr (end of day)
 *   Conflict flagged when cheapest ≠ cleanest
 *
 * Mode 3 — +Solar/Storage
 *   Same as Mode 2 but solar output offsets grid draw at each DC
 *   Also produces investment ranking for solar/storage by DC
 */

import type { Task, DataCenter, GridProfile } from './physics'
import * as fs   from 'fs'
import * as path from 'path'

// Load model placement at module init
// Maps dc_id → set of model_ids hosted there
function loadPlacement(): Map<string, Set<string>> {
  try {
    // Use __dirname to find data/ relative to this file (src/simulation/)
    // process.cwd() is unreliable in ts-node depending on how it's invoked
    const dataDir = path.join(__dirname, '..', '..', 'data')
    const raw     = fs.readFileSync(path.join(dataDir, 'placement.json'), 'utf-8')
    const data    = JSON.parse(raw) as Record<string, { models: string[] }>
    const map     = new Map<string, Set<string>>()
    for (const [dcId, val] of Object.entries(data)) {
      if (dcId.startsWith('_')) continue  // skip comment keys
      map.set(dcId, new Set(val.models))
    }
    console.log(`  Loaded model placement: ${map.size} DCs`)
    return map
  } catch (e) {
    console.warn('placement.json not found — all DCs accept all models:', e)
    return new Map()
  }
}

const MODEL_PLACEMENT = loadPlacement()

/** Returns true if dc hosts the model required by this task (or task has no model requirement) */
function dcHostsModel(dc: DataCenter, task: Task): boolean {
  const modelId = (task as any).model_id as string | null
  if (!modelId) return true                          // Flex 2/3 — no model constraint
  const hosted = MODEL_PLACEMENT.get(dc.id)
  if (!hosted || hosted.size === 0) return true      // no placement data — allow all
  return hosted.has(modelId)
}
import { computeDistanceKm } from './physics'
import {
  findBestPlacement,
  rankSolarInvestments,
  type BestPlacement,
  type SolarInvestmentScore,
} from './objective'

// ── Output Types ──────────────────────────────────────────────────────────────

export type SimMode = 1 | 2 | 3

export interface ScheduledTask {
  // Identity
  request_id: string
  mode: SimMode

  // Scheduling outcome
  assigned_dc_id: string
  assigned_dc_name: string
  scheduled_hour: number
  deferred_by_hours: number
  status: 'scheduled' | 'deferred' | 'dropped'  // dropped = no feasible DC found

  // Task properties (copied for convenience)
  submit_hour: number
  submit_minute_frac: number
  flex_type: 1 | 2 | 3
  task_type: string
  origin_city: string
  origin_lat: number
  origin_lon: number
  gpu_count: number
  duration_hours: number
  power_draw_kw: number
  energy_kwh: number

  // Placement costs
  it_power_kw: number
  total_power_kw: number        // after PUE
  total_energy_kwh: number      // after PUE
  net_grid_energy_kwh: number   // after solar (Mode 3) or = total_energy (Modes 1/2)
  cost_usd: number
  carbon_kg: number
  pue: number
  lmp_usd_per_mwh: number
  carbon_g_co2_per_kwh: number
  solar_offset_kwh: number      // 0 for Modes 1/2

  // Routing metadata
  distance_km: number
  latency_ms: number
  cost_vs_carbon_conflict: boolean
  conflict_cheapest_dc_id: string | null
  conflict_cleanest_dc_id: string | null

  // Objective scores (Mode 2/3 only; 0 for Mode 1)
  score_total: number
  score_cost: number
  score_carbon: number
  score_latency: number
  score_deferral: number
}

export interface DCHourlyCapacity {
  [dcId: string]: number[]  // [hour 0..23] = GPUs in use at that hour
}

export interface SimulationResult {
  mode: SimMode
  schedule: ScheduledTask[]
  dropped_tasks: string[]           // request_ids that couldn't be placed
  dc_hourly_gpu_usage: DCHourlyCapacity
  solar_rankings?: SolarInvestmentScore[]  // Mode 3 only

  // Fleet-level aggregates
  total_cost_usd: number
  total_carbon_kg: number
  total_tasks_scheduled: number
  total_tasks_deferred: number
  total_tasks_dropped: number
  total_energy_kwh: number
  conflict_count: number
}

// ── Capacity Tracker ──────────────────────────────────────────────────────────

/**
 * Track GPU usage per DC per hour.
 * A task occupies GPUs in every hour it runs (from scheduledHour
 * through scheduledHour + ceil(duration_hours)).
 */
function initCapacity(dcs: DataCenter[]): DCHourlyCapacity {
  const cap: DCHourlyCapacity = {}
  for (const dc of dcs) {
    // 48 hours: 0-23 = Aug 15, 24-47 = Aug 16 overnight
    // Allows late-day tasks to schedule into the overnight window
    cap[dc.id] = new Array(48).fill(0)
  }
  return cap
}

function occupyCapacity(
  cap: DCHourlyCapacity,
  dcId: string,
  scheduledHour: number,
  durationHours: number,
  gpuCount: number,
): void {
  const hoursOccupied = Math.ceil(durationHours)
  for (let h = scheduledHour; h < Math.min(48, scheduledHour + hoursOccupied); h++) {
    cap[dcId][h] += gpuCount
  }
}

function hasCapacity(
  cap: DCHourlyCapacity,
  dc: DataCenter,
  scheduledHour: number,
  durationHours: number,
  gpuCount: number,
): boolean {
  const hoursOccupied = Math.ceil(durationHours)
  for (let h = scheduledHour; h < Math.min(48, scheduledHour + hoursOccupied); h++) {
    if ((cap[dc.id][h] ?? 0) + gpuCount > dc.gpu_count) return false
  }
  return true
}

// ── Mode 1: Baseline ──────────────────────────────────────────────────────────

function scheduleMode1(
  tasks: Task[],
  dcs: DataCenter[],
  grids: Map<string, GridProfile>,
): SimulationResult {
  const cap = initCapacity(dcs)
  const schedule: ScheduledTask[] = []
  const dropped: string[] = []

  // Mode 1 has no backlog — it only processes tasks submitted on Aug 15.
  // Backlog tasks are a product of intelligent scheduling (Modes 2/3) where
  // the system defers work from prior days to optimal windows. A naive
  // baseline scheduler has no such queue — it just runs what arrives.
  const liveTasks = tasks.filter(t => !t.is_backlog)

  // Sort by submit time (process in arrival order)
  const sorted = [...liveTasks].sort((a, b) => a.submit_minute_frac - b.submit_minute_frac +
    (a.submit_hour - b.submit_hour) * 60)

  for (const task of sorted) {
    const submitHour = Math.floor(task.submit_minute_frac)

    let assignedDc: DataCenter | null = null

    if (task.flex_type === 1) {
      // Nearest DC that hosts the required model with available capacity
      const byDistance = [...dcs].sort((a, b) =>
        computeDistanceKm(task.origin_lat, task.origin_lon, a.lat, a.lon) -
        computeDistanceKm(task.origin_lat, task.origin_lon, b.lat, b.lon)
      )
      assignedDc = byDistance.find(dc =>
        dcHostsModel(dc, task) &&
        hasCapacity(cap, dc, submitHour, task.duration_hours, task.gpu_count)
      ) ?? null
    } else {
      // Nearest DC with available capacity (distance-weighted baseline)
      // This gives a more realistic baseline — tasks still go to the closest
      // feasible DC, just without any cost/carbon optimization.
      const byDistance = [...dcs].sort((a, b) =>
        computeDistanceKm(task.origin_lat, task.origin_lon, a.lat, a.lon) -
        computeDistanceKm(task.origin_lat, task.origin_lon, b.lat, b.lon)
      )
      assignedDc = byDistance.find(dc =>
        hasCapacity(cap, dc, submitHour, task.duration_hours, task.gpu_count)
      ) ?? null
    }

    if (!assignedDc) {
      dropped.push(task.request_id)
      continue
    }

    const grid = grids.get(assignedDc.utility_id)!
    occupyCapacity(cap, assignedDc.id, submitHour, task.duration_hours, task.gpu_count)

    const { placement } = {
      placement: {
        itPowerKw: task.power_draw_kw,
        totalPowerKw: task.power_draw_kw * assignedDc.hourly_pue[submitHour],
        totalEnergyKwh: task.energy_kwh * assignedDc.hourly_pue[submitHour],
        netGridEnergyKwh: task.energy_kwh * assignedDc.hourly_pue[submitHour],
        costUsd: task.energy_kwh * assignedDc.hourly_pue[submitHour] * (grid.lmp_usd_per_mwh[submitHour] / 1000),
        carbonKg: task.energy_kwh * assignedDc.hourly_pue[submitHour] * grid.carbon_g_co2_per_kwh[submitHour] / 1000,
        latencyMs: computeDistanceKm(task.origin_lat, task.origin_lon, assignedDc.lat, assignedDc.lon) / 100 + 5,
        distanceKm: computeDistanceKm(task.origin_lat, task.origin_lon, assignedDc.lat, assignedDc.lon),
        pue: assignedDc.hourly_pue[submitHour],
        lmpUsdPerMwh: grid.lmp_usd_per_mwh[submitHour],
        carbonGCo2PerKwh: grid.carbon_g_co2_per_kwh[submitHour],
        solarOffsetKwh: 0,
      }
    }

    schedule.push(buildScheduledTask(task, assignedDc, submitHour, placement, 1, false, null))
  }

  return buildResult(1, schedule, dropped, cap)
}

// ── Mode 2 & 3: Optimized ────────────────────────────────────────────────────

function scheduleOptimized(
  mode: 2 | 3,
  tasks: Task[],
  dcs: DataCenter[],
  grids: Map<string, GridProfile>,
): SimulationResult {
  const cap = initCapacity(dcs)
  const schedule: ScheduledTask[] = []
  const dropped: string[] = []
  const includeSolar = mode === 3

  // Process live Aug 15 tasks only — no backlog.
  // All three modes now compare apples-to-apples on the same 8,000 live tasks.
  const liveTasks = tasks.filter(t => !t.is_backlog)

  // Process Flex 1 first (hard real-time), then Flex 2, then Flex 3
  const byFlexThenTime = [...liveTasks].sort((a, b) => {
    if (a.flex_type !== b.flex_type) return a.flex_type - b.flex_type
    return (a.submit_hour + a.submit_minute_frac / 60) -
           (b.submit_hour + b.submit_minute_frac / 60)
  })

  for (const task of byFlexThenTime) {
    // Filter DCs to those with capacity in the task's feasible window
    const submitHour = Math.floor(task.submit_minute_frac)
    // Allow tasks to schedule into Aug 16 overnight (hours 24-47).
    // Previously capped at hour 22/23 which caused late-day tasks to be dropped
    // even when overnight capacity was available.
    const maxHour = Math.min(47, Math.floor(task.submit_minute_frac + task.deadline_hours))

    const feasibleDcs = dcs.filter(dc => {
      // Must host the required model (Flex 2/3 have null model_id so always pass)
      if (!dcHostsModel(dc, task)) return false
      // At least one hour in the window has capacity
      for (let h = submitHour; h <= maxHour; h++) {
        if (hasCapacity(cap, dc, h, task.duration_hours, task.gpu_count)) return true
      }
      return false
    })

    if (feasibleDcs.length === 0) {
      dropped.push(task.request_id)
      continue
    }

    // Flex 1: hard real-time — bypass objective function entirely.
    // Route to nearest DC that hosts the required model with available capacity.
    // Model placement constraint may force routing past the geographically nearest DC.
    if (task.flex_type === 1) {
      const byDistance = [...feasibleDcs].sort((a, b) =>
        computeDistanceKm(task.origin_lat, task.origin_lon, a.lat, a.lon) -
        computeDistanceKm(task.origin_lat, task.origin_lon, b.lat, b.lon)
      )
      const nearestDc = byDistance.find(dc =>
        dcHostsModel(dc, task) &&
        hasCapacity(cap, dc, submitHour, task.duration_hours, task.gpu_count)
      )
      if (!nearestDc) {
        dropped.push(task.request_id)
        continue
      }
      const grid = grids.get(nearestDc.utility_id)!
      occupyCapacity(cap, nearestDc.id, submitHour, task.duration_hours, task.gpu_count)
      const { placement } = { placement: {
        itPowerKw:        task.power_draw_kw,
        totalPowerKw:     task.power_draw_kw * nearestDc.hourly_pue[submitHour],
        totalEnergyKwh:   task.energy_kwh * nearestDc.hourly_pue[submitHour],
        netGridEnergyKwh: task.energy_kwh * nearestDc.hourly_pue[submitHour],
        costUsd:          task.energy_kwh * nearestDc.hourly_pue[submitHour] * (grid.lmp_usd_per_mwh[submitHour] / 1000),
        carbonKg:         task.energy_kwh * nearestDc.hourly_pue[submitHour] * grid.carbon_g_co2_per_kwh[submitHour] / 1000,
        latencyMs:        computeDistanceKm(task.origin_lat, task.origin_lon, nearestDc.lat, nearestDc.lon) / 100 + 5,
        distanceKm:       computeDistanceKm(task.origin_lat, task.origin_lon, nearestDc.lat, nearestDc.lon),
        pue:              nearestDc.hourly_pue[submitHour],
        lmpUsdPerMwh:     grid.lmp_usd_per_mwh[submitHour],
        carbonGCo2PerKwh: grid.carbon_g_co2_per_kwh[submitHour],
        solarOffsetKwh:   0,
      }}
      schedule.push(buildScheduledTask(task, nearestDc, submitHour, placement, mode, false, null))
      continue
    }

    const best: BestPlacement | null = findBestPlacement(task, feasibleDcs, grids, includeSolar, cap)

    if (!best) {
      dropped.push(task.request_id)
      continue
    }

    const assignedDc = dcs.find(dc => dc.id === best.dcId)!

    // Verify capacity still available at chosen hour (findBestPlacement doesn't mutate cap)
    if (!hasCapacity(cap, assignedDc, best.scheduledHour, task.duration_hours, task.gpu_count)) {
      // Re-run placement excluding the now-full DC+hour — rare race between scoring and assignment
      const fallback = findBestPlacement(
        task,
        feasibleDcs.filter(dc => dc.id !== assignedDc.id ||
          hasCapacity(cap, dc, best.scheduledHour, task.duration_hours, task.gpu_count)),
        grids, includeSolar, cap
      )
      if (!fallback) { dropped.push(task.request_id); continue }
      const fbDc = dcs.find(dc => dc.id === fallback.dcId)!
      occupyCapacity(cap, fbDc.id, fallback.scheduledHour, task.duration_hours, task.gpu_count)
      schedule.push(buildScheduledTask(task, fbDc, fallback.scheduledHour, {
        itPowerKw: fallback.score.placement.itPowerKw,
        totalPowerKw: fallback.score.placement.totalPowerKw,
        totalEnergyKwh: fallback.score.placement.totalEnergyKwh,
        netGridEnergyKwh: fallback.score.placement.netGridEnergyKwh,
        costUsd: fallback.score.placement.costUsd,
        carbonKg: fallback.score.placement.carbonKg,
        latencyMs: fallback.score.placement.latencyMs,
        distanceKm: fallback.score.placement.distanceKm,
        pue: fallback.score.placement.pue,
        lmpUsdPerMwh: fallback.score.placement.lmpUsdPerMwh,
        carbonGCo2PerKwh: fallback.score.placement.carbonGCo2PerKwh,
        solarOffsetKwh: fallback.score.placement.solarOffsetKwh,
      }, mode, false, null, fallback.score))
      continue
    }

    occupyCapacity(cap, assignedDc.id, best.scheduledHour, task.duration_hours, task.gpu_count)

    schedule.push(buildScheduledTask(
      task,
      assignedDc,
      best.scheduledHour,
      {
        itPowerKw:         best.score.placement.itPowerKw,
        totalPowerKw:      best.score.placement.totalPowerKw,
        totalEnergyKwh:    best.score.placement.totalEnergyKwh,
        netGridEnergyKwh:  best.score.placement.netGridEnergyKwh,
        costUsd:           best.score.placement.costUsd,
        carbonKg:          best.score.placement.carbonKg,
        latencyMs:         best.score.placement.latencyMs,
        distanceKm:        best.score.placement.distanceKm,
        pue:               best.score.placement.pue,
        lmpUsdPerMwh:      best.score.placement.lmpUsdPerMwh,
        carbonGCo2PerKwh:  best.score.placement.carbonGCo2PerKwh,
        solarOffsetKwh:    best.score.placement.solarOffsetKwh,
      },
      mode,
      best.conflict.hasConflict,
      best.conflict,
      best.score,
    ))
  }

  const result = buildResult(mode, schedule, dropped, cap)

  if (mode === 3) {
    result.solar_rankings = rankSolarInvestments(dcs, grids)
  }

  return result
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface RawPlacement {
  itPowerKw: number
  totalPowerKw: number
  totalEnergyKwh: number
  netGridEnergyKwh: number
  costUsd: number
  carbonKg: number
  latencyMs: number
  distanceKm: number
  pue: number
  lmpUsdPerMwh: number
  carbonGCo2PerKwh: number
  solarOffsetKwh: number
}

function buildScheduledTask(
  task: Task,
  dc: DataCenter,
  scheduledHour: number,
  placement: RawPlacement,
  mode: SimMode,
  hasConflict: boolean,
  conflict: any,
  score?: any,
): ScheduledTask {
  const deferredBy = Math.max(0, scheduledHour - Math.floor(task.submit_minute_frac))

  return {
    request_id:              task.request_id,
    mode,
    assigned_dc_id:          dc.id,
    assigned_dc_name:        dc.name,
    scheduled_hour:          scheduledHour,
    deferred_by_hours:       deferredBy,
    status:                  deferredBy > 0 ? 'deferred' : 'scheduled',
    submit_hour:             task.submit_hour,
    submit_minute_frac:      task.submit_minute_frac,
    flex_type:               task.flex_type,
    task_type:               task.task_type,
    origin_city:             task.origin_city,
    origin_lat:              task.origin_lat,
    origin_lon:              task.origin_lon,
    gpu_count:               task.gpu_count,
    duration_hours:          task.duration_hours,
    power_draw_kw:           task.power_draw_kw,
    energy_kwh:              task.energy_kwh,
    it_power_kw:             placement.itPowerKw,
    total_power_kw:          placement.totalPowerKw,
    total_energy_kwh:        placement.totalEnergyKwh,
    net_grid_energy_kwh:     placement.netGridEnergyKwh,
    cost_usd:                placement.costUsd,
    carbon_kg:               placement.carbonKg,
    pue:                     placement.pue,
    lmp_usd_per_mwh:         placement.lmpUsdPerMwh,
    carbon_g_co2_per_kwh:    placement.carbonGCo2PerKwh,
    solar_offset_kwh:        placement.solarOffsetKwh,
    distance_km:             placement.distanceKm,
    latency_ms:              placement.latencyMs,
    cost_vs_carbon_conflict: hasConflict,
    conflict_cheapest_dc_id: conflict?.cheapestDcId ?? null,
    conflict_cleanest_dc_id: conflict?.cleanestDcId ?? null,
    score_total:             score?.totalScore   ?? 0,
    score_cost:              score?.costScore    ?? 0,
    score_carbon:            score?.carbonScore  ?? 0,
    score_latency:           score?.latencyScore ?? 0,
    score_deferral:          score?.deferralScore ?? 0,
  }
}

function buildResult(
  mode: SimMode,
  schedule: ScheduledTask[],
  dropped: string[],
  cap: DCHourlyCapacity,
): SimulationResult {
  return {
    mode,
    schedule,
    dropped_tasks:           dropped,
    dc_hourly_gpu_usage:     cap,
    total_cost_usd:          schedule.reduce((s, t) => s + t.cost_usd, 0),
    total_carbon_kg:         schedule.reduce((s, t) => s + t.carbon_kg, 0),
    total_tasks_scheduled:   schedule.length,
    total_tasks_deferred:    schedule.filter(t => t.status === 'deferred').length,
    total_tasks_dropped:     dropped.length,
    total_energy_kwh:        schedule.reduce((s, t) => s + t.net_grid_energy_kwh, 0),
    conflict_count:          schedule.filter(t => t.cost_vs_carbon_conflict).length,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the simulation for a given mode.
 *
 * @param mode   1 = baseline, 2 = optimized, 3 = optimized + solar/storage
 * @param tasks  All 1,000 workload tasks from workloads.json
 * @param dcs    All 6 data centers from data_centers.json
 * @param grids  All 6 grid profiles from grid.json
 * @returns      Full simulation result including schedule and fleet aggregates
 */
export function runSimulation(
  mode: SimMode,
  tasks: Task[],
  dcs: DataCenter[],
  grids: GridProfile[],
): SimulationResult {
  const gridMap = new Map<string, GridProfile>(grids.map(g => [g.utility_id, g]))

  switch (mode) {
    case 1: return scheduleMode1(tasks, dcs, gridMap)
    case 2: return scheduleOptimized(2, tasks, dcs, gridMap)
    case 3: return scheduleOptimized(3, tasks, dcs, gridMap)
  }
}