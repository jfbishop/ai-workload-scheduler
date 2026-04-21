/**
 * src/app/api/data/route.ts
 *
 * Serves static JSON files from /data and /results directories.
 * Next.js can't serve files from outside /public directly, so this
 * route reads them from the filesystem at request time.
 *
 * Usage:
 *   GET /api/data?file=data_centers      → data/data_centers.json
 *   GET /api/data?file=grid              → data/grid.json
 *   GET /api/data?file=workloads         → data/workloads.json
 *   GET /api/data?file=schedule_mode1    → results/schedule_mode1.json
 *   GET /api/data?file=schedule_mode2    → results/schedule_mode2.json
 *   GET /api/data?file=schedule_mode3    → results/schedule_mode3.json
 *   GET /api/data?file=summary           → results/summary.json
 */

import { NextRequest, NextResponse } from 'next/server'
import fs   from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

const ALLOWED_FILES: Record<string, string> = {
  data_centers:    'data/data_centers.json',
  grid:            'data/grid.json',
  workloads:       'data/workloads.json',
  schedule_mode1:  'results/schedule_mode1.json',
  schedule_mode2:  'results/schedule_mode2.json',
  schedule_mode3:  'results/schedule_mode3.json',
  summary:         'results/summary.json',
}

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file')

  if (!file || !ALLOWED_FILES[file]) {
    return NextResponse.json(
      { error: `Unknown file: ${file}. Allowed: ${Object.keys(ALLOWED_FILES).join(', ')}` },
      { status: 400 },
    )
  }

  const filePath = path.join(process.cwd(), ALLOWED_FILES[file])

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: `File not found: ${ALLOWED_FILES[file]}. Run npm run simulate first.` },
      { status: 404 },
    )
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const data    = JSON.parse(content)
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to parse data file' }, { status: 500 })
  }
}