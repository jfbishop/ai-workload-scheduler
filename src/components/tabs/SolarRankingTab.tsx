'use client'

/**
 * SolarRankingTab.tsx
 * Mode 3 — Solar + Storage Investment Ranking
 *
 * Shows which data centers would benefit most from rooftop solar
 * and battery storage investment, ranked by composite score.
 *
 * Sections:
 *   - Intro explainer (methodology)
 *   - Mode 2 vs Mode 3 delta summary (what solar/storage actually saved)
 *   - Ranked DC cards with investment metrics
 *   - Solar potential map (peak kW and kWh/day per DC)
 *   - Storage value explainer (why storage multiplier varies)
 */

import { useState } from 'react'
import { useSimulationStore } from '@/store/simulationStore'
import type { SolarInvestmentRanking } from '@/simulation/types'

// ── BESS SoC Chart ────────────────────────────────────────────────────────────

const DC_COLORS = ['#2563EB', '#D97706', '#16A34A', '#DC2626', '#7C3AED', '#0891B2']
const DC_LABELS: Record<string, string> = {
  dc_hammond_il:        'Hammond IL',
  dc_plano_tx:          'Plano TX',
  dc_chester_va:        'Chester VA',
  dc_weehawken_nj:      'Weehawken NJ',
  dc_eagle_mountain_ut: 'Eagle Mtn UT',
  dc_san_jose_ca:       'San Jose CA',
}

function BESSSoCChart() {
  const { results, dcs } = useSimulationStore()
  const [hoveredDC, setHoveredDC] = useState<string | null>(null)

  const bessSchedules = results[3]?.bess_schedules
  if (!bessSchedules || bessSchedules.length === 0) return null

  const W = 500, H = 90
  const PAD = { top: 8, right: 8, bottom: 0, left: 8 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const maxCapMwh = Math.max(...dcs.map(d => (d.battery_capacity_kwh ?? 0) / 1000))
  const yMaxMwh = Math.ceil(maxCapMwh / 5) * 5

  const toX = (h: number) => PAD.left + (h / 23) * chartW
  const toY = (mwh: number) => PAD.top + (1 - mwh / yMaxMwh) * chartH

  const ref = bessSchedules[0]

  return (
    <div>
      {/* Legend + zone key */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '7px' }}>
        {bessSchedules.map((s, i) => {
          const dimmed = hoveredDC !== null && hoveredDC !== s.dc_id
          return (
            <div key={s.dc_id}
              style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'default',
                opacity: dimmed ? 0.25 : 1, transition: 'opacity 0.15s' }}
              onMouseEnter={() => setHoveredDC(s.dc_id)}
              onMouseLeave={() => setHoveredDC(null)}>
              <div style={{ width: '16px', height: '2px', background: DC_COLORS[i], borderRadius: '1px' }} />
              <span style={{ fontSize: '9.5px', color: '#555',
                fontWeight: hoveredDC === s.dc_id ? 600 : 400 }}>
                {DC_LABELS[s.dc_id] ?? s.dc_id}
              </span>
            </div>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <div style={{ width: '9px', height: '9px', background: '#DCEEFF', border: '0.5px solid #A8D0F0', borderRadius: '1px' }} />
            <span style={{ fontSize: '8px', color: '#bbb' }}>Charging</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <div style={{ width: '9px', height: '9px', background: '#FFF0DC', border: '0.5px solid #F0C878', borderRadius: '1px' }} />
            <span style={{ fontSize: '8px', color: '#bbb' }}>Discharging</span>
          </div>
        </div>
      </div>

      {/* Chart body — mirrors FleetHourlyChart layout */}
      <div style={{ position: 'relative', height: '140px' }}>

        {/* Y-axis labels */}
        <div style={{
          position: 'absolute', left: 0, top: 8, bottom: 22, width: '30px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          alignItems: 'flex-end', paddingRight: '4px',
        }}>
          <span style={{ fontSize: '7px', color: '#bbb' }}>{yMaxMwh} MWh</span>
          <span style={{ fontSize: '7px', color: '#bbb' }}>{Math.round(yMaxMwh / 2)}</span>
          <span style={{ fontSize: '7px', color: '#bbb' }}>0</span>
        </div>

        {/* Chart area */}
        <div style={{
          position: 'absolute', left: '34px', right: '8px', top: 0, bottom: '22px',
          background: '#f4f4f2', borderRadius: '8px',
          border: '0.5px solid rgba(0,0,0,0.08)', overflow: 'hidden',
        }}>
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">

            {/* Charging / discharging zone shading */}
            {ref.hourly.map((state, h) => {
              if (h === 23) return null
              return (
                <rect key={h}
                  x={toX(h)} y={PAD.top}
                  width={toX(h + 1) - toX(h)} height={chartH}
                  fill={state.charging ? '#DCEEFF' : '#FFF0DC'}
                  opacity={0.55}
                />
              )
            })}

            {/* Dashed grid lines at 25 / 50 / 75 % */}
            {[0.25, 0.5, 0.75].map(p => (
              <line key={p}
                x1={PAD.left} y1={PAD.top + p * chartH}
                x2={W - PAD.right} y2={PAD.top + p * chartH}
                stroke="rgba(0,0,0,0.07)" strokeWidth={0.5} strokeDasharray="3,3"
              />
            ))}

            {/* Visible SoC lines */}
            {bessSchedules.map((schedule, i) => {
              const pts = schedule.hourly
                .map((state, h) => `${toX(h).toFixed(1)},${toY(state.soc_kwh / 1000).toFixed(1)}`)
                .join(' ')
              const isHovered = hoveredDC === schedule.dc_id
              const isDimmed  = hoveredDC !== null && !isHovered
              return (
                <polyline key={schedule.dc_id}
                  points={pts}
                  fill="none"
                  stroke={DC_COLORS[i]}
                  strokeWidth={isHovered ? 2.4 : 1.8}
                  strokeLinejoin="round"
                  opacity={isDimmed ? 0.12 : 0.9}
                  style={{ transition: 'opacity 0.15s, stroke-width 0.1s' }}
                />
              )
            })}

            {/* Invisible wide hit areas */}
            {bessSchedules.map((schedule) => {
              const pts = schedule.hourly
                .map((state, h) => `${toX(h).toFixed(1)},${toY(state.soc_kwh / 1000).toFixed(1)}`)
                .join(' ')
              return (
                <polyline key={`hit-${schedule.dc_id}`}
                  points={pts}
                  fill="none" stroke="transparent" strokeWidth="14"
                  style={{ cursor: 'crosshair' }}
                  onMouseEnter={() => setHoveredDC(schedule.dc_id)}
                  onMouseLeave={() => setHoveredDC(null)}
                />
              )
            })}
          </svg>
        </div>

        {/* X-axis labels */}
        <div style={{
          position: 'absolute', bottom: 0, left: '34px', right: '8px',
          display: 'flex', justifyContent: 'space-between',
        }}>
          {['12a','3a','6a','9a','12p','3p','6p','9p','12a'].map((l, i) => (
            <span key={i} style={{ fontSize: '7px', color: '#bbb' }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── BESS Revenue Breakdown panel ──────────────────────────────────────────────

function BESSRevenuePanel() {
  const { results } = useSimulationStore()
  const m3 = results[3]
  if (!m3?.bess_revenue || m3.bess_revenue.length === 0) return null

  const rev = m3.bess_revenue
  const totalArbitrage = m3.total_bess_arbitrage_usd ?? 0
  const totalCharging  = m3.total_bess_charging_cost_usd ?? 0
  const totalNetArb    = m3.total_bess_net_arbitrage_usd ?? 0
  const totalCapacity  = m3.total_capacity_market_usd ?? 0
  const totalNet       = m3.total_bess_net_benefit_usd ?? 0
  const effectiveCost  = m3.total_cost_usd - totalNet

  return (
    <div style={PANEL}>
      <div style={HD}>BESS revenue stack — energy arbitrage + capacity market (Mode 3)</div>
      <div style={{ fontSize: '10px', color: '#888', marginBottom: '12px', lineHeight: 1.6 }}>
        BESS economics are computed post-scheduling and do not influence task routing decisions.
        <span style={{ color: '#444' }}> Arbitrage</span> = actual discharge savings capped by DC load, net of charging cost.
        <span style={{ color: '#444' }}> Capacity payments</span> = $/MW-day for BESS enrolled as demand-response resource (availability-based, not event-dependent).
      </div>

      {/* Per-DC table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
          <thead>
            <tr style={{ borderBottom: '0.5px solid rgba(0,0,0,0.10)' }}>
              {['DC', 'Market', 'BESS MW', 'Arbitrage savings', '− Charging cost', 'Net arbitrage', '+ Capacity mkt', 'Net benefit'].map(h => (
                <th key={h} style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 500, color: '#666', whiteSpace: 'nowrap' }}
                  {...(h === 'DC' || h === 'Market' ? { style: { textAlign: 'left', padding: '4px 8px', fontWeight: 500, color: '#666' } } : {})}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rev.map((r, i) => (
              <tr key={r.dc_id} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.05)', background: i % 2 === 0 ? 'transparent' : '#fafaf9' }}>
                <td style={{ padding: '5px 8px', color: '#333', fontWeight: 500 }}>{r.dc_name}</td>
                <td style={{ padding: '5px 8px', color: '#888' }}>{r.market_name}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#555' }}>{(r.bess_capacity_kw / 1000).toFixed(1)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#1a7a3f' }}>{fmt$(r.arbitrage_savings_usd)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#B54A00' }}>−{fmt$(r.charging_cost_usd)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: r.net_arbitrage_usd >= 0 ? '#1a7a3f' : '#B54A00', fontWeight: 500 }}>{fmt$(r.net_arbitrage_usd)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#185FA5' }}>{fmt$(r.capacity_market_usd)}</td>
                <td style={{ padding: '5px 8px', textAlign: 'right', color: '#185FA5', fontWeight: 600 }}>{fmt$(r.net_benefit_usd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '1px solid rgba(0,0,0,0.12)', background: '#f4f4f2' }}>
              <td colSpan={3} style={{ padding: '6px 8px', fontWeight: 600, color: '#333', fontSize: '10px' }}>Fleet total</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#1a7a3f', fontWeight: 600 }}>{fmt$(totalArbitrage)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#B54A00', fontWeight: 600 }}>−{fmt$(totalCharging)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: totalNetArb >= 0 ? '#1a7a3f' : '#B54A00' }}>{fmt$(totalNetArb)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#185FA5', fontWeight: 600 }}>{fmt$(totalCapacity)}</td>
              <td style={{ padding: '6px 8px', textAlign: 'right', color: '#185FA5', fontWeight: 700 }}>{fmt$(totalNet)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Effective cost callout */}
      <div style={{
        marginTop: '12px', padding: '8px 12px',
        background: '#EFF6FF', borderRadius: '8px', border: '0.5px solid #BFDBFE',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <span style={{ fontSize: '10px', color: '#555' }}>Mode 3 gross electricity cost</span>
          <span style={{ fontSize: '10px', color: '#999', marginLeft: '8px' }}>{fmt$(m3.total_cost_usd)}</span>
          <span style={{ fontSize: '10px', color: '#999', margin: '0 6px' }}>−</span>
          <span style={{ fontSize: '10px', color: '#555' }}>BESS net benefit {fmt$(totalNet)}</span>
        </div>
        <div>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#1D4ED8' }}>Effective cost: {fmt$(effectiveCost)}</span>
        </div>
      </div>

      <div style={{ marginTop: '8px', fontSize: '9px', color: '#aaa', lineHeight: 1.6 }}>
        Capacity market prices: PJM $300/MW-day (midpoint 2025/26–2026/27 BRA, pjm.com) ·
        ERCOT $114/MW-day (ERS $50M budget ÷ ~1,200 MW summer, ercot.com) ·
        CAISO $292.33/MW-day ($8.77/kW-month H1 2025, Modo Energy) ·
        PacifiCorp $0 (no organized capacity market, bilateral RFPs only).
        Assumes 100% performance factor; actual derate typically 5–15%.
        Charging cost uses per-DC round-trip efficiency (0.90); Li-ion typical 0.85 (NREL ATB 2023).
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number | undefined) {
  return '$' + (n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
}
function fmtCO2(kg: number) {
  return kg >= 1000 ? (kg / 1000).toFixed(1) + ' t' : kg.toFixed(0) + ' kg'
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

// Rank medal colors
const RANK_COLORS = ['#BA7517', '#888780', '#854F0B', '#5F5E5A', '#5F5E5A', '#5F5E5A']
const RANK_LABELS = ['1st', '2nd', '3rd', '4th', '5th', '6th']

// ── Mode 2 vs 3 delta cards ───────────────────────────────────────────────────

function DeltaCards() {
  const { results } = useSimulationStore()
  const m2 = results[2]
  const m3 = results[3]

  if (!m2 || !m3) return null

  const costSaved   = m2.total_cost_usd - m3.total_cost_usd
  const carbonSaved = m2.total_carbon_kg - m3.total_carbon_kg
  const costPct     = ((costSaved / m2.total_cost_usd) * 100).toFixed(1)
  const carbonPct   = ((carbonSaved / m2.total_carbon_kg) * 100).toFixed(1)

  const cards = [
    {
      val: fmt$(costSaved),
      label: 'Additional cost savings vs Mode 2',
      sub: `${costPct}% further reduction`,
      subColor: '#0F6E56',
    },
    {
      val: fmtCO2(carbonSaved),
      label: 'Additional CO₂ avoided vs Mode 2',
      sub: `${carbonPct}% further reduction`,
      subColor: '#0F6E56',
    },
    {
      val: fmt$(m3.total_cost_usd),
      label: 'Mode 3 total fleet cost',
      sub: `vs $${(m2.total_cost_usd ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} Mode 2`,
      subColor: '#666',
    },
    {
      val: fmtCO2(m3.total_carbon_kg),
      label: 'Mode 3 total CO₂',
      sub: `vs ${fmtCO2(m2.total_carbon_kg)} Mode 2`,
      subColor: '#666',
    },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: '8px', marginBottom: '10px' }}>
      {cards.map(c => (
        <div key={c.label} style={{ background: '#f4f4f2', borderRadius: '8px', padding: '10px 12px' }}>
          <div style={{ fontSize: '20px', fontWeight: 500, color: '#1a1a1a' }}>{c.val}</div>
          <div style={{ fontSize: '11px', color: '#666', marginTop: '2px' }}>{c.label}</div>
          <div style={{ fontSize: '11px', color: c.subColor, marginTop: '3px' }}>{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── Investment ranking card ───────────────────────────────────────────────────

function RankingCard({
  ranking, rank, dc, annualBessRevenueUsd,
}: {
  ranking: SolarInvestmentRanking
  rank: number
  dc: { capacity_mw: number; roof_sqft: number; insolation_peak_sun_hours: number; solar_potential_kw_peak: number } | undefined
  annualBessRevenueUsd: number
}) {
  const rankColor = RANK_COLORS[rank] ?? '#5F5E5A'
  const scoreWidth = `${ranking.investmentScore}%`

  return (
    <div style={{
      ...PANEL,
      borderLeft: `3px solid ${rankColor}`,
      borderRadius: '0 12px 12px 0',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontSize: '11px', fontWeight: 500,
              color: rankColor,
              background: rankColor + '18',
              padding: '2px 8px', borderRadius: '5px',
            }}>
              {RANK_LABELS[rank]}
            </span>
            <span style={{ fontSize: '14px', fontWeight: 500, color: '#1a1a1a' }}>
              {ranking.dcName}
            </span>
          </div>
          {dc && (
            <div style={{ fontSize: '10px', color: '#888', marginTop: '3px' }}>
              {dc.capacity_mw} MW · {(dc.roof_sqft ?? 0).toLocaleString()} sqft roof ·{' '}
              {dc.insolation_peak_sun_hours} peak sun hrs/day
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#185FA5' }}>
            Score: {ranking.investmentScore}/100
          </div>
          <div style={{ fontSize: '10px', color: '#888', marginTop: '2px' }}>
            ~{ranking.paybackYearsEstimate}yr payback
          </div>
        </div>
      </div>

      {/* Score bar */}
      <div style={{
        height: '5px', background: '#f0f0ee', borderRadius: '3px',
        marginBottom: '12px', overflow: 'hidden',
      }}>
        <div style={{
          width: scoreWidth, height: '100%',
          background: rankColor,
          borderRadius: '3px',
          transition: 'width 0.5s ease',
        }} />
      </div>

      {/* Total value banner */}
      <div style={{
        background: '#f0f7ff', borderRadius: '7px', padding: '8px 12px',
        marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: '#0C447C' }}>
          Total annual value: {fmt$(ranking.totalAnnualValueUsd + annualBessRevenueUsd)}
        </div>
        {ranking.drEligible
          ? <span style={{ fontSize: '10px', background: '#E1F5EE', color: '#085041', padding: '2px 8px', borderRadius: '5px', fontWeight: 500 }}>DR: {fmt$(ranking.drAnnualValueUsd)}/yr</span>
          : <span style={{ fontSize: '10px', background: '#f4f4f2', color: '#888', padding: '2px 8px', borderRadius: '5px' }}>No DR market</span>
        }
      </div>

      {/* Metrics grid — 5 value streams */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
        {[
          {
            val: fmt$(ranking.annualCostDisplacementUsd),
            label: 'Energy cost offset',
            sub: 'solar displaces grid',
            color: '#185FA5',
          },
          {
            val: fmtCO2(ranking.annualCarbonDisplacementKg),
            label: 'Carbon avoided',
            sub: 'vs drawing from grid',
            color: '#0F6E56',
          },
          {
            val: ranking.storageMultiplier.toFixed(1) + '×',
            label: 'Storage multiplier',
            sub: 'evening / solar LMP',
            color: ranking.storageMultiplier > 5 ? '#0C447C' : '#666',
          },
          {
            val: annualBessRevenueUsd > 0 ? fmt$(annualBessRevenueUsd) : '—',
            label: 'BESS revenue',
            sub: 'cap. mkt + arbitrage · Aug 15 ×365',
            color: annualBessRevenueUsd > 0 ? '#854F0B' : '#bbb',
          },
          {
            val: fmt$(ranking.coincidentPeakSavingsUsd),
            label: 'Coincident peak',
            sub: 'capacity charge avoided',
            color: '#534AB7',
          },
        ].map(m => (
          <div key={m.label} style={{
            background: '#f9f9f8', borderRadius: '7px', padding: '7px 9px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 500, color: m.color }}>{m.val}</div>
            <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>{m.label}</div>
            <div style={{ fontSize: '9px', color: '#999', marginTop: '1px' }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Solar specs footer */}
      {dc && (
        <div style={{
          marginTop: '8px', paddingTop: '8px',
          borderTop: '0.5px solid rgba(0,0,0,0.08)',
          display: 'flex', gap: '16px',
        }}>
          <div style={{ fontSize: '10px', color: '#666' }}>
            <span style={{ color: '#999' }}>Solar peak: </span>
            {(dc.solar_potential_kw_peak ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })} kW
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>
            <span style={{ color: '#999' }}>Daily potential: </span>
            {(dc.solar_potential_kw_peak * dc.insolation_peak_sun_hours / 1000).toFixed(0)} MWh/day
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>
            <span style={{ color: '#999' }}>~{ranking.paybackYearsEstimate}yr payback </span>
            with all value streams
          </div>
        </div>
      )}
    </div>
  )
}

// ── Solar potential bar chart ─────────────────────────────────────────────────

function SolarPotentialChart({ rankings }: { rankings: SolarInvestmentRanking[] }) {
  const { dcs } = useSimulationStore()
  const maxKwh = Math.max(1, ...rankings.map(r => {
    const dc = dcs.find(d => d.id === r.dcId)
    return dc ? dc.solar_potential_kwh_per_day : 0
  }))

  return (
    <div>
      {rankings.map((r, i) => {
        const dc = dcs.find(d => d.id === r.dcId)
        if (!dc) return null
        const pct = (dc.solar_potential_kwh_per_day / maxKwh) * 100
        return (
          <div key={r.dcId} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '7px' }}>
            <div style={{ fontSize: '10px', color: '#666', width: '100px', flexShrink: 0, textAlign: 'right' }}>
              {r.dcName}
            </div>
            <div style={{ flex: 1, height: '10px', background: '#f0f0ee', borderRadius: '5px', overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%',
                background: i === 0 ? '#EF9F27' : '#1D9E75',
                borderRadius: '5px',
              }} />
            </div>
            <div style={{ fontSize: '10px', color: '#666', width: '80px', textAlign: 'right', flexShrink: 0 }}>
              {(dc.solar_potential_kwh_per_day / 1000).toFixed(1)} MWh/day
            </div>
            <div style={{ fontSize: '10px', color: '#999', width: '60px', flexShrink: 0 }}>
              {dc.insolation_peak_sun_hours} sun hrs
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Storage value explainer ───────────────────────────────────────────────────

function StorageExplainer() {
  return (
    <div style={{ ...PANEL, background: '#E6F1FB', border: '0.5px solid #85B7EB' }}>
      <div style={{ fontSize: '12px', fontWeight: 500, color: '#0C447C', marginBottom: '6px' }}>
        Why does the storage multiplier matter?
      </div>
      <div style={{ fontSize: '11px', color: '#185FA5', lineHeight: 1.6 }}>
        Solar panels generate power when the sun shines — typically 9am to 4pm.
        But on grids like CAISO, the most expensive electricity happens in the evening (5pm–9pm)
        when solar has already dropped off and AC demand is still high.
        Battery storage lets a data center capture cheap solar energy during the day
        and discharge it during the expensive evening ramp — effectively time-shifting
        the solar benefit to when it's worth the most.
        A storage multiplier above 1.5× means the evening-to-midday price ratio is high
        enough that storage investment has strong economic justification on top of solar alone.
      </div>
    </div>
  )
}

// ── Methodology note ─────────────────────────────────────────────────────────

function MethodologyNote() {
  return (
    <div style={{ ...PANEL, background: '#f9f9f8' }}>
      <div style={{ fontSize: '11px', fontWeight: 500, color: '#666', marginBottom: '6px' }}>
        Ranking methodology
      </div>
      <div style={{ fontSize: '10px', color: '#888', lineHeight: 1.6 }}>
        Investment score = 0.40 × energy cost displacement + 0.25 × carbon displacement + 0.15 × storage multiplier + 0.12 × demand response revenue + 0.08 × coincident peak savings.
        Energy cost displacement = solar kWh/day × 365 × avg LMP during solar hours (9am–4pm).
        Carbon displacement = solar kWh/day × 365 × avg carbon intensity during solar hours.
        Storage multiplier = avg evening LMP ÷ avg solar LMP — higher ratio means stronger time-shifting value.
        Demand response = battery (2× solar peak kW) must shed greater than or equal to 50% of estimated peak load across 4 events/year. DR payments: PJM $12,500/MW/event, CAISO $10,000, ERCOT $8,750, PacifiCorp $5,000.
        Coincident peak = solar kW at system peak hour × grid capacity charge (PJM $150/kW-yr, CAISO $120, ERCOT $100, PacifiCorp $80).
        Solar: NSRDB insolation data, 20% panel efficiency, full roof utilization. Install cost: $1.00/W.
      </div>
    </div>
  )
}

// ── Main SolarRankingTab ──────────────────────────────────────────────────────

export default function SolarRankingTab() {
  const { results, dcs } = useSimulationStore()
  const m3 = results[3]

  if (!m3) {
    return (
      <div style={{ padding: '2rem', color: '#666', fontSize: '13px' }}>
        Mode 3 has not been run yet. Switch to Mode 3 and the rankings will appear here.
      </div>
    )
  }

  if (!m3.solar_rankings || m3.solar_rankings.length === 0) {
    return (
      <div style={{ padding: '2rem', color: '#666', fontSize: '13px' }}>
        No solar rankings available in Mode 3 results.
      </div>
    )
  }

  const rankings = m3.solar_rankings
  const bessRevByDC = new Map(
    (m3.bess_revenue ?? []).map(r => [r.dc_id, r.net_benefit_usd * 365])
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Delta vs Mode 2 */}
      <DeltaCards />

      {/* BESS State-of-Charge chart */}
      <div style={PANEL}>
        <div style={HD}>Battery state-of-charge — 24h dispatch schedule (Mode 3)</div>
        <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px' }}>
          Each DC pre-charges during cheap hours (LMP below daily median) and discharges during expensive hours.
          Load shifting benefit applies to all tasks — including Flex 1 real-time inference that cannot be deferred by scheduling alone.
        </div>
        <BESSSoCChart />
        <div style={{ display: 'flex', gap: '24px', marginTop: '10px', paddingTop: '8px', borderTop: '0.5px solid rgba(0,0,0,0.07)' }}>
          <div style={{ fontSize: '10px', color: '#888' }}>
            <span style={{ color: '#555', fontWeight: 500 }}>Sizing: </span>
            Battery capacity = solar peak kW × 4h · Charge/discharge rate = solar peak kW · RTE = 90%
          </div>
          <div style={{ fontSize: '10px', color: '#888' }}>
            <span style={{ color: '#555', fontWeight: 500 }}>Dispatch strategy: </span>
            Charge when LMP ≤ daily median · Discharge when LMP &gt; daily median
          </div>
        </div>
      </div>

      {/* Storage explainer */}
      <StorageExplainer />

      {/* BESS Revenue Breakdown */}
      <BESSRevenuePanel />

      {/* Ranked cards */}
      <div style={PANEL}>
        <div style={HD}>Data center investment ranking — solar + storage</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {rankings.map((r, i) => {
            const dc = dcs.find(d => d.id === r.dcId)
            return (
              <RankingCard
                key={r.dcId}
                ranking={r}
                rank={i}
                dc={dc ? {
                  capacity_mw: dc.capacity_mw,
                  roof_sqft: dc.roof_sqft,
                  insolation_peak_sun_hours: dc.insolation_peak_sun_hours,
                  solar_potential_kw_peak: dc.solar_potential_kw_peak,
                } : undefined}
                annualBessRevenueUsd={bessRevByDC.get(r.dcId) ?? 0}
              />
            )
          })}
        </div>
      </div>

      {/* Solar potential bars */}
      <div style={PANEL}>
        <div style={HD}>Daily solar generation potential by DC</div>
        <div style={{ fontSize: '10px', color: '#888', marginBottom: '10px' }}>
          Based on NSRDB insolation data · 20% panel efficiency · full roof utilization
        </div>
        <SolarPotentialChart rankings={rankings} />
      </div>

      {/* Methodology */}
      <MethodologyNote />
    </div>
  )
}
