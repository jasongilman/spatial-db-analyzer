#!/bin/bash
#
# Regenerates the front end's TypeScript types from the pydantic models.
#
# Dumps ResultsFile's JSON Schema to a temp file and converts it with
# json-schema-to-typescript into frontend/src/generated/results.ts.

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/npm_guard.sh
source scripts/npm_guard.sh

schema="$(mktemp -t results-schema)"
trap 'rm -f "$schema"' EXIT

uv run python -c 'import json; from spatial_db_analyzer.models import ResultsFile; print(json.dumps(ResultsFile.model_json_schema()))' > "$schema"
(cd frontend && npx json-schema-to-typescript "$schema" -o src/generated/results.ts)
