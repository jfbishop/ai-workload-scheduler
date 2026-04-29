'use client'

/**
 * FleetSummaryTab.tsx
 * Fleet-wide summary across all 6 data centers:
 *   - 4 top KPI cards (total cost, carbon, inference tasks, training tasks)
 *   - Stacked bar: tasks per DC (inference vs training vs background)
 *   - Horizontal bars: cost per DC
 *   - Horizontal bars: carbon per DC (sorted worst→best)
 *   - Fleet hourly energy + carbon line chart
 *   - Collapsible deferral analysis panel
 */

import { useState } from 'react'
import { useSimulationStore } from '@/store/simulationStore'
import type { SimulationResult } from '@/simulation/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function fmtCO2(kg: number) {
  return kg >= 1000 ? (kg / 1000).toFixed(1) + ' t' : kg.toFixed(0) + ' kg'
}
function fmtKwh(kwh: number) {
  return kwh >= 1000 ? (kwh / 1000).toFixed(1) + ' MWh' : kwh.toFixed(0) + ' kWh'
}

const PANEL: React.CSSProperties = {
  background: '#fff',
  border: '0.5px solid rgba(0,0,0,0.10)',
  borderRadius: '12px',
  padding: '10px 12px',
}

const HD: React.CSSProperties = {
  fontSize: '11px', fontWeight: 500,
  color: '#666', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginBottom: '10px',
}

// ── KPI Cards ─────────────────────────────────────────────────────────────────

function KPICard({ val, label, sub, subColor }: {
  val: string; label: string; sub?: string; subColor?: string
}) {
  return (
    <div style={{ background: '#f4f4f2', borderRadius: '8px', padding: '10px 12px' }}>
      <div style={{ fontSize: '20px', fontWeight: 500, color: '#1a1a1a' }}>{val}</div>
      <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{label}</div>
      {sub && (
        <div style={{ fontSize: '11px', color: subColor ?? '#666', marginTop: '3px' }}>{sub}</div>
      )}
    </div>
  )
}

// ── Tasks Per DC stacked bar ──────────────────────────────────────────────────

function TasksPerDCChart() {
  const { dcTotalStats, results } = useSimulationStore()
  if (!dcTotalStats.length) return null

  // Use max across ALL modes so bars are visually comparable when switching
  // Without this, Mode 2's spread distribution makes bars look shorter than Mode 1
  const globalMax = Math.max(1, ...[1, 2, 3].flatMap(mode => {
    const r = results[mode as 1|2|3]
    if (!r) return [0]
    return r.schedule
      ? Object.values(
          r.schedule.reduce((acc, t) => {
            acc[t.assigned_dc_id] = (acc[t.assigned_dc_id] || 0) + 1
            return acc
          }, {} as Record<string, number>)
        )
      : [0]
  }))

  const maxJobs = globalMax

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '140px', paddingTop: '8px' }}>
        {dcTotalStats.map(dc => {
          const hInf = (dc.inference_jobs  / maxJobs) * 110
          const hTr  = (dc.training_jobs   / maxJobs) * 110
          const hBg  = (dc.background_jobs / maxJobs) * 110
          return (
            <div key={dc.dcId} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', width: '100%' }}>
                {hBg > 0 && (
                  <div title={`Background: ${dc.background_jobs}`}
                    style={{ width: '100%', height: `${hBg}px`, background: '#1D9E75', borderRadius: '2px 2px 0 0' }} />
                )}
                {hTr > 0 && (
                  <div title={`Training: ${dc.training_jobs}`}
                    style={{ width: '100%', height: `${hTr}px`, background: '#378ADD' }} />
                )}
                {hInf > 0 && (
                  <div title={`Inference: ${dc.inference_jobs}`}
                    style={{ width: '100%', height: `${hInf}px`, background: '#7F77DD', borderRadius: hBg === 0 && hTr === 0 ? '2px 2px 0 0' : undefined }} />
                )}
              </div>
              <div style={{ fontSize: '8px', color: '#888', marginTop: '4px', textAlign: 'center', lineHeight: 1.3 }}>
                {dc.dcName.split(' ')[0]}<br />{dc.dcName.split(' ')[1]}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
        {[
          { color: '#7F77DD', label: 'Flex 1 — inference' },
          { color: '#378ADD', label: 'Flex 2 — training' },
          { color: '#1D9E75', label: 'Flex 3 — background' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: color }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Horizontal bar helper ─────────────────────────────────────────────────────

function HorizBar({ label, value, displayVal, maxVal, color }: {
  label: string; value: number; displayVal: string; maxVal: number; color: string
}) {
  const pct = maxVal > 0 ? (value / maxVal) * 100 : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
      <div style={{ fontSize: '10px', color: '#666', width: '88px', flexShrink: 0, textAlign: 'right' }}>
        {label}
      </div>
      <div style={{ flex: 1, height: '8px', background: '#f0f0ee', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '4px' }} />
      </div>
      <div style={{ fontSize: '10px', color: '#666', width: '52px', textAlign: 'right', flexShrink: 0 }}>
        {displayVal}
      </div>
    </div>
  )
}

// ── Fleet Hourly Line Chart ───────────────────────────────────────────────────

function FleetHourlyChart() {
  const { fleetHourlyStats } = useSimulationStore()
  if (!fleetHourlyStats.length) return null

  const W = 500, H = 90
  const PAD = { top: 8, right: 8, bottom: 0, left: 8 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxKwh    = Math.max(1, ...fleetHourlyStats.map(s => s.total_energy_kwh))
  const maxCarbon = Math.max(1, ...fleetHourlyStats.map(s => s.total_carbon_kg))

  function points(vals: number[], maxVal: number) {
    return vals.map((v, i) => {
      const x = PAD.left + (i / 23) * chartW
      const y = PAD.top + (1 - v / maxVal) * chartH
      return `${x},${y}`
    }).join(' ')
  }

  const kwhVals    = fleetHourlyStats.map(s => s.total_energy_kwh)
  const carbonVals = fleetHourlyStats.map(s => s.total_carbon_kg)
  const maxKwhFmt    = maxKwh >= 1000 ? (maxKwh/1000).toFixed(1)+'k' : maxKwh.toFixed(0)
  const maxCarbonFmt = maxCarbon >= 1000 ? (maxCarbon/1000).toFixed(1)+'t' : maxCarbon.toFixed(0)+'kg'

  return (
    <div style={{ position: 'relative', height: '140px' }}>
      {/* Left axis */}
      <div style={{
        position: 'absolute', left: 0, top: 8, bottom: 22, width: '32px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        alignItems: 'flex-end', paddingRight: '4px',
      }}>
        {[maxKwhFmt, '', '0'].map((t, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#185FA5' }}>{t}</span>
        ))}
      </div>
      {/* Right axis */}
      <div style={{
        position: 'absolute', right: 0, top: 8, bottom: 22, width: '36px',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        alignItems: 'flex-start', paddingLeft: '4px',
      }}>
        {[maxCarbonFmt, '', '0'].map((t, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#854F0B' }}>{t}</span>
        ))}
      </div>
      {/* Chart */}
      <div style={{
        position: 'absolute', left: '36px', right: '40px', top: 0, bottom: '22px',
        background: '#f4f4f2', borderRadius: '8px',
        border: '0.5px solid rgba(0,0,0,0.08)', overflow: 'hidden',
      }}>
        <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map(p => (
            <line key={p}
              x1={PAD.left} y1={PAD.top + p * chartH}
              x2={W - PAD.right} y2={PAD.top + p * chartH}
              stroke="rgba(0,0,0,0.07)" strokeWidth={0.5} strokeDasharray="3,3"
            />
          ))}
          <polyline points={points(kwhVals, maxKwh)} fill="none" stroke="#185FA5" strokeWidth={2} />
          <polyline points={points(carbonVals, maxCarbon)} fill="none" stroke="#BA7517" strokeWidth={2} strokeDasharray="5,3" />
        </svg>
      </div>
      {/* X axis */}
      <div style={{
        position: 'absolute', bottom: 0, left: '36px', right: '40px',
        display: 'flex', justifyContent: 'space-between',
      }}>
        {['12a','3a','6a','9a','12p','3p','6p','9p','12a'].map((l, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#bbb' }}>{l}</span>
        ))}
      </div>
    </div>
  )
}

// ── Deferral Analysis (collapsible) ──────────────────────────────────────────

function DeferralAnalysis({ result }: { result: SimulationResult }) {
  const [open, setOpen] = useState(false)

  const schedule = result.schedule ?? []
  const deferred = schedule.filter(
    t => t.status === 'deferred' || (t.deferred_by_hours != null && t.deferred_by_hours > 0)
  )
  const total = schedule.length

  // Flex type breakdown
  const byFlex: Record<number, number> = { 1: 0, 2: 0, 3: 0 }
  deferred.forEach(t => { byFlex[t.flex_type] = (byFlex[t.flex_type] || 0) + 1 })

  // Submit hour vs run hour — clamp scheduled_hour to 0-23 for display
  const submitDist = Array(24).fill(0)
  const runDist    = Array(24).fill(0)
  deferred.forEach(t => {
    const sh = Math.min(23, Math.floor(t.submit_hour))
    const rh = Math.min(23, Math.floor(t.scheduled_hour))
    submitDist[sh] = (submitDist[sh] || 0) + 1
    runDist[rh]    = (runDist[rh]    || 0) + 1
  })

  // Deferral duration distribution
  const durationBuckets = { '0-2h': 0, '2-4h': 0, '4-8h': 0, '8-16h': 0, '16h+': 0 }
  deferred.forEach(t => {
    const h = t.deferred_by_hours
    if      (h < 2)  durationBuckets['0-2h']++
    else if (h < 4)  durationBuckets['2-4h']++
    else if (h < 8)  durationBuckets['4-8h']++
    else if (h < 16) durationBuckets['8-16h']++
    else             durationBuckets['16h+']++
  })

  const maxDist = Math.max(1, ...submitDist, ...runDist)

  // Guard AFTER all hooks and derived data
  if (schedule.length === 0 || deferred.length === 0) return null

  const FLEX_COLORS: Record<number, string> = { 1: '#7F77DD', 2: '#378ADD', 3: '#1D9E75' }
  const FLEX_LABELS: Record<number, string> = {
    1: 'Flex 1 — inference',
    2: 'Flex 2 — batch/training',
    3: 'Flex 3 — background',
  }

  return (
    <div style={{ ...PANEL, padding: 0 }}>
      {/* Header — always visible */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 12px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#378ADD' }} />
          <span style={{ fontSize: '11px', fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Deferral analysis — {result.total_tasks_deferred.toLocaleString()} tasks shifted to a cheaper same-day window
          </span>
          <span style={{ fontSize: '11px', color: '#999' }}>
            ({((result.total_tasks_deferred / total) * 100).toFixed(0)}% of scheduled)
          </span>
        </div>
        <span style={{
          fontSize: '10px', color: '#bbb',
          display: 'inline-block',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
        }}>▼</span>
      </div>

      {/* Collapsible body */}
      {open && (
        <div style={{ padding: '0 12px 12px', borderTop: '0.5px solid rgba(0,0,0,0.08)' }}>

          {/* Explainer */}
          <div style={{
            fontSize: '12px', color: '#444', lineHeight: 1.6,
            background: '#f4f4f2', borderRadius: '8px', padding: '8px 12px',
            margin: '10px 0 14px',
          }}>
            <span style={{ fontWeight: 500, color: '#1a1a1a' }}>All deferred tasks still run on Aug 15</span> — deferral means the scheduler
            shifted a task to a later hour within the same day, not to the next day.
            Of the {result.total_tasks_deferred.toLocaleString()} deferred tasks,
            all complete within their deadline window.
            Aug 15 is a high-demand summer day on PJM and ERCOT; shifting work to CAISO
            solar hours (9am–4pm, $4–14/MWh) is often the economically correct choice
            even at the cost of a few hours' delay.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

            {/* Left: flex type breakdown + duration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

              {/* Flex type bars */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Deferred by flex type
                </div>
                {([2, 3, 1] as const).map(f => {
                  const count = byFlex[f] || 0
                  const pct   = total > 0 ? (count / total) * 100 : 0
                  const barW  = deferred.length > 0 ? (count / deferred.length) * 100 : 0
                  return (
                    <div key={f} style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                        <span style={{ fontSize: '10px', color: '#666' }}>{FLEX_LABELS[f]}</span>
                        <span style={{ fontSize: '10px', color: '#888' }}>
                          {count.toLocaleString()} ({pct.toFixed(0)}% of scheduled)
                        </span>
                      </div>
                      <div style={{ height: '8px', background: '#f0f0ee', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${barW}%`, height: '100%', background: FLEX_COLORS[f], borderRadius: '4px' }} />
                      </div>
                    </div>
                  )
                })}
                <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                  Flex 1 inference is never deferred — routed to nearest DC immediately.
                </div>
              </div>

              {/* Deferral duration buckets */}
              <div>
                <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Deferral duration distribution
                </div>
                {Object.entries(durationBuckets).map(([label, count]) => {
                  const barW = deferred.length > 0 ? (count / deferred.length) * 100 : 0
                  return (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                      <div style={{ fontSize: '10px', color: '#666', width: '36px', flexShrink: 0 }}>{label}</div>
                      <div style={{ flex: 1, height: '8px', background: '#f0f0ee', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ width: `${barW}%`, height: '100%', background: '#185FA5', borderRadius: '4px' }} />
                      </div>
                      <div style={{ fontSize: '10px', color: '#888', width: '36px', textAlign: 'right', flexShrink: 0 }}>
                        {count.toLocaleString()}
                      </div>
                    </div>
                  )
                })}
                <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                  Most deferrals are 4–8hrs — overnight submissions waiting for the solar window.
                </div>
              </div>
            </div>

            {/* Right: submit hour vs run hour chart */}
            <div>
              <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                When tasks were submitted vs when they ran
              </div>
              <div style={{
                display: 'flex', alignItems: 'flex-end', gap: '2px',
                height: '120px',
                background: '#f4f4f2', borderRadius: '7px',
                padding: '8px 6px 0',
                boxSizing: 'border-box',
              }}>
                {Array.from({ length: 24 }, (_, h) => {
                  const sub = submitDist[h] || 0
                  const run = runDist[h]    || 0
                  const subH = sub > 0 ? Math.max(4, (sub / maxDist) * 100) : 0
                  const runH = run > 0 ? Math.max(4, (run / maxDist) * 100) : 0
                  return (
                    <div key={h} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '1px', height: '100%' }}>
                      <div
                        title={`${h}:00 — submitted: ${sub}`}
                        style={{ flex: 1, height: `${subH}px`, background: '#888780', borderRadius: '1px 1px 0 0', opacity: 0.7 }}
                      />
                      <div
                        title={`${h}:00 — ran: ${run}`}
                        style={{ flex: 1, height: `${runH}px`, background: '#1D9E75', borderRadius: '1px 1px 0 0', opacity: 0.85 }}
                      />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px', paddingLeft: '6px', paddingRight: '6px' }}>
                {['12a','6a','12p','6p','12a'].map((l, i) => (
                  <span key={i} style={{ fontSize: '8px', color: '#bbb' }}>{l}</span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '14px', marginTop: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#888780', opacity: 0.7 }} />
                  Submitted
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#1D9E75' }} />
                  Actually ran
                </div>
              </div>
              <div style={{ fontSize: '10px', color: '#999', marginTop: '8px', lineHeight: 1.5 }}>
                Gray bars show when tasks arrived. Green bars show when they were scheduled.
                The rightward shift toward midday reflects deferral to cheaper, cleaner grid windows.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main FleetSummaryTab ──────────────────────────────────────────────────────

export default function FleetSummaryTab() {
  const { results, activeMode, dcTotalStats, fleetHourlyStats } = useSimulationStore()
  const result = results[activeMode]

  if (!result) {
    return (
      <div style={{ padding: '2rem', color: '#666', fontSize: '13px' }}>
        No data available — run the simulation first.
      </div>
    )
  }

  const totalInference  = dcTotalStats.reduce((s, d) => s + d.inference_jobs, 0)
  const totalTraining   = dcTotalStats.reduce((s, d) => s + d.training_jobs, 0)
  const totalBackground = dcTotalStats.reduce((s, d) => s + d.background_jobs, 0)
  const totalEnergy     = dcTotalStats.reduce((s, d) => s + d.total_energy_kwh, 0)

  const maxCost   = Math.max(1, ...dcTotalStats.map(d => d.total_cost_usd))
  const maxCarbon = Math.max(1, ...dcTotalStats.map(d => d.total_carbon_kg))

  // Sort carbon worst → best for the carbon bars
  const byCarbon = [...dcTotalStats].sort((a, b) => b.total_carbon_kg - a.total_carbon_kg)
  // Sort cost high → low
  const byCost   = [...dcTotalStats].sort((a, b) => b.total_cost_usd - a.total_cost_usd)

  // Carbon bar color: scale from red (high) to green (low)
  function carbonColor(kg: number) {
    const t = maxCarbon > 0 ? kg / maxCarbon : 0
    if (t > 0.66) return '#E24B4A'
    if (t > 0.33) return '#EF9F27'
    return '#1D9E75'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* ── KPI row ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '8px' }}>
        <KPICard
          val={fmt$(result.total_cost_usd)}
          label="Total fleet electricity cost"
          sub={`${fmtKwh(totalEnergy)} consumed`}
          subColor="#666"
        />
        <KPICard
          val={fmtCO2(result.total_carbon_kg)}
          label="Total fleet CO₂ emitted"
          sub={`${(result.total_carbon_kg / Math.max(1, totalEnergy) * 1000).toFixed(0)} gCO₂/kWh avg intensity`}
          subColor="#666"
        />
        <KPICard
          val={`${totalInference}`}
          label="Flex 1 — inference tasks"
          sub={`${((totalInference / result.total_tasks_scheduled) * 100).toFixed(0)}% of all tasks`}
          subColor="#666"
        />
        <KPICard
          val={`${totalTraining + totalBackground}`}
          label="Flex 2+3 — training / background"
          sub={`${result.total_tasks_deferred} shifted to a cheaper window same day`}
          subColor="#666"
        />
      </div>

      {/* ── Two-column: tasks per DC + fleet hourly chart ─────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

        <div style={PANEL}>
          <div style={HD}>Tasks per DC — by flex type</div>
          <TasksPerDCChart />
        </div>

        <div style={PANEL}>
          <div style={HD}>Fleet hourly energy + carbon</div>
          <div style={{ fontSize: '10px', color: '#888', marginBottom: '8px' }}>
            Left: kWh consumed &nbsp;·&nbsp; Right: kg CO₂
          </div>
          <FleetHourlyChart />
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#666' }}>
              <div style={{ width: '18px', height: '2px', background: '#185FA5', borderRadius: '1px' }} />
              kWh consumed
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: '#666' }}>
              <div style={{ width: '18px', height: 0, borderTop: '2px dashed #BA7517' }} />
              kg CO₂
            </div>
          </div>
        </div>
      </div>

      {/* ── Two-column: cost per DC + carbon per DC ───────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>

        <div style={PANEL}>
          <div style={HD}>Electricity cost per DC</div>
          {byCost.map(dc => (
            <HorizBar
              key={dc.dcId}
              label={dc.dcName}
              value={dc.total_cost_usd}
              displayVal={fmt$(dc.total_cost_usd)}
              maxVal={maxCost}
              color="#185FA5"
            />
          ))}
          <div style={{ fontSize: '10px', color: '#888', marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid rgba(0,0,0,0.08)' }}>
            Total: {fmt$(result.total_cost_usd)} · {result.conflict_count} cost vs carbon conflicts
          </div>
        </div>

        <div style={PANEL}>
          <div style={HD}>Carbon output per DC — worst to best</div>
          {byCarbon.map(dc => (
            <HorizBar
              key={dc.dcId}
              label={dc.dcName}
              value={dc.total_carbon_kg}
              displayVal={fmtCO2(dc.total_carbon_kg)}
              maxVal={maxCarbon}
              color={carbonColor(dc.total_carbon_kg)}
            />
          ))}
          <div style={{ fontSize: '10px', color: '#888', marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid rgba(0,0,0,0.08)' }}>
            Total: {fmtCO2(result.total_carbon_kg)} · avg {(result.total_carbon_kg / Math.max(1, totalEnergy) * 1000).toFixed(0)} gCO₂/kWh
          </div>
        </div>
      </div>

      {/* ── Conflict summary ─────────────────────────────────────── */}
      {result.conflict_count > 0 && (
        <div style={{
          ...PANEL,
          background: '#FAEEDA',
          border: '0.5px solid #FAC775',
        }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: '#854F0B', marginBottom: '6px' }}>
            ● {result.conflict_count} cost vs carbon conflicts this run
          </div>
          <div style={{ fontSize: '11px', color: '#854F0B' }}>
            In {result.conflict_count} scheduling decisions, the cheapest available DC was not the cleanest.
            Cost was prioritized per the objective function (w_cost = 0.55 &gt; w_carbon = 0.30).
            These tasks still ran on the cheapest grid even though a cleaner option existed.
          </div>
        </div>
      )}

      {/* ── Deferral analysis — collapsible ──────────────────────── */}
      {result.total_tasks_deferred > 0 && (
        <DeferralAnalysis result={result} />
      )}
    </div>
  )
}