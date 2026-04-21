# AI Workload Scheduler

A grid-aware AI task routing simulation that demonstrates how large-scale data center operators can reduce electricity costs and carbon emissions through intelligent workload scheduling and distributed energy resources.

Built as a final project for a graduate course on AI and the Modern Electricity Grid.

**Live demo:** [ai-workload-scheduler.vercel.app](https://ai-workload-scheduler.vercel.app)

---

## What it does

The simulator models a fleet of six data centers across the continental US, each connected to a different grid operator with distinct electricity price and carbon intensity profiles. It schedules 9,500 AI workloads across three modes:

**Mode 1 — Baseline:** No optimization. Tasks are assigned to the nearest available data center and run immediately as submitted. This is the cost and carbon benchmark.

**Mode 2 — Optimized routing:** Tasks are scored against a multi-objective function that balances electricity cost (primary), carbon intensity (secondary), geographic latency (Flex 1 only), and deadline urgency. Flex 2 and Flex 3 tasks are deferred to cheaper, cleaner grid windows within their deadline constraints.

**Mode 3 — +Solar/storage:** Same as Mode 2, but rooftop solar offsets grid draw at each data center. A solar and battery storage investment ranking is generated, incorporating grid energy cost displacement, carbon avoidance, storage time-shifting value, demand response eligibility, and coincident peak capacity charge savings.

---

## Key findings

- Grid-aware routing alone (Mode 2) reduces electricity cost by ~64% and carbon emissions by ~41% with no hardware changes
- Adding rooftop solar and battery storage (Mode 3) achieves a further ~18% cost reduction and ~11% carbon reduction
- The CAISO duck curve creates strong arbitrage: Flex 2/3 jobs deferred to the 9am–4pm solar window cost as little as $4/MWh vs $162/MWh during the evening ramp
- Eagle Mountain UT (PacifiCorp grid) ranks #2 for solar investment despite being on the dirtiest grid — high insolation + high carbon displacement makes it the strongest carbon reduction opportunity
- San Jose CA (CAISO) has a 9.4× storage multiplier — battery storage that time-shifts solar generation to the evening ramp has strong economic justification

---

## Data centers

| Location | MW | GPUs | Grid | Notes |
|---|---|---|---|---|
| Hammond IL | 80 | 16,000 | PJM ComEd | Largest facility |
| Eagle Mountain UT | 75 | 15,000 | PacifiCorp PACE | Best insolation, dirty grid |
| Weehawken NJ | 50 | 10,000 | PJM PSEG | NYC-adjacent, highest LMP |
| San Jose CA | 40 | 8,000 | CAISO PG&E | Cleanest grid, duck curve |
| Plano TX | 30 | 6,000 | ERCOT North | Wind-heavy, volatile prices |
| Chester VA | 28 | 5,600 | PJM Dominion | Richmond area |

---

## Workload taxonomy

Tasks are bucketed into three flex types based on EmeraldAI's scheduling methodology:

| Type | Category | Examples | Deferral window |
|---|---|---|---|
| Flex 1 | Hard real-time | Live inference, API requests | None — routed to nearest DC immediately |
| Flex 2 | Soft real-time | Batch inference, model training, fine-tuning | Up to 4 hours |
| Flex 3 | Background | Model retraining, data pipelines, eval sweeps | Up to 24 hours |

The simulation includes a 1,500-task backlog from August 14 representing Flex 2/3 work carried over to run during August 15's overnight low-demand, low-cost window.

---

## Objective function

For Flex 2 and Flex 3 tasks, each (data center, hour) candidate is scored:

```
Score = 0.55 × NormalizedLMP
      + 0.30 × NormalizedCarbon
      + 0.15 × DeferralUrgency
      + UtilizationPenalty(quadratic, kicks in at 30% capacity)
```

Flex 1 tasks bypass the objective function entirely and are hard-routed to the nearest data center with available GPU capacity. Latency is non-negotiable for live inference.

When the cheapest available DC is not the cleanest, cost takes priority and a **conflict flag** is raised. These conflicts are visible throughout the dashboard and represent moments where a carbon price signal or tighter carbon constraint would change the routing decision.

Grid conditions (LMP and carbon intensity) are averaged across the full task runtime — a task starting at noon that runs for 8 hours is scored on the average conditions from 12pm to 8pm, not just the start hour. This prevents the scheduler from greedily picking a cheap start hour that runs into an expensive evening peak.

---

## Solar and storage ranking methodology

Investment score for each data center:

```
Score = 0.40 × annual energy cost displacement
      + 0.25 × annual carbon displacement
      + 0.15 × storage time-shifting multiplier
      + 0.12 × demand response revenue
      + 0.08 × coincident peak capacity charge savings
```

**Storage multiplier** = average evening LMP ÷ average solar-hour LMP. CAISO's duck curve produces a ~9.4× ratio (evening $138/MWh vs solar noon $8/MWh), making battery storage strongly justified there.

**Demand response eligibility**: a DC qualifies if a battery sized at 2× solar peak output can shed >50% of estimated peak window load. DR payments assumed: PJM $12,500/MW/event, CAISO $10,000, ERCOT $8,750, PacifiCorp $5,000 at 4 events/year.

**Coincident peak**: solar output at the grid's coincident peak hour reduces billable peak demand. Capacity charges: PJM $150/kW-year, CAISO $120, ERCOT $100, PacifiCorp $80.

All values scaled from single-day simulation to annual estimates. Solar potential based on NSRDB insolation data, 20% panel efficiency, full roof utilization. Install cost assumed at $1.00/W (utility-scale commercial).

---

## Grid data sources

Electricity price (LMP) and carbon intensity profiles are based on historical August 15 data:

- **PJM** (Hammond IL, Chester VA, Weehawken NJ): PJM Data Miner historical day-ahead LMPs by zone. Carbon from EPA eGRID RFCE/RFCM subregions shaped with WattTime marginal emissions methodology.
- **ERCOT** (Plano TX): ERCOT historical settlement point prices, North Hub. Wind-heavy overnight profile, dual-peak summer pattern.
- **CAISO** (San Jose CA): CAISO OASIS NP15 zone LMPs. Duck curve clearly visible — solar glut drives prices to $4/MWh midday, steep evening ramp to $162/MWh.
- **PacifiCorp PACE** (Eagle Mountain UT): EIA-930 approximation. Coal-dominant dispatch, highest carbon intensity in fleet (412–460 gCO₂/kWh), flat price profile.

---

## Project structure

```
ai-workload-scheduler/
├── data/
│   ├── workloads.json          # 9,500 synthetic AI tasks (Aug 14 backlog + Aug 15 live)
│   ├── data_centers.json       # 6 DCs with specs, insolation, hourly temp/PUE
│   └── grid.json               # 6 grid operators × 24hr LMP + carbon intensity
├── results/                    # Generated by npm run simulate (gitignored)
│   ├── schedule_mode1.json
│   ├── schedule_mode2.json
│   ├── schedule_mode3.json
│   └── summary.json
├── scripts/
│   └── run-simulation.ts       # Runs all 3 modes, writes results/
├── src/
│   ├── simulation/
│   │   ├── physics.ts          # Power draw, PUE, latency, cost, carbon math
│   │   ├── objective.ts        # Scoring function, DR/coincident peak, solar ranking
│   │   ├── scheduler.ts        # Routing algorithm — all 3 modes
│   │   └── types.ts            # Shared TypeScript interfaces
│   ├── store/
│   │   └── simulationStore.ts  # Zustand state — simulation results, playback clock
│   ├── app/
│   │   ├── page.tsx            # Root page, loads data, renders dashboard
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   └── api/data/route.ts   # Serves JSON files to the dashboard
│   └── components/
│       ├── dashboard/
│       │   └── Dashboard.tsx   # Shell — topbar, mode selector, tab router
│       └── tabs/
│           ├── SimulationTab.tsx       # Live playback — map, Gantt, queue, ticker
│           ├── PerDCTab.tsx            # Per-DC utilization, jobs, grid reference
│           ├── FleetSummaryTab.tsx     # Fleet-wide cost, carbon, task distribution
│           ├── GridDataTab.tsx         # LMP + carbon profiles for all 6 grids
│           ├── SolarRankingTab.tsx     # Mode 3 solar/storage investment ranking
│           └── ModeComparisonTab.tsx   # Side-by-side comparison, key findings
├── public/
│   └── us.svg                  # Continental US map (Wikipedia, lower 48 states)
└── tsconfig.scripts.json       # ts-node config for simulation scripts
```

---

## Getting started

**Prerequisites:** Node.js ≥ 20, npm

```bash
# Clone and install
git clone https://github.com/your-username/ai-workload-scheduler
cd ai-workload-scheduler
npm install

# Run the simulation (generates results/ from data/)
npm run simulate

# Start the dev server
npm run dev
# Open http://localhost:3000
```

The simulation completes in under 1 second for all three modes. Results are written to `results/` which is gitignored — run `npm run simulate` after cloning before starting the dev server.

---

## Deployment

The project is deployed on Vercel with pre-computed simulation results committed to the repository. Rather than running the simulation at build time, results are generated locally and pushed to git — Vercel then serves them as static JSON via the `/api/data` route.

**Build command:** `next build` (default)

**Output directory:** `.next`

**Environment:** Node.js 20.x

To update the live site after changing simulation parameters:

```bash
npm run simulate        # regenerate results/
git add results/
git commit -m "update simulation results"
git push                # Vercel redeploys automatically
```

Make sure `results/` is **not** in your `.gitignore` so the JSON files are committed.

---

## Built with

- [Next.js 16](https://nextjs.org/) — React framework
- [Zustand](https://zustand-demo.pmnd.rs/) — state management
- [TypeScript](https://www.typescriptlang.org/) — throughout
- [Alibaba Cluster Trace GPU 2023](https://github.com/alibaba/clusterdata) — workload distribution reference
- [NSRDB](https://nsrdb.nrel.gov/) — solar insolation data
- [EPA eGRID](https://www.epa.gov/egrid) — grid carbon intensity
- [PJM Data Miner](https://dataminer2.pjm.com/) — historical LMP data
- [ERCOT](https://www.ercot.com/gridinfo/load/load_hist) — historical settlement prices
- [CAISO OASIS](http://oasis.caiso.com/) — historical LMP data
- [SimpleMaps](https://simplemaps.com/resources/svg-us) / [Wikipedia](https://commons.wikimedia.org/wiki/File:Blank_US_Map_48states.svg) — US map SVG

---

## Authors

Graduate course project — AI and the Modern Electricity Grid
