#!/bin/bash
#
# Runs the frontend

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/npm_guard.sh
source scripts/npm_guard.sh

(cd frontend && npm run dev)
