# spatial-db-analyzer

Compares how spatial databases and libraries handle **geodetic polygons**: polygons on a
spherical Earth, where edges follow great-circle arcs rather than straight lines in longitude
and latitude.

**See the results: <https://jasongilman.github.io/spatial-db-analyzer>**

The failure cases this demonstrates:

- A polygon can contain one or both poles, and its **winding order** is what says so.
- A polygon can cross the **antimeridian** (±180° longitude).
- A wide polygon's edges **bow toward the pole**, so the true shape sits well away from the
  rectangle a planar library draws.

The test is containment: *is this point inside this polygon?* Each library is run both raw and
with its usual workaround applied, and the site makes each workaround's tradeoffs explicit.

A planar library is not buggy by its own rules. It just uses different rules, and this shows
where those rules give a different answer.

## What it covers

| System | Semantics | Variants |
|---|---|---|
| Reference (ours) | spherical | control column, scores 100% by construction |
| Shapely (GEOS) | planar | raw, antimeridian fix, antimeridian fix rewound, densified then fixed |
| DuckDB `spatial` | planar | raw, antimeridian fix, densified then fixed |
| spherely (S2) | spherical | default, oriented |

Six polygons: an ordinary box, one covering each pole, one containing both poles, one crossing
the antimeridian, and a wide band of latitude. Each is tested against 5,000 points spread evenly
over the globe.

A sample of the results, as the percentage of points each system placed correctly:

| Polygon | Shapely raw | Shapely densified then fixed | spherely default | spherely oriented |
|---|---|---|---|---|
| Ordinary box | 100% | 100% | 100% | 100% |
| Covers the North Pole | rejected | 100% | 100% | 100% |
| Covers the South Pole | rejected | 100% | 100% | 100% |
| Contains both poles | 0.9% | 88.0% | 0.0% | 100% |
| Crosses the antimeridian | 65.7% | 100% | 100% | 100% |
| Wide band of latitude | 96.0% | 100% | 100% | 100% |

## Using the site

The site has three pages:

- **Results**: the matrix of every polygon against every system and variant. Click a cell to
  open that combination on a globe and a flat map, with every test point colored by whether the
  library got it right. Each map layer can be switched on or off, and has a help pop-up.
- **How it works**: the geometry behind the matrix (great-circle edges, poles, the antimeridian,
  winding order) and how each combination is scored, with figures.
- **Libraries & fixes**: what each library is, its known limitations, and what each workaround
  does and costs.

Every view has its own URL, such as `#/combo/antimeridian/shapely/raw`, so a link to one
opens that view directly.

## How it works

A Python pipeline runs every polygon × system × variant combination. It scores each point's
answer against our own spherical reference implementation, then writes the results to
`frontend/public/results.json`. A static Vite + TypeScript site reads that file. There is no
backend.

`results.json` is committed. A GitHub Actions workflow (`.github/workflows/pages.yml`) lints,
tests and builds the site on every push to `main`, then publishes it to GitHub Pages. That
workflow ships the committed `results.json` unchanged, so new results reach the site only
through a commit that someone has reviewed.

## Prerequisites

- [uv](https://docs.astral.sh/uv/). It installs Python 3.13 if you don't have it.
- Node.js 24 with npm, the version CI uses.
- [shellcheck](https://www.shellcheck.net/), for `scripts/lint.sh` only.

If npm is not on `PATH` in a non-interactive shell, as happens when Node comes from nvm, the
scripts that use `frontend/` source `scripts/npm_guard.sh`. It adds
`~/.nvm/versions/node/v24.21.0/bin` to `PATH` if that directory exists. Otherwise it stops with a
message. If you use a different Node version, put its `bin` directory on `PATH` yourself.

## Getting started

```bash
git clone https://github.com/jasongilman/spatial-db-analyzer.git
cd spatial-db-analyzer
uv sync --all-groups            # Python dependencies; scripts/recreate_venv.sh rebuilds from scratch
(cd frontend && npm install)    # front-end dependencies
scripts/run_frontend.sh         # the site, at http://localhost:5173
```

`results.json` is committed, so the site runs without running the Python pipeline first.

## Everyday commands

```bash
scripts/lint.sh                 # ruff, ruff format, pyright strict, shellcheck, eslint, prettier, tsc
scripts/test.sh                 # pytest then vitest; --python-only skips vitest
scripts/generate_results.sh     # rerun every combination and rewrite frontend/public/results.json
scripts/generate_types.sh       # regenerate frontend/src/generated/results.ts from the models
scripts/run_frontend.sh         # the dev server, same as (cd frontend && npm run dev)
(cd frontend && npm run build)  # type-check and build the static site into frontend/dist
(cd frontend && npm run preview)  # serve the built site
```

To run a single test, pass it to the test script or to vitest:

```bash
scripts/test.sh --python-only tests/spatial_db_analyzer_tests/test_reference.py
(cd frontend && npx vitest run src/geo.test.ts)
```

### Regenerating results

`generate_results.sh` runs `uv run spatial-db-analyzer run` and forwards its arguments. It prints
a plain-text version of the matrix when it finishes.

| Option | Default | Meaning |
|---|---|---|
| `--points N` | 5000 | How many grid points to spread over the globe |
| `--polygons a,b` | all | Polygon ids: `normal`, `north_pole`, `south_pole`, `both_poles`, `antimeridian`, `wide` |
| `--systems a,b` | all | System ids: `shapely`, `duckdb_spatial`, `spherely` |
| `--region=W,S,E,N` | whole globe | Only use grid points inside this window |
| `--edge-tolerance D` | 0.25 | Skip points within D degrees of a polygon edge |
| `--output PATH` | `frontend/public/results.json` | Where to write the results |

```bash
scripts/generate_results.sh --points 1000
scripts/generate_results.sh --polygons normal,wide --systems shapely
scripts/generate_results.sh --region=-10,-10,10,10 --output /tmp/results.json
```

A filtered run overwrites the committed `results.json` with only the combinations you asked for.
To experiment without changing the site, pass `--output` somewhere else. To undo a run, use
`git checkout frontend/public/results.json`.

Write `--region=W,S,E,N` as one argument. A value starting with `-` is otherwise read as another
flag. A region whose west is greater than its east crosses the antimeridian.

## Layout

```
src/spatial_db_analyzer/        the Python pipeline
  reference.py                  ground truth: spherical containment, area, bounding box
  test_polygons.py              the six test polygons (data, not tests)
  systems/                      one adapter per library under test
  runner.py                     runs and scores every combination
tests/                          pytest suite
frontend/                       the static site (Vite + TypeScript)
  public/results.json           the precomputed results the site loads
  src/generated/                types generated from the pydantic models; don't edit by hand
scripts/                        lint, test, generate and run scripts
plans/                          the design record
```

## Adding a library

Write an adapter in `src/spatial_db_analyzer/systems/` that implements the `SpatialSystem`
protocol in `systems/base.py`. It needs an `info` describing the library, its `variants` (the raw
input plus any workarounds), and an `evaluate` method that answers containment for a batch of
points. Register it in `ALL_SYSTEMS` in `systems/__init__.py`, where its position sets its column
in the matrix.

The prose the site shows about a library (notes, limitations, documentation link, and each
variant's description and tradeoffs) comes from the adapter through `results.json`. The front
end has no per-library text of its own. `frontend/src/content.test.ts` checks that the committed
`results.json` contains this prose. Run `scripts/generate_results.sh`, then `scripts/test.sh`.

Test polygons are GeoJSON `[lon, lat]` with longitudes in -180..180 and counter-clockwise
exterior rings (RFC 7946). Each adapter converts that to its library's own convention.

## Regenerating the TypeScript types

`scripts/generate_types.sh` derives `frontend/src/generated/results.ts` from the pydantic models,
so the front end cannot drift from the results file. After changing a model, run it and then
`scripts/generate_results.sh`.

It passes the schema through `scripts/schema_for_typescript.py` first. pydantic emits draft
2020-12, where a fixed-length tuple is `prefixItems`; json-schema-to-typescript 16 only
understands the draft-07 spelling and renders every `prefixItems` entry as `unknown`. Without the
rewrite, every coordinate in the results file would come out as `unknown[]`.

## Why TypeScript is pinned to 6.0.x

TypeScript 7, the native compiler, is the current release, but typescript-eslint 8.70 declares
support for `>=4.8.4 <6.1.0`. On TS 7, linting breaks. Revisit when typescript-eslint supports it.

## Why vitest uses the forks pool

`frontend/vite.config.ts` pins `pool: "forks"`. The default `threads` pool hangs on the
maintainer's machine: the run reports "no tests" after about two minutes of worker timeouts.
Forked processes start marginally slower and run the suite reliably.

## Notes on correctness

Ground truth comes from `reference.py`, not from any library under test. It is pinned three ways:
hand-checked points for each polygon, property tests (reversing a ring must flip every non-boundary
point, and a ring's area plus its complement's must be the whole sphere), and
`test_reference_matches_spherely`, which requires agreement with spherely on every non-skipped
grid point for all six polygons. Areas also match the fractions verified during planning.

Points within `--edge-tolerance` degrees of a boundary are skipped, because behavior exactly on a
boundary is ambiguous and not what this is measuring. A combination with no scored points is
reported as "no data", never as 100%.

Only containment decides whether a combination is correct. The site also shows each library's
area and bounding box, but neither affects the score.

## License

See [LICENSE](LICENSE).
