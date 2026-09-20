# Phase 1 Plan

This plan builds the first end-to-end slice described in [01-design-decisions.md](01-design-decisions.md): precomputed results for in-process libraries, shown on a static website that runs locally. There is no deployment in this phase.

## Goal and Exit Criteria

Phase 1 is done when:

1. `scripts/lint.sh` and `scripts/test.sh` pass cleanly for both Python and the front end.
2. `scripts/generate_results.sh` runs every combination (6 polygons × Phase 1 systems × variants) and writes `frontend/public/results.json`.
3. `npm run dev` in `frontend/` shows a summary matrix, and clicking a cell opens a detail view with a globe and a flat map.
4. The reference implementation agrees with spherely (`oriented=True`) on every non-edge grid point for all 6 polygons.

**Time target:** about 4 hours. Items marked **(cut line)** are the first to drop if we're running over.

## Prerequisites

| Tool | Status on this machine | Action |
|---|---|---|
| uv 0.12 | Installed | None |
| Python 3.13 | Installed (pyenv) | uv will manage it |
| Node.js (current LTS) + npm | **Missing** | `brew install node` |
| shellcheck | **Missing** | `brew install shellcheck` |
| Docker | Installed | Not needed until Phase 2 |

## Versions (latest as of 2026-09-19)

**Python:** ruff 0.16, pyright 1.1.414, pydantic 2.13, pytest 9.1, numpy 2.5, shapely 2.1 (+ `types-shapely`), spherely 0.1.1, duckdb 1.5, antimeridian 0.4.

**Front end:** vite 8, typescript, d3-geo 3.1, eslint 10, typescript-eslint 8.70, prettier 3.9, vitest 5, world-atlas 2 + topojson-client 3, json-schema-to-typescript 16.

**TypeScript 7 risk:** TypeScript 7 is the new native compiler. If typescript-eslint doesn't support it yet, we pin the newest TypeScript version that typescript-eslint supports, and note it in the README.

## Verified Library Behavior

These were checked with quick experiments during planning, and they shape the design.

* **spherely** normalizes rings by default (`oriented=False`), silently picking whichever interpretation has the smaller area. A clockwise ring around the North Pole still gives the small polygon. With `oriented=True`, it honors the winding order. The default can never represent a polygon larger than a hemisphere, which is a good finding for the display.
* **spherely has no bounding box or validation function** in 0.1.1. Validity comes from whether construction raises an error. Bounding box is N/A.
* **antimeridian** (`fix_polygon`, `great_circle=True`) splits polygons at the antimeridian using the great-circle crossing latitude. It also closes pole-covering rings by adding edges along ±90 latitude. It is the common, documented fix for planar GeoJSON consumers, so we use it as the planar workaround instead of writing our own. Its `fix_winding` option may reorient rings, so we'll record what it does to the both-poles polygon.
* **DuckDB `geography` extension** installs from the community repository and provides `s2_contains`, `s2_area`, `s2_bounds_box`, and `s2_is_valid_reason`. This answers the open question in `01`. It's still Phase 2, but it's cheap to add early if time allows.
* **Earth radius:** spherely uses 6,371,010 m. The reference uses the same constant, so area comparisons aren't skewed by a radius mismatch.

## Repository Layout

```
.
├── pyproject.toml              # uv project, ruff + pyright config
├── uv.lock
├── .python-version             # 3.13
├── src/spatial_db_analyzer/
│   ├── __init__.py
│   ├── models.py               # pydantic models (input + results schema)
│   ├── spherical.py            # vector math helpers (lon/lat <-> xyz, arcs)
│   ├── reference.py            # reference point-in-polygon, area, bbox
│   ├── point_grid.py           # Fibonacci sphere + region filter + edge skip
│   ├── test_polygons.py        # the scenario definitions
│   ├── workarounds.py          # densify, antimeridian fix
│   ├── systems/
│   │   ├── __init__.py         # registry of systems
│   │   ├── base.py             # SpatialSystem protocol + SystemEvaluation
│   │   ├── shapely_system.py
│   │   ├── spherely_system.py
│   │   └── duckdb_spatial.py
│   ├── runner.py               # runs combinations, compares to reference
│   └── cli.py                  # argparse entry point
├── tests/spatial_db_analyzer_tests/
├── scripts/
│   ├── recreate_venv.sh
│   ├── lint.sh                 # python + shell + front end
│   ├── test.sh                 # pytest + vitest
│   ├── generate_types.sh       # JSON Schema -> TypeScript types
│   └── generate_results.sh     # run CLI -> frontend/public/results.json
└── frontend/
    ├── package.json, tsconfig.json, eslint.config.js, .prettierrc, vite.config.ts
    ├── index.html
    ├── public/results.json     # committed, so the site builds without Python
    └── src/
        ├── main.ts             # hash router: #/ and #/combo/...
        ├── generated/results.ts
        ├── data.ts             # load + index results
        ├── geo.ts              # winding conversion, planar-edge densify for drawing
        ├── summary.ts          # summary matrix view
        ├── detail.ts           # detail view
        ├── map.ts              # shared d3-geo rendering (globe + flat map)
        └── style.css
```

## Step 1: Scaffolding (~30 min)

* `pyproject.toml` is based on NLG, with these changes:
  * `requires-python = ">=3.13"`, pyright `pythonVersion = "3.13"`.
  * `uv_build` as the build backend (drop setuptools-git-versioning), and `[dependency-groups] dev` instead of optional extras.
  * The same ruff `select = ['ALL']`, ignore list, per-file ignores, and line length of 100. Add `ruff format` (checked in lint).
  * The same pyright strict settings, with `include = ["src", "tests"]`.
  * A console script: `spatial-db-analyzer = "spatial_db_analyzer.cli:main"`.
* Scripts are adapted from NLG (`set -euo pipefail`, header comments), plus shellcheck. No pre-commit or CI in Phase 1 (parking lot).
* The front end starts from the `vite` vanilla-ts template:
  * **tsconfig:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitOverride`.
  * **ESLint:** flat config with typescript-eslint `strictTypeChecked` + `stylisticTypeChecked`, and Prettier compatibility.
  * **npm scripts:** `dev`, `build`, `lint` (eslint + `prettier --check` + `tsc --noEmit`), and `test` (vitest).
* `.gitignore` additions: `node_modules/`, `frontend/dist/`.

## Step 2: Models (~20 min)

All models are `ConfigDict(strict=True, extra="forbid", frozen=True)`.

* `LonLat = tuple[float, float]`.
* `GeoJsonPolygon`: `type: Literal["Polygon"]`, `coordinates: tuple[tuple[LonLat, ...]]` (exactly one ring, closed, at least 4 positions). It validates that the ring is closed and that longitude and latitude are in range.
* `BBox`: `west, south, east, north`. `west > east` means the box crosses the antimeridian.
* `TestPolygon`: `id`, `name`, `description`, `polygon`, `expected_valid: bool`.
* `GridConfig`: `point_count`, `region: BBox | None`, `edge_tolerance_deg`.
* `SystemInfo`: `id`, `name`, `version`, `semantics: Literal["planar", "spherical"]`, `notes`.
* `Variant`: `id`, `name`, `description`, `tradeoffs: tuple[str, ...]`. Every system has a `raw` variant, plus its workaround variants.
* `ReferenceResult` (one per polygon): `inside_indices`, `skipped_indices` (near an edge), `area_m2`, `bbox`.
* `CombinationResult`:
  * `polygon_id`, `system_id`, `variant_id`
  * `outcome: Literal["correct", "accepted_but_wrong", "rejected", "error"]`
  * `accepted: bool`, `validation_errors: tuple[str, ...]`, `error_message: str | None`
  * `submitted_geometry`: the GeoJSON actually given to the library after the workaround (Polygon or MultiPolygon). This is what the "library's view" layer draws.
  * `agreement_pct`, `false_positive_indices`, `false_negative_indices`
  * `area_m2: float | None`, `area_error_pct: float | None`
  * `bbox: BBox | None`, `bbox_covers_expected: bool | None`
  * `duration_ms`
* `ResultsFile`: `schema_version`, `generated_at`, `grid: GridConfig`, `points: tuple[LonLat, ...]`, `polygons`, `reference: dict[polygon_id, ReferenceResult]`, `systems`, `variants`, `results`.

**Outcome rule:**
* `rejected`: construction or validation failed for a polygon we expect to be valid.
* `correct`: accepted and 100% agreement on non-skipped points.
* `accepted_but_wrong`: accepted but some points disagree.
* `error`: an unexpected exception. The message is recorded and the run continues.

Area and bounding box are shown separately and don't affect the outcome.

`scripts/generate_types.sh` dumps `ResultsFile.model_json_schema()` and runs `json-schema-to-typescript`, writing `frontend/src/generated/results.ts`. That keeps the Python and TypeScript types in sync.

## Step 3: Reference Implementation (~60 min)

`spherical.py` and `reference.py` use numpy and are vectorized over points.

* **Conversion:** lon/lat → unit xyz vectors.
* **Point in polygon (crossing parity from a known inside point):**
  1. Reference point `R`: the midpoint of the first edge, nudged a tiny angle toward its left side (the direction `v0 × v1`). By the GeoJSON convention, that point is inside.
  2. For each test point `P`, count how many polygon edges cross the minor arc `R → P`, using the S2-style robust crossing sign test (triple products).
  3. Even count = inside.
  4. If `P` is nearly antipodal to `R`, the arc is ambiguous. For those points, use a second reference point just *outside* the first edge (odd count = inside).
* **Edge proximity:** the angular distance from each point to each edge arc: the distance to the great circle if the point projects within the arc, otherwise the distance to the nearest endpoint. Points within `edge_tolerance_deg` are skipped.
* **Area:** Gauss–Bonnet: `A = R² (2π − Σ turning angles)`, with interior on the left. This works for polygons larger than a hemisphere.
* **Expected bounding box (cut line):**
  * **Latitude:** min/max over vertices and each edge's interior latitude extreme. If a pole is contained, the latitude extends to ±90 and the longitude range is the full −180..180.
  * **Longitude:** the smallest interval covering every edge's longitude span.
* **Great-circle interpolation** (used by densify and the tests): slerp between vertices.

**Tests:**
* Known points for each scenario (pole inside or outside, points on either side of the antimeridian).
* Complement property: `inside(ring) XOR inside(reversed ring)` for every non-skipped point.
* `area(ring) + area(reversed) = 4πR²`.
* Octant polygon area = `4πR²/8`.
* Cross-check against spherely `oriented=True` on all 6 polygons.

## Step 4: Point Grid (~15 min)

* A Fibonacci sphere with `n` points (default 5,000, about 3° spacing), via the golden-angle spiral, returned as lon/lat arrays.
* An optional `region` filter, which handles antimeridian-crossing windows.
* **Tests:** the count, points spread evenly (nearest-neighbor spacing variance is small), and the region filter.

## Step 5: Test Polygons (~15 min)

These are the Phase 1 scenarios. All are large and deliberately obvious. Rings are GeoJSON counter-clockwise. The coordinates below are starting points and may be tuned.

| # | id | Shape | Why it's interesting |
|---|---|---|---|
| 1 | `normal` | Box over North America, (−110..−90, 30..45) | Control case. Everyone should pass. |
| 2 | `north_pole` | Irregular 8-vertex ring around 55–70°N, longitude increasing | Planar libraries see a band, not a cap |
| 3 | `south_pole` | Irregular ring around 55–70°S, longitude decreasing | Same, southern version |
| 4 | `both_poles` | Everything *except* a large region in the Pacific (clockwise-looking ring) | Larger than a hemisphere. spherely's default picks the complement. |
| 5 | `antimeridian` | (160..−160, −20..20) | Planar libraries see a 320°-wide box |
| 7 | `wide` | (−80..80, 50..70) | Great-circle edges peak near 82°N and 86°N, so the true shape is a crescent far from where a planar library puts it |

## Step 6: Systems and Variants (~45 min)

`base.py` defines the adapter interface:

```python
class SystemEvaluation(BaseModel):  # strict, frozen
    accepted: bool
    validation_errors: tuple[str, ...]
    submitted_geometry: GeoJsonGeometry
    contains: tuple[bool, ...] | None  # one per grid point; None if rejected
    area_m2: float | None
    bbox: BBox | None

class SpatialSystem(Protocol):
    info: SystemInfo
    variants: tuple[Variant, ...]
    def evaluate(self, polygon: TestPolygon, points: PointArrays, variant_id: str) -> SystemEvaluation: ...
```

The runner compares each evaluation with the reference, builds the `CombinationResult`, and catches exceptions per combination.

| System | Variants | Containment | Validity | Area | BBox |
|---|---|---|---|---|---|
| Shapely | `raw`; `antimeridian_fix` (antimeridian `fix_polygon`); `densified_fix` (great-circle densify every 1°, then `fix_polygon`) | `shapely.contains_xy` (vectorized) | `is_valid_reason` | N/A (square degrees are not comparable) | `bounds` |
| DuckDB `spatial` | Same three as Shapely | One SQL query per polygon against a `points` table, using `ST_Contains(ST_GeomFromGeoJSON(?), ST_Point(lon, lat))` | `ST_IsValid` (plus a reason, if available) | N/A | `ST_Extent` |
| spherely | `default` (`oriented=False`); `oriented` (`oriented=True`) | `spherely.contains(poly, spherely.points(lons, lats))` | Construction succeeded | `spherely.area` | N/A |

**Tradeoff text for each variant** (shown in the UI):
* **antimeridian fix:** "Splits the polygon into a MultiPolygon at ±180°, and adds edges along ±90° latitude to close pole caps. The stored shape no longer matches the input. You must know to apply it before inserting."
* **densify:** "Adds a vertex every 1° along each great-circle edge. Planar edges between these points only approximate the curve, and there are many more vertices to store and test."
* **spherely default:** "Assumes the smaller of the two possible polygons. It ignores winding, so it can't represent anything larger than a hemisphere."

**Adapter tests:** the `normal` polygon is 100% correct on every variant. Known failures are pinned: raw Shapely on `antimeridian` is `accepted_but_wrong`, and spherely `default` on `both_poles` is `accepted_but_wrong`.

**Pyright:** Shapely uses `types-shapely`. Any untyped library call is kept inside its adapter module, with narrow `cast`s and no `# type: ignore` spread around.

## Step 7: Runner and CLI (~20 min)

* `spatial-db-analyzer run --points 5000 [--region W,S,E,N] [--edge-tolerance 0.25] [--systems ...] [--polygons ...] --output PATH`
* Builds the grid → computes the reference per polygon → runs every system × variant × polygon → writes `ResultsFile` JSON (compact, with coordinates rounded to 5 decimals).
* `scripts/generate_results.sh` wraps it, writing to `frontend/public/results.json`.
* **Test:** an end-to-end run with 200 points produces a `ResultsFile` that round-trips through `model_validate_json`.

## Step 8: Front End (~75 min)

* **Loading:** `data.ts` fetches `results.json`, checks `schema_version`, and builds lookups.
* **Routing:** hash routes, `#/` (summary) and `#/combo/{polygon}/{system}/{variant}`.
* **Summary view:**
  * A short explainer paragraph and legend.
  * A table with polygons as rows and system/variant as columns. Each cell shows the outcome color and agreement %.
  * The column header shows the semantics badge (planar or spherical).
* **Detail view:**
  * **Header:** polygon name and description, system, variant, outcome, and agreement %.
  * **Two maps** side by side (stacked on narrow screens), sharing a layer renderer in `map.ts`:
    * **Orthographic globe:** drag to rotate, starting centered on the polygon's centroid.
    * **Equirectangular flat map.**
  * **Map layers:**
    1. Graticule and land outline (from world-atlas 110m) for context.
    2. The true polygon: its ring reversed to d3's clockwise-is-interior convention, drawn natively by d3 as great-circle edges.
    3. The library's view: `submitted_geometry`. For planar systems, it's densified *linearly in lon/lat* before projecting, so its edges are straight on the flat map, which is exactly how a planar library treats them. For spherical systems, it's drawn like layer 2.
    4. Grid points: correct-inside, correct-outside (faint), false positive, false negative, and skipped (hidden by default). The palette is colorblind-safe.
  * **Side panel:** the variant's description and tradeoffs (prominent), validation errors, the error message, area (library vs. reference, with % error), and the bounding box (library vs. expected).
  * **Links** to the other variants of the same system and polygon, for quick comparison.
* **Vitest tests** for the pure functions: winding reversal, planar densify, route parsing, and the outcome → style mapping. No DOM tests in Phase 1.

## Step 9: Wrap-up (~10 min)

* A README covering what the project is, the prerequisites, how to regenerate results, and how to run the site.
* Commit the generated `results.json`.
* Record findings and surprises in `plans/03-phase-1-findings.md`, to inform Phase 2.

## Suggested Commit Checkpoints

1. Scaffolding with lint and test scripts passing on empty packages
2. Models + reference + point grid, with tests
3. Test polygons + systems + runner + CLI, generating results
4. Front end summary view
5. Front end detail view + README

## Risks

* **Reference correctness:** mitigated by the spherely cross-check and property tests. Any disagreement blocks Step 6.
* **Strict typing of numpy code:** keep numpy typing to `NDArray[np.float64]` / `NDArray[np.bool_]` at function boundaries.
* **Front end time:** the detail view is the biggest single item. If we're running over, drop globe rotation (fixed centering only) and the variant-comparison links.
