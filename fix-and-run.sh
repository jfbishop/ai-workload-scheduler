#!/bin/bash
# fix-and-run.sh
# Run from inside ai-workload-scheduler/

set -e

echo "→ Step 1: replace package.json with valid one..."
# Copy the package.json from outputs, or paste it manually.
# It should contain at minimum:
cat > package.json << 'EOF'
{
  "name": "ai-workload-scheduler",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "simulate": "ts-node --project tsconfig.scripts.json scripts/run-simulation.ts",
    "simulate:all": "npm run simulate"
  }
}
EOF
echo "  done"

echo ""
echo "→ Step 2: install all dependencies..."
npm install next react react-dom typescript
npm install --save-dev @types/node @types/react @types/react-dom ts-node
npm install zustand
npm install --save-dev tailwindcss postcss autoprefixer
echo "  done"

echo ""
echo "→ Step 3: write tsconfig.json..."
cat > tsconfig.json << 'EOF'
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
EOF

echo "→ Step 4: write tsconfig.scripts.json (CommonJS, for ts-node)..."
cat > tsconfig.scripts.json << 'EOF'
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
EOF
echo "  done"

echo ""
echo "→ Step 5: write next.config.js..."
cat > next.config.js << 'EOF'
/** @type {import('next').NextConfig} */
const nextConfig = {}
module.exports = nextConfig
EOF
echo "  done"

echo ""
echo "→ Step 6: write minimal app shell..."
mkdir -p src/app

cat > src/app/globals.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF

cat > src/app/layout.tsx << 'EOF'
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Workload Scheduler',
  description: 'Grid-aware AI task routing simulation',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
EOF

cat > src/app/page.tsx << 'EOF'
export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>AI Workload Scheduler</h1>
      <p>Simulation engine ready. Run: npm run simulate</p>
    </main>
  )
}
EOF
echo "  done"

echo ""
echo "→ Step 7: confirm data files are present..."
for f in data/workloads.json data/data_centers.json data/grid.json; do
  if [ -s "$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ MISSING: $f — copy this file in before running simulate"
  fi
done

echo ""
echo "→ Step 8: confirm simulation scripts are present..."
for f in src/simulation/physics.ts src/simulation/objective.ts src/simulation/scheduler.ts scripts/run-simulation.ts; do
  if [ -f "$f" ]; then
    echo "  ✓ $f"
  else
    echo "  ✗ MISSING: $f — copy this file in before running simulate"
  fi
done

echo ""
echo "All steps complete. Now run:"
echo ""
echo "  npm run simulate     ← generates results/schedule_mode{1,2,3}.json"
echo "  npm run dev          ← starts Next.js at http://localhost:3000"
echo ""
