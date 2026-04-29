/**
 * types.ts
 * Shared TypeScript interfaces used across the dashboard and simulation engine.
 * These mirror the data shapes in workloads.json, data_centers.json, grid.json,
 * and the schedule_mode{1,2,3}.json results files.
 */

// ── Raw data types (match JSON files exactly) ─────────────────────────────────

export interface DataCenter {
  id: string
  name: string
  city: string
  state: string
  lat: number
  lon: number
  elevation_m: number
  capacity_mw: number
  gpu_count: number
  roof_sqft: number
  roof_m2: number
  grid_operator: string
  grid_zone: string
  utility_id: string
  insolation_peak_sun_hours: number
  solar_potential_kw_peak: number
  solar_potential_kwh_per_day: number
  panel_efficiency: number
  gpu_p_max_kw: number
  gpu_p_idle_kw: number
  hourly_ambient_temp_c: number[]   // [0..23]
  hourly_pue: number[]              // [0..23]
  battery_capacity_kwh: number
  charge_rate_kw: number
  discharge_rate_kw: number
  round_trip_efficiency: number
}

export interface GridProfile {
  utility_id: string
  name: string
  dc_ids: string[]
  simulation_date: string
  lmp_usd_per_mwh: number[]         // [0..23]
  carbon_g_co2_per_kwh: number[]    // [0..23]
  lmp_notes: string
  carbon_notes: string
}

export interface Task {
  request_id: string
  submit_time: string
  submit_hour: number
  submit_minute_frac: number
  origin_city: string
  origin_lat: number
  origin_lon: number
  flex_type: 1 | 2 | 3
  task_type: string
  gpu_count: number
  avg_gpu_util: number
  duration_hours: number
  deadline_hours: number
  memory_gb: number
  power_draw_kw: number
  energy_kwh: number
  is_backlog?: boolean   // true = submitted Aug 14, carried over to Aug 15 queue
  model_id?: string | null  // Flex 1 only — which model this request needs
}

// ── Scheduled task (output of simulation engine) ──────────────────────────────

export type SimMode = 1 | 2 | 3
export type TaskStatus = 'scheduled' | 'deferred' | 'dropped'

export interface ScheduledTask {
  request_id: string
  mode: SimMode
  assigned_dc_id: string
  assigned_dc_name: string
  scheduled_hour: number
  deferred_by_hours: number
  status: TaskStatus
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
  it_power_kw: number
  total_power_kw: number
  total_energy_kwh: number
  net_grid_energy_kwh: number
  cost_usd: number
  carbon_kg: number
  pue: number
  lmp_usd_per_mwh: number
  carbon_g_co2_per_kwh: number
  solar_offset_kwh: number
  bess_offset_kwh: number
  distance_km: number
  latency_ms: number
  cost_vs_carbon_conflict: boolean
  conflict_cheapest_dc_id: string | null
  conflict_cleanest_dc_id: string | null
  score_total: number
  score_cost: number
  score_carbon: number
  score_latency: number
  score_deferral: number
}

// ── Simulation result (schedule_mode{n}.json) ─────────────────────────────────

export interface DCHourlyGpuUsage {
  [dcId: string]: number[]  // [0..23] GPUs in use each hour
}

export interface SolarInvestmentRanking {
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

export interface BESSHourlyState {
  soc_kwh: number         // state of charge at start of this hour
  bess_offset_kw: number  // discharge power offsetting grid draw (0 when charging)
  charging: boolean       // true = battery is charging this hour
}

export interface BESSSchedule {
  dc_id: string
  hourly: BESSHourlyState[]  // 24 elements, one per simulation hour
}

export interface BESSRevenueHour {
  hour: number
  dc_load_kwh: number
  bess_discharge_kwh: number
  bess_charge_kwh_from_grid: number
  lmp_usd_per_mwh: number
  arbitrage_savings_usd: number
  charging_cost_usd: number
}

export interface BESSRevenueResult {
  dc_id: string
  dc_name: string
  market_name: string
  bess_capacity_kw: number
  arbitrage_savings_usd: number
  charging_cost_usd: number
  net_arbitrage_usd: number
  capacity_market_usd: number
  net_benefit_usd: number
  hourly: BESSRevenueHour[]
}

export interface SimulationResult {
  mode: SimMode
  schedule: ScheduledTask[]
  dropped_tasks: string[]
  dc_hourly_gpu_usage: DCHourlyGpuUsage
  solar_rankings?: SolarInvestmentRanking[]
  bess_schedules?: BESSSchedule[]
  bess_revenue?: BESSRevenueResult[]
  total_bess_arbitrage_usd?: number
  total_bess_charging_cost_usd?: number
  total_bess_net_arbitrage_usd?: number
  total_capacity_market_usd?: number
  total_bess_net_benefit_usd?: number
  total_cost_usd: number
  total_carbon_kg: number
  total_tasks_scheduled: number
  total_tasks_deferred: number
  total_tasks_dropped: number
  total_energy_kwh: number
  conflict_count: number
}

// ── Dashboard UI state ────────────────────────────────────────────────────────

export type DashTab =
  | 'simulation'
  | 'per-dc'
  | 'fleet'
  | 'grid'
  | 'solar'
  | 'compare'

// Per-DC hourly aggregates (derived, for charts)
export interface DCHourlyStats {
  dcId: string
  hour: number
  inference_jobs: number
  training_jobs: number
  background_jobs: number
  total_jobs: number
  total_energy_kwh: number
  total_carbon_kg: number
  total_cost_usd: number
  gpu_utilization_pct: number
}

// Fleet hourly aggregates (derived, for fleet summary charts)
export interface FleetHourlyStats {
  hour: number
  total_jobs: number
  total_energy_kwh: number
  total_carbon_kg: number
  total_cost_usd: number
  flex1_jobs: number
  flex2_jobs: number
  flex3_jobs: number
}

// Per-DC total aggregates (derived, for fleet summary bars)
export interface DCTotalStats {
  dcId: string
  dcName: string
  inference_jobs: number
  training_jobs: number
  background_jobs: number
  total_jobs: number
  total_energy_kwh: number
  total_carbon_kg: number
  total_cost_usd: number
}

// Conflict record for display
export interface ConflictRecord {
  request_id: string
  origin_city: string
  flex_type: 1 | 2 | 3
  task_type: string
  assigned_dc_name: string
  scheduled_hour: number
  lmp_usd_per_mwh: number
  carbon_g_co2_per_kwh: number
  conflict_cheapest_dc_id: string | null
  conflict_cleanest_dc_id: string | null
  cost_usd: number
  carbon_kg: number
}