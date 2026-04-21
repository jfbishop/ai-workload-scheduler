'use client'

/**
 * PerDCTab.tsx
 * Per-data-center analytics:
 *   - DC selector row
 *   - 4 quick-stat cards (MW, grid, total CO₂, total spend)
 *   - Dual-axis line chart: MWh consumed (left) + kg CO₂ (right) by hour
 *   - Stacked bar chart: inference + training jobs by hour
 *   - LMP sparkline for that DC's grid
 *   - Carbon intensity sparkline for that DC's grid
 */

import { useSimulationStore } from '@/store/simulationStore'
import type { DataCenter, GridProfile } from '@/simulation/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function fmtCO2(kg: number) {
  return kg >= 1000 ? (kg / 1000).toFixed(1) + ' t' : kg.toFixed(0) + ' kg'
}
function fmtMWh(kwh: number) {
  return kwh >= 1000 ? (kwh / 1000).toFixed(1) + ' MWh' : kwh.toFixed(0) + ' kWh'
}

// ── DC Selector ───────────────────────────────────────────────────────────────

function DCSelector({ dcs }: { dcs: DataCenter[] }) {
  const { activeDCId, setActiveDC } = useSimulationStore()
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
      {dcs.map(dc => {
        const active = dc.id === activeDCId
        return (
          <button
            key={dc.id}
            onClick={() => setActiveDC(dc.id)}
            style={{
              fontSize: '11px', padding: '4px 10px',
              borderRadius: '7px',
              border: active ? '0.5px solid #85B7EB' : '0.5px solid rgba(0,0,0,0.15)',
              color: active ? '#0C447C' : '#666',
              background: active ? '#E6F1FB' : 'transparent',
              cursor: 'pointer',
              fontWeight: active ? 500 : 400,
            }}
          >
            {dc.city} {dc.state}
          </button>
        )
      })}
    </div>
  )
}

// ── Info Cards ────────────────────────────────────────────────────────────────

function InfoCards({
  dc, totalCarbonKg, totalCostUsd,
}: {
  dc: DataCenter; totalCarbonKg: number; totalCostUsd: number
}) {
  const cards = [
    { val: `${dc.capacity_mw} MW`,   lbl: 'Facility size' },
    { val: dc.grid_operator,          lbl: 'Grid operator' },
    { val: fmtCO2(totalCarbonKg),    lbl: 'Total CO₂ today' },
    { val: fmt$(totalCostUsd),        lbl: 'Total electricity spend' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '8px', marginBottom: '10px' }}>
      {cards.map(c => (
        <div key={c.lbl} style={{ background: '#f4f4f2', borderRadius: '8px', padding: '8px 10px' }}>
          <div style={{ fontSize: '15px', fontWeight: 500, color: '#1a1a1a' }}>{c.val}</div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>{c.lbl}</div>
        </div>
      ))}
    </div>
  )
}

// ── Dual-Axis Line Chart ──────────────────────────────────────────────────────

function DualAxisLineChart({
  hourlyKwh, hourlyCarbonKg,
}: {
  hourlyKwh: number[]; hourlyCarbonKg: number[]
}) {
  const W = 500, H = 100
  const PAD = { top: 8, right: 8, bottom: 0, left: 8 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxKwh    = Math.max(1, ...hourlyKwh)
  const maxCarbon = Math.max(1, ...hourlyCarbonKg)

  function pointsKwh() {
    return hourlyKwh.map((v, i) => {
      const x = PAD.left + (i / 23) * chartW
      const y = PAD.top + (1 - v / maxKwh) * chartH
      return `${x},${y}`
    }).join(' ')
  }

  function pointsCarbon() {
    return hourlyCarbonKg.map((v, i) => {
      const x = PAD.left + (i / 23) * chartW
      const y = PAD.top + (1 - v / maxCarbon) * chartH
      return `${x},${y}`
    }).join(' ')
  }

  // Y-axis tick labels
  const kwhTicks    = [0, maxKwh * 0.5, maxKwh].map(v => v >= 1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(0))
  const carbonTicks = [0, maxCarbon * 0.5, maxCarbon].map(v => v >= 1000 ? (v/1000).toFixed(1)+'t' : v.toFixed(0))

  return (
    <div style={{ position: 'relative', height: '160px' }}>
      {/* Left axis labels */}
      <div style={{
        position: 'absolute', left: 0, top: 8, bottom: 22, width: '32px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        alignItems: 'flex-end', paddingRight: '4px',
      }}>
        {[...kwhTicks].reverse().map((t, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#185FA5' }}>{t}</span>
        ))}
      </div>

      {/* Right axis labels */}
      <div style={{
        position: 'absolute', right: 0, top: 8, bottom: 22, width: '32px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        alignItems: 'flex-start', paddingLeft: '4px',
      }}>
        {[...carbonTicks].reverse().map((t, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#854F0B' }}>{t}</span>
        ))}
      </div>

      {/* Chart area */}
      <div style={{
        position: 'absolute', left: '36px', right: '36px', top: 0, bottom: '22px',
        background: '#f4f4f2', borderRadius: '8px',
        border: '0.5px solid rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(p => (
            <line key={p}
              x1={PAD.left} y1={PAD.top + p * chartH}
              x2={W - PAD.right} y2={PAD.top + p * chartH}
              stroke="rgba(0,0,0,0.07)" strokeWidth={0.5} strokeDasharray="3,3"
            />
          ))}
          {/* MWh line */}
          <polyline points={pointsKwh()} fill="none" stroke="#185FA5" strokeWidth={2} />
          {/* Carbon line */}
          <polyline points={pointsCarbon()} fill="none" stroke="#BA7517" strokeWidth={2} strokeDasharray="5,3" />
        </svg>
      </div>

      {/* X axis labels */}
      <div style={{
        position: 'absolute', bottom: 0, left: '36px', right: '36px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        {['12a','3a','6a','9a','12p','3p','6p','9p','12a'].map((l, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#bbb' }}>{l}</span>
        ))}
      </div>
    </div>
  )
}

// ── Stacked Bar Chart ─────────────────────────────────────────────────────────

function StackedBarChart({
  hourlyInference, hourlyTraining, hourlyBackground,
}: {
  hourlyInference: number[]
  hourlyTraining: number[]
  hourlyBackground: number[]
}) {
  const maxJobs = Math.max(1, ...hourlyInference.map((v, i) =>
    v + hourlyTraining[i] + hourlyBackground[i]
  ))

  return (
    <div style={{ position: 'relative', height: '150px' }}>
      {/* Left axis */}
      <div style={{
        position: 'absolute', left: 0, top: 8, bottom: 22, width: '28px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        alignItems: 'flex-end', paddingRight: '4px',
      }}>
        {[maxJobs, Math.round(maxJobs * 0.5), 0].map((v, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#888' }}>{v}</span>
        ))}
      </div>

      {/* Chart area */}
      <div style={{
        position: 'absolute', left: '32px', right: '8px', top: 8, bottom: 22,
        background: '#f4f4f2', borderRadius: '8px',
        border: '0.5px solid rgba(0,0,0,0.08)',
        overflow: 'hidden',
      }}>
        <svg width="100%" height="100%" viewBox="0 0 240 100" preserveAspectRatio="none">
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(p => (
            <line key={p}
              x1={0} y1={p * 100} x2={240} y2={p * 100}
              stroke="rgba(0,0,0,0.07)" strokeWidth={0.5} strokeDasharray="3,3"
            />
          ))}

          {Array.from({ length: 24 }, (_, h) => {
            const inf  = hourlyInference[h]
            const tr   = hourlyTraining[h]
            const bg   = hourlyBackground[h]
            const total = inf + tr + bg
            if (total === 0) return null

            const x = (h / 24) * 240
            const w = (1 / 24) * 240 * 0.82
            const xc = x + ((1 / 24) * 240 - w) / 2

            const hBg  = (bg  / maxJobs) * 100
            const hTr  = (tr  / maxJobs) * 100
            const hInf = (inf / maxJobs) * 100
            const yBg  = 100 - hBg - hTr - hInf
            const yTr  = 100 - hTr - hInf
            const yInf = 100 - hInf

            return (
              <g key={h}>
                {bg  > 0 && <rect x={xc} y={yBg}  width={w} height={hBg}  fill="#1D9E75" rx={1} />}
                {tr  > 0 && <rect x={xc} y={yTr}  width={w} height={hTr}  fill="#EF9F27" rx={1} />}
                {inf > 0 && <rect x={xc} y={yInf} width={w} height={hInf} fill="#E24B4A" rx={1} />}
              </g>
            )
          })}
        </svg>
      </div>

      {/* X axis */}
      <div style={{
        position: 'absolute', bottom: 0, left: '32px', right: '8px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        {['12a','3a','6a','9a','12p','3p','6p','9p','12a'].map((l, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#bbb' }}>{l}</span>
        ))}
      </div>
    </div>
  )
}

// ── Grid Sparkline ────────────────────────────────────────────────────────────

function GridSparkline({
  values, label, unit, colorLow, colorHigh,
}: {
  values: number[]; label: string; unit: string
  colorLow: string; colorHigh: string
}) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)

  function barColor(v: number) {
    const t = (v - min) / range  // 0 = cheapest/cleanest, 1 = most expensive/dirty
    if (t < 0.33) return colorLow
    if (t < 0.66) return '#EF9F27'
    return colorHigh
  }

  return (
    <div>
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px' }}>{label}</div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '2px', height: '48px',
        background: '#f4f4f2', borderRadius: '7px',
        border: '0.5px solid rgba(0,0,0,0.08)',
        padding: '5px 5px 0',
      }}>
        {values.map((v, i) => {
          const heightPct = ((v - min) / range) * 80 + 10
          return (
            <div
              key={i}
              title={`${i}:00 — ${v.toFixed(0)} ${unit}`}
              style={{
                flex: 1, borderRadius: '1px 1px 0 0',
                height: `${heightPct}%`,
                background: barColor(v),
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
        <span style={{ fontSize: '8px', color: '#bbb' }}>12a</span>
        <span style={{ fontSize: '8px', color: '#bbb' }}>12p</span>
        <span style={{ fontSize: '8px', color: '#bbb' }}>12a</span>
      </div>
    </div>
  )
}

// ── Main PerDCTab ─────────────────────────────────────────────────────────────

export default function PerDCTab() {
  const { dcs, grids, results, activeMode, activeDCId, dcHourlyStats } = useSimulationStore()
  const result = results[activeMode]

  const dc   = dcs.find(d => d.id === activeDCId) ?? dcs[0]
  const grid = grids.find(g => g.utility_id === dc?.utility_id)

  if (!dc || !grid) {
    return (
      <div style={{ padding: '2rem', color: '#666', fontSize: '13px' }}>
        No data available — run the simulation first.
      </div>
    )
  }

  // Pull hourly stats for this DC
  const hourlyStats = Array.from({ length: 24 }, (_, h) =>
    dcHourlyStats.find(s => s.dcId === dc.id && s.hour === h) ?? {
      dcId: dc.id, hour: h,
      inference_jobs: 0, training_jobs: 0, background_jobs: 0, total_jobs: 0,
      total_energy_kwh: 0, total_carbon_kg: 0, total_cost_usd: 0, gpu_utilization_pct: 0,
    }
  )

  const hourlyKwh        = hourlyStats.map(s => s.total_energy_kwh)
  const hourlyCarbonKg   = hourlyStats.map(s => s.total_carbon_kg)
  const hourlyInference  = hourlyStats.map(s => s.inference_jobs)
  const hourlyTraining   = hourlyStats.map(s => s.training_jobs)
  const hourlyBackground = hourlyStats.map(s => s.background_jobs)

  const totalCarbonKg = hourlyCarbonKg.reduce((s, v) => s + v, 0)
  const totalCostUsd  = hourlyStats.reduce((s, v) => s + v.total_cost_usd, 0)

  const panelStyle = {
    background: '#fff',
    border: '0.5px solid rgba(0,0,0,0.10)',
    borderRadius: '12px',
    padding: '10px 12px',
    marginBottom: '10px',
  }

  const hdStyle = {
    fontSize: '11px', fontWeight: 500 as const,
    color: '#666', textTransform: 'uppercase' as const,
    letterSpacing: '0.04em', marginBottom: '8px',
  }

  return (
    <div>
      <DCSelector dcs={dcs} />
      <InfoCards dc={dc} totalCarbonKg={totalCarbonKg} totalCostUsd={totalCostUsd} />

      {/* Line chart */}
      <div style={panelStyle}>
        <div style={hdStyle}>Energy consumption + carbon output — hourly</div>
        <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px' }}>
          Left axis: MWh consumed &nbsp;·&nbsp; Right axis: kg CO₂ output
        </div>
        <DualAxisLineChart hourlyKwh={hourlyKwh} hourlyCarbonKg={hourlyCarbonKg} />
        <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#666' }}>
            <div style={{ width: '20px', height: '2.5px', background: '#185FA5', borderRadius: '1px' }} />
            MWh consumed
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#666' }}>
            <div style={{ width: '20px', height: '0', borderTop: '2.5px dashed #BA7517' }} />
            kg CO₂ output
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div style={panelStyle}>
        <div style={hdStyle}>Jobs per hour — inference vs training vs background</div>
        <StackedBarChart
          hourlyInference={hourlyInference}
          hourlyTraining={hourlyTraining}
          hourlyBackground={hourlyBackground}
        />
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          {[
            { color: '#E24B4A', label: 'Flex 1 — inference' },
            { color: '#EF9F27', label: 'Flex 2 — training/batch' },
            { color: '#1D9E75', label: 'Flex 3 — background' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Grid reference sparklines */}
      <div style={panelStyle}>
        <div style={hdStyle}>{grid.name} — grid reference</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <GridSparkline
            values={grid.lmp_usd_per_mwh}
            label="LMP electricity price ($/MWh)"
            unit="$/MWh"
            colorLow="#1D9E75"
            colorHigh="#E24B4A"
          />
          <GridSparkline
            values={grid.carbon_g_co2_per_kwh}
            label="Carbon intensity (gCO₂/kWh)"
            unit="gCO₂/kWh"
            colorLow="#1D9E75"
            colorHigh="#E24B4A"
          />
        </div>
        <div style={{ fontSize: '10px', color: '#888', marginTop: '8px' }}>
          {dc.grid_operator} · {dc.grid_zone} zone · simulation date Aug 15
        </div>
      </div>
    </div>
  )
}
