# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A comparison of how spatial libraries handle **geodetic polygons** (great-circle edges, poles,
antimeridian). A Python pipeline runs every polygon × system × variant combination, scores
point-in-polygon answers against our own spherical reference, and writes
`frontend/public/results.json`. A static Vite + TypeScript site reads that file. There is no
backend. `results.json` is committed.

The site is live at <https://jasongilman.github.io/spatial-db-analyzer/>.
`.github/workflows/pages.yml` deploys it on every push to `main`: front-end lint, vitest, build,
then publish `frontend/dist`. CI never regenerates `results.json`; the committed file ships.
`vite.config.ts` sets `base: "./"` so the build works under the Pages subpath.

`plans/` holds the project's design record, numbered in order (`02`–`08` are Phase 1 and its
follow-ups, each with a status line at the top). `plans/01-design-decisions.md` overrides
`plans/00-initial-project-description.md` where they disagree; read `01` before changing scope,
winding conventions or the list of systems. Later-phase systems (PostGIS, MongoDB, DuckDB
`geography`, Elasticsearch) and the parking lot are listed there.

## Commands

Node comes from nvm, which non-interactive shells don't pick up. Scripts that touch `frontend/`
source `scripts/npm_guard.sh` to fix `PATH`; when running `npm` directly, first run
`export PATH="/Users/jason/.nvm/versions/node/v24.21.0/bin:$PATH"`.

```bash
uv sync --all-groups && (cd frontend && npm install)   # setup
scripts/lint.sh                  # ruff check, ruff format --check, pyright strict, shellcheck, eslint/prettier/tsc
scripts/test.sh                  # pytest then vitest; --python-only skips vitest; other args go to pytest
scripts/test.sh --python-only tests/spatial_db_analyzer_tests/test_reference.py::test_name   # single pytest
(cd frontend && npx vitest run src/geo.test.ts)          # single vitest file
scripts/generate_results.sh      # rewrite frontend/public/results.json (args forwarded to the CLI)
scripts/generate_types.sh        # regenerate frontend/src/generated/results.ts from the pydantic models
scripts/run_frontend.sh          # site at http://localhost:5173 (same as `cd frontend && npm run dev`)
```

CLI filters: `--points N`, `--polygons normal,wide`, `--systems shapely`, `--region=W,S,E,N`,
`--edge-tolerance D`, `--output PATH`. A filtered run overwrites the committed `results.json`
with only the selected combinations; pass `--output` elsewhere for experiments, and never commit
a filtered file.
Write `--region=...` as one argument, because a leading `-` in the value is otherwise read as a
flag. A region with west > east crosses the antimeridian.

## Architecture

**Data flow:** `test_polygons.py` (scenarios) + `point_grid.py` (Fibonacci sphere) →
`reference.py` (ground truth) → `runner.py` runs each `SpatialSystem` × variant and scores →
`models.ResultsFile` → `results.json` → `frontend/src/data.ts`.

- **Ground truth is `reference.py`**, built on `spherical.py` vector math, and never taken from a
  library under test. Tests pin it with hand-checked points, property tests (ring reversal flips
  containment, area + complement = sphere), and `test_reference_matches_spherely`. If you change
  reference math, all of these must still pass.
- **System adapters** (`systems/`) implement the `SpatialSystem` protocol in `systems/base.py`:
  `info`, `variants` (raw plus workarounds), and `evaluate(polygon, lons, lats, variant_id)` →
  `SystemEvaluation`. To add a system, register it in `ALL_SYSTEMS` in `systems/__init__.py`;
  its position there sets the column order in the summary matrix. The reference control column is
  not an adapter: the runner builds it from the ground truth it already computed.
- **Workarounds** (`workarounds.py`: great-circle densify, antimeridian fix) are shared across
  adapters and exposed as variants. The front end must make each workaround's tradeoffs visible.
- **Scoring** (`runner._score`) uses containment only. Area and bbox are shown but never affect
  the outcome. Points within `--edge-tolerance` of a boundary are skipped. When no point is scored,
  the outcome is `no_data`, never 100%.
- **Conventions:** GeoJSON `[lon, lat]`, longitudes -180..180 only (no 0..360), and exterior
  rings counter-clockwise (RFC 7946), which is how a ring encodes containing a pole. Each adapter
  converts to its library's convention; the front end converts to d3-geo's clockwise-interior
  convention in `geo.ts`.
- **Python ↔ TypeScript contract:** `models.py` (pydantic, `StrictModel`) is the single source.
  After changing any model, run `scripts/generate_types.sh` and then `scripts/generate_results.sh`.
  Don't edit `frontend/src/generated/results.ts` by hand.
- **Front end:** vanilla TS, no framework. `main.ts` hash-routes (`routing.ts`) between
  `summary.ts` (matrix, `#/`), `detail.ts` (one combo, `#/combo/{polygon}/{system}/{variant}`),
  `howItWorks.ts` (`#/how-it-works[/{section}]`) and `libraries.ts`
  (`#/libraries[/{system}|/fixes/{workaround}]`). Unknown hashes fall back to the summary.
  `map.ts` is a canvas renderer shared by both projections (orthographic globe, equirectangular);
  `figures.ts` wraps it for the explanatory pages. Call `disposeDetail()` and `disposeFigures()`
  before re-rendering. Colors live in `palette.ts` (Okabe-Ito), not CSS, because canvas needs
  them; layer help text lives in `help.ts`.
- **Library prose comes from the adapters.** Each `SystemInfo` (notes, limitations, docs_url) and
  `Variant` (description, tradeoffs) is defined next to its adapter and reaches the site through
  `results.json`; the front end holds no per-library text. Workaround explanations are the
  `WorkaroundInfo` constants in `workarounds.py`. Figures on the explanatory pages are drawn from
  `results.json` too, never hand-drawn. `frontend/src/content.test.ts` reads the committed
  `results.json`, so after changing adapter prose or geometry, regenerate results before running
  vitest.

## Gotchas

- `src/spatial_db_analyzer/test_polygons.py` contains data, not tests. pytest `testpaths` is
  `tests/`, so it is never collected.
- Ruff runs with `select = ['ALL']` and pyright runs in strict mode with unknown-type reports as
  errors. Docstrings use Google style.
  `runtime-evaluated-base-classes` keeps pydantic model imports out of `TYPE_CHECKING` blocks.
- TypeScript is pinned to `~6.0.x` because typescript-eslint doesn't support TS 7 yet.
- vitest uses `pool: "forks"` because the default threads pool hangs on this machine.
- `scripts/schema_for_typescript.py` rewrites pydantic's `prefixItems` to draft-07 tuples.
  Without that rewrite, coordinates are typed as `unknown[]`.
- Shell scripts must pass `shellcheck -x` and work on macOS bash 3.2, for example with the
  `${arr[@]+"${arr[@]}"}` idiom for empty arrays.
