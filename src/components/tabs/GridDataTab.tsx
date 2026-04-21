'use client'

/**
 * GridDataTab.tsx
 * Reference view of the underlying grid data driving the simulation:
 *   - Summary cards per grid (avg LMP, avg carbon, DC served)
 *   - LMP hourly bar charts for all grids
 *   - Carbon intensity hourly bar charts for all grids
 *   - Annotation callouts for key grid phenomena
 *     (CAISO duck curve, ERCOT dual peak, PacifiCorp coal baseload)
 */

import { useSimulationStore } from '@/store/simulationStore'
import type { GridProfile, DataCenter } from '@/simulation/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(arr: number[]) {
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// LMP heat color: low=teal, mid=amber, high=red
function lmpColor(v: number, min: number, max: number) {
  const t = (v - min) / Math.max(1, max - min)
  if (t < 0.33) return '#1D9E75'
  if (t < 0.66) return '#EF9F27'
  return '#E24B4A'
}

// Carbon heat color: slightly different ramp to distinguish from LMP
function carbonColor(v: number, min: number, max: number) {
  const t = (v - min) / Math.max(1, max - min)
  if (t < 0.33) return '#5DCAA5'
  if (t < 0.66) return '#BA7517'
  return '#993C1D'
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
  letterSpacing: '0.04em', marginBottom: '8px',
}

// ── Grid phenomena annotations ────────────────────────────────────────────────

const ANNOTATIONS: Record<string, { lmp: string; carbon: string }> = {
  caiso_pge: {
    lmp:    'Duck curve: solar glut drives prices to $4/MWh midday, steep evening ramp to $162/MWh as solar drops',
    carbon: 'Solar noon dip to 38 gCO₂/kWh — best clean window in fleet. Evening gas peakers push to 252 gCO₂/kWh',
  },
  ercot_north: {
    lmp:    'Dual peak pattern: midday AC load + evening demand. Wind keeps overnight prices low (~$18/MWh)',
    carbon: 'Wind-heavy overnight (158 gCO₂/kWh) but gas peakers fire at peak demand (325 gCO₂/kWh)',
  },
  pjm_comed: {
    lmp:    'Classic summer peak: prices rise steadily from 6am, sustain $140–162/MWh midday through afternoon',
    carbon: 'Coal + gas mix. Carbon rises with demand — peak 418 gCO₂/kWh aligns with price peak',
  },
  pjm_dom: {
    lmp:    'Similar to ComEd but slightly lower LMP. Gas-heavy Dominion zone raises carbon vs ComEd',
    carbon: 'Highest PJM carbon intensity (435 gCO₂/kWh peak) due to more gas in dispatch stack',
  },
  pjm_pseg: {
    lmp:    'NYC-adjacent congestion: highest LMP in fleet ($180/MWh peak). Urban load density drives premiums',
    carbon: 'Gas-heavy NYC grid. Carbon tracks price — high when demand high',
  },
  pacificorp_pace: {
    lmp:    'Cheap flat baseload ($20–105/MWh). Coal provides low-cost power but with high carbon penalty',
    carbon: 'Highest carbon in fleet (412–460 gCO₂/kWh). Coal-dominant dispatch — minimal renewables',
  },
}

// ── Sparkline bar chart ───────────────────────────────────────────────────────

function HourlyBars({
  values,
  colorFn,
  height = 56,
  globalMax,
  unit,
}: {
  values: number[]
  colorFn: (v: number, min: number, max: number) => string
  height?: number
  globalMax?: number
  unit?: string
}) {
  const localMin = Math.min(...values)
  const localMax = Math.max(...values)
  const scaleMax = globalMax ?? localMax
  const peakHour = values.indexOf(localMax)

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        position: 'absolute', top: '-2px', right: 0,
        fontSize: '9px', color: '#854F0B', fontWeight: 500,
        background: '#FAEEDA', padding: '1px 5px',
        borderRadius: '4px', zIndex: 1,
      }}>
        peak {peakHour}:00 — {localMax.toFixed(0)}{unit ? ' ' + unit : ''}
      </div>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: '2px',
        height: `${height}px`,
        background: '#f4f4f2',
        borderRadius: '7px',
        border: '0.5px solid rgba(0,0,0,0.07)',
        padding: '5px 5px 0',
      }}>
        {values.map((v, i) => {
          const heightPct = scaleMax > 0 ? Math.max(4, (v / scaleMax) * 90) : 4
          return (
            <div
              key={i}
              title={`${i}:00 — ${v.toFixed(0)}${unit ? ' ' + unit : ''}`}
              style={{
                flex: 1,
                height: `${heightPct}%`,
                background: colorFn(v, localMin, localMax),
                borderRadius: '1px 1px 0 0',
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


// ── Grid summary card ─────────────────────────────────────────────────────────

function GridSummaryCard({
  grid, dcs, globalLmpMax, globalCarbonMax,
}: {
  grid: GridProfile
  dcs: DataCenter[]
  globalLmpMax: number
  globalCarbonMax: number
}) {
  const servedDCs  = dcs.filter(dc => dc.utility_id === grid.utility_id)
  const avgLMP     = avg(grid.lmp_usd_per_mwh)
  const minLMP     = Math.min(...grid.lmp_usd_per_mwh)
  const maxLMP     = Math.max(...grid.lmp_usd_per_mwh)
  const avgCarbon  = avg(grid.carbon_g_co2_per_kwh)
  const minCarbon  = Math.min(...grid.carbon_g_co2_per_kwh)
  const maxCarbon  = Math.max(...grid.carbon_g_co2_per_kwh)
  const annotation = ANNOTATIONS[grid.utility_id]

  return (
    <div style={PANEL}>
      {/* Header */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>
          {grid.name}
        </div>
        <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
          Serving: {servedDCs.map(dc => dc.city).join(', ')}
        </div>
      </div>

      {/* Stat pills */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {[
          { label: 'avg LMP',    val: `$${avgLMP.toFixed(0)}/MWh` },
          { label: 'range',      val: `$${minLMP}–$${maxLMP}` },
          { label: 'avg carbon', val: `${avgCarbon.toFixed(0)} gCO₂` },
          { label: 'range',      val: `${minCarbon}–${maxCarbon}` },
        ].map((s, i) => (
          <div key={i} style={{
            background: '#f4f4f2', borderRadius: '5px',
            padding: '3px 7px', fontSize: '10px', color: '#444',
          }}>
            <span style={{ color: '#999', marginRight: '3px' }}>{s.label}</span>
            {s.val}
          </div>
        ))}
      </div>

      {/* LMP chart — full width */}
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px', fontWeight: 500 }}>
        LMP electricity price $/MWh
      </div>
      <HourlyBars values={grid.lmp_usd_per_mwh} colorFn={lmpColor} height={56} globalMax={globalLmpMax} unit="$/MWh" />
      {annotation && (
        <div style={{ fontSize: '10px', color: '#666', marginTop: '5px', marginBottom: '12px', lineHeight: 1.5 }}>
          {annotation.lmp}
        </div>
      )}

      {/* Carbon chart — same full width, stacked below */}
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px', fontWeight: 500 }}>
        Carbon intensity gCO₂/kWh
      </div>
      <HourlyBars values={grid.carbon_g_co2_per_kwh} colorFn={carbonColor} height={56} globalMax={globalCarbonMax} unit="gCO₂/kWh" />
      {annotation && (
        <div style={{ fontSize: '10px', color: '#666', marginTop: '5px', lineHeight: 1.5 }}>
          {annotation.carbon}
        </div>
      )}
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div style={{
      ...PANEL,
      display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start',
    }}>
      <div>
        <div style={{ fontSize: '10px', fontWeight: 500, color: '#666', marginBottom: '5px' }}>
          LMP price scale
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {['#1D9E75','#EF9F27','#E24B4A'].map((c, i) => (
            <div key={i} style={{ width: '32px', height: '10px', background: c, borderRadius: '2px' }} />
          ))}
          <span style={{ fontSize: '9px', color: '#888', marginLeft: '4px' }}>cheap → expensive</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: '10px', fontWeight: 500, color: '#666', marginBottom: '5px' }}>
          Carbon intensity scale
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {['#5DCAA5','#BA7517','#993C1D'].map((c, i) => (
            <div key={i} style={{ width: '32px', height: '10px', background: c, borderRadius: '2px' }} />
          ))}
          <span style={{ fontSize: '9px', color: '#888', marginLeft: '4px' }}>clean → dirty</span>
        </div>
      </div>
      <div style={{ fontSize: '10px', color: '#888', flex: 1, lineHeight: 1.6 }}>
        Note: LMP and carbon intensity use different color ramps to distinguish price signals from
        emissions signals. A grid can be cheap but dirty (PacifiCorp) or expensive but clean (CAISO midday).
        The scheduler prioritizes cost (w=0.55) over carbon (w=0.30), flagging conflicts where they diverge.
      </div>
    </div>
  )
}

// ── Main GridDataTab ──────────────────────────────────────────────────────────

export default function GridDataTab() {
  const { grids, dcs } = useSimulationStore()

  if (!grids.length) {
    return (
      <div style={{ padding: '2rem', color: '#666', fontSize: '13px' }}>
        No grid data loaded.
      </div>
    )
  }

  // Order: CAISO first (most interesting), then ERCOT, then PJM x3, then PacifiCorp
  const order = ['caiso_pge', 'ercot_north', 'pjm_comed', 'pjm_dom', 'pjm_pseg', 'pacificorp_pace']
  const sorted = order
    .map(id => grids.find(g => g.utility_id === id))
    .filter(Boolean) as GridProfile[]

  // Shared scale across all grids — makes bar heights visually comparable
  const globalLmpMax    = Math.max(...grids.flatMap(g => g.lmp_usd_per_mwh))
  const globalCarbonMax = Math.max(...grids.flatMap(g => g.carbon_g_co2_per_kwh))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <Legend />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {sorted.map(grid => (
          <GridSummaryCard
            key={grid.utility_id}
            grid={grid}
            dcs={dcs}
            globalLmpMax={globalLmpMax}
            globalCarbonMax={globalCarbonMax}
          />
        ))}
      </div>
    </div>
  )
}
