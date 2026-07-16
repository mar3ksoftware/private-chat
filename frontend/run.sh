#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "Frontend starting on http://localhost:5173"
exec npm run dev
