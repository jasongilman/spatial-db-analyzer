#!/bin/bash
#
# Runs the test suites.
#
# pytest first, then the front-end vitest suite. Pass --python-only to skip the
# front end. Any other arguments are forwarded to pytest.

set -euo pipefail

cd "$(dirname "$0")/.."

python_only=false
pytest_args=()
for arg in "$@"; do
  if [ "$arg" = "--python-only" ]; then
    python_only=true
  else
    pytest_args+=("$arg")
  fi
done

# The ${x[@]+"${x[@]}"} form keeps `set -u` happy with an empty array on bash 3.2.
uv run pytest -vv -rA --log-cli-level=INFO ${pytest_args[@]+"${pytest_args[@]}"}

if [ "$python_only" = false ]; then
  # shellcheck source=scripts/npm_guard.sh
  source scripts/npm_guard.sh
  (cd frontend && npm test -- --run)
fi
