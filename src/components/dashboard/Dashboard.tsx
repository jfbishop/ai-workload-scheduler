'use client'

/**
 * Dashboard.tsx
 * Root shell — topbar, mode pills, nav tabs, tab content router.
 * All child tabs read from useSimulationStore directly.
 */

import { useSimulationStore } from '@/store/simulationStore'
import type { DashTab, SimMode } from '@/simulation/types'

import ExplainerPanel   from '@/components/dashboard/ExplainerPanel'
import SimulationTab    from '@/components/tabs/SimulationTab'
import PerDCTab         from '@/components/tabs/PerDCTab'
import FleetSummaryTab  from '@/components/tabs/FleetSummaryTab'
import GridDataTab      from '@/components/tabs/GridDataTab'
import SolarRankingTab  from '@/components/tabs/SolarRankingTab'
import ModeComparisonTab from '@/components/tabs/ModeComparisonTab'

// ── Colour tokens (CSS custom props defined in globals.css) ───────────────────
// Used inline so the dashboard works before Tailwind is fully configured.

const C = {
  bg:         'var(--ds-bg,        #f9f9f8)',
  surface:    'var(--ds-surface,   #ffffff)',
  border:     'var(--ds-border,    rgba(0,0,0,0.10))',
  textPri:    'var(--ds-text-pri,  #1a1a1a)',
  textSec:    'var(--ds-text-sec,  #666)',
  blue:       '#185FA5',
  blueLight:  '#E6F1FB',
  blueMid:    '#378ADD',
  amber:      '#854F0B',
  amberLight: '#FAEEDA',
  green:      '#0F6E56',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModePill({ mode, label }: { mode: SimMode; label: string }) {
  const { activeMode, modesRun, setActiveMode, setCurrentHour, setPlaying } =
    useSimulationStore()

  const isActive  = activeMode === mode
  const isRunnable = modesRun.includes(mode)

  function handleClick() {
    if (!isRunnable) return
    setPlaying(false)
    setCurrentHour(0)
    setActiveMode(mode)
  }

  return (
    <button
      onClick={handleClick}
      style={{
        fontSize: '11px',
        padding: '4px 12px',
        borderRadius: '20px',
        border: isActive
          ? `0.5px solid ${C.blue}`
          : '0.5px solid rgba(0,0,0,0.18)',
        color: isActive ? C.blueLight : isRunnable ? C.textSec : '#bbb',
        background: isActive ? C.blue : 'transparent',
        cursor: isRunnable ? 'pointer' : 'default',
        opacity: isRunnable ? 1 : 0.45,
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function NavTab({
  tab, label, locked,
}: {
  tab: DashTab; label: string; locked?: boolean
}) {
  const { activeTab, setActiveTab, modesRun } = useSimulationStore()

  // Solar tab unlocks when mode 3 has run; compare tab when all 3 run
  const isUnlocked = locked
    ? tab === 'solar'
      ? modesRun.includes(3)
      : modesRun.length === 3
    : true

  const isActive = activeTab === tab && isUnlocked

  function handleClick() {
    if (!isUnlocked) return
    setActiveTab(tab)
  }

  return (
    <button
      onClick={handleClick}
      style={{
        fontSize: '12px',
        padding: '9px 14px',
        border: 'none',
        borderBottom: isActive ? `2px solid ${C.blue}` : '2px solid transparent',
        background: 'transparent',
        color: isActive ? C.blue : isUnlocked ? C.textSec : '#bbb',
        fontWeight: isActive ? 500 : 400,
        cursor: isUnlocked ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        opacity: isUnlocked ? 1 : 0.4,
      }}
    >
      {label}
      {locked && !isUnlocked && (
        <span style={{ fontSize: '10px', marginLeft: '4px', opacity: 0.6 }}>🔒</span>
      )}
    </button>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { activeTab, tasks, dcs } = useSimulationStore()

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.bg,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {/* ── Topbar ─────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: C.surface,
          border: `0.5px solid ${C.border}`,
          borderRadius: '12px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <div style={{ fontSize: '14px', fontWeight: 500, color: C.textPri }}>
            AI Workload Scheduler{' '}
            <span style={{ color: C.blue }}>· Aug 15</span>
          </div>
          <div style={{ fontSize: '11px', color: C.textSec, marginTop: '2px' }}>
            Grid-aware task routing simulation · 8,000 tasks · {dcs.length > 0 ? dcs.length : 6} data centers
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <ModePill mode={1} label="Mode 1: baseline" />
          <ModePill mode={2} label="Mode 2: optimized" />
          <ModePill mode={3} label="Mode 3: +solar/storage" />
        </div>
      </div>

      {/* ── Explainer panel ─────────────────────────────────────── */}
      <ExplainerPanel />

      {/* ── Nav tabs + content ──────────────────────────────────── */}
      <div
        style={{
          background: C.surface,
          border: `0.5px solid ${C.border}`,
          borderRadius: '12px',
          overflow: 'hidden',
          flex: 1,
        }}
      >
        {/* Tab bar */}
        <div
          style={{
            display: 'flex',
            borderBottom: `0.5px solid ${C.border}`,
            padding: '0 14px',
            overflowX: 'auto',
          }}
        >
          <NavTab tab="simulation" label="Simulation" />
          <NavTab tab="per-dc"    label="Per-DC analytics" />
          <NavTab tab="fleet"     label="Fleet summary" />
          <NavTab tab="grid"      label="Grid data" />
          <NavTab tab="solar"     label="Solar/storage ranking" locked />
          <NavTab tab="compare"   label="Mode comparison" locked />
        </div>

        {/* Tab content */}
        <div style={{ padding: '12px' }}>
          {activeTab === 'simulation' && <SimulationTab />}
          {activeTab === 'per-dc'     && <PerDCTab />}
          {activeTab === 'fleet'      && <FleetSummaryTab />}
          {activeTab === 'grid'       && <GridDataTab />}
          {activeTab === 'solar'      && <SolarRankingTab />}
          {activeTab === 'compare'    && <ModeComparisonTab />}
        </div>
      </div>
    </div>
  )
}
