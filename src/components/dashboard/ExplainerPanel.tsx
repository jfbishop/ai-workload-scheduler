'use client'

import { useState } from 'react'

const TABS = [
  {
    name: 'Simulation',
    desc: 'Live playback of tasks being routed across the US as the day unfolds. Watch which data centers receive which workloads and when.',
  },
  {
    name: 'Per-DC analytics',
    desc: 'Drill into any single data center — its hourly energy use, job mix, and the grid conditions it was operating under.',
  },
  {
    name: 'Fleet summary',
    desc: 'Fleet-wide totals for cost, carbon, and task distribution across all six data centers for the selected mode.',
  },
  {
    name: 'Grid data',
    desc: 'Reference view of the electricity price and carbon intensity profiles driving the simulation — one card per grid operator.',
  },
  {
    name: 'Solar/storage ranking',
    desc: 'Which data centers would benefit most from rooftop solar and battery investment, and why. Mode 3 only.',
  },
  {
    name: 'Mode comparison',
    desc: 'Side-by-side table and charts comparing all three modes — the headline cost and carbon savings in one place.',
  },
]

export default function ExplainerPanel() {
  const [open, setOpen] = useState(true)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <div style={{
      background: '#fff',
      border: '0.5px solid rgba(0,0,0,0.10)',
      borderRadius: '12px',
      marginBottom: '8px',
      overflow: 'hidden',
      opacity: 1,
      transition: 'opacity 0.2s',
    }}>
      {/* Header — always visible, toggles body */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 16px', cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: '#378ADD', flexShrink: 0,
          }} />
          <span style={{
            fontSize: '11px', fontWeight: 500, color: '#666',
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            How this works
          </span>
        </div>
        <span style={{
          fontSize: '10px', color: '#bbb',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
          display: 'inline-block',
        }}>
          ▼
        </span>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: '0 16px 14px' }}>

          {/* Intro sentence */}
          <div style={{
            fontSize: '13px', color: '#1a1a1a', lineHeight: 1.65,
            marginBottom: '12px', paddingBottom: '12px',
            borderBottom: '0.5px solid rgba(0,0,0,0.08)',
          }}>
            This simulator asks: <span style={{ fontWeight: 500 }}>what if AI data centers
            scheduled workloads based on when and where electricity is cheapest and cleanest?</span>{' '}
            It models 9,500 AI tasks — from real-time inference to overnight training runs — routed
            across 6 US data centers using three different strategies. Switch between modes using the
            pills in the top right to see the impact on cost and carbon.
          </div>

          {/* Try this */}
          <div style={{
            fontSize: '12px', color: '#444', lineHeight: 1.6,
            background: '#f4f4f2', borderRadius: '8px',
            padding: '8px 12px', marginBottom: '14px',
          }}>
            <span style={{ fontWeight: 500, color: '#1a1a1a' }}>Try this: </span>
            Hit Play on the Simulation tab to watch tasks route in real time → switch to Mode 2:
            optimized → open Mode comparison to see the cost and carbon savings.
          </div>

          {/* Tab descriptions */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: '8px', marginBottom: '14px',
          }}>
            {TABS.map(tab => (
              <div key={tab.name} style={{
                background: '#f9f9f8', borderRadius: '8px',
                padding: '9px 11px',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 500, color: '#1a1a1a', marginBottom: '3px' }}>
                  {tab.name}
                </div>
                <div style={{ fontSize: '11px', color: '#666', lineHeight: 1.5 }}>
                  {tab.desc}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setDismissed(true)}
              style={{
                fontSize: '12px', padding: '5px 14px',
                borderRadius: '8px',
                border: '0.5px solid rgba(0,0,0,0.15)',
                background: '#fff', color: '#444',
                cursor: 'pointer',
              }}
            >
              Got it ✓
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
