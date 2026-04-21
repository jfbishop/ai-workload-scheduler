#!/bin/bash

# bootstrap.sh
# Run this from inside the ai-workload-scheduler project root.
# It wires up all the pieces we've built so far and starts the dev server.

set -e

echo ""
echo "=== AI Workload Scheduler — local bootstrap ==="
echo ""

# ── 1. Install dependencies ───────────────────────────────────────
echo "→ Installing dependencies..."
npm install next react react-dom typescript @types/node @types/react @types/react-dom
npm install zustand                         # state management
npm install ts-node --save-dev              # run simulation scripts
npm install tailwindcss postcss autoprefixer --save-dev
npx tailwindcss init -p 2>/dev/null || true

echo ""

# ── 2. Copy data files into project ──────────────────────────────
echo "→ Copying data files..."
# Run this from project root; assumes you downloaded the three JSON files
# from the chat into a sibling folder called `data-files/`
# OR just move them manually into data/ after running setup.sh

mkdir -p data results

# If data files are sitting next to this script, copy them in:
for f in workloads.json data_centers.json grid.json; do
  if [ -f "../$f" ]; then
    cp "../$f" "data/$f"
    echo "  Copied $f"
  elif [ -f "data/$f" ] && [ -s "data/$f" ]; then
    echo "  data/$f already present"
  else
    echo "  WARNING: data/$f not found — place it in data/ before running simulation"
  fi
done

echo ""

# ── 3. Copy simulation scripts into place ────────────────────────
echo "→ Placing simulation engine files..."
# These should already be in src/simulation/ and scripts/
# If you downloaded them from chat, move them:
#   physics.ts      → src/simulation/physics.ts
#   objective.ts    → src/simulation/objective.ts
#   scheduler.ts    → src/simulation/scheduler.ts
#   run-simulation.ts → scripts/run-simulation.ts

echo ""

# ── 4. Write tsconfig.json ───────────────────────────────────────
echo "→ Writing tsconfig.json..."
cat > tsconfig.json << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
TSCONFIG

# tsconfig for ts-node (scripts only — uses CommonJS)
cat > tsconfig.scripts.json << 'TSCONFIG_SCRIPTS'
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "noEmit": false,
    "outDir": ".ts-out"
  },
  "include": ["scripts/**/*.ts", "src/simulation/**/*.ts"]
}
TSCONFIG_SCRIPTS

# ── 5. Write next.config.js ──────────────────────────────────────
echo "→ Writing next.config.js..."
cat > next.config.js << 'NEXTCONFIG'
/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig
NEXTCONFIG

# ── 6. Write package.json scripts block ──────────────────────────
echo "→ Updating package.json scripts..."
# Use node to merge scripts into existing package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.scripts = {
  ...pkg.scripts,
  'dev':          'next dev',
  'build':        'next build',
  'start':        'next start',
  'simulate':     'ts-node --project tsconfig.scripts.json scripts/run-simulation.ts',
  'simulate:all': 'npm run simulate',
};
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('  package.json scripts updated');
"

# ── 7. Write placeholder app files ───────────────────────────────
echo "→ Writing Next.js app shell..."

mkdir -p src/app

cat > src/app/globals.css << 'CSS'
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --font-sans: system-ui, -apple-system, sans-serif;
}

body {
  font-family: var(--font-sans);
  background: #f8f8f8;
}
CSS

cat > src/app/layout.tsx << 'LAYOUT'
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Workload Scheduler',
  description: 'Grid-aware AI task routing simulation — Aug 15',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
LAYOUT

cat > src/app/page.tsx << 'PAGE'
export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 500 }}>
        AI Workload Scheduler
      </h1>
      <p style={{ color: '#666', marginTop: '0.5rem' }}>
        Simulation engine ready. Dashboard coming next.
      </p>
      <p style={{ color: '#666', marginTop: '1rem', fontSize: '0.875rem' }}>
        Run <code>npm run simulate</code> to generate results, then we will wire up the dashboard.
      </p>
    </main>
  )
}
PAGE

echo ""

# ── 8. Run the simulation ─────────────────────────────────────────
echo "→ Running simulation (all 3 modes)..."
echo "  (requires data/ files and simulation scripts to be in place)"
echo ""

if [ -f "data/workloads.json" ] && [ -f "data/data_centers.json" ] && [ -f "data/grid.json" ]; then
  if [ -f "scripts/run-simulation.ts" ]; then
    npm run simulate
  else
    echo "  Skipping — scripts/run-simulation.ts not found yet"
    echo "  Copy it in then run: npm run simulate"
  fi
else
  echo "  Skipping — data files not found yet"
  echo "  Copy data files into data/ then run: npm run simulate"
fi

echo ""

# ── 9. Start dev server ───────────────────────────────────────────
echo "→ Starting dev server..."
echo "  Open http://localhost:3000 in your browser"
echo ""
npm run dev
