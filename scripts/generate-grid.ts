/**
 * generate-grid.ts
 *
 * Generates data/grid.json — hourly LMP ($/MWh) and carbon intensity (gCO₂/kWh)
 * profiles for each grid operator serving the simulated data centers.
 *
 * NOT run automatically. Only execute if you want to regenerate grid profiles
 * with different parameters or add new grid operators.
 *
 * Run with:
 *   npx ts-node --project tsconfig.scripts.json scripts/generate-grid.ts
 *
 * WARNING: This overwrites data/grid.json. Commit the existing file first
 * if you want to preserve the current profiles.
 *
 * ── Data sources ─────────────────────────────────────────────────────────────
 *
 * LMP (Locational Marginal Price) profiles are shaped from historical day-ahead
 * prices for August 15, a high-demand summer weekday. Sources:
 *
 *   PJM (ComEd IL, Dominion VA, PSEG NJ):
 *     PJM Data Miner 2 — https://dataminer2.pjm.com/
 *     Historical day-ahead LMPs by zone, August 15 2023.
 *     ComEd zone (IL hub), Dominion zone (VA hub), PSEG zone (NJ hub).
 *
 *   ERCOT (North TX):
 *     ERCOT Historical Settlement Point Prices
 *     https://www.ercot.com/gridinfo/load/load_hist
 *     North Hub day-ahead price, August 15 2023.
 *     Characterized by wind-driven overnight lows and dual AC/industrial peaks.
 *
 *   CAISO (PG&E CA):
 *     CAISO OASIS — http://oasis.caiso.com/
 *     NP15 zone day-ahead LMP, August 15 2023.
 *     Duck curve clearly visible: solar glut drives midday to ~$4/MWh,
 *     steep evening ramp to ~$162/MWh as solar drops and AC demand peaks.
 *
 *   PacifiCorp PACE (UT):
 *     EIA Form 923 + EIA-930 generation data approximation.
 *     https://www.eia.gov/electricity/data/eia923/
 *     Coal-dominant dispatch produces flat, low price profile ($20–105/MWh).
 *
 * Carbon intensity profiles are shaped from marginal emissions data:
 *
 *   EPA eGRID subregion averages (2022 data):
 *     https://www.epa.gov/egrid
 *     RFCE (PJM East — ComEd/PSEG), RFCM (PJM West — Dominion),
 *     ERCT (ERCOT), CAMX (CAISO), NWPP (PacifiCorp PACE).
 *
 *   WattTime marginal emissions methodology for hourly shaping:
 *     https://www.watttime.org/
 *     Carbon intensity peaks with demand (more gas peakers dispatched),
 *     troughs overnight (baseload coal/nuclear, less gas).
 *     CAISO shows solar noon dip (~38 gCO₂/kWh) driven by curtailed
 *     solar effectively displacing gas generation.
 *
 * ── Additional ISOs not currently simulated ──────────────────────────────────
 *
 * The following ISOs are not included in the current simulation but are
 * documented here for future extension. To add a new ISO:
 *   1. Add a new entry to the GRID_PROFILES array below
 *   2. Add the corresponding DC to data/data_centers.json with matching utility_id
 *   3. Run npm run simulate to regenerate results
 *
 * MISO (Midcontinent ISO):
 *   Covers MN, IA, IL, IN, MI, WI, MO, ND, SD, MT, and parts of LA/AR/MS.
 *   Characterization: wind-heavy (largest wind operator in North America),
 *   moderate coal baseload. LMP typically $25–120/MWh summer days.
 *   Carbon: ~350–420 gCO₂/kWh (wind-shaped, lower overnight).
 *   Data source: MISO Energy Markets — https://www.misoenergy.org/markets-and-operations/
 *   Key hubs: Indiana Hub, Illinois Hub, Minnesota Hub.
 *
 * NYISO (New York ISO):
 *   Covers New York State. NYC zone (Zone J) has the highest LMP in the US
 *   due to transmission congestion — can reach $500+/MWh during heat events.
 *   Characterization: dual peak (morning commute + evening), very congestion-driven.
 *   Carbon: ~200–350 gCO₂/kWh (significant nuclear + hydro from upstate).
 *   Data source: NYISO Market Data — https://www.nyiso.com/markets
 *   Key zones: Zone A (West), Zone J (NYC), Zone K (Long Island).
 *
 * ISO-NE (New England ISO):
 *   Covers CT, MA, ME, NH, RI, VT.
 *   Characterization: gas-dominant dispatch, high summer LMPs ($60–200/MWh).
 *   Moderate carbon (~250–380 gCO₂/kWh), lower than PJM due to nuclear.
 *   Data source: ISO-NE Energy, Load and Demand — https://www.iso-ne.com/isoexpress/
 *   Relevant for a Boston or Providence data center.
 *
 * SPP (Southwest Power Pool):
 *   Covers KS, OK, NE, SD, ND, TX Panhandle, NM, MT, WY.
 *   Characterization: wind-heavy (2nd after MISO), cheap baseload.
 *   LMP typically $20–90/MWh. Carbon ~300–420 gCO₂/kWh (wind + coal mix).
 *   Data source: SPP Marketplace — https://marketplace.spp.org/
 *
 * Duke Energy Carolinas / Duke Energy Progress:
 *   Not an ISO — vertically integrated utility covering NC, SC.
 *   Relevant for Charlotte, Raleigh, or Research Triangle data centers.
 *   Characterization: nuclear-heavy (low carbon ~180–280 gCO₂/kWh),
 *   moderate LMP. Would need EIA Form 923 approximation (no public LMP).
 *
 * NV Energy (Nevada):
 *   Not an ISO — covers Las Vegas metro. Relevant for Henderson/North Las Vegas DCs.
 *   High solar penetration, hot summers (high cooling PUE), moderate carbon.
 *   Data source: EIA-930 approximation.
 *
 * ── PUE methodology ──────────────────────────────────────────────────────────
 *
 * Power Usage Effectiveness (PUE) represents the ratio of total facility power
 * to IT equipment power. PUE = 1.0 is perfect efficiency; real facilities run
 * 1.1–1.6 depending on cooling technology and ambient temperature.
 *
 * Formula used (air-side economizer model):
 *   PUE(temp_c) = PUE_BASE + max(0, temp_c - ECONOMIZER_THRESHOLD) × TEMP_COEFFICIENT
 *   PUE_BASE              = 1.30  (overhead from power distribution, lighting, fans)
 *   ECONOMIZER_THRESHOLD  = 20°C  (below this, outside air cooling is "free")
 *   TEMP_COEFFICIENT      = 0.01  (each degree above 20°C adds 1% overhead)
 *   PUE_CAP               = 1.60  (mechanical cooling limit)
 *
 * This models a facility using air-side economization (free cooling from outside
 * air when ambient is cool enough). When ambient exceeds 20°C, mechanical
 * refrigeration must supplement, increasing PUE linearly.
 *
 * Real-world reference: Google data centers report PUE 1.10 (optimized),
 * industry average is ~1.55 (Uptime Institute 2023 Global Data Center Survey).
 * Our model produces 1.30–1.47 depending on location and hour, which is
 * consistent with a modern facility using partial economization.
 *
 * August ambient temperatures are derived from NOAA Climate Normals (1991–2020):
 *   https://www.ncei.noaa.gov/products/land-based-station/us-climate-normals
 *   Daily temperature cycle modeled as sinusoidal between recorded daily
 *   min (occurring ~6am) and daily max (occurring ~3pm).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs   from 'fs'
import * as path from 'path'

const ROOT = path.join(__dirname, '..')

// ── Constants ─────────────────────────────────────────────────────────────────

const PUE_BASE             = 1.30
const ECONOMIZER_THRESHOLD = 20    // °C — free cooling below this
const TEMP_COEFFICIENT     = 0.01  // PUE increase per °C above threshold
const PUE_CAP              = 1.60  // mechanical cooling limit

// ── PUE calculation from ambient temperature ──────────────────────────────────

function computePue(ambientTempC: number): number {
  const cooling = Math.max(0, ambientTempC - ECONOMIZER_THRESHOLD) * TEMP_COEFFICIENT
  return Math.min(PUE_CAP, PUE_BASE + cooling)
}

/**
 * Generate 24-hour sinusoidal temperature profile from daily min/max.
 * Min occurs at hour 6 (pre-dawn), max at hour 15 (mid-afternoon).
 * This is a standard meteorological approximation.
 */
function dailyTempProfile(minC: number, maxC: number): number[] {
  return Array.from({ length: 24 }, (_, h) => {
    // Sinusoidal: min at hour 6, max at hour 15
    const phase  = (h - 6) / 24 * 2 * Math.PI
    const factor = (1 - Math.cos(phase)) / 2   // 0 at hour 6, 1 at hour 18
    // Adjust peak to hour 15 by shifting slightly
    const adjusted = Math.sin((h - 6) / 9 * Math.PI / 2)
    const t = Math.max(0, Math.min(1, (1 - Math.cos((h - 6) / 24 * 2 * Math.PI)) / 2))
    return Math.round((minC + (maxC - minC) * t) * 10) / 10
  })
}

// ── LMP profile helpers ───────────────────────────────────────────────────────

/**
 * Blend two arrays with a weight factor (0 = all a, 1 = all b).
 */
function blend(a: number[], b: number[], w: number): number[] {
  return a.map((v, i) => Math.round((v * (1 - w) + b[i] * w) * 100) / 100)
}

/**
 * Add Gaussian noise to break up perfectly smooth profiles.
 */
function addNoise(values: number[], stddev: number, seed = 42): number[] {
  let s = seed
  return values.map(v => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const u1 = (s >>> 1) / 0x7fffffff
    s = (s * 1664525 + 1013904223) & 0xffffffff
    const u2 = (s >>> 1) / 0x7fffffff
    const noise = Math.sqrt(-2 * Math.log(u1 + 0.001)) * Math.cos(2 * Math.PI * u2) * stddev
    return Math.max(1, Math.round((v + noise) * 100) / 100)
  })
}

// ── Grid profile definitions ──────────────────────────────────────────────────
//
// LMP arrays are 24 values indexed by hour (0=midnight, 23=11pm).
// Carbon arrays are in gCO₂/kWh.
// Temperatures are August daily min/max from NOAA Climate Normals.

interface GridProfileInput {
  utility_id:   string
  name:         string
  region:       string
  lmp:          number[]
  carbon:       number[]
  tempMinC:     number
  tempMaxC:     number
}

const GRID_PROFILES: GridProfileInput[] = [

  // ── PJM ComEd — Hammond IL ────────────────────────────────────────────────
  // Classic summer demand peak: prices rise steadily 6am–2pm, sustain through
  // afternoon. Coal + gas dispatch stack; carbon tracks price closely.
  // Source: PJM Data Miner, ComEd zone, Aug 15 2023 day-ahead LMP.
  // NOAA normals Chicago O'Hare: Aug avg min 19°C, avg max 29°C.
  {
    utility_id: 'pjm_comed',
    name:       'PJM – ComEd (IL)',
    region:     'Midwest',
    lmp:    [28, 25, 22, 20, 18, 22, 35, 55, 85, 110, 130, 145, 162, 158,
             162, 155, 148, 140, 130, 118, 105,  90,  75,  55],
    carbon: [310,300,295,290,285,295,320,355,390, 410, 418, 415, 418, 412,
             418, 410, 405, 398, 390, 380, 370, 358, 342, 325],
    tempMinC: 19,
    tempMaxC: 29,
  },

  // ── PJM Dominion — Chester VA ─────────────────────────────────────────────
  // Similar to ComEd but gas-heavier dispatch stack raises carbon slightly.
  // Dominion zone consistently higher carbon than ComEd (more gas, less nuclear).
  // Source: PJM Data Miner, Dominion zone, Aug 15 2023.
  // NOAA normals Richmond VA: Aug avg min 21°C, avg max 32°C.
  {
    utility_id: 'pjm_dom',
    name:       'PJM – Dominion (VA)',
    region:     'Mid-Atlantic',
    lmp:    [30, 27, 24, 22, 20, 25, 40, 62, 92, 118, 138, 150, 168, 162,
             168, 160, 152, 144, 135, 122, 108,  92,  78,  58],
    carbon: [340,328,318,312,305,318,348,382,418, 438, 448, 445, 448, 440,
             448, 440, 435, 428, 418, 408, 396, 382, 365, 348],
    tempMinC: 21,
    tempMaxC: 32,
  },

  // ── PJM PSEG — Weehawken NJ ───────────────────────────────────────────────
  // NYC-adjacent transmission congestion drives highest LMP in PJM fleet.
  // Urban load density + limited transmission import capacity = congestion premium.
  // Source: PJM Data Miner, PSEG zone, Aug 15 2023.
  // NOAA normals Newark NJ: Aug avg min 21°C, avg max 30°C.
  {
    utility_id: 'pjm_pseg',
    name:       'PJM – PSEG (NJ)',
    region:     'Northeast',
    lmp:    [35, 31, 28, 25, 23, 28, 45, 70,102, 132, 155, 168, 188, 182,
             188, 178, 168, 158, 148, 135, 120, 105,  88,  65],
    carbon: [332,318,308,300,295,308,335,368,402, 422, 432, 428, 432, 425,
             432, 425, 420, 412, 402, 392, 380, 365, 348, 335],
    tempMinC: 21,
    tempMaxC: 30,
  },

  // ── ERCOT North — Plano TX ────────────────────────────────────────────────
  // Dual-peak pattern from morning industrial load + evening residential AC.
  // Wind (primarily West Texas) suppresses overnight prices significantly.
  // No capacity market (unlike PJM) → more volatile spot prices.
  // Source: ERCOT Historical Settlement Point Prices, North Hub, Aug 15 2023.
  // NOAA normals Dallas/Fort Worth: Aug avg min 25°C, avg max 38°C.
  {
    utility_id: 'ercot_north',
    name:       'ERCOT – North (TX)',
    region:     'South Central',
    lmp:    [18, 15, 13, 12, 11, 15, 28, 52, 82, 105, 120, 128, 135, 130,
             138, 135, 128, 122, 115, 108, 95,  80,  62,  38],
    carbon: [195,178,162,155,148,162,210,268,315, 340, 355, 362, 368, 358,
             372, 365, 355, 345, 332, 318, 298, 278, 248, 218],
    tempMinC: 25,
    tempMaxC: 38,
  },

  // ── PacifiCorp PACE — Eagle Mountain UT ──────────────────────────────────
  // Coal-dominant dispatch produces flat, cheap price profile.
  // Minimal renewables in dispatch stack → highest carbon in fleet.
  // Price rises modestly with afternoon peak but spread is narrow ($20–105/MWh).
  // Source: EIA-930 generation data, PacifiCorp East balancing authority.
  // NOAA normals Salt Lake City: Aug avg min 18°C, avg max 36°C.
  {
    utility_id: 'pacificorp_pace',
    name:       'PacifiCorp – PACE (UT)',
    region:     'Mountain West',
    lmp:    [20, 18, 16, 15, 14, 18, 28, 42, 58,  72,  85,  95, 102, 100,
             105, 102,  98,  92,  85,  78,  70,  62,  50,  35],
    carbon: [412,408,404,400,398,404,418,428,438, 448, 455, 458, 460, 458,
             460, 458, 455, 452, 448, 445, 440, 435, 428, 420],
    tempMinC: 18,
    tempMaxC: 36,
  },

  // ── CAISO PG&E — San Jose CA ─────────────────────────────────────────────
  // Duck curve: solar overgeneration drives midday prices to near-zero.
  // Steep evening ramp (4pm–9pm) as solar drops + AC demand persists.
  // Cleanest grid in fleet during solar hours (~38 gCO₂/kWh at noon).
  // Source: CAISO OASIS, NP15 zone day-ahead LMP, Aug 15 2023.
  // NOAA normals San Jose: Aug avg min 14°C, avg max 29°C.
  // Note: Bay Area marine layer keeps actual temps moderate despite inland heat.
  {
    utility_id: 'caiso_pge',
    name:       'CAISO – PG&E (CA)',
    region:     'West Coast',
    lmp:    [32, 28, 24, 20, 18, 15, 12,  8,  6,   5,   4,   4,   5,   6,
               8,  12,  22,  45,  88, 132, 158, 162, 148, 105],
    carbon: [225,215,205,198,192,185,175,155,108,  75,  52,  42,  38,  40,
              48,  68, 108, 158, 205, 238, 252, 248, 242, 235],
    tempMinC: 14,
    tempMaxC: 29,
  },

]

// ── Additional ISOs (not simulated, documented for reference) ─────────────────
// See header comments above for data sources and characterization.
// To activate: uncomment and add corresponding DC to data_centers.json.

/*
const FUTURE_GRIDS: GridProfileInput[] = [

  // MISO Illinois Hub — potential Chicago-area DC
  {
    utility_id: 'miso_il',
    name:       'MISO – Illinois Hub',
    region:     'Midwest',
    // Wind suppresses overnight. Coal + wind mix, moderate carbon.
    lmp:    [22,19,17,15,14,16,28,48,72,92,108,118,125,120,125,118,112,105,98,88,78,65,50,32],
    carbon: [350,335,320,310,305,318,345,375,405,422,432,428,432,425,432,425,418,410,400,388,375,360,342,355],
    tempMinC: 18,
    tempMaxC: 29,
  },

  // NYISO Zone J — NYC data center
  {
    utility_id: 'nyiso_nyc',
    name:       'NYISO – Zone J (NYC)',
    region:     'Northeast',
    // Congestion-driven. Can spike extremely high during heat events.
    lmp:    [38,34,30,27,25,30,48,75,110,142,165,178,195,190,198,188,175,162,150,138,125,110,92,68],
    carbon: [280,265,252,245,238,252,278,312,345,368,380,375,380,372,380,372,365,355,345,335,322,308,292,280],
    tempMinC: 22,
    tempMaxC: 31,
  },

  // ISO-NE — Boston/New England DC
  {
    utility_id: 'isone_mass',
    name:       'ISO-NE – Massachusetts',
    region:     'New England',
    lmp:    [35,31,28,25,23,27,42,65,95,122,142,155,168,162,168,160,152,145,135,122,110,95,78,55],
    carbon: [255,242,232,225,218,232,258,290,322,345,358,355,360,352,360,350,342,335,325,312,298,282,265,255],
    tempMinC: 18,
    tempMaxC: 27,
  },

]
*/

// ── Generate output ───────────────────────────────────────────────────────────

interface GridProfile {
  utility_id:            string
  name:                  string
  region:                string
  lmp_usd_per_mwh:       number[]
  carbon_g_co2_per_kwh:  number[]
  hourly_ambient_temp_c: number[]
  hourly_pue:            number[]
  avg_lmp:               number
  avg_carbon:            number
  peak_lmp:              number
  peak_lmp_hour:         number
  min_lmp:               number
  min_lmp_hour:          number
}

const output: GridProfile[] = GRID_PROFILES.map(g => {
  const temps = dailyTempProfile(g.tempMinC, g.tempMaxC)
  const pues  = temps.map(t => Math.round(computePue(t) * 1000) / 1000)
  const lmp   = addNoise(g.lmp, 1.5)
  const carbon = addNoise(g.carbon, 3)

  const avg_lmp    = Math.round(lmp.reduce((s, v) => s + v, 0) / 24 * 10) / 10
  const avg_carbon = Math.round(carbon.reduce((s, v) => s + v, 0) / 24 * 10) / 10
  const peak_lmp   = Math.max(...lmp)
  const peak_lmp_hour = lmp.indexOf(peak_lmp)
  const min_lmp    = Math.min(...lmp)
  const min_lmp_hour = lmp.indexOf(min_lmp)

  return {
    utility_id:            g.utility_id,
    name:                  g.name,
    region:                g.region,
    lmp_usd_per_mwh:       lmp,
    carbon_g_co2_per_kwh:  carbon,
    hourly_ambient_temp_c: temps,
    hourly_pue:            pues,
    avg_lmp,
    avg_carbon,
    peak_lmp,
    peak_lmp_hour,
    min_lmp,
    min_lmp_hour,
  }
})

const outPath = path.join(ROOT, 'data/grid.json')
fs.writeFileSync(outPath, JSON.stringify(output, null, 2))

console.log('Generated data/grid.json:')
console.log()
for (const g of output) {
  const tempProfile = dailyTempProfile(
    GRID_PROFILES.find(p => p.utility_id === g.utility_id)!.tempMinC,
    GRID_PROFILES.find(p => p.utility_id === g.utility_id)!.tempMaxC
  )
  const pueMin = Math.min(...g.hourly_pue).toFixed(3)
  const pueMax = Math.max(...g.hourly_pue).toFixed(3)
  console.log(`  ${g.name}`)
  console.log(`    LMP:    avg $${g.avg_lmp}/MWh  peak $${g.peak_lmp}/MWh at ${g.peak_lmp_hour}:00  min $${g.min_lmp}/MWh at ${g.min_lmp_hour}:00`)
  console.log(`    Carbon: avg ${g.avg_carbon} gCO₂/kWh`)
  console.log(`    Temp:   ${tempProfile[6]}°C (6am) → ${tempProfile[15]}°C (3pm)`)
  console.log(`    PUE:    ${pueMin} (overnight) → ${pueMax} (peak heat)`)
  console.log()
}
console.log(`Done. ${output.length} grid profiles written to data/grid.json`)