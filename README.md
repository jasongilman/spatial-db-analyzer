# spatial-db-analyzer

Compares how spatial databases and libraries handle **geodetic polygons**: polygons on a
spherical Earth, where edges follow great-circle arcs rather than straight lines in longitude
and latitude.

The failure cases this demonstrates:

- A polygon can contain one or both poles, and its **winding order** is what says so.
- A polygon can cross the **antimeridian** (±180° longitude).
- A wide polygon's edges **bow toward the pole**, so the true shape sits well away from the
  rectangle a planar library draws.

The test is containment: *is this point inside this polygon?* Each library is run both raw and
with its usual workaround applied, and the site makes each workaround's tradeoffs explicit.

A planar library is not buggy by its own rules. It just uses different rules, and this shows
where those rules give a different answer.

## What Phase 1 covers

| System | Semantics | Variants |
|---|---|---|
| Reference (ours) | spherical | control column, scores 100% by construction |
| Shapely (GEOS) | planar | raw, antimeridian fix, antimeridian fix rewound, densified then fixed |
| DuckDB `spatial` | planar | raw, antimeridian fix, densified then fixed |
| spherely (S2) | spherical | default, oriented |

Six polygons: an ordinary box, one covering each pole, one containing both poles, one crossing
the antimeridian, and a wide band of latitude.

**Live site: <https://jasongilman.github.io/spatial-db-analyzer/>**

Results are precomputed into `frontend/public/results.json` and committed. The site is static:
there is no backend at runtime. A GitHub Actions workflow (`.github/workflows/pages.yml`) builds
it and publishes it to GitHub Pages on every push to `main`. It ships the committed
`results.json` as it is; regenerating results stays a deliberate, reviewed commit.

## Prerequisites

uv, Python 3.13, Node.js with npm, shellcheck, and a browser.

**Node is installed through nvm**, which a non-interactive shell does not pick up. The scripts
that call into `frontend/` source `scripts/npm_guard.sh`, which adds it and otherwise fails with
an actionable message. To set it yourself:

```bash
export PATH="/Users/jason/.nvm/versions/node/v24.21.0/bin:$PATH"
```

## Getting started

```bash
uv sync --all-groups            # or scripts/recreate_venv.sh for a clean rebuild
(cd frontend && npm install)
```

## Everyday commands

```bash
scripts/lint.sh                 # ruff, ruff format, pyright strict, shellcheck, frontend lint
scripts/test.sh                 # pytest + vitest; --python-only skips the front end
scripts/generate_results.sh     # rewrites frontend/public/results.json
scripts/generate_types.sh       # regenerates frontend/src/generated/results.ts from the models
(cd frontend && npm run dev)    # the site, at http://localhost:5173
(cd frontend && npm run build)  # type-check and build the static site
```

`generate_results.sh` forwards its arguments to the CLI:

```bash
scripts/generate_results.sh --points 1000
scripts/generate_results.sh --polygons normal,wide --systems shapely
scripts/generate_results.sh --region=-10,-10,10,10
```

Write `--region=W,S,E,N` as one argument. A value starting with `-` is otherwise read as another
flag. A region whose west is greater than its east crosses the antimeridian.

## Layout

```
src/spatial_db_analyzer/
  models.py         pydantic models for the inputs and the results file
  spherical.py      vector math on the unit sphere
  reference.py      ground truth: containment, area, expected bounding box
  point_grid.py     Fibonacci sphere and its region filter
  test_polygons.py  the six scenarios and their explainer text
  workarounds.py    great-circle densify, antimeridian fix
  systems/          one adapter per library
  runner.py         runs and scores every combination
  cli.py            argparse entry point
frontend/src/
  data.ts           loads results.json and builds lookups
  geo.ts            winding conversion and planar densify
  map.ts            the canvas renderer, shared by both projections
  summary.ts        the matrix
  detail.ts         one combination in depth
```

`src/spatial_db_analyzer/test_polygons.py` starts with `test_` but holds no tests. pytest's
`testpaths` is limited to `tests/`, so it is never collected.

## Regenerating the TypeScript types

`scripts/generate_types.sh` derives `frontend/src/generated/results.ts` from the pydantic models,
so the front end cannot drift from the results file.

It passes the schema through `scripts/schema_for_typescript.py` first. pydantic emits draft
2020-12, where a fixed-length tuple is `prefixItems`; json-schema-to-typescript 16 only
understands the draft-07 spelling and renders every `prefixItems` entry as `unknown`. Without the
rewrite, every coordinate in the results file would come out as `unknown[]`.

## Why TypeScript is pinned to 6.0.x

TypeScript 7, the native compiler, is the current release, but typescript-eslint 8.70 declares
support for `>=4.8.4 <6.1.0`. On TS 7, linting breaks. Revisit when typescript-eslint supports it.

## Why vitest uses the forks pool

`frontend/vite.config.ts` pins `pool: "forks"`. The default `threads` pool hangs on this machine:
the run reports "no tests" after about two minutes of worker timeouts. Forked processes start
marginally slower and run the suite reliably.

## Notes on correctness

Ground truth comes from `reference.py`, not from any library under test. It is pinned three ways:
hand-checked points for each polygon, property tests (reversing a ring must flip every non-boundary
point, and a ring's area plus its complement's must be the whole sphere), and
`test_reference_matches_spherely`, which requires agreement with spherely on every non-skipped
grid point for all six polygons. Areas also match the fractions verified during planning.

Points within `--edge-tolerance` degrees of a boundary are skipped, because behavior exactly on a
boundary is ambiguous and not what this is measuring.

## Documents

- [plans/00-initial-project-description.md](plans/00-initial-project-description.md) — background and motivation
- [plans/01-design-decisions.md](plans/01-design-decisions.md) — decisions and the parking lot
- [plans/02-phase-1-plan.md](plans/02-phase-1-plan.md) — the Phase 1 plan
- [plans/03-phase-1-findings.md](plans/03-phase-1-findings.md) — what Phase 1 turned up

## License

See [LICENSE](LICENSE).
