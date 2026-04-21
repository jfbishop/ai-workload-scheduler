/**
 * physics.ts
 *
 * Pure math layer for the AI workload scheduler simulation.
 * No framework dependencies — runs in Node.js scripts and browser alike.
 *
 * All functions are pure (no side effects, no global state).
 * Units are explicit in every function name and comment.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

export const GPU_P_MAX_KW  = 5.0  // kW per GPU at 100% utilization (H100-class)
export const GPU_P_IDLE_KW = 3.0  // kW per GPU at idle (0.6 × P_max, industry standard)
export const PUE_BASE      = 1.3  // baseline Power Usage Effectiveness
export const PUE_TEMP_COEFF = 0.01 // additional PUE per °C above 20°C ambient
export const PUE_MAX       = 1.6  // cap — above this cooling becomes limiting factor
export const PUE_TEMP_BASE = 20   // °C at which PUE_BASE applies

export const LATENCY_BASE_MS       = 5    // ms — base RTT (switching, queuing)
export const LATENCY_MS_PER_100KM  = 1    // ms per 100 km propagation delay
export const EARTH_RADIUS_KM       = 6371

// Solar production window and shape
export const SOLAR_HOUR_START = 6   // first hour with meaningful production
export const SOLAR_HOUR_END   = 19  // last hour with meaningful production
export const SOLAR_PEAK_HOUR  = 12.5 // hour of peak insolation (solar noon approx)
export const SOLAR_SIGMA      = 3.2  // Gaussian width in hours (≈ 6-7hr FWHM)

// ── Types (mirrored from types.ts for standalone use) ─────────────────────────

export interface DataCenter {
  id: string
  name: string
  lat: number
  lon: number
  capacity_mw: number
  gpu_count: number
  roof_sqft: number
  roof_m2: number
  solar_potential_kw_peak: number
  solar_potential_kwh_per_day: number
  panel_efficiency: number
  gpu_p_max_kw: number
  gpu_p_idle_kw: number
  hourly_ambient_temp_c: number[]  // length 24
  hourly_pue: number[]             // length 24
  utility_id: string
  grid_operator: string
  insolation_peak_sun_hours: number
}

export interface GridProfile {
  utility_id: string
  name: string
  lmp_usd_per_mwh: number[]       // length 24
  carbon_g_co2_per_kwh: number[]  // length 24
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
  is_backlog?: boolean
}

// ── GPU Power ─────────────────────────────────────────────────────────────────

/**
 * Compute instantaneous GPU power draw in kW.
 * Formula: P = P_idle + (P_max - P_idle) × utilization
 * Scaled by GPU count.
 *
 * @param gpuCount   Number of GPUs assigned to this task
 * @param avgUtil    Average GPU utilization 0–1
 * @returns          Total IT power in kW (before PUE)
 */
export function computeGpuPowerKw(gpuCount: number, avgUtil: number): number {
  const perGpu = GPU_P_IDLE_KW + (GPU_P_MAX_KW - GPU_P_IDLE_KW) * avgUtil
  return gpuCount * perGpu
}

/**
 * Compute energy consumed by a task in kWh.
 *
 * @param powerKw        IT power draw in kW
 * @param durationHours  Task runtime in hours
 * @returns              Energy in kWh
 */
export function computeEnergyKwh(powerKw: number, durationHours: number): number {
  return powerKw * durationHours
}

// ── PUE (cooling overhead) ────────────────────────────────────────────────────

/**
 * Compute Power Usage Effectiveness (PUE) from ambient temperature.
 * PUE = 1.3 + max(0, temp_c - 20) × 0.01, capped at 1.6.
 * PUE > 1 means cooling and overhead consume that multiple of IT load.
 *
 * @param ambientTempC  Outside air temperature in °C
 * @returns             PUE dimensionless ratio ≥ 1.3
 */
export function computePUE(ambientTempC: number): number {
  const raw = PUE_BASE + Math.max(0, ambientTempC - PUE_TEMP_BASE) * PUE_TEMP_COEFF
  return Math.min(PUE_MAX, raw)
}

/**
 * Compute total facility power draw including cooling overhead.
 *
 * @param itPowerKw  IT equipment power (GPUs + servers) in kW
 * @param pue        Power Usage Effectiveness ratio
 * @returns          Total facility power in kW
 */
export function computeTotalPowerKw(itPowerKw: number, pue: number): number {
  return itPowerKw * pue
}

/**
 * Compute total energy including PUE overhead.
 *
 * @param itEnergyKwh  Raw IT energy in kWh
 * @param pue          PUE ratio
 * @returns            Total facility energy in kWh
 */
export function computeTotalEnergyKwh(itEnergyKwh: number, pue: number): number {
  return itEnergyKwh * pue
}

// ── Geography ─────────────────────────────────────────────────────────────────

/**
 * Haversine great-circle distance between two lat/lon points.
 *
 * @returns Distance in km
 */
export function computeDistanceKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

/**
 * Estimate network round-trip latency from task origin to data center.
 * Uses propagation delay model: 1ms per 100km + 5ms base RTT.
 *
 * @param distanceKm  Great-circle distance in km
 * @returns           Estimated latency in ms
 */
export function computeLatencyMs(distanceKm: number): number {
  return LATENCY_BASE_MS + (distanceKm / 100) * LATENCY_MS_PER_100KM
}

// ── Cost and Carbon ───────────────────────────────────────────────────────────

/**
 * Compute electricity cost for a task.
 *
 * @param totalEnergyKwh  Total facility energy (after PUE) in kWh
 * @param lmpUsdPerMwh    Locational marginal price in $/MWh
 * @returns               Cost in USD
 */
export function computeCostUsd(totalEnergyKwh: number, lmpUsdPerMwh: number): number {
  return totalEnergyKwh * (lmpUsdPerMwh / 1000)
}

/**
 * Compute carbon emissions for a task.
 *
 * @param totalEnergyKwh      Total facility energy (after PUE) in kWh
 * @param carbonGCo2PerKwh    Grid carbon intensity in gCO₂/kWh
 * @returns                   Carbon emitted in kg CO₂
 */
export function computeCarbonKg(totalEnergyKwh: number, carbonGCo2PerKwh: number): number {
  return (totalEnergyKwh * carbonGCo2PerKwh) / 1000
}

// ── Grid Lookups ──────────────────────────────────────────────────────────────

/**
 * Safely retrieve an hourly value from a 24-element array.
 * Clamps hour to [0, 23] — never throws.
 *
 * @param hourlyArray  24-element array indexed by hour of day
 * @param hour         Hour of day (0–23); fractional hours are floored
 * @returns            Value at that hour
 */
export function getHourlyValue(hourlyArray: number[], hour: number): number {
  const h = Math.max(0, Math.min(23, Math.floor(hour)))
  return hourlyArray[h]
}

/**
 * Get the LMP at a given hour for a grid profile.
 */
export function getLMP(grid: GridProfile, hour: number): number {
  return getHourlyValue(grid.lmp_usd_per_mwh, hour)
}

/**
 * Get the carbon intensity at a given hour for a grid profile.
 */
export function getCarbonIntensity(grid: GridProfile, hour: number): number {
  return getHourlyValue(grid.carbon_g_co2_per_kwh, hour)
}

/**
 * Get the ambient temperature at a given hour for a data center.
 */
export function getAmbientTemp(dc: DataCenter, hour: number): number {
  return getHourlyValue(dc.hourly_ambient_temp_c, hour)
}

/**
 * Get the PUE at a given hour for a data center.
 */
export function getDCPue(dc: DataCenter, hour: number): number {
  return getHourlyValue(dc.hourly_pue, hour)
}

// ── Solar Production (Mode 3) ─────────────────────────────────────────────────

/**
 * Estimate solar output from rooftop panels at a given hour.
 * Uses a Gaussian bell curve centered on solar noon.
 * Output is zero outside SOLAR_HOUR_START – SOLAR_HOUR_END.
 *
 * @param dc    Data center record (contains solar_potential_kw_peak)
 * @param hour  Hour of day (0–23)
 * @returns     Solar power output in kW
 */
export function computeSolarOutputKw(dc: DataCenter, hour: number): number {
  if (hour < SOLAR_HOUR_START || hour > SOLAR_HOUR_END) return 0
  const exponent = -0.5 * ((hour - SOLAR_PEAK_HOUR) / SOLAR_SIGMA) ** 2
  return dc.solar_potential_kw_peak * Math.exp(exponent)
}

/**
 * Compute the effective net grid draw after solar offset.
 * Solar output reduces the energy drawn from the grid (and its cost/carbon).
 * Cannot go below zero (no grid export modeled in Modes 1/2).
 *
 * @param grossPowerKw   Total facility power needed in kW
 * @param solarKw        Solar output available in kW
 * @returns              Net power drawn from grid in kW
 */
export function computeNetGridDrawKw(grossPowerKw: number, solarKw: number): number {
  return Math.max(0, grossPowerKw - solarKw)
}

// ── Composite: full cost/carbon for one task at one DC at one hour ────────────

export interface TaskPlacementCost {
  itPowerKw: number
  totalPowerKw: number      // after PUE
  totalEnergyKwh: number    // after PUE
  netGridEnergyKwh: number  // after solar (Mode 3) or same as totalEnergy (Modes 1/2)
  costUsd: number
  carbonKg: number
  latencyMs: number
  distanceKm: number
  pue: number
  lmpUsdPerMwh: number
  carbonGCo2PerKwh: number
  solarOffsetKwh: number    // 0 for Modes 1/2
}

/**
 * Compute the full cost and carbon footprint of running a task
 * at a specific data center during a specific hour.
 *
 * @param task         The workload task
 * @param dc           Target data center
 * @param grid         Grid profile for that DC
 * @param scheduledHour  Hour the task will actually start (may differ from submit_hour if deferred)
 * @param includeSolar   Whether to subtract rooftop solar (Mode 3 only)
 * @returns            Full breakdown of placement cost
 */
export function computeTaskPlacementCost(
  task: Task,
  dc: DataCenter,
  grid: GridProfile,
  scheduledHour: number,
  includeSolar = false,
): TaskPlacementCost {
  // Average grid conditions across the full task runtime.
  // A task starting at hour 12 with 8hr duration runs through hour 19,
  // so we must account for the full cost/carbon profile it will experience.
  // This prevents the scheduler from greedily picking a cheap start hour
  // that runs into an expensive/dirty evening peak.
  const durationHours = task.duration_hours
  const hoursOccupied = Math.max(1, Math.ceil(durationHours))
  const runtimeHours: number[] = []
  for (let i = 0; i < hoursOccupied; i++) {
    runtimeHours.push(Math.min(23, scheduledHour + i))
  }

  // Weight each hour by how much of the task runs in it
  // First and last hours may be partial; middle hours are full
  const avgLmp = runtimeHours.reduce((s, h) => s + grid.lmp_usd_per_mwh[h], 0) / runtimeHours.length
  const avgCarbon = runtimeHours.reduce((s, h) => s + grid.carbon_g_co2_per_kwh[h], 0) / runtimeHours.length
  const avgPue = runtimeHours.reduce((s, h) => s + dc.hourly_pue[h], 0) / runtimeHours.length

  // Average solar output across runtime (only meaningful for Mode 3)
  const avgSolarKw = includeSolar
    ? runtimeHours.reduce((s, h) => s + computeSolarOutputKw(dc, h), 0) / runtimeHours.length
    : 0

  const itPowerKw      = computeGpuPowerKw(task.gpu_count, task.avg_gpu_util)
  const totalPowerKw   = computeTotalPowerKw(itPowerKw, avgPue)
  const itEnergyKwh    = computeEnergyKwh(itPowerKw, durationHours)
  const totalEnergyKwh = computeTotalEnergyKwh(itEnergyKwh, avgPue)

  const solarOffsetKwh  = includeSolar
    ? computeEnergyKwh(Math.min(avgSolarKw, totalPowerKw), durationHours)
    : 0
  const netGridEnergyKwh = Math.max(0, totalEnergyKwh - solarOffsetKwh)

  const costUsd  = computeCostUsd(netGridEnergyKwh, avgLmp)
  const carbonKg = computeCarbonKg(netGridEnergyKwh, avgCarbon)

  const distanceKm = computeDistanceKm(task.origin_lat, task.origin_lon, dc.lat, dc.lon)
  const latencyMs  = computeLatencyMs(distanceKm)

  return {
    itPowerKw,
    totalPowerKw,
    totalEnergyKwh,
    netGridEnergyKwh,
    costUsd,
    carbonKg,
    latencyMs,
    distanceKm,
    pue:              avgPue,
    lmpUsdPerMwh:     avgLmp,
    carbonGCo2PerKwh: avgCarbon,
    solarOffsetKwh,
  }
}