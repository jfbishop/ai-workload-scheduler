import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Workload Scheduler · Aug 15',
  description: 'Grid-aware AI task routing simulation across 6 data centers',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
