'use client'

import { useEffect, useRef } from 'react'
import { useSimulationStore, getRunningTotals, getVisibleQueueTasks, getDCUtilizationAtHour } from '@/store/simulationStore'
import type { ScheduledTask, DataCenter } from '@/simulation/types'

// ── Colour helpers ────────────────────────────────────────────────────────────

const FLEX_COLORS = { 1: '#E24B4A', 2: '#EF9F27', 3: '#1D9E75' } as const
const FLEX_BG     = { 1: '#FCEBEB', 2: '#FAEEDA', 3: '#EAF3DE' } as const
const FLEX_TEXT   = { 1: '#A32D2D', 2: '#854F0B', 3: '#3B6D11' } as const
const FLEX_LABEL  = { 1: 'F1', 2: 'F2', 3: 'F3' } as const

function fmt$(n: number) { return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) }
function fmtCO2(kg: number) { return kg >= 1000 ? (kg/1000).toFixed(1) + ' t' : kg.toFixed(0) + ' kg' }
function fmtHour(h: number) {
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12  = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:00 ${ampm}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({ val, label, sub, subColor }: {
  val: string; label: string; sub?: string; subColor?: string
}) {
  return (
    <div style={{
      background: 'var(--ds-surface2, #f4f4f2)',
      borderRadius: '8px', padding: '10px 12px',
    }}>
      <div style={{ fontSize: '20px', fontWeight: 500, color: 'var(--ds-text-pri, #1a1a1a)' }}>{val}</div>
      <div style={{ fontSize: '11px', color: 'var(--ds-text-sec, #666)', marginTop: '2px' }}>{label}</div>
      {sub && <div style={{ fontSize: '11px', marginTop: '3px', color: subColor ?? '#666' }}>{sub}</div>}
    </div>
  )
}

function FlexBadge({ flex }: { flex: 1|2|3 }) {
  return (
    <span style={{
      fontSize: '9px', padding: '2px 5px', borderRadius: '5px',
      fontWeight: 500, flexShrink: 0,
      background: FLEX_BG[flex], color: FLEX_TEXT[flex],
    }}>
      {FLEX_LABEL[flex]}
    </span>
  )
}

// ── Time Controls ─────────────────────────────────────────────────────────────

function TimeControls() {
  const { currentHour, isPlaying, playbackSpeed, setCurrentHour, setPlaying, setPlaybackSpeed, reset, results, activeMode } = useSimulationStore()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        const h = useSimulationStore.getState().currentHour
        if (h >= 23) {
          useSimulationStore.getState().setPlaying(false)
          return
        }
        useSimulationStore.getState().setCurrentHour(h + 1)
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isPlaying])

  const hasData = !!results[activeMode]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '8px 12px',
      background: 'var(--ds-surface, #fff)',
      border: '0.5px solid var(--ds-border, rgba(0,0,0,0.10))',
      borderRadius: '12px',
    }}>
      <span style={{ fontSize: '11px', color: '#999' }}>12a</span>
      <div
        style={{
          flex: 1, height: '5px', background: '#f0f0ee',
          borderRadius: '3px', position: 'relative', cursor: 'pointer',
        }}
        onClick={e => {
          const rect = (e.target as HTMLElement).getBoundingClientRect()
          const pct  = (e.clientX - rect.left) / rect.width
          setCurrentHour(Math.round(pct * 23))
        }}
      >
        <div style={{ width: `${(currentHour / 23) * 100}%`, height: '100%', background: '#378ADD', borderRadius: '3px' }} />
        <div style={{
          width: '13px', height: '13px', borderRadius: '50%', background: '#185FA5',
          position: 'absolute', top: '-4px', left: `calc(${(currentHour / 23) * 100}% - 6px)`,
          border: '2px solid #fff',
        }} />
      </div>
      <span style={{ fontSize: '11px', color: '#999' }}>12a</span>
      <div style={{ width: '1px', height: '16px', background: 'rgba(0,0,0,0.10)' }} />
      <span style={{ fontSize: '12px', fontWeight: 500, minWidth: '72px' }}>{fmtHour(currentHour)}</span>
      <button
        onClick={() => hasData && setPlaying(!isPlaying)}
        style={{
          fontSize: '11px', padding: '4px 12px', borderRadius: '6px',
          border: '0.5px solid #185FA5', color: '#185FA5', background: 'transparent',
          cursor: hasData ? 'pointer' : 'default', opacity: hasData ? 1 : 0.4,
        }}
      >
        {isPlaying ? '⏸ Pause' : '▶ Play'}
      </button>
      <button
        onClick={reset}
        style={{
          fontSize: '11px', padding: '4px 10px', borderRadius: '6px',
          border: '0.5px solid rgba(0,0,0,0.18)', color: '#666', background: 'transparent', cursor: 'pointer',
        }}
      >
        ↺ Reset
      </button>
      <select
        value={playbackSpeed}
        onChange={e => setPlaybackSpeed(Number(e.target.value))}
        style={{ fontSize: '11px', color: '#666', border: '0.5px solid rgba(0,0,0,0.18)', borderRadius: '6px', padding: '3px 6px', background: 'transparent' }}
      >
        <option value={1}>1x</option>
        <option value={10}>10x</option>
        <option value={60}>60x</option>
      </select>
    </div>
  )
}

// ── Ticker ────────────────────────────────────────────────────────────────────

function Ticker() {
  const { results, activeMode, currentHour, grids, dcs } = useSimulationStore()
  const result = results[activeMode]
  if (!result) return null

  const totals = getRunningTotals(result.schedule, currentHour)

  // Find cheapest and cleanest grid at current hour
  let cheapestGrid = { name: '—', lmp: Infinity, id: '' }
  let cleanestGrid = { name: '—', carbon: Infinity, id: '' }
  let dirtiestGrid = { name: '—', carbon: 0, id: '' }

  for (const g of grids) {
    const lmp    = g.lmp_usd_per_mwh[currentHour]
    const carbon = g.carbon_g_co2_per_kwh[currentHour]
    if (lmp < cheapestGrid.lmp)      cheapestGrid = { name: g.name.split('–')[0].trim(), lmp, id: g.utility_id }
    if (carbon < cleanestGrid.carbon) cleanestGrid = { name: g.name.split('–')[0].trim(), carbon, id: g.utility_id }
    if (carbon > dirtiestGrid.carbon) dirtiestGrid = { name: g.name.split('–')[0].trim(), carbon, id: g.utility_id }
  }

  const conflictNow = cheapestGrid.id !== cleanestGrid.id

  const items = [
    { val: fmtHour(currentHour),      lbl: 'simulation time',       color: undefined },
    { val: fmt$(totals.cost),          lbl: 'electricity spend so far', color: undefined },
    { val: fmtCO2(totals.carbon),      lbl: 'CO₂ emitted so far',    color: undefined },
    { val: `${totals.scheduled}`,      lbl: 'tasks scheduled',        color: undefined },
    { val: `${totals.deferred}`,       lbl: 'tasks deferred',         color: undefined },
    { val: cheapestGrid.name,          lbl: `cheapest now · $${cheapestGrid.lmp}/MWh`, color: '#0F6E56' },
    { val: cleanestGrid.name,          lbl: `cleanest now · ${cleanestGrid.carbon} gCO₂`, color: '#0F6E56' },
    { val: `${totals.conflicts}`,      lbl: conflictNow ? 'conflicts (grids diverge now)' : 'conflicts flagged', color: totals.conflicts > 0 ? '#854F0B' : undefined },
  ]

  return (
    <div style={{
      display: 'flex', background: '#f4f4f2', borderRadius: '8px', overflow: 'hidden',
    }}>
      {items.map((item, i) => (
        <div key={i} style={{
          flex: 1, padding: '7px 10px',
          borderRight: i < items.length - 1 ? '0.5px solid rgba(0,0,0,0.10)' : 'none',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: item.color ?? 'var(--ds-text-pri, #1a1a1a)', whiteSpace: 'nowrap' }}>
            {item.val}
          </div>
          <div style={{ fontSize: '9px', color: '#999', marginTop: '1px', whiteSpace: 'nowrap' }}>
            {item.lbl}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── US Map ────────────────────────────────────────────────────────────────────

// Rough equirectangular projection for continental US
// lat: 24–50, lon: -125 to -66
// Coordinates calibrated from clicked pixel positions on Wikipedia lower-48 SVG
// Fitted using 9 anchor cities: svg_x = 16.879*lon + 2109.2, svg_y = -22.745*lat + 1137.5
// Mean fit error: ~31px (acceptable for dot placement on a map this size)

const MAP_W = 960, MAP_H = 593

// DC positions in SVG coordinate space
const DC_SVG_COORDS: Record<string, [number, number]> = {
  'dc_hammond_il':        [607.3, 235.8],
  'dc_plano_tx':          [477.1, 420.5],
  'dc_chester_va':        [802.1, 287.7],
  'dc_weehawken_nj':      [846.0, 210.2],
  'dc_eagle_mountain_ut': [223.0, 235.6],
  'dc_san_jose_ca':       [46.9,  271.2],
}

// City positions in SVG coordinate space
const CITY_SVG_COORDS: Record<string, [number, number]> = {
  'New York NY':       [844.1, 227.5],
  'San Francisco CA':  [43.0,  267.3],
  'Los Angeles CA':    [113.4, 363.0],
  'Chicago IL':        [610.2, 230.0],
  'Seattle WA':        [85.4,   41.7],
  'Boston MA':         [870.8, 160.0],
  'Austin TX':         [459.5, 470.1],
  'Washington DC':     [808.9, 252.6],
  'Dallas TX':         [475.4, 425.0],
  'Atlanta GA':        [684.9, 390.9],
  'Denver CO':         [337.1, 250.6],
  'Miami FL':          [787.7, 551.5],
  'Phoenix AZ':        [200.6, 376.7],
  'Minneapolis MN':    [535.0, 130.5],
  'Portland OR':       [49.6,  102.5],
  'San Diego CA':      [131.7, 375.4],
  'Philadelphia PA':   [840.5, 228.8],
  'Detroit MI':        [685.5, 190.7],
  'Nashville TN':      [644.5, 340.0],
  'Salt Lake City UT': [220.7, 232.4],
  'Raleigh NC':        [781.9, 335.7],
}

// Fixed jitter per flex type so dots don't overlap
const JITTER: Record<number, { dx: number; dy: number }> = {
  1: { dx: 0,   dy: 0  },
  2: { dx: 14,  dy: -9 },
  3: { dx: -12, dy: 9  },
}

function USMap() {
  const { results, activeMode, currentHour, dcs } = useSimulationStore()
  const result = results[activeMode]

  const submittedTasks = result
    ? result.schedule.filter(t => t.submit_hour <= currentHour)
    : []

  const cityData: Record<string, { counts: Record<number, number> }> = {}
  for (const t of submittedTasks) {
    if (!cityData[t.origin_city]) {
      cityData[t.origin_city] = { counts: { 1: 0, 2: 0, 3: 0 } }
    }
    cityData[t.origin_city].counts[t.flex_type] =
      (cityData[t.origin_city].counts[t.flex_type] || 0) + 1
  }

  const maxCount = Math.max(1, ...Object.values(cityData).flatMap(c => Object.values(c.counts)))

  return (
    <div>
      <div style={{ fontSize: '10px', color: '#999', marginBottom: '6px' }}>
        Dot color = flex type · Dot size = cumulative requests · ◆ = data center (hover for info)
      </div>
      <div style={{
        borderRadius: '8px', 
        border: '0.5px solid rgba(0,0,0,0.10)',
        overflow: 'hidden', 
        background: '#f8f8f6',
        height: '320px', // Hard cap the height to keep it consistent
        width: '100%',
        position: 'relative'
      }}>
        <svg
          style={{ width: '100%', height: '100%', display: 'block' }}
          /* ViewBox breakdown: 
            [x-start] [y-start] [width] [height]
            Lowering the height (the 4th number) "zooms" in.
          */
          viewBox="10 5 850 600" 
          preserveAspectRatio="xMidYMid meet"
        >
          <image href="/us.svg" x="0" y="0" width="960" height="593" />

          {Object.entries(cityData).map(([city, data]) => {
            const coords = CITY_SVG_COORDS[city]
            if (!coords) return null
            return ([1, 2, 3] as const).map(flex => {
              const count = data.counts[flex] || 0
              if (count === 0) return null
              const r = 6 + (count / maxCount) * 24
              const { dx, dy } = JITTER[flex]
              return (
                <circle
                  key={`${city}-${flex}`}
                  cx={coords[0] + dx} cy={coords[1] + dy} r={r}
                  fill={FLEX_COLORS[flex]} opacity={0.6}
                >
                  <title>{`${city} · Flex ${flex} · ${count} requests`}</title>
                </circle>
              )
            })
          })}

          {dcs.map(dc => {
            const coords = DC_SVG_COORDS[dc.id]
            if (!coords) return null
            const [x, y] = coords
            const s = 10
            return (
              <polygon
                key={dc.id}
                points={`${x},${y-s} ${x+s},${y} ${x},${y+s} ${x-s},${y}`}
                fill="#333" stroke="white" strokeWidth={2}
              >
                <title>{`${dc.name} · ${dc.capacity_mw} MW · ${dc.grid_operator}`}</title>
              </polygon>
            )
          })}
        </svg>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginTop: '6px', flexWrap: 'wrap' }}>
        {([1, 2, 3] as const).map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
            <div style={{ width: '9px', height: '9px', borderRadius: '50%', background: FLEX_COLORS[f] }} />
            {f === 1 ? 'Flex 1 — inference' : f === 2 ? 'Flex 2 — batch/training' : 'Flex 3 — background'}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
          <svg width="12" height="12" viewBox="0 0 12 12">
            <polygon points="6,0 12,6 6,12 0,6" fill="#333" />
          </svg>
          Data center (hover for info)
        </div>
      </div>
    </div>
  )
}

// ── Gantt ─────────────────────────────────────────────────────────────────────

function GanttChart() {
  const { results, activeMode, currentHour, dcs, dcHourlyStats } = useSimulationStore()
  const result = results[activeMode]
  if (!result) return <div style={{ color: '#999', fontSize: '12px' }}>No data</div>

  // Build hourly utilization % and dominant flex type per DC per hour
  // This gives a fair visual comparison across modes — same 1,000 tasks,
  // just distributed differently. Each hour cell shows how busy that DC was.
  const hourlyByDC: Record<string, Array<{
    utilPct: number
    flex1: number; flex2: number; flex3: number; conflicts: number
  }>> = {}

  for (const dc of dcs) {
    hourlyByDC[dc.id] = Array.from({ length: 24 }, (_, h) => {
      const gpusUsed = result.dc_hourly_gpu_usage[dc.id]?.[h] ?? 0
      const utilPct  = dc.gpu_count > 0 ? (gpusUsed / dc.gpu_count) * 100 : 0
      const hourTasks = result.schedule.filter(
        t => t.assigned_dc_id === dc.id && t.scheduled_hour === h
      )
      return {
        utilPct,
        flex1:     hourTasks.filter(t => t.flex_type === 1).length,
        flex2:     hourTasks.filter(t => t.flex_type === 2).length,
        flex3:     hourTasks.filter(t => t.flex_type === 3).length,
        conflicts: hourTasks.filter(t => t.cost_vs_carbon_conflict).length,
      }
    })
  }

  return (
    <div>
      <div style={{ fontSize: '9px', color: '#999', marginBottom: '5px', marginLeft: '80px' }}>
        00:00 → 23:59 · fill = GPU utilization % · color = dominant flex type · all modes show same 1,000 tasks
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {dcs.map(dc => {
          const hourly = hourlyByDC[dc.id] ?? []
          const totalTasks = result.schedule.filter(t => t.assigned_dc_id === dc.id).length

          return (
            <div key={dc.id} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ fontSize: '9px', color: '#888', width: '74px', textAlign: 'right', flexShrink: 0 }}>
                <div>{dc.city}</div>
                <div style={{ color: '#bbb', fontSize: '8px' }}>{totalTasks} tasks</div>
              </div>
              <div style={{
                flex: 1, height: '18px',
                background: '#f0f0ee', borderRadius: '3px',
                display: 'flex', overflow: 'hidden',
              }}>
                {hourly.map((h, hi) => {
                  if (h.utilPct === 0) {
                    return (
                      <div
                        key={hi}
                        style={{ flex: 1, height: '100%', background: 'transparent' }}
                      />
                    )
                  }
                  // Dominant flex type determines color
                  const dominant = h.conflicts > 0
                    ? '#EF9F27'
                    : h.flex3 >= h.flex2 && h.flex3 >= h.flex1
                    ? FLEX_COLORS[3]
                    : h.flex2 >= h.flex1
                    ? FLEX_COLORS[2]
                    : FLEX_COLORS[1]

                  // Current hour highlight
                  const isCurrent = hi === currentHour

                  return (
                    <div
                      key={hi}
                      title={`${dc.city} ${hi}:00 — ${h.utilPct.toFixed(0)}% util · F1:${h.flex1} F2:${h.flex2} F3:${h.flex3}`}
                      style={{
                        flex: 1,
                        height: '100%',
                        background: isCurrent ? '#185FA5' : dominant,
                        opacity: isCurrent ? 0.6 : Math.max(0.15, h.utilPct / 100),
                        borderRight: '0.5px solid rgba(255,255,255,0.3)',
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginLeft: '80px', marginTop: '3px',
      }}>
        {['12a','3a','6a','9a','12p','3p','6p','9p','12a'].map((l, i) => (
          <span key={i} style={{ fontSize: '8px', color: '#bbb' }}>{l}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
        {([1,2,3] as const).map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: FLEX_COLORS[f] }} />
            {f === 1 ? 'Flex 1 dominant' : f === 2 ? 'Flex 2 dominant' : 'Flex 3 dominant'}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#EF9F27' }} />
          Conflict hour
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#666' }}>
          <div style={{ width: '22px', height: '10px', borderRadius: '2px', background: 'linear-gradient(to right, #E24B4A22, #E24B4A)' }} />
          Opacity = utilization %
        </div>
      </div>
    </div>
  )
}

// ── DC Utilization Bars ───────────────────────────────────────────────────────

function UtilizationBars() {
  const { results, activeMode, currentHour, dcs } = useSimulationStore()
  const result = results[activeMode]
  if (!result) return null

  const utils = getDCUtilizationAtHour(result, dcs, currentHour)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {utils.map(u => {
        const color = u.pct > 85 ? '#E24B4A' : u.pct > 60 ? '#EF9F27' : '#1D9E75'
        return (
          <div key={u.dcId} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ fontSize: '10px', color: '#666', width: '84px', flexShrink: 0 }}>
              {dcs.find(d => d.id === u.dcId)?.city}
            </div>
            <div style={{ flex: 1, height: '8px', background: '#f0f0ee', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ width: `${u.pct}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ fontSize: '10px', color: '#666', width: '30px', textAlign: 'right' }}>
              {u.pct.toFixed(0)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Live Task Queue ───────────────────────────────────────────────────────────

function TaskQueue() {
  const { results, activeMode, currentHour } = useSimulationStore()
  const result = results[activeMode]
  if (!result) return null

  const visible = getVisibleQueueTasks(result.schedule, currentHour, 8)

  if (visible.length === 0) {
    return <div style={{ fontSize: '11px', color: '#999', padding: '8px 0' }}>No tasks in window at this hour</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {visible.map(t => (
        <div
          key={t.request_id}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '7px',
            padding: '6px 8px', borderRadius: '7px',
            border: t.cost_vs_carbon_conflict
              ? '0.5px solid #FAC775'
              : '0.5px solid rgba(0,0,0,0.10)',
            background: t.cost_vs_carbon_conflict ? '#FAEEDA18' : 'transparent',
          }}
        >
          <FlexBadge flex={t.flex_type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t.task_type.replace(/_/g, ' ')} · {t.origin_city}
            </div>
            <div style={{
              fontSize: '10px',
              color: t.cost_vs_carbon_conflict ? '#854F0B' : '#666',
            }}>
              → {t.assigned_dc_name} · {t.deferred_by_hours > 0 ? `defer +${t.deferred_by_hours}h` : '0 min defer'}
              {t.cost_vs_carbon_conflict && ' · conflict: cheap > clean'}
            </div>
          </div>
          <div style={{ fontSize: '9px', color: '#999', whiteSpace: 'nowrap' }}>
            {fmtHour(t.scheduled_hour)}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main SimulationTab ────────────────────────────────────────────────────────

export default function SimulationTab() {
  const { results, activeMode, currentHour } = useSimulationStore()
  const result = results[activeMode]

  const totals = result ? getRunningTotals(result.schedule, currentHour) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* ── KPI row ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '8px' }}>
        <KPICard
          val={totals ? fmt$(totals.cost) : '—'}
          label="Electricity spend so far"
          sub="running total"
          subColor="#666"
        />
        <KPICard
          val={totals ? fmtCO2(totals.carbon) : '—'}
          label="CO₂ emitted so far"
          sub="running total"
          subColor="#666"
        />
        <KPICard
          val={totals ? `${totals.scheduled} sched  ${totals.deferred} defer` : '—'}
          label="Tasks scheduled / deferred"
          sub={result ? `${result.total_tasks_scheduled + result.total_tasks_dropped} total submitted` : ''}
          subColor="#666"
        />
        <KPICard
          val={totals ? `${totals.conflicts}` : '—'}
          label="Cost vs carbon conflicts"
          sub={totals && totals.conflicts > 0 ? '● cheapest chosen over cleanest' : 'no conflicts yet'}
          subColor={totals && totals.conflicts > 0 ? '#854F0B' : '#0F6E56'}
        />
      </div>

      {/* ── Ticker ──────────────────────────────────────────────── */}
      <Ticker />

      {/* ── Time scrubber ───────────────────────────────────────── */}
      <TimeControls />

      {/* ── Main grid: map + gantt | sidebar ────────────────────── */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '55% 1fr', 
          gap: '10px',
          alignItems: 'start' // Keeps columns from stretching vertically if content is short
        }}>

        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Map */}
          <div style={{
            background: '#fff', border: '0.5px solid rgba(0,0,0,0.10)',
            borderRadius: '12px', padding: '10px 12px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
              Request origins — cumulative snapshot
            </div>
            <USMap />
          </div>

          {/* Gantt */}
          <div style={{
            background: '#fff', border: '0.5px solid rgba(0,0,0,0.10)',
            borderRadius: '12px', padding: '10px 12px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
              DC scheduled utilization — full day
            </div>
            <GanttChart />
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* GPU utilization */}
          <div style={{
            background: '#fff', border: '0.5px solid rgba(0,0,0,0.10)',
            borderRadius: '12px', padding: '10px 12px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              GPU utilization at {fmtHour(currentHour)}
            </div>
            <UtilizationBars />
          </div>

          {/* Task queue */}
          <div style={{
            background: '#fff', border: '0.5px solid rgba(0,0,0,0.10)',
            borderRadius: '12px', padding: '10px 12px', flex: 1,
          }}>
            <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '8px' }}>
              Task queue — {fmtHour(currentHour)}
            </div>
            <TaskQueue />
          </div>
        </div>
      </div>
    </div>
  )
}
