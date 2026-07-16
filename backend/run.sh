#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Backend starting on http://localhost:3000"
exec bun run src/index.ts
