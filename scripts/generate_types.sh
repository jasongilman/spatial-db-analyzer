#!/bin/bash
#
# Regenerates the front end's TypeScript types from the pydantic models.
#
# Dumps ResultsFile's JSON Schema to a temp file and converts it with
# json-schema-to-typescript into frontend/src/generated/results.ts.
#
# The schema goes through scripts/schema_for_typescript.py first, which rewrites
# pydantic's draft 2020-12 `prefixItems` into the draft-07 tuple spelling. Without
# that, every coordinate comes out as `unknown`.

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/npm_guard.sh
source scripts/npm_guard.sh

schema="$(mktemp -t results-schema)"
trap 'rm -f "$schema"' EXIT

uv run python scripts/schema_for_typescript.py > "$schema"
(cd frontend && npx json-schema-to-typescript "$schema" -o src/generated/results.ts)
