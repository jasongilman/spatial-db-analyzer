#!/bin/bash
#
# Regenerates the precomputed results the front end reads.
#
# Runs every polygon x system x variant combination and writes
# frontend/public/results.json. Extra arguments are forwarded to the CLI.

set -euo pipefail

cd "$(dirname "$0")/.."

uv run spatial-db-analyzer run --output frontend/public/results.json "$@"
