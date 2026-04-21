/// <reference types="node" />
/**
 * run-simulation.ts
 *
 * Orchestration script — runs all three simulation modes and writes
 * results to /results/schedule_mode{1,2,3}.json
 *
 * Usage (from project root):
 *   npm run simulate
 *
 * Prerequisites:
 *   data/workloads.json
 *   data/data_centers.json
 *   data/grid.json
 *
 * Outputs:
 *   results/schedule_mode1.json
 *   results/schedule_mode2.json
 *   results/schedule_mode3.json
 *   results/summary.json
 */

import * as fs   from 'fs'
import * as path from 'path'
import { runSimulation, type SimulationResult } from '../src/simulation/scheduler'
import type { Task, DataCenter, GridProfile }   from '../src/simulation/physics'

// ── Load data ─────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..')

function load<T>(relativePath: string): T {
  const full = path.join(ROOT, relativePath)
  if (!fs.existsSync(full)) {
    throw new Error(`Data file not found: ${full}\nRun data generation scripts first.`)
  }
  return JSON.parse(fs.readFileSync(full, 'utf-8')) as T
}

const tasks: Task[]           = load('data/workloads.json')
const dcs: DataCenter[]       = load('data/data_centers.json')
const grids: GridProfile[]    = load('data/grid.json')

console.log(`\nLoaded:`)
console.log(`  ${tasks.length} tasks`)
console.log(`  ${dcs.length} data centers`)
console.log(`  ${grids.length} grid profiles`)

// ── Run all three modes ───────────────────────────────────────────────────────

const results: SimulationResult[] = []

for (const mode of [1, 2, 3] as const) {
  console.log(`\nRunning Mode ${mode}...`)
  const start = Date.now()

  const result = runSimulation(mode, tasks, dcs, grids)
  results.push(result)

  const elapsed = ((Date.now() - start) / 1000).toFixed(2)

  console.log(`  Mode ${mode} complete in ${elapsed}s`)
  console.log(`  Scheduled:  ${result.total_tasks_scheduled}`)
  console.log(`  Deferred:   ${result.total_tasks_deferred}`)
  console.log(`  Dropped:    ${result.total_tasks_dropped}`)
  console.log(`  Cost:       $${result.total_cost_usd.toFixed(2)}`)
  console.log(`  Carbon:     ${result.total_carbon_kg.toFixed(1)} kg CO₂`)
  console.log(`  Conflicts:  ${result.conflict_count}`)

  const outPath = path.join(ROOT, `results/schedule_mode${mode}.json`)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2))
  console.log(`  → Written to results/schedule_mode${mode}.json`)
}

// ── Build summary.json ────────────────────────────────────────────────────────

const [m1, m2, m3] = results

function pctChange(baseline: number, optimized: number): string {
  const delta = ((optimized - baseline) / baseline) * 100
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`
}

const summary = {
  generated_at:    new Date().toISOString(),
  simulation_date: '2024-08-15',
  task_count:      tasks.length,

  modes: {
    mode1_baseline: {
      total_cost_usd:        m1.total_cost_usd,
      total_carbon_kg:       m1.total_carbon_kg,
      total_energy_kwh:      m1.total_energy_kwh,
      tasks_scheduled:       m1.total_tasks_scheduled,
      tasks_deferred:        m1.total_tasks_deferred,
      tasks_dropped:         m1.total_tasks_dropped,
      conflict_count:        m1.conflict_count,
    },
    mode2_optimized: {
      total_cost_usd:        m2.total_cost_usd,
      total_carbon_kg:       m2.total_carbon_kg,
      total_energy_kwh:      m2.total_energy_kwh,
      tasks_scheduled:       m2.total_tasks_scheduled,
      tasks_deferred:        m2.total_tasks_deferred,
      tasks_dropped:         m2.total_tasks_dropped,
      conflict_count:        m2.conflict_count,
      vs_baseline: {
        cost_delta_usd:    m2.total_cost_usd - m1.total_cost_usd,
        cost_pct_change:   pctChange(m1.total_cost_usd, m2.total_cost_usd),
        carbon_delta_kg:   m2.total_carbon_kg - m1.total_carbon_kg,
        carbon_pct_change: pctChange(m1.total_carbon_kg, m2.total_carbon_kg),
      },
    },
    mode3_solar: {
      total_cost_usd:        m3.total_cost_usd,
      total_carbon_kg:       m3.total_carbon_kg,
      total_energy_kwh:      m3.total_energy_kwh,
      tasks_scheduled:       m3.total_tasks_scheduled,
      tasks_deferred:        m3.total_tasks_deferred,
      tasks_dropped:         m3.total_tasks_dropped,
      conflict_count:        m3.conflict_count,
      solar_rankings:        m3.solar_rankings ?? [],
      vs_baseline: {
        cost_delta_usd:    m3.total_cost_usd - m1.total_cost_usd,
        cost_pct_change:   pctChange(m1.total_cost_usd, m3.total_cost_usd),
        carbon_delta_kg:   m3.total_carbon_kg - m1.total_carbon_kg,
        carbon_pct_change: pctChange(m1.total_carbon_kg, m3.total_carbon_kg),
      },
      vs_mode2: {
        cost_delta_usd:    m3.total_cost_usd - m2.total_cost_usd,
        cost_pct_change:   pctChange(m2.total_cost_usd, m3.total_cost_usd),
        carbon_delta_kg:   m3.total_carbon_kg - m2.total_carbon_kg,
        carbon_pct_change: pctChange(m2.total_carbon_kg, m3.total_carbon_kg),
      },
    },
  },
}

const summaryPath = path.join(ROOT, 'results/summary.json')
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
console.log(`\n→ Summary written to results/summary.json`)
console.log('\nMode comparison:')
console.log(`  Cost:   M1 $${m1.total_cost_usd.toFixed(0)} → M2 $${m2.total_cost_usd.toFixed(0)} (${pctChange(m1.total_cost_usd, m2.total_cost_usd)}) → M3 $${m3.total_cost_usd.toFixed(0)} (${pctChange(m1.total_cost_usd, m3.total_cost_usd)} vs baseline)`)
console.log(`  Carbon: M1 ${m1.total_carbon_kg.toFixed(0)}kg → M2 ${m2.total_carbon_kg.toFixed(0)}kg (${pctChange(m1.total_carbon_kg, m2.total_carbon_kg)}) → M3 ${m3.total_carbon_kg.toFixed(0)}kg (${pctChange(m1.total_carbon_kg, m3.total_carbon_kg)} vs baseline)`)
console.log('\nDone.')
