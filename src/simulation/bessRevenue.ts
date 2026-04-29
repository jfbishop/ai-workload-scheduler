/**
 * bessRevenue.ts
 *
 * Post-hoc BESS economic analysis for Mode 3 simulations.
 * Called AFTER the scheduling loop completes — does not influence task placement.
 *
 * Revenue streams modeled:
 *   1. Energy arbitrage  — charge at low LMP, discharge at high LMP (net of charging cost)
 *   2. Capacity market   — DC registered as demand response resource; paid $/MW-day
 *                          for availability regardless of actual dispatch events.
 *
 * Not modeled (see README §BESS-aware routing extension):
 *   - DR energy event payments (would double-count with arbitrage in wholesale LMP model)
 *   - Ancillary services (frequency regulation, spinning reserves)
 *   - BTM export to grid (prohibited under most commercial utility tariffs)
 *
 * Charging assumption: BESS charges from grid (worst-case cost basis, plan A).
 *   Round-trip efficiency: uses per-DC value from data_centers.json (0.90).
 *   Li-ion typical is 0.85; 0.90 represents premium-grade NMC chemistry.
 *   Source: NREL "Utility-Scale Battery Storage" Annual Technology Baseline 2023.
 *
 * Capacity market parameters (see source comments on DR_MARKET_PARAMS):
 *   PJM   — $300/MW-day (midpoint 2025/26 BRA and 2026/27 cap)
 *   ERCOT — $114/MW-day (summer SCT equivalent, $50M ERS budget)
 *   CAISO — $292.33/MW-day ($8.77/kW-month H1 2025 RA avg, Modo Energy)
 *   PacifiCorp — $0 (no organized capacity market)
 *
 * Caveats:
 *   - Assumes 100% performance factor; actual derate typically 5–15%
 *   - BTM BESS capacity market registration requires CSP qualification
 *     and peak-hour performance obligations; modeled as unconditional here
 *   - PacifiCorp PACE does not participate in any capacity market auction;
 *     $0 is conservative and defensible (bilateral RFP prices not public)
 */

import type { DataCenter, GridProfile, BESSSchedule } from './physics'
import type { BESSRevenueHour, BESSRevenueResult } from './types'

// ── Per-market capacity payment parameters ─────────────────────────────────────

interface DRMarketParams {
  market_name: string
  capacity_usd_per_mw_day: number
  source: string
}

const DR_MARKET_PARAMS: Record<string, DRMarketParams> = {
  pjm_comed: {
    market_name: 'PJM RPM',
    // Midpoint between 2025/2026 BRA RTO-wide clearing ($269.92/MW-day) and
    // 2026/2027 BRA price cap ($329.17/MW-day, all LDAs uniform).
    // Source: PJM 2025/2026 BRA Report (pjm.com, July 30 2024);
    //         PJM 2026/2027 BRA Report (pjm.com, July 22 2025).
    capacity_usd_per_mw_day: 300,
    source: 'PJM BRA reports pjm.com; midpoint $269.92 (2025/26) and $329.17 (2026/27 cap)',
  },
  pjm_dom: {
    market_name: 'PJM RPM',
    // Dominion zone cleared $444.26/MW-day in 2025/2026 (constrained LDA).
    // In 2026/2027 all zones converged to uniform cap $329.17/MW-day.
    // Using system-wide midpoint $300 for simulation consistency.
    // Source: PJM 2025/2026 BRA Report (pjm.com, July 30 2024).
    capacity_usd_per_mw_day: 300,
    source: 'PJM BRA reports; Dominion zone $444.26 (2025/26), system cap $329.17 (2026/27)',
  },
  pjm_pseg: {
    market_name: 'PJM RPM',
    // PSEG zone cleared at RTO-wide $269.92/MW-day in 2025/2026.
    // Using system-wide midpoint $300 consistent with other PJM zones.
    // Source: PJM 2025/2026 BRA Report (pjm.com, July 30 2024).
    capacity_usd_per_mw_day: 300,
    source: 'PJM BRA reports; PSEG RTO-wide $269.92 (2025/26), cap $329.17 (2026/27)',
  },
  ercot_north: {
    market_name: 'ERCOT ERS (Jun–Sep SCT)',
    // ERCOT has no formal capacity market (energy-only market).
    // Emergency Response Service (ERS) availability payment approximation:
    //   $50M annual ERS budget (PUCT Rule 25.507) ÷ ~1,200 MW typical
    //   summer (Jun–Sep) procurement = ~$41,667/MW-year = $114/MW-day.
    //   Offer cap: $80/MW/hour. Source: ercot.com/services/programs/load/eils/
    // Simulation day is Aug 15 (summer SCT); using summer-SCT daily equivalent.
    capacity_usd_per_mw_day: 114,
    source: 'ERCOT ERS $50M budget (PUCT 25.507) ÷ ~1,200 MW summer procurement; offer cap $80/MW-hr',
  },
  pacificorp_pace: {
    market_name: 'PacifiCorp (no capacity market)',
    // PacifiCorp participates in the Energy Imbalance Market (EIM) only.
    // No organized capacity auction exists in the PacifiCorp BAA.
    // Capacity procured through bilateral RFPs; no public clearing price.
    // Modeled as $0 (conservative, fully defensible in academic context).
    // Source: PacifiCorp 2025 Integrated Resource Plan (pacificorp.com).
    capacity_usd_per_mw_day: 0,
    source: 'PacifiCorp participates in EIM only; no organized capacity market. Source: PacifiCorp 2025 IRP',
  },
  caiso_pge: {
    market_name: 'CAISO Resource Adequacy',
    // Battery RA contract price H1 2025 average: $8.77/kW-month (+12% YoY).
    // Converted: $8.77/kW-month × 1,000 kW/MW ÷ 30 days/month = $292.33/MW-day.
    // Source: Modo Energy CAISO Battery Revenues Report, October 2025.
    //         CAISO 2024 Special Report on Battery Storage, May 29 2025 (caiso.com).
    capacity_usd_per_mw_day: 292.33,
    source: 'Modo Energy CAISO Battery Revenues (Oct 2025): $8.77/kW-month RA avg × 1000/30',
  },
}

// ── Main revenue calculation ───────────────────────────────────────────────────

/**
 * Compute BESS economic benefit for one DC on the simulation day.
 * Called post-scheduling; does not affect task routing.
 *
 * @param dc                Data center (battery parameters from data_centers.json)
 * @param bessSchedule      24-hour BESS dispatch (from precomputeBESSSchedule)
 * @param dcHourlyLoadKwh   Actual scheduled task energy at this DC per hour [24 values, kWh]
 * @param grid              Grid profile (hourly LMP)
 */
export function computeBESSRevenue(
  dc: DataCenter,
  bessSchedule: BESSSchedule,
  dcHourlyLoadKwh: number[],
  grid: GridProfile,
): BESSRevenueResult {
  const params = DR_MARKET_PARAMS[dc.utility_id] ?? {
    market_name: 'Unknown market',
    capacity_usd_per_mw_day: 0,
    source: 'No data',
  }

  const hourly: BESSRevenueHour[] = []
  let totalArbitrage    = 0
  let totalChargingCost = 0

  for (let h = 0; h < 24; h++) {
    const state  = bessSchedule.hourly[h]
    const lmp    = grid.lmp_usd_per_mwh[h]
    const dcLoad = dcHourlyLoadKwh[h]

    let dischargeKwh      = 0
    let chargeKwhFromGrid = 0
    let arbitrageSavings  = 0
    let chargingCost      = 0

    if (!state.charging && state.bess_offset_kw > 0) {
      // Discharge: cap actual offset by DC's real load at this hour.
      // BESS can only offset energy the DC actually consumed from the grid.
      dischargeKwh    = Math.min(state.bess_offset_kw, dcLoad)
      arbitrageSavings = dischargeKwh * lmp / 1000

    } else if (state.charging) {
      // Charging: grid must supply more than what gets stored (efficiency loss).
      // Grid draw = min(charge_rate, available_headroom) / round_trip_efficiency.
      // Per-DC efficiency = 0.90 (data_centers.json); Li-ion typical 0.85 per NREL ATB 2023.
      const headroom       = dc.battery_capacity_kwh - state.soc_kwh
      const kwhToStore     = Math.min(dc.charge_rate_kw * dc.round_trip_efficiency, headroom)
      chargeKwhFromGrid    = kwhToStore / dc.round_trip_efficiency
      chargingCost         = chargeKwhFromGrid * lmp / 1000
    }

    totalArbitrage    += arbitrageSavings
    totalChargingCost += chargingCost

    hourly.push({
      hour:                      h,
      dc_load_kwh:               dcLoad,
      bess_discharge_kwh:        dischargeKwh,
      bess_charge_kwh_from_grid: chargeKwhFromGrid,
      lmp_usd_per_mwh:           lmp,
      arbitrage_savings_usd:     arbitrageSavings,
      charging_cost_usd:         chargingCost,
    })
  }

  const netArbitrageUsd   = totalArbitrage - totalChargingCost
  // Capacity payment = BESS discharge capacity (kW) converted to MW × $/MW-day
  const capacityMarketUsd = (dc.discharge_rate_kw / 1000) * params.capacity_usd_per_mw_day
  const netBenefitUsd     = netArbitrageUsd + capacityMarketUsd

  return {
    dc_id:                  dc.id,
    dc_name:                dc.name,
    market_name:            params.market_name,
    bess_capacity_kw:       dc.discharge_rate_kw,
    arbitrage_savings_usd:  totalArbitrage,
    charging_cost_usd:      totalChargingCost,
    net_arbitrage_usd:      netArbitrageUsd,
    capacity_market_usd:    capacityMarketUsd,
    net_benefit_usd:        netBenefitUsd,
    hourly,
  }
}
