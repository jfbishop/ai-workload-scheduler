/**
 * simulationStore.ts
 *
 * Zustand store — single source of truth for all dashboard state.
 * Holds loaded data, simulation results, playback clock, and UI state.
 *
 * Usage:
 *   const { currentHour, activeMode } = useSimulationStore()
 *   const { setMode, tick } = useSimulationStore()
 */

import { create } from 'zustand'
import type {
  DataCenter,
  GridProfile,
  Task,
  SimulationResult,
  ScheduledTask,
  SimMode,
  DashTab,
  DCHourlyStats,
  FleetHourlyStats,
  DCTotalStats,
  ConflictRecord,
} from '@/simulation/types'

// ── Derived data helpers ───────────────────────────────────────────────────────

/** Build per-DC hourly stats from a schedule */
export function buildDCHourlyStats(
  schedule: ScheduledTask[],
  dcs: DataCenter[],
): DCHourlyStats[] {
  const results: DCHourlyStats[] = []

  for (const dc of dcs) {
    for (let h = 0; h < 24; h++) {
      const hourTasks = schedule.filter(
        t => t.assigned_dc_id === dc.id && t.scheduled_hour === h,
      )
      const inference   = hourTasks.filter(t => t.flex_type === 1).length
      const training    = hourTasks.filter(t => t.flex_type === 2).length
      const background  = hourTasks.filter(t => t.flex_type === 3).length
      const energy      = hourTasks.reduce((s, t) => s + t.net_grid_energy_kwh, 0)
      const carbon      = hourTasks.reduce((s, t) => s + t.carbon_kg, 0)
      const cost        = hourTasks.reduce((s, t) => s + t.cost_usd, 0)
      const gpusUsed    = hourTasks.reduce((s, t) => s + t.gpu_count, 0)
      const utilPct     = dc.gpu_count > 0 ? (gpusUsed / dc.gpu_count) * 100 : 0

      results.push({
        dcId:               dc.id,
        hour:               h,
        inference_jobs:     inference,
        training_jobs:      training,
        background_jobs:    background,
        total_jobs:         hourTasks.length,
        total_energy_kwh:   energy,
        total_carbon_kg:    carbon,
        total_cost_usd:     cost,
        gpu_utilization_pct: utilPct,
      })
    }
  }
  return results
}

/** Build fleet-wide hourly stats from a schedule */
export function buildFleetHourlyStats(schedule: ScheduledTask[]): FleetHourlyStats[] {
  return Array.from({ length: 24 }, (_, h) => {
    const hourTasks = schedule.filter(t => t.scheduled_hour === h)
    return {
      hour:             h,
      total_jobs:       hourTasks.length,
      total_energy_kwh: hourTasks.reduce((s, t) => s + t.net_grid_energy_kwh, 0),
      total_carbon_kg:  hourTasks.reduce((s, t) => s + t.carbon_kg, 0),
      total_cost_usd:   hourTasks.reduce((s, t) => s + t.cost_usd, 0),
      flex1_jobs:       hourTasks.filter(t => t.flex_type === 1).length,
      flex2_jobs:       hourTasks.filter(t => t.flex_type === 2).length,
      flex3_jobs:       hourTasks.filter(t => t.flex_type === 3).length,
    }
  })
}

/** Build per-DC total stats from a schedule */
export function buildDCTotalStats(
  schedule: ScheduledTask[],
  dcs: DataCenter[],
): DCTotalStats[] {
  return dcs.map(dc => {
    const dcTasks = schedule.filter(t => t.assigned_dc_id === dc.id)
    return {
      dcId:           dc.id,
      dcName:         dc.name,
      inference_jobs:  dcTasks.filter(t => t.flex_type === 1).length,
      training_jobs:   dcTasks.filter(t => t.flex_type === 2).length,
      background_jobs: dcTasks.filter(t => t.flex_type === 3).length,
      total_jobs:      dcTasks.length,
      total_energy_kwh: dcTasks.reduce((s, t) => s + t.net_grid_energy_kwh, 0),
      total_carbon_kg:  dcTasks.reduce((s, t) => s + t.carbon_kg, 0),
      total_cost_usd:   dcTasks.reduce((s, t) => s + t.cost_usd, 0),
    }
  })
}

/** Extract conflict records from a schedule for display */
export function buildConflicts(schedule: ScheduledTask[]): ConflictRecord[] {
  return schedule
    .filter(t => t.cost_vs_carbon_conflict)
    .map(t => ({
      request_id:             t.request_id,
      origin_city:            t.origin_city,
      flex_type:              t.flex_type,
      task_type:              t.task_type,
      assigned_dc_name:       t.assigned_dc_name,
      scheduled_hour:         t.scheduled_hour,
      lmp_usd_per_mwh:        t.lmp_usd_per_mwh,
      carbon_g_co2_per_kwh:   t.carbon_g_co2_per_kwh,
      conflict_cheapest_dc_id: t.conflict_cheapest_dc_id,
      conflict_cleanest_dc_id: t.conflict_cleanest_dc_id,
      cost_usd:               t.cost_usd,
      carbon_kg:              t.carbon_kg,
    }))
}

/** Tasks visible in the queue at a given sim hour (submitted ≤ hour, not yet complete) */
export function getVisibleQueueTasks(
  schedule: ScheduledTask[],
  currentHour: number,
  limit = 8,
): ScheduledTask[] {
  return schedule
    .filter(t => t.submit_hour <= currentHour && t.scheduled_hour >= currentHour)
    .sort((a, b) => a.flex_type - b.flex_type || a.scheduled_hour - b.scheduled_hour)
    .slice(0, limit)
}

/** Running cost/carbon totals up to and including currentHour */
export function getRunningTotals(
  schedule: ScheduledTask[],
  currentHour: number,
): { cost: number; carbon: number; scheduled: number; deferred: number; conflicts: number } {
  const done = schedule.filter(t => t.scheduled_hour <= currentHour)
  return {
    cost:      done.reduce((s, t) => s + t.cost_usd, 0),
    carbon:    done.reduce((s, t) => s + t.carbon_kg, 0),
    scheduled: done.filter(t => t.status === 'scheduled').length,
    deferred:  done.filter(t => t.status === 'deferred').length,
    conflicts: done.filter(t => t.cost_vs_carbon_conflict).length,
  }
}

/** GPU utilization % per DC at a given hour */
export function getDCUtilizationAtHour(
  result: SimulationResult,
  dcs: DataCenter[],
  hour: number,
): Array<{ dcId: string; dcName: string; gpusUsed: number; gpuCount: number; pct: number }> {
  return dcs.map(dc => {
    const gpusUsed = result.dc_hourly_gpu_usage[dc.id]?.[hour] ?? 0
    return {
      dcId:     dc.id,
      dcName:   dc.name,
      gpusUsed,
      gpuCount: dc.gpu_count,
      pct:      dc.gpu_count > 0 ? (gpusUsed / dc.gpu_count) * 100 : 0,
    }
  })
}

// ── Store state interface ─────────────────────────────────────────────────────

interface SimState {
  // ── Static data (loaded once) ──────────────────────────────────
  dcs:   DataCenter[]
  grids: GridProfile[]
  tasks: Task[]

  // ── Simulation results (one per mode) ─────────────────────────
  results: Partial<Record<SimMode, SimulationResult>>
  modesRun: SimMode[]

  // ── Active mode + tab ──────────────────────────────────────────
  activeMode: SimMode
  activeTab:  DashTab
  activeDCId: string   // selected DC for per-DC tab

  // ── Playback clock ─────────────────────────────────────────────
  currentHour:  number   // 0–23
  isPlaying:    boolean
  playbackSpeed: number  // multiplier (60 = 60x, one hour per second)

  // ── Derived data (recomputed when activeMode or results change) ─
  dcHourlyStats:  DCHourlyStats[]
  fleetHourlyStats: FleetHourlyStats[]
  dcTotalStats:   DCTotalStats[]
  conflicts:      ConflictRecord[]

  // ── Actions ────────────────────────────────────────────────────
  loadStaticData:  (dcs: DataCenter[], grids: GridProfile[], tasks: Task[]) => void
  loadResult:      (result: SimulationResult) => void
  setActiveMode:   (mode: SimMode) => void
  setActiveTab:    (tab: DashTab) => void
  setActiveDC:     (dcId: string) => void
  setCurrentHour:  (hour: number) => void
  setPlaying:      (playing: boolean) => void
  setPlaybackSpeed:(speed: number) => void
  tick:            () => void   // advance one hour (called by clock interval)
  reset:           () => void   // reset clock to hour 0
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useSimulationStore = create<SimState>((set, get) => ({
  // Initial state
  dcs:   [],
  grids: [],
  tasks: [],

  results:  {},
  modesRun: [],

  activeMode: 1,
  activeTab:  'simulation',
  activeDCId: 'dc_hammond_il',

  currentHour:   0,
  isPlaying:     false,
  playbackSpeed: 60,

  dcHourlyStats:    [],
  fleetHourlyStats: [],
  dcTotalStats:     [],
  conflicts:        [],

  // ── Actions ──────────────────────────────────────────────────────

  loadStaticData: (dcs, grids, tasks) => {
    set({ dcs, grids, tasks })
    // Set default active DC to first one
    if (dcs.length > 0 && !get().activeDCId) {
      set({ activeDCId: dcs[0].id })
    }
  },

  loadResult: (result) => {
    const { dcs, results, modesRun } = get()
    const newResults = { ...results, [result.mode]: result }
    const newModesRun = modesRun.includes(result.mode)
      ? modesRun
      : [...modesRun, result.mode].sort() as SimMode[]

    // Recompute derived data for this result
    const dcHourlyStats   = buildDCHourlyStats(result.schedule, dcs)
    const fleetHourlyStats = buildFleetHourlyStats(result.schedule)
    const dcTotalStats    = buildDCTotalStats(result.schedule, dcs)
    const conflicts       = buildConflicts(result.schedule)

    set({
      results:        newResults,
      modesRun:       newModesRun,
      activeMode:     result.mode,
      dcHourlyStats,
      fleetHourlyStats,
      dcTotalStats,
      conflicts,
    })
  },

  setActiveMode: (mode) => {
    const { results, dcs } = get()
    const result = results[mode]
    if (!result) return  // mode not run yet

    const dcHourlyStats    = buildDCHourlyStats(result.schedule, dcs)
    const fleetHourlyStats = buildFleetHourlyStats(result.schedule)
    const dcTotalStats     = buildDCTotalStats(result.schedule, dcs)
    const conflicts        = buildConflicts(result.schedule)

    set({ activeMode: mode, dcHourlyStats, fleetHourlyStats, dcTotalStats, conflicts })
  },

  setActiveTab:     (tab)   => set({ activeTab: tab }),
  setActiveDC:      (dcId)  => set({ activeDCId: dcId }),
  setCurrentHour:   (hour)  => set({ currentHour: Math.max(0, Math.min(23, hour)) }),
  setPlaying:       (playing) => set({ isPlaying: playing }),
  setPlaybackSpeed: (speed)   => set({ playbackSpeed: speed }),

  tick: () => {
    const { currentHour, isPlaying } = get()
    if (!isPlaying) return
    if (currentHour >= 23) {
      set({ isPlaying: false, currentHour: 23 })
      return
    }
    set({ currentHour: currentHour + 1 })
  },

  reset: () => set({ currentHour: 0, isPlaying: false }),
}))