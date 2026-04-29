/**
 * generate-workloads.ts
 *
 * Generates data/workloads.json — synthetic AI task workload for Aug 15 simulation.
 *
 * NOT run automatically. Only execute if you want to regenerate the workload
 * dataset with different parameters (task count, flex ratios, city weights, etc).
 *
 * Run with:
 *   npx ts-node --project tsconfig.scripts.json scripts/generate-workloads.ts
 *
 * WARNING: This overwrites data/workloads.json. Commit the existing file first
 * if you want to preserve the current dataset. Results also need to be
 * regenerated after changing workloads: npm run simulate
 *
 * ── Workload taxonomy ────────────────────────────────────────────────────────
 *
 * Tasks are classified into three flex types based on scheduling flexibility.
 * This taxonomy is adapted from EmeraldAI's AI workload scheduling framework
 * and Google's carbon-aware computing whitepaper (2021).
 *
 * Flex 1 — Hard real-time (inference):
 *   Live user-facing requests that require immediate response.
 *   Cannot be deferred. Routed to nearest DC hosting the required model.
 *   GPU count: 1–4 (single request, small batch)
 *   Duration: seconds to minutes (~5min avg)
 *   Deadline: 5 minutes (SLA)
 *   Examples: chatbot inference, API calls, streaming generation
 *
 * Flex 2 — Soft real-time (batch/training):
 *   Time-sensitive but not user-blocking. Can be deferred within a window.
 *   Routed by cost + carbon objective function.
 *   GPU count: 4–64 (multi-GPU training runs)
 *   Duration: 30min – 6hrs
 *   Deadline: 1.5× duration or 4hrs minimum
 *   Examples: batch inference, fine-tuning, data preprocessing
 *
 * Flex 3 — Background (best-effort):
 *   No hard latency requirement. Can be deferred up to 24hrs.
 *   Scheduler optimizes aggressively — may defer to cheapest overnight window.
 *   GPU count: 8–128 (large training jobs)
 *   Duration: 2hrs – 12hrs
 *   Deadline: 24 hours
 *   Examples: full model retraining, historical batch processing, eval sweeps
 *
 * ── Demand distribution ──────────────────────────────────────────────────────
 *
 * Hourly demand follows a realistic AI request pattern for a US-based service:
 *   - Morning ramp: 6am–10am (East Coast business hours starting)
 *   - Midday peak: 10am–3pm (full US business day overlap)
 *   - Afternoon secondary peak: 2pm–4pm
 *   - Evening shoulder: 5pm–9pm (consumer usage)
 *   - Overnight trough: 10pm–5am (minimal activity)
 *
 * Reference: Anthropic API traffic patterns (anonymized); similar patterns
 * documented in Meta's "Sustainable AI" paper (Wu et al., 2022).
 *
 * ── Geographic origin distribution ──────────────────────────────────────────
 *
 * Request origins are distributed across 21 US cities weighted by
 * approximate AI startup/enterprise density, loosely based on:
 *   - Crunchbase AI company concentration by metro (2023)
 *   - Bureau of Labor Statistics tech employment by MSA
 *   - NYC and SF/Bay Area dominate enterprise AI API traffic
 *
 * ── Power and energy modeling ────────────────────────────────────────────────
 *
 * GPU power draw modeled per NVIDIA H100 SXM5 TDP specs:
 *   Idle power:  3.0 kW/GPU (memory refresh, minimal compute)
 *   Max power:   5.0 kW/GPU (full FP16/BF16 matmul throughput)
 *   Actual draw: idle + (max - idle) × avg_gpu_utilization
 *
 * Average GPU utilization is sampled per flex type:
 *   Flex 1: 82–96% (single request, fully utilizing the allocated GPUs)
 *   Flex 2: 68–88% (batch jobs, some padding/fragmentation)
 *   Flex 3: 55–78% (large training, checkpointing reduces effective util)
 *
 * Energy = power × duration (kWh)
 * Total facility energy = IT energy × PUE (from grid.json hourly_pue)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs   from 'fs'
import * as path from 'path'

const ROOT = path.join(__dirname, '..')

// ── Configuration ─────────────────────────────────────────────────────────────
// Change these to experiment with different scenarios.

const CONFIG = {
  RANDOM_SEED:    42,          // Fixed seed for reproducibility
  LIVE_TASKS:     8000,        // Aug 15 live task count
  BACKLOG_TASKS:  0,           // Aug 14 carry-over (set >0 to add overnight backlog)
  SIM_DATE:       '2024-08-15',

  // H100 SXM5 power envelope (kW per GPU)
  GPU_IDLE_KW:    3.0,
  GPU_MAX_KW:     5.0,

  // Flex type mix during different times of day
  // Format: [flex1_weight, flex2_weight, flex3_weight]
  FLEX_MIX_OVERNIGHT:  [0.15, 0.30, 0.55],  // 0–6am: background-heavy
  FLEX_MIX_RAMP:       [0.35, 0.40, 0.25],  // 6–9am: ramping
  FLEX_MIX_PEAK:       [0.55, 0.33, 0.12],  // 9am–6pm: inference-heavy
  FLEX_MIX_EVENING:    [0.40, 0.38, 0.22],  // 6pm–midnight
}

// ── Model distribution for Flex 1 tasks ─────────────────────────────────────
// Must match models in data/models.json and data/placement.json

const MODEL_WEIGHTS: Record<string, number> = {
  flash_7b:   0.48,
  sonnet_35b: 0.32,
  opus_70b:   0.12,
  vision_13b: 0.08,
}

// ── City distribution ─────────────────────────────────────────────────────────
// [name, lat, lon, weight]
// Weights sum to 1.0. Add new cities by appending to this array.

const CITIES: [string, number, number, number][] = [
  ['New York NY',       40.7128, -74.0060,  0.16],
  ['San Francisco CA',  37.7749,-122.4194,  0.14],
  ['Los Angeles CA',    34.0522,-118.2437,  0.10],
  ['Chicago IL',        41.8781, -87.6298,  0.08],
  ['Seattle WA',        47.6062,-122.3321,  0.07],
  ['Boston MA',         42.3601, -71.0589,  0.06],
  ['Austin TX',         30.2672, -97.7431,  0.05],
  ['Washington DC',     38.9072, -77.0369,  0.05],
  ['Dallas TX',         32.7767, -96.7970,  0.04],
  ['Atlanta GA',        33.7490, -84.3880,  0.04],
  ['Denver CO',         39.7392,-104.9903,  0.03],
  ['Miami FL',          25.7617, -80.1918,  0.03],
  ['Phoenix AZ',        33.4484,-112.0740,  0.03],
  ['Minneapolis MN',    44.9778, -93.2650,  0.02],
  ['Portland OR',       45.5051,-122.6750,  0.02],
  ['San Diego CA',      32.7157,-117.1611,  0.02],
  ['Philadelphia PA',   39.9526, -75.1652,  0.02],
  ['Detroit MI',        42.3314, -83.0458,  0.01],
  ['Nashville TN',      36.1627, -86.7816,  0.01],
  ['Salt Lake City UT', 40.7608,-111.8910,  0.01],
  ['Raleigh NC',        35.7796, -78.6382,  0.01],
]

const TASK_TYPES: Record<number, string[]> = {
  1: ['live_inference', 'api_inference', 'streaming_inference'],
  2: ['batch_inference', 'model_training', 'fine_tuning', 'data_preprocessing'],
  3: ['model_retraining', 'historical_batch', 'data_pipeline', 'eval_sweep'],
}

// ── Seeded RNG (LCG) ─────────────────────────────────────────────────────────

let _seed = CONFIG.RANDOM_SEED

function rand(): number {
  _seed = (_seed * 1664525 + 1013904223) & 0xffffffff
  return ((_seed >>> 0) / 0xffffffff)
}

function randGaussian(mean = 0, std = 1): number {
  const u1 = rand() + 0.0001
  const u2 = rand()
  return mean + std * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function weightedChoice<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

// ── Demand curve ──────────────────────────────────────────────────────────────

function demandWeight(hour: number): number {
  const morning   = Math.exp(-0.5 * ((hour - 10) / 2.5) ** 2) * 1.0
  const midday    = Math.exp(-0.5 * ((hour - 12) / 2.5) ** 2) * 0.7
  const afternoon = Math.exp(-0.5 * ((hour - 14) / 2.5) ** 2) * 0.8
  const evening   = Math.exp(-0.5 * ((hour - 19) / 2.0) ** 2) * 0.4
  return Math.max(0.05, morning + midday + afternoon + evening)
}

// ── Task generation helpers ───────────────────────────────────────────────────

function pickFlexType(hour: number): 1 | 2 | 3 {
  let mix: number[]
  if      (hour < 6)  mix = CONFIG.FLEX_MIX_OVERNIGHT
  else if (hour < 9)  mix = CONFIG.FLEX_MIX_RAMP
  else if (hour < 18) mix = CONFIG.FLEX_MIX_PEAK
  else                mix = CONFIG.FLEX_MIX_EVENING
  const r = rand()
  if (r < mix[0])          return 1
  if (r < mix[0] + mix[1]) return 2
  return 3
}

function pickGpuCount(flex: number): number {
  if (flex === 1) {
    const r = rand()
    return r < 0.75 ? 1 : r < 0.93 ? 2 : 4
  }
  if (flex === 2) {
    const raw = Math.round(Math.exp(randGaussian(Math.log(16), 0.7)))
    return Math.max(4, Math.min(64, Math.round(raw / 4) * 4))
  }
  const raw = Math.round(Math.exp(randGaussian(Math.log(32), 0.6)))
  return Math.max(8, Math.min(128, Math.round(raw / 8) * 8))
}

function pickDuration(flex: number): number {
  if (flex === 1) return Math.round((-1 / 12) * Math.log(rand() + 0.001) * 1000) / 1000
  if (flex === 2) return Math.round((rand() * 5.5 + 0.5) * 100) / 100
  return Math.round((rand() * 10.0 + 2.0) * 100) / 100
}

function pickUtilization(flex: number): number {
  if (flex === 1) return Math.round((rand() * 0.14 + 0.82) * 1000) / 1000
  if (flex === 2) return Math.round((rand() * 0.20 + 0.68) * 1000) / 1000
  return Math.round((rand() * 0.23 + 0.55) * 1000) / 1000
}

function computePowerKw(gpuCount: number, utilization: number): number {
  return Math.round(gpuCount * (CONFIG.GPU_IDLE_KW + (CONFIG.GPU_MAX_KW - CONFIG.GPU_IDLE_KW) * utilization) * 100) / 100
}

function deadlineHours(flex: number, duration: number): number {
  if (flex === 1) return Math.round(5 / 60 * 10000) / 10000
  if (flex === 2) return Math.round(Math.max(duration * 1.5, 4.0) * 100) / 100
  return 24.0
}

// ── Main generation ───────────────────────────────────────────────────────────

const weights24 = Array.from({ length: 24 }, (_, h) => demandWeight(h))
const totalW    = weights24.reduce((s, w) => s + w, 0)
const tasksPerHour = weights24.map(w => Math.round(CONFIG.LIVE_TASKS * w / totalW))

// Correct for rounding
const deficit = CONFIG.LIVE_TASKS - tasksPerHour.reduce((s, n) => s + n, 0)
tasksPerHour[10] += deficit

const tasks: Record<string, unknown>[] = []
let taskId = 1

// Live Aug 15 tasks
for (let hour = 0; hour < 24; hour++) {
  for (let i = 0; i < tasksPerHour[hour]; i++) {
    const minute = rand() * 59.99
    const flex   = pickFlexType(hour)
    const gpus   = pickGpuCount(flex)
    const dur    = pickDuration(flex)
    const util   = pickUtilization(flex)
    const power  = computePowerKw(gpus, util)
    const [city, lat, lon] = weightedChoice(CITIES, CITIES.map(c => c[3]))

    const submitMinFrac = Math.round((hour + minute / 60) * 10000) / 10000

    tasks.push({
      request_id:         `task_${String(taskId).padStart(5, '0')}`,
      submit_time:        `${CONFIG.SIM_DATE}T${String(hour).padStart(2,'0')}:${String(Math.floor(minute)).padStart(2,'0')}:${String(Math.floor((minute%1)*60)).padStart(2,'0')}`,
      submit_hour:        hour,
      submit_minute_frac: submitMinFrac,
      origin_city:        city,
      origin_lat:         lat,
      origin_lon:         lon,
      flex_type:          flex,
      task_type:          weightedChoice(TASK_TYPES[flex], TASK_TYPES[flex].map(() => 1)),
      gpu_count:          gpus,
      avg_gpu_util:       util,
      duration_hours:     dur,
      deadline_hours:     deadlineHours(flex, dur),
      memory_gb:          Math.round(Math.min(gpus * rand() * 52 + gpus * 20, gpus * 80) * 10) / 10,
      power_draw_kw:      power,
      energy_kwh:         Math.round(power * dur * 1000) / 1000,
      is_backlog:         false,
      model_id:           flex === 1
        ? weightedChoice(Object.keys(MODEL_WEIGHTS), Object.values(MODEL_WEIGHTS))
        : null,
    })
    taskId++
  }
}

// Optional backlog from Aug 14
for (let i = 0; i < CONFIG.BACKLOG_TASKS; i++) {
  const flex  = rand() < 0.55 ? 2 : 3
  const gpus  = pickGpuCount(flex)
  const dur   = pickDuration(flex)
  const util  = pickUtilization(flex)
  const power = computePowerKw(gpus, util)
  const [city, lat, lon] = weightedChoice(CITIES, CITIES.map(c => c[3]))
  const submitFrac = Math.round(rand() * 0.9 * 10000) / 10000

  const prevHour = 20 + Math.floor(rand() * 4)
  const prevMin  = Math.floor(rand() * 60)

  tasks.push({
    request_id:         `task_${String(taskId).padStart(5, '0')}`,
    submit_time:        `2024-08-14T${String(prevHour).padStart(2,'0')}:${String(prevMin).padStart(2,'0')}:00`,
    submit_hour:        0,
    submit_minute_frac: submitFrac,
    origin_city:        city,
    origin_lat:         lat,
    origin_lon:         lon,
    flex_type:          flex,
    task_type:          weightedChoice(TASK_TYPES[flex], TASK_TYPES[flex].map(() => 1)),
    gpu_count:          gpus,
    avg_gpu_util:       util,
    duration_hours:     dur,
    deadline_hours:     24.0,
    memory_gb:          Math.round(Math.min(gpus * rand() * 52 + gpus * 20, gpus * 80) * 10) / 10,
    power_draw_kw:      power,
    energy_kwh:         Math.round(power * dur * 1000) / 1000,
    is_backlog:         true,
    model_id:           null,
  })
  taskId++
}

// ── Write output ──────────────────────────────────────────────────────────────

const outPath = path.join(ROOT, 'data/workloads.json')
fs.writeFileSync(outPath, JSON.stringify(tasks, null, 2))

// Summary
const flex1 = tasks.filter(t => t.flex_type === 1)
const flex2 = tasks.filter(t => t.flex_type === 2)
const flex3 = tasks.filter(t => t.flex_type === 3)
const backlog = tasks.filter(t => t.is_backlog)
const modelDist = Object.fromEntries(
  Object.keys(MODEL_WEIGHTS).map(m => [m, flex1.filter(t => t.model_id === m).length])
)

console.log(`Generated data/workloads.json:`)
console.log(`  Total tasks:  ${tasks.length}`)
console.log(`  Live Aug 15:  ${tasks.length - backlog.length}`)
console.log(`  Backlog:      ${backlog.length}`)
console.log()
console.log(`  Flex 1 (inference):  ${flex1.length} (${(flex1.length/tasks.length*100).toFixed(1)}%)`)
console.log(`  Flex 2 (training):   ${flex2.length} (${(flex2.length/tasks.length*100).toFixed(1)}%)`)
console.log(`  Flex 3 (background): ${flex3.length} (${(flex3.length/tasks.length*100).toFixed(1)}%)`)
console.log()
console.log(`  Model distribution (Flex 1):`)
for (const [m, count] of Object.entries(modelDist)) {
  console.log(`    ${m.padEnd(15)} ${count} (${(count/flex1.length*100).toFixed(1)}%)`)
}
console.log()
console.log(`  Hourly distribution:`)
for (let h = 0; h < 24; h++) {
  const n   = tasksPerHour[h]
  const bar = '█'.repeat(Math.round(n / 20))
  console.log(`    ${String(h).padStart(2,'0')}:00  ${String(n).padStart(4)}  ${bar}`)
}
console.log()
console.log(`Done. Run npm run simulate to generate results.`)