#!/bin/bash
#
# Runs every linter, failing on the first error.
#
# Covers Python (ruff check, ruff format --check, pyright strict), shell
# (shellcheck) and the front end (eslint, prettier, tsc --noEmit).

set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/npm_guard.sh
source scripts/npm_guard.sh

uv run ruff check src/ tests/
uv run ruff format --check src/ tests/
uv run pyright
shellcheck -x scripts/*.sh
(cd frontend && npm run lint)
