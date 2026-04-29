'use client'

/**
 * page.tsx — root page
 * Loads all static data + simulation results on mount, renders the dashboard.
 */

import { useEffect, useState } from 'react'
import { useSimulationStore } from '@/store/simulationStore'
import Dashboard from '@/components/dashboard/Dashboard'
import type { DataCenter, GridProfile, Task, SimulationResult, SimMode } from '@/simulation/types'

export default function Home() {
  const { loadStaticData, loadResult } = useSimulationStore()
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      try {
        // Load static data files in parallel
        const [dcsRes, gridsRes, tasksRes, placementRes] = await Promise.all([
          fetch('/api/data?file=data_centers'),
          fetch('/api/data?file=grid'),
          fetch('/api/data?file=workloads'),
          fetch('/api/data?file=placement'),
        ])

        if (!dcsRes.ok || !gridsRes.ok || !tasksRes.ok) {
          throw new Error('Failed to load data files. Have you run npm run simulate?')
        }

        const dcs:       DataCenter[]  = await dcsRes.json()
        const grids:     GridProfile[] = await gridsRes.json()
        const tasks:     Task[]        = await tasksRes.json()
        const placement: unknown       = placementRes.ok ? await placementRes.json() : {}

        // Expose placement to window so DC hover tooltips can read it
        ;(window as any).__modelPlacement = placement

        loadStaticData(dcs, grids, tasks)

        // Load simulation results in parallel
        const modeResults = await Promise.all(
          ([1, 2, 3] as SimMode[]).map(async (mode) => {
            const res = await fetch(`/api/data?file=schedule_mode${mode}`)
            if (!res.ok) return null
            return res.json() as Promise<SimulationResult>
          }),
        )

        for (const result of modeResults) {
          if (result) loadResult(result)
        }

        // Default to Mode 2
        useSimulationStore.getState().setActiveMode(1)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setLoading(false)
      }
    }

    init()
  }, [loadStaticData, loadResult])

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: 'system-ui, sans-serif',
        flexDirection: 'column', gap: '12px',
        background: 'var(--color-bg, #f9f9f8)',
      }}>
        <div style={{ fontSize: '15px', color: '#444' }}>Loading simulation data...</div>
        <div style={{ fontSize: '12px', color: '#888' }}>Aug 15 · 9,500 tasks · 6 data centers</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: 'system-ui, sans-serif',
        flexDirection: 'column', gap: '12px',
      }}>
        <div style={{ fontSize: '15px', color: '#c00' }}>Error loading data</div>
        <div style={{ fontSize: '12px', color: '#666', maxWidth: '400px', textAlign: 'center' }}>
          {error}
        </div>
        <div style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}>
          Make sure you have run <code>npm run simulate</code> first.
        </div>
      </div>
    )
  }

  return <Dashboard />
}