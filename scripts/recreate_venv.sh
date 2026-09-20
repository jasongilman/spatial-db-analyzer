#!/bin/bash
#
# Recreates the Python virtual environment from scratch.
#
# Deletes .venv and re-syncs every dependency group with uv. Use this when the
# environment has drifted or a dependency change needs a clean resolve.

set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf .venv
uv sync --all-groups
