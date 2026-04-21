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

import { useSimulationStore } from '@/store/simulationStore'
import type { SolarInvestmentRanking } from '@/simulation/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt$(n: number) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
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
      sub: `vs $${m2.total_cost_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })} Mode 2`,
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
  ranking, rank, dc,
}: {
  ranking: SolarInvestmentRanking
  rank: number
  dc: { capacity_mw: number; roof_sqft: number; insolation_peak_sun_hours: number; solar_potential_kw_peak: number } | undefined
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
              {dc.capacity_mw} MW · {dc.roof_sqft.toLocaleString()} sqft roof ·{' '}
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
          Total annual value: {fmt$(ranking.totalAnnualValueUsd)}
        </div>
        {ranking.drEligible
          ? <span style={{ fontSize: '10px', background: '#E1F5EE', color: '#085041', padding: '2px 8px', borderRadius: '5px', fontWeight: 500 }}>DR eligible</span>
          : <span style={{ fontSize: '10px', background: '#f4f4f2', color: '#888', padding: '2px 8px', borderRadius: '5px' }}>DR not eligible ({ranking.drShedPct}% shed)</span>
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
            val: ranking.drEligible ? fmt$(ranking.drAnnualValueUsd) : '—',
            label: 'DR revenue',
            sub: ranking.drEligible ? `${ranking.drShedPct}% shed · 4 events/yr` : 'below 50% shed threshold',
            color: ranking.drEligible ? '#854F0B' : '#bbb',
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
            {dc.solar_potential_kw_peak.toLocaleString('en-US', { maximumFractionDigits: 0 })} kW
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
        Demand response = battery (2× solar peak kW) must shed &gt;50% of estimated peak load across 4 events/year. DR payments: PJM $12,500/MW/event, CAISO $10,000, ERCOT $8,750, PacifiCorp $5,000.
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      {/* Delta vs Mode 2 */}
      <DeltaCards />

      {/* Storage explainer */}
      <StorageExplainer />

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
