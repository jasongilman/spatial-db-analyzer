# Phase 1 Plan

> **Status: complete** (verified 2026-09-25 on `phase-1-implementation`). Every exit criterion
> below passes: `scripts/lint.sh`, `scripts/test.sh` (116 pytest, 62 vitest, including
> `test_reference_matches_spherely`), `scripts/generate_results.sh` (a fresh run reproduces the
> committed `results.json` for all 60 combinations, excluding timings), `npm run build`, and
> `npm run dev`. All nine steps are done, and both cut-line items were kept (`expected_bbox`
> and the links to sibling variants). Findings are in
> [03-phase-1-findings.md](03-phase-1-findings.md), and the code review and its fixes are in
> [04-phase-1-code-review-findings.md](04-phase-1-code-review-findings.md).
>
> **Where the build departs from this plan:**
>
> * **`schema_version` is 2, not 1**, and `CombinationResult.outcome` has a fifth value,
>   `no_data`, used when no grid point could be scored (code review finding 1). `data.ts`
>   rejects any other schema version.
> * **The generated TypeScript types are used, not hand-written.** Pydantic's `prefixItems` did
>   come back as `unknown`, as the Risks section warned. `scripts/schema_for_typescript.py`
>   rewrites them to draft-07 tuples before generation.
> * **Files the layout doesn't list:** `systems/reference_system.py` (metadata for the control
>   column), `scripts/npm_guard.sh` (the nvm `PATH` guard), `scripts/run_frontend.sh`, and
>   `frontend/src/{routing,palette,arrays}.ts`, which split pure functions out so they can be
>   unit tested.
> * **One DOM-free test beyond what Step 8 lists:** `detail.test.ts` covers `classifyPoints`
>   (code review finding 6).

This plan builds the first end-to-end slice: precomputed results for in-process libraries, shown on a static website that runs locally. There is no deployment and no runtime backend in this phase.

**This document is written to be implemented without any other context.** Everything needed is either here or in the two appendices at the end. [00-initial-project-description.md](00-initial-project-description.md) gives the background and motivation, and [01-design-decisions.md](01-design-decisions.md) records the decisions and the parking lot, but neither is required reading to do the work.

## Context in One Page

The project compares how databases and spatial libraries handle **geodetic polygons**, meaning polygons on a spherical Earth. The failure cases we're demonstrating:

* A polygon can contain one or both poles. The **winding order** of its points is what says so.
* A polygon can cross the **antimeridian** (±180° longitude).
* The shortest path between two points follows a **great-circle arc**, not a straight line in latitude/longitude.

Libraries that assume a flat plane either reject such polygons or silently place them somewhere else, which gives wrong answers.

Decisions that constrain this phase:

* **The test is containment**, "is this point inside this polygon?" Polygon-to-polygon intersection is out of scope.
* **"Correct" means spherical**, with great-circle edges. A planar library isn't buggy by its own rules; it just uses different rules, and the UI must say so rather than calling it broken.
* **Ground truth comes from a reference implementation we write ourselves** (Step 3), cross-checked against spherely (S2).
* **Polygons are GeoJSON**, `[lon, lat]`, longitudes in −180..180, exactly one ring (**no holes**), closed, and wound **counter-clockwise with the interior on the left** (RFC 7946). Each adapter converts to whatever its library expects.
* **Each system is tested both raw and with its usual workaround applied**, and the UI must make each workaround's tradeoffs obvious.
* **No invalid polygons, no user-drawn polygons, no deployment** in this phase.
* Elasticsearch, PostGIS, MongoDB and DuckDB's `geography` extension come in later phases. Phase 1 is Shapely, spherely, and DuckDB's `spatial` extension.

## Goal and Exit Criteria

Phase 1 is done when all of these pass:

```bash
scripts/lint.sh                 # ruff, ruff format, pyright strict, shellcheck, frontend lint
scripts/test.sh                 # pytest + vitest
scripts/generate_results.sh     # writes frontend/public/results.json
(cd frontend && npm run build)  # type-checks and builds the static site
(cd frontend && npm run dev)    # summary matrix; clicking a cell opens the detail view
```

And: the reference implementation agrees with spherely (`oriented=True`) on every non-skipped grid point for all 6 polygons (this is a test, `test_reference_matches_spherely`).

**Budget:** the 4-to-8-hour limit in `00` is a budget on **Jason's own time** — reviewing, deciding, and checking results — not on how long the implementation takes. So the plan optimizes for *few review cycles*, not for less code: get each piece verifiable on its own, and pin expected values up front (Appendix D) so a reviewer can confirm correctness by reading test names instead of re-deriving spherical geometry.

The practical consequences:

* Work through the steps in order and report at the commit checkpoints, not step by step.
* Where this plan already decided something, follow it rather than reopening the question.
* Bring back a question only when the plan is silent, wrong, or a verified behavior turns out to have changed. Otherwise pick the option most consistent with the decisions above and note the choice at the checkpoint.
* Items marked **(cut line)** are optional. Skip one if it would need a design discussion to get right; keep it if it's simply more code.
* Each step below carries a **relative size**, for sequencing and for judging how far along things are. It is not a promise about elapsed time.

## Prerequisites

uv, Python 3.13, Node.js with npm, shellcheck, and a browser. Docker is not needed until Phase 2. All are installed as of 2026-09-20: uv 0.12, shellcheck 0.11, and Node 24.21 with npm 11.19.

**Node is installed through nvm**, at `/Users/jason/.nvm/versions/node/v24.21.0/bin`, which a non-interactive shell does not pick up. Any script or agent that runs `npm` must either source nvm first or put that directory on `PATH`:

```bash
export PATH="/Users/jason/.nvm/versions/node/v24.21.0/bin:$PATH"
```

`scripts/lint.sh` and `scripts/test.sh` call into `frontend/`, so give them a guard: if `command -v npm` fails, print the line above and exit non-zero, rather than failing with a confusing "npm: command not found".

## Pinned Versions

Python (all resolved by uv from the constraints in Appendix A): ruff 0.16, pyright 1.1.414, pydantic 2.13, pytest 9.1, numpy 2.5, shapely 2.1, types-shapely, spherely 0.1.1, duckdb 1.5, antimeridian 0.4.

Front end: vite 8, **typescript 6.0.3**, d3-geo 3.1, d3-selection 3, d3-drag 3, eslint 10, typescript-eslint 8.70, prettier 3.9, vitest 5, world-atlas 2, topojson-client 3, json-schema-to-typescript 16.

**TypeScript is pinned to 6.0.x on purpose.** TypeScript 7 (the native compiler) is the current release, but typescript-eslint 8.70 declares support for `>=4.8.4 <6.1.0`, so linting would break on TS 7. Note this in the README, and revisit when typescript-eslint supports TS 7.

## Verified Library Behavior

Each of these was confirmed by running it during planning. They shape the design, so don't re-litigate them, but do re-verify if a version changes.

* **spherely ignores winding order by default.** `spherely.create_polygon(ring)` returns whichever of the two possible polygons has the smaller area. `spherely.create_polygon(ring, oriented=True)` honors the GeoJSON convention. So the default can never represent a polygon larger than a hemisphere. Both are tested as separate variants.
* **spherely 0.1.1 has no bounding-box function and no standalone validation function.** Its API includes `create_polygon`, `create_point`, `points`, `contains`, `area`, `to_wkt`, `from_wkt`. Validity therefore means "construction didn't raise," and bounding box is N/A.
* **spherely is vectorized:** `spherely.points(lons, lats)` takes arrays, and `spherely.contains(polygon, points_array)` returns a boolean array.
* **spherely's Earth radius is `spherely.EARTH_RADIUS_METERS` = 6,371,010 m.** The reference implementation uses the same constant so area comparisons aren't skewed.
* **`antimeridian.fix_polygon(shapely_polygon, great_circle=True)`** is the common, documented fix for planar consumers. Verified behavior: for a box from 160°E to 160°W it returns a MultiPolygon split at ±180°, with the split latitude computed on the great circle (±21.17° for a box whose corners are at ±20°). For a ring around the North Pole it returns a polygon closed along the +90° latitude line. Signature: `fix_polygon(polygon, *, force_north_pole=False, force_south_pole=False, fix_winding=None, great_circle=True)`. `fix_winding` reorients rings, which defeats the `both_poles` polygon, so Step 6 pins it explicitly on every variant rather than accepting the default.
* **Shapely** has vectorized `shapely.contains_xy(geom, lons, lats)` and `shapely.is_valid_reason(geom)` (which returns the string `"Valid Geometry"` when valid).
* **DuckDB `spatial`** has `ST_GeomFromGeoJSON`, `ST_Contains`, `ST_Point`, `ST_IsValid` and `ST_Extent`, but **no `ST_IsValidReason`**, so validity is a bare boolean. `ST_Extent(geom)` returns a `BOX_2D`, which arrives in Python as a dict with `min_x`, `min_y`, `max_x`, `max_y` — read those keys in Python rather than trying to extract struct fields in SQL. GeoJSON strings can be passed as query parameters.
* **DuckDB `geography`** (Phase 2, verified available) installs with `INSTALL geography FROM community; LOAD geography;` and provides `s2_contains`, `s2_area`, `s2_bounds_box`, `s2_is_valid`, `s2_is_valid_reason`.

## Code Conventions

**Python**

* Python 3.13. Full type annotations on everything; pyright runs in strict mode.
* ruff with `select = ['ALL']` and the ignore list in Appendix A. Note that docstring rules stay **on** for public functions and classes (`D103` is not ignored), using Google-style docstrings. Line length is 100. `ruff format` is enforced in lint. Note that `ALL` also turns on `N806`, which objects to the uppercase `R` and `E` in the Appendix E formulas — use lowercase names in code rather than adding ignores.
* **Every pydantic model field gets `Field(description="...")` unless the field's purpose is obvious from its name.** These descriptions flow into the generated JSON Schema and from there into the TypeScript types, so they document the front end too.
* All models use `model_config = ConfigDict(strict=True, extra="forbid", frozen=True)`. Frozen models use `tuple[...]` rather than `list[...]`.
* numpy types appear at function boundaries as `NDArray[np.float64]` and `NDArray[np.bool_]`.
* Keep untyped third-party calls inside the adapter module that needs them, with narrow `cast`s. Avoid scattering `# type: ignore`.

**Shell:** bash with `set -euo pipefail`, a header comment block describing the script, and shellcheck-clean.

**Front end:** strict TypeScript, no `any`, ESLint `strictTypeChecked`, Prettier-formatted, and small pure functions kept separate from DOM code so they can be unit tested.

## Step 1: Scaffolding (small)

1. `uv init --lib --python 3.13` at the repo root, then replace the generated `pyproject.toml` with Appendix A and write `.python-version` containing `3.13`.
2. Create the package and test layout shown below, with `__init__.py` files, then `uv sync --all-groups` (the same command `recreate_venv.sh` uses).
3. Write the five scripts from Appendix B, `chmod +x scripts/*.sh`.
4. `npm create vite@latest frontend -- --template vanilla-ts`, then apply Appendix C (package.json dependencies, tsconfig, ESLint flat config, Prettier config).
5. Add to `.gitignore`: `node_modules/`, `frontend/dist/`, `.venv/`.
6. Confirm `scripts/lint.sh` and `scripts/test.sh` pass on the empty skeleton (add a trivial passing test).

```
├── pyproject.toml, uv.lock, .python-version, README.md
├── src/spatial_db_analyzer/
│   ├── models.py            # pydantic models: inputs + the results file schema
│   ├── spherical.py         # vector math: lon/lat <-> xyz, arcs, crossings, distances
│   ├── reference.py         # reference containment, area, expected bbox
│   ├── point_grid.py        # Fibonacci sphere, region filter, edge skipping
│   ├── test_polygons.py     # the 6 scenario definitions (Appendix D)
│   ├── workarounds.py       # great-circle densify, antimeridian fix
│   ├── systems/{__init__,base,shapely_system,spherely_system,duckdb_spatial}.py
│   ├── runner.py            # runs combinations, compares against the reference
│   └── cli.py               # argparse entry point
├── tests/spatial_db_analyzer_tests/
├── scripts/{recreate_venv,lint,test,generate_types,generate_results}.sh
└── frontend/
    ├── package.json, tsconfig.json, eslint.config.js, .prettierrc, vite.config.ts, index.html
    ├── public/results.json  # generated, and committed
    └── src/{main,data,geo,summary,detail,map,style.css}, src/generated/results.ts
```

Naming note: `src/spatial_db_analyzer/test_polygons.py` starts with `test_`, which pytest would try to collect. Keep `testpaths = ["tests"]` in the pytest config (Appendix A) so it doesn't, or rename it to `scenarios.py` if that feels safer.

## Step 2: Models (small)

In `models.py`. All are strict, frozen, `extra="forbid"`, and all non-obvious fields carry `Field(description=...)`.

* `LonLat = tuple[float, float]` — a `(longitude, latitude)` pair in degrees.
* `GeoJsonPolygon`: `type: Literal["Polygon"]`, `coordinates: tuple[tuple[LonLat, ...]]`. Validators: exactly one ring, at least 4 positions, first equals last, `-180 <= lon <= 180`, `-90 <= lat <= 90`.
* `GeoJsonMultiPolygon`: the same shape one level deeper. `GeoJsonGeometry = GeoJsonPolygon | GeoJsonMultiPolygon`.
* `BBox`: `west`, `south`, `east`, `north`. Document that `west > east` means the box crosses the antimeridian.
* `TestPolygon`: `id`, `name`, `description` (the explainer text the UI shows), `polygon`, `expected_valid: bool`.
* `GridConfig`: `point_count` (default 5000), `region: BBox | None` (default `None`), `edge_tolerance_deg` (default 0.25). These defaults are the single source of truth; the CLI flags in Step 7 fall back to them.
* `SystemInfo`: `id`, `name`, `version`, `semantics: Literal["planar", "spherical"]`, `notes`.
* `Variant`: `id`, `name`, `description`, `tradeoffs: tuple[str, ...]`. Every system has a baseline variant plus its workaround variants.
* `ReferenceResult` (one per polygon): `inside_indices: tuple[int, ...]`, `skipped_indices: tuple[int, ...]` (too close to an edge), `area_m2: float`, `bbox: BBox | None`. The bbox is nullable so that dropping `expected_bbox` (Step 3) stays a live option: if it isn't computed, this is `None`, every `bbox_covers_expected` is `None`, and the detail view shows the library's bbox beside "not computed".
* `CombinationResult`:
  * `polygon_id`, `system_id`, `variant_id`
  * `outcome: Literal["correct", "accepted_but_wrong", "rejected", "error"]`
  * `accepted: bool`, `validation_errors: tuple[str, ...]`, `error_message: str | None`
  * `submitted_geometry: GeoJsonGeometry` — what was actually handed to the library after the workaround; the UI draws this as "the library's view"
  * `agreement_pct: float | None`, `false_positive_indices: tuple[int, ...]`, `false_negative_indices: tuple[int, ...]` (indices into `ResultsFile.points`). When the outcome is `rejected` or `error` there is no containment array to compare against, so `agreement_pct` is `None` and both index tuples are empty. The summary matrix renders a `None` percentage as an em dash, never as `0%`.
  * `area_m2: float | None`, `area_error_pct: float | None`
  * `bbox: BBox | None`, `bbox_covers_expected: bool | None`
  * `duration_ms: float`
* `ResultsFile`: `schema_version: Literal[1]`, `generated_at: datetime`, `grid: GridConfig`, `points: tuple[LonLat, ...]`, `polygons: tuple[TestPolygon, ...]`, `reference: dict[str, ReferenceResult]` keyed by polygon id, `systems: tuple[SystemInfo, ...]`, `variants: dict[str, tuple[Variant, ...]]` keyed by system id, `results: tuple[CombinationResult, ...]`.

**Outcome rule** (computed in the runner):

| Condition | Outcome |
|---|---|
| An unexpected exception was raised | `error` |
| The polygon was rejected, or validation reported errors, and we expect it to be valid | `rejected` |
| Accepted, and every non-skipped point agrees with the reference | `correct` |
| Accepted, and at least one point disagrees | `accepted_but_wrong` |

Area and bounding box are displayed but do not affect the outcome.

**Test:** a `ResultsFile` round-trips through `model_dump_json` / `model_validate_json`, and the polygon validators reject an unclosed ring and an out-of-range longitude.

## Step 3: Reference Implementation (large)

`spherical.py` holds the math, vectorized with numpy; `reference.py` composes it. Appendix E has the formulas, which are the part worth getting exactly right.

* `lonlat_to_xyz` / `xyz_to_lonlat`.
* `contains(ring_xyz, points_xyz) -> NDArray[np.bool_]`: crossing parity from a reference point known to be inside (Appendix E.1).
* `angular_distance_to_edges(ring_xyz, points_xyz)`: the smallest angular distance from each point to the polygon boundary (Appendix E.2), used to skip points near an edge.
* `spherical_area(ring_xyz) -> float`: exact signed area (Appendix E.3), valid for polygons larger than a hemisphere.
* `interpolate_great_circle(a, b, max_step_deg)`: slerp, used by densify and by tests.
* `expected_bbox(ring_xyz) -> BBox` **(cut line — if cut, `ReferenceResult.bbox` is `None` everywhere and nothing else changes)**: latitude extremes include each edge's interior maximum, not just the vertices; if a pole is inside, latitude extends to ±90 and longitude covers −180..180; longitude is the smallest interval covering every edge's span, with `west > east` when it crosses the antimeridian.

**Tests** (this is the step where thorough tests matter most, since everything else is scored against it):

* Hand-checked points for each of the 6 polygons: the pole is inside for `north_pole`, `south_pole` and `both_poles`; `(180, 0)` is inside `antimeridian`; `(0, 84)` is inside `wide`, while `(0, 60)` is outside it.
* Complement property: for every non-skipped grid point, `contains(ring) != contains(reversed_ring)`.
* `spherical_area(ring) + spherical_area(reversed_ring) == 4πR²` (within tolerance).
* An octant polygon has area `4πR²/8`.
* `test_reference_matches_spherely`: for all 6 polygons and all non-skipped grid points, the reference agrees with `spherely.contains(create_polygon(ring, oriented=True), points)`. Appendix D lists the expected area fractions, which give a second, independent check.

If this test doesn't pass, stop and resolve the disagreement before Step 6. Everything downstream is measured against this code.

## Step 4: Point Grid (small)

* `fibonacci_sphere(n) -> (lons, lats)` using the golden-angle spiral (Appendix E.4). Default `n = 5000`, roughly 3° spacing.
* An optional `region: BBox` filter, which must handle a window that crosses the antimeridian (`west > east`).
* **Tests:** the point count is exact; nearest-neighbor spacing has low variance (evenness); the region filter includes and excludes the right points, including an antimeridian-crossing window.

## Step 5: Test Polygons (small)

`test_polygons.py` returns the 6 `TestPolygon` values with the exact coordinates in **Appendix D**. Those coordinates were verified with spherely during planning, so the pole-containment and area expectations in the appendix are known-good. Each polygon's `description` is user-facing text for the UI, explaining what the case demonstrates.

## Step 6: Systems and Variants (medium)

`systems/base.py`:

```python
class SystemEvaluation(BaseModel):
    """What one library reported for one polygon."""
    accepted: bool
    validation_errors: tuple[str, ...]
    submitted_geometry: GeoJsonGeometry
    contains: tuple[bool, ...] | None   # one per grid point; None when rejected
    area_m2: float | None
    bbox: BBox | None

class SpatialSystem(Protocol):
    info: SystemInfo
    variants: tuple[Variant, ...]
    def evaluate(
        self, polygon: TestPolygon, lons: NDArray[np.float64], lats: NDArray[np.float64], variant_id: str
    ) -> SystemEvaluation: ...
```

`systems/__init__.py` exposes `ALL_SYSTEMS: tuple[SpatialSystem, ...]`. `workarounds.py` provides `densify(polygon, max_step_deg=1.0)` (great-circle interpolation, so the added vertices sit on the true edge) and `fix_antimeridian(polygon, *, fix_winding: bool)` (wrapping `antimeridian.fix_polygon(..., great_circle=True)`, converting to and from Shapely).

**Pass `fix_winding` explicitly, never by default.** The library's own default rewinds rings, which silently turns `both_poles` from "everything except a box over the eastern Pacific" into the small box itself. That trap is worth demonstrating rather than tripping over. So `antimeridian_fix` and `densified_fix` pass `fix_winding=False`, and `shapely` carries one extra variant, `antimeridian_fix_rewound`, passing `fix_winding=True` to show what the default does. Only `shapely` gets that variant: `duckdb_spatial` runs the same GEOS engine, so repeating it there would add a column without adding a lesson.

| System | Variants | Containment | Validity | Area | BBox |
|---|---|---|---|---|---|
| `reference` (spherical, ours) | `reference` | the Step 3 implementation, echoed back | always valid | `spherical_area` | `expected_bbox`, when computed |
| `shapely` (planar, GEOS) | `raw`, `antimeridian_fix`, `antimeridian_fix_rewound`, `densified_fix` (densify 1° then fix) | `shapely.contains_xy(geom, lons, lats)` | `shapely.is_valid_reason` (anything other than `"Valid Geometry"` is an error) | N/A — square degrees aren't comparable | `geom.bounds` |
| `duckdb_spatial` (planar, GEOS) | `raw`, `antimeridian_fix`, `densified_fix` | one query per polygon: `SELECT id FROM points WHERE ST_Contains(ST_GeomFromGeoJSON(?), ST_Point(lon, lat))`, with the points table created once per run | `ST_IsValid` (boolean only; no reason function exists) | N/A | `ST_Extent`, read as a dict of `min_x`/`min_y`/`max_x`/`max_y` |
| `spherely` (spherical, S2) | `default` (`oriented=False`), `oriented` (`oriented=True`) | `spherely.contains(poly, spherely.points(lons, lats))` | construction succeeded | `spherely.area` | N/A |

The `reference` row is a **control column, not a system under test**. It scores 100% by construction, which is the point: it shows a reader what a passing row looks like before they read the failures, and it makes the yardstick visible instead of implicit. The runner fills it from the already-computed `ReferenceResult` rather than re-running anything. That makes 10 columns across 6 rows in the summary matrix.

**Variant text for the UI** (`description` plus `tradeoffs`):

* `reference` — "Our own spherical implementation, shown as a control." Tradeoff: "Scores 100% by definition; it is the yardstick, not a contender."

* `raw` — "The polygon as-is, with no preprocessing." Tradeoff: "Nothing to remember, but geodetic cases are wrong."
* `antimeridian_fix` — "Preprocessed with the `antimeridian` package before insertion, with `fix_winding=False` so the ring's orientation is left alone." Tradeoffs: "Splits into a MultiPolygon at ±180°, so the stored shape no longer matches the input." / "Closes pole coverage with edges along ±90° latitude, which is an artifact of the projection, not real geometry." / "The caller has to know to do this."
* `antimeridian_fix_rewound` — "The same antimeridian fix, left at the package's default `fix_winding=True`." Tradeoffs: "Rewinding reinterprets which side of the ring is the interior, so `both_poles` collapses from 88% of the globe to the 12% box." / "This is the library's default, so it is what you get if you never think about winding."
* `densified_fix` — "A vertex added every 1° along each great-circle edge, then the antimeridian fix." Tradeoffs: "Straight segments only approximate the curve; error grows with segment length." / "Far more vertices to store and test." / "Still wrong if you forget it."
* `spherely` `default` — "spherely's default, which ignores winding order." Tradeoffs: "Always assumes the smaller of the two candidate polygons." / "Cannot represent a polygon larger than a hemisphere."
* `spherely` `oriented` — "Winding order honored (`oriented=True`)." Tradeoff: "The caller must guarantee correct ring orientation; spherely won't check."

**Pinned expectations in tests** (verified during planning, so these are assertions, not guesses):

* Every system and variant reaches **at least 99.9% agreement** on `normal`, and every *spherical* variant is exactly `correct`. Do not assert the `correct` category for the planar variants here: `normal`'s parallels bow to 30.38°N and 45.44°N, so a raw planar polygon disagrees with the truth over two slivers totalling roughly 9 deg². At the default 5,000-point grid that is about a one-in-five chance of a single stray point, and it becomes a near-certainty as the grid gets finer. Pin the grid size inside the test so the number is reproducible, and read a stray point as the right answer rather than a bug.
* `shapely`/`raw` on `antimeridian` is `accepted_but_wrong`: it excludes `(179.9, 0)`, which is inside, and includes `(0, 0)`, which is outside.
* `spherely`/`default` on `both_poles` is `accepted_but_wrong`: it returns the complement, about 12% of the globe instead of 88%.
* `spherely`/`oriented` is `correct` on all 6.

## Step 7: Runner and CLI (small)

`runner.py` builds the grid, computes the reference per polygon, then loops polygon × system × variant, converting each `SystemEvaluation` into a `CombinationResult`. Skipped points are excluded from the comparison. Exceptions are caught per combination, recorded as `outcome="error"` with the message, and the run continues.

`cli.py` (argparse):

```
spatial-db-analyzer run [--points 5000] [--region W,S,E,N] [--edge-tolerance 0.25]
                        [--systems id,id] [--polygons id,id] [--output PATH]
```

It writes `ResultsFile` JSON with coordinates rounded to 5 decimal places, and prints a short summary table to the terminal (polygon × system/variant → outcome), which is how you sanity-check a run.

**Test:** an end-to-end run with 200 points produces JSON that validates as a `ResultsFile` and contains a result for every combination.

## Step 8: Front End (large)

Run `scripts/generate_types.sh` first so `src/generated/results.ts` exists.

* `data.ts` — fetches `results.json` (from `import.meta.env.BASE_URL`), checks `schema_version === 1`, and builds lookup maps by polygon, system and variant.
* `main.ts` — hash routing: `#/` for the summary, `#/combo/{polygonId}/{systemId}/{variantId}` for the detail view. Unknown routes fall back to the summary.
* `summary.ts`:
  * A short explainer paragraph (what geodetic polygons are, and why a planar library gets them wrong) and a legend.
  * A matrix: polygons as rows, system/variant as columns. Each cell is colored by outcome and shows the agreement percentage. The column header carries a "planar" or "spherical" badge; the row header shows the polygon name with its description as a tooltip.
  * Clicking a cell navigates to the detail view.
* `map.ts` — one **canvas** renderer used by both views, parameterized by projection. Canvas rather than SVG because the points layer is 5,000 marks per map: with SVG, dragging the globe means rewriting `cx`/`cy` on 5,000 DOM nodes per frame, and every navigation between combinations builds and tears down 10,000 of them. `d3.geoPath(projection, ctx)` draws the same geometry to a canvas context that `d3.geoPath(projection)` writes as an SVG path, so only the points layer and the update mechanics differ, and nothing in this view needs per-point DOM. `d3-selection` stays, for the matrix, legend and side panel.
  * **Orthographic** globe, rotatable by dragging (`d3-drag`), initially centered on the polygon's centroid.
  * **Equirectangular** flat map (`geoEquirectangular`), chosen over Mercator because it shows the poles and because a planar library's straight edges are straight lines in it.
  * Layers, bottom to top: graticule at 30° and land outlines from `world-atlas` 110m (via `topojson-client`'s `feature`); then the true polygon (great-circle edges, drawn natively by d3); then the library's view (`submitted_geometry`); then the grid points.
  * **Winding conversion:** d3-geo treats **clockwise** rings as the interior, the opposite of GeoJSON, so every ring must be reversed before handing it to d3. Without this, pole-containing polygons render inside-out. This is `geo.ts`'s `toD3Winding`.
  * **Planar rendering:** for a planar system, `submitted_geometry` is densified *linearly in lon/lat* before projecting (`geo.ts`'s `densifyPlanar`), so its edges draw straight on the flat map, which is what the library actually believes. Spherical systems' geometry is drawn the same way as the true polygon.
  * **Canvas mechanics:** size the backing store as `canvas.width = cssWidth * devicePixelRatio` and `ctx.scale(dpr, dpr)`, or everything is soft on a retina display. Redraw the whole scene each frame; don't cache layers in this phase. `d3-drag` binds to a canvas element unchanged.
  * **Points layer:** project every point once per frame into a reusable `Float64Array`, then draw in five passes grouped by class (correct-inside, correct-outside, false positive, false negative, skipped), setting `fillStyle` once per pass rather than once per point. On the orthographic, cull the back hemisphere first with a dot product of each point's unit vector against the rotation centre — `projection()` does not cull on its own, it mirrors hidden points onto the visible disk. If per-point hover is ever wanted, scan the cached projected coordinates on `mousemove`: 5,000 distance checks is well under a millisecond and needs no quadtree.
* `detail.ts`:
  * Header: polygon name and description, system, variant, outcome, agreement percentage.
  * The two maps side by side, stacking on narrow screens.
  * Grid points: correct-inside (filled), correct-outside (small and faint), false positive (a filled marker), false negative (a hollow marker), skipped (hidden behind a toggle). Use a colorblind-safe palette: blue `#0072B2` for correct-inside, grey `#BBBBBB` for correct-outside, vermillion `#D55E00` for false positives, and orange `#E69F00` with a dark outline for false negatives. Outcome colors reuse the same palette. The palette lives in a TS module rather than in `style.css`, since canvas sets `fillStyle` from it; that module is what the outcome-to-style Vitest test asserts against.
  * Side panel: the variant description and tradeoffs (prominent, since this is the real lesson), validation errors, error message, area (library vs. reference, with percent error, or "not reported"), and bounding box (library vs. expected).
  * Links to the same polygon's other variants for quick comparison **(cut line)**.
* **Vitest tests** for the pure functions in `geo.ts` and `data.ts`: winding reversal, planar densify, route parsing and formatting, and the outcome-to-style mapping. No DOM tests in this phase.

## Step 9: Wrap-up (small)

* A README: what this is, prerequisites, how to regenerate results, how to run the site, and why TypeScript is pinned.
* Commit the generated `frontend/public/results.json`.
* Write `plans/03-phase-1-findings.md` with the surprises worth keeping, to feed Phase 2.

## Suggested Commit Checkpoints

1. Scaffolding, with lint and test passing on the skeleton
2. Models, reference implementation and point grid, with tests
3. Test polygons, systems, runner and CLI, generating results
4. Front end summary view
5. Front end detail view and README

## Risks

* **The reference could be wrong.** Mitigated by the property tests, the hand-checked points, the spherely cross-check, and the verified area fractions in Appendix D. A failure here blocks Step 6.
* **The generated TypeScript types may come back useless.** Pydantic emits draft 2020-12 `prefixItems` for `tuple[float, float]`; if `json-schema-to-typescript` doesn't understand that, every coordinate becomes `unknown[]` and `strictTypeChecked` will make it painful. Run the generator in Step 1, before any front-end code depends on it. Fallback: hand-write about 60 lines in `src/generated/results.ts` and drop `generate_types.sh`.
* **Strict typing over numpy and untyped libraries** can eat time. Keep numpy at the boundaries as `NDArray[...]`, and isolate untyped calls in adapters.
* **The detail view is the largest single item**, and the one most likely to need a look-at-it-and-react cycle. Get the summary view reviewable first, so feedback on the visual style arrives before the detail view is built on top of it.

---

# Appendix A: pyproject.toml

Derived from Element84/natural-language-geocoding, updated to Python 3.13 and current tool versions.

```toml
[project]
name = "spatial-db-analyzer"
version = "0.1.0"
description = "Compares how spatial databases and libraries handle geodetic polygons."
readme = "README.md"
requires-python = ">=3.13"
license = { file = "LICENSE" }
dependencies = [
  "pydantic>=2.13",
  "numpy>=2.5",
  "shapely>=2.1",
  "spherely>=0.1.1",
  "duckdb>=1.5",
  "antimeridian>=0.4.9",
]

[project.scripts]
spatial-db-analyzer = "spatial_db_analyzer.cli:main"

[dependency-groups]
dev = [
  "pytest>=9.1",
  "ruff>=0.16",
  "pyright>=1.1.414",
  "types-shapely>=2.1",
]

[build-system]
requires = ["uv_build>=0.12"]
build-backend = "uv_build"

[tool.uv.build-backend]
module-root = "src"

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]

[tool.pyright]
pythonVersion = "3.13"
include = ["src/", "tests/"]
ignore = ["**/venv/**", "**/.venv/**", "*.pyc", "build/"]
typeCheckingMode = "strict"
reportGeneralTypeIssues = true
reportImplicitStringConcatenation = "none"
reportPropertyTypeMismatch = "error"
reportShadowedImports = "error"
reportTypedDictNotRequiredAccess = "none"
reportUninitializedInstanceVariable = "error"
reportUnknownArgumentType = "error"
reportUnknownMemberType = "error"
reportUnknownVariableType = "error"
reportUnnecessaryComparison = "error"
reportIncompatibleVariableOverride = "none"

[tool.ruff]
line-length = 100

[tool.ruff.lint.pydocstyle]
convention = "google"

# Without this, the TC rules move model imports into `if TYPE_CHECKING:` blocks
# and pydantic can no longer resolve the annotations at import time.
[tool.ruff.lint.flake8-type-checking]
runtime-evaluated-base-classes = ["pydantic.BaseModel"]

[tool.ruff.lint]
select = ['ALL']
ignore = [
  'RET504',  # Unnecessary assignment before return
  'COM812',  # Trailing comma missing
  'D100',    # Missing docstring in module
  'D101',    # Missing docstring in public class
  'D102',    # Missing docstring in public method
  'D105',    # Missing docstring in magic method
  'D107',    # Missing docstring in __init__
  'D203',    # 1 blank line before class docstring
  'D213',    # Multi-line summary should start at the second line
  'TRY002', 'TRY003', 'EM101', 'EM102',  # Allow messages in exception declarations
  'TD002', 'TD003', 'TD004', 'FIX002',   # Allow TODOs
]

[tool.ruff.lint.per-file-ignores]
'__init__.py' = ['E402', 'F401']
'tests/**/*' = [
  'S101',     # assert
  'ANN201',   # missing return type
  'D1',       # missing docstrings
  'SLF001',   # private member access
  'PLR2004',  # magic values
]
```

# Appendix B: Scripts

All start with `#!/bin/bash`, `set -euo pipefail`, and a header comment. Written to be run from the repo root.

* **`recreate_venv.sh`** — `rm -rf .venv; uv sync --all-groups`
* **`lint.sh`** — in order, failing on the first error:
  ```bash
  uv run ruff check src/ tests/
  uv run ruff format --check src/ tests/
  uv run pyright
  shellcheck scripts/*.sh
  (cd frontend && npm run lint)
  ```
* **`test.sh`** — `uv run pytest -vv -rA --log-cli-level=INFO "$@"`, then `(cd frontend && npm test -- --run)`. A `--python-only` flag skips the front end.
* **`generate_types.sh`** — writes the JSON Schema to a temp file and converts it:
  ```bash
  schema="$(mktemp -t results-schema)"
  trap 'rm -f "$schema"' EXIT
  uv run python -c 'import json; from spatial_db_analyzer.models import ResultsFile; print(json.dumps(ResultsFile.model_json_schema()))' > "$schema"
  (cd frontend && npx json-schema-to-typescript "$schema" -o src/generated/results.ts)
  ```
  Read the generated file the first time you run this: pydantic emits `prefixItems` for tuples, and if the generator renders those as `unknown[]`, hand-write the types instead (see Risks).
* **`generate_results.sh`** — `uv run spatial-db-analyzer run --output frontend/public/results.json "$@"`

# Appendix C: Front End Configuration

**`package.json`** (beyond the Vite template): dependencies `d3-geo`, `d3-selection`, `d3-drag`, `topojson-client`, `world-atlas`; dev dependencies `typescript@~6.0.3`, `vite`, `vitest`, `eslint`, `typescript-eslint`, `prettier`, `eslint-config-prettier`, `json-schema-to-typescript`, and the `@types/d3-geo`, `@types/d3-selection`, `@types/d3-drag`, `@types/topojson-client` type packages. Scripts:

```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "lint": "eslint . && prettier --check . && tsc --noEmit",
  "format": "prettier --write .",
  "test": "vitest"
}
```

**`tsconfig.json`** — the Vite template's, plus `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`, `"noImplicitOverride": true`, `"noImplicitReturns": true`, and `"resolveJsonModule": true` (needed for the world-atlas JSON import).

**`eslint.config.js`** — flat config: `tseslint.config(eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked, eslintConfigPrettier)`, with `languageOptions.parserOptions = { projectService: true, tsconfigRootDir: import.meta.dirname }`, and `src/generated/**` ignored.

**`.prettierrc`** — `{ "singleQuote": false, "printWidth": 100 }`.

# Appendix D: Test Polygon Coordinates

Rings are listed **without** the closing point; close them in code. All are wound so the interior is on the left (GeoJSON counter-clockwise). Every row below was verified with `spherely.create_polygon(ring, oriented=True)`.

| id | Ring (lon, lat) | Verified |
|---|---|---|
| `normal` | (−110, 30), (−90, 30), (−90, 45), (−110, 45) | contains (−100, 37); area ≈ 0.57% of the globe |
| `north_pole` | (−180, 60), (−135, 55), (−90, 65), (−45, 58), (0, 70), (45, 60), (90, 66), (135, 57) | contains (0, 89); area ≈ 5.53% |
| `south_pole` | (180, −60), (135, −55), (90, −65), (45, −58), (0, −70), (−45, −60), (−90, −66), (−135, −57) | contains (0, −89); area ≈ 5.53% |
| `both_poles` | (−150, −30), (−150, 40), (−80, 40), (−80, −30) | contains (0, 89); area ≈ 87.91% of the globe (larger than a hemisphere); spherely's default returns the ~12% complement instead |
| `antimeridian` | (160, −20), (−160, −20), (−160, 20), (160, 20) | contains (180, 0); area ≈ 3.94%; `antimeridian.fix_polygon` splits it at ±180° with a crossing latitude of ±21.17° |
| `wide` | (−80, 50), (80, 50), (80, 70), (−80, 70) | contains (0, 84), excludes (0, 60); area ≈ 0.65%. The bottom edge's great circle peaks at 81.71°N and the top edge's at 86.38°N, so the true shape is a crescent high above where a planar library draws it. |

Note that `both_poles`, read as a plain list of coordinates, looks like a small clockwise box over the eastern Pacific. Under the interior-on-the-left rule it means "everything except that box," which is why it contains both poles. That's exactly the case planar libraries and spherely's default get wrong. Each polygon's `description` field should say something like this in user-facing terms.

# Appendix E: Formulas

**E.1 Containment by crossing parity**

Work in 3D unit vectors. For an edge from `a` to `b`, `cross(a, b)` points toward the **left** side of travel, which by our convention is the interior. (Check: `a = (1,0,0)` at (0°, 0°), `b = (0,1,0)` at (90°, 0°), travelling east; `cross(a, b) = (0,0,1)`, the North Pole, which is indeed to the left.)

1. Build a reference point known to be **inside**, just off the midpoint of the first edge:
   `R = normalize(normalize(v0 + v1) + eps * normalize(cross(v0, v1)))` with `eps = 1e-6` (about 6 m off the edge). Smaller values such as `1e-9` still work in float64, but they leave only a few digits of sign margin in the crossing test below, and `1e-6` is just as reliably inside for polygons this large.
2. For each test point `P`, count the polygon edges that cross the minor arc `R → P`. An **even** count means `P` is inside (`R` is inside, and each crossing flips it).
3. Crossing test for arcs `(a, b)` and `(c, d)`, the S2 "simple crossing" sign test:
   ```
   ab = cross(a, b)
   acb = -dot(ab, c);  bda = dot(ab, d)
   if acb * bda <= 0: no crossing
   cd = cross(c, d)
   cbd = -dot(cd, b);  dac = dot(cd, a)
   crossing iff acb * cbd > 0 and acb * dac > 0
   ```
4. If `P` is nearly antipodal to `R` (angle > π − `antipodal_tol`, with `antipodal_tol = 1e-9`; keep it a separately named constant so it isn't confused with `eps` above, which serves an unrelated purpose), the minor arc is ill-defined. For those points use a second reference point just **outside** the first edge (`-eps` instead of `+eps`), where an **odd** count means inside.

Vectorize over points × edges with numpy broadcasting; 5,000 points × ~100 edges is trivial.

**E.2 Angular distance from a point to an edge arc**

With `n = normalize(cross(a, b))`: the distance to the full great circle is `|asin(dot(p, n))|`. That's only the distance to the *arc* if `p` projects inside it. Test with `proj = normalize(p - dot(p, n) * n)` and check `dot(cross(a, proj), n) >= 0 and dot(cross(proj, b), n) >= 0`. Otherwise the distance is `min(angle(p, a), angle(p, b))`. Take the minimum over all edges, and skip points below `edge_tolerance_deg`.

**E.3 Exact spherical polygon area**

Fan-triangulate from `v0` and sum signed spherical excesses, using the Van Oosterom–Strackee formula for the signed solid angle of triangle `(a, b, c)`:

```
E = 2 * atan2(dot(a, cross(b, c)), 1 + dot(a, b) + dot(b, c) + dot(c, a))
```

Sum `E` over triangles `(v0, v_i, v_{i+1})` for `i = 1 .. n-2`. If the total is negative, add `4π`. Multiply by `R²` with `R = 6_371_010.0` m (matching spherely). Signed contributions cancel correctly for non-convex rings, and the `+4π` correction handles polygons larger than a hemisphere. The test `area(ring) + area(reversed) == 4πR²` catches sign errors.

**E.4 Fibonacci sphere**

For `i` in `0..n-1`: `z = 1 - (2i + 1)/n`, `lat = degrees(asin(z))`, `lon = degrees((i * golden_angle) mod 2π)` normalized into −180..180, where `golden_angle = π * (3 - sqrt(5))`.

# Appendix F: Results File Shape

An abbreviated example of `frontend/public/results.json`, to make the layout concrete:

```json
{
  "schema_version": 1,
  "generated_at": "2026-09-20T12:00:00Z",
  "grid": { "point_count": 5000, "region": null, "edge_tolerance_deg": 0.25 },
  "points": [[12.34567, -45.6789], "..."],
  "polygons": [
    { "id": "north_pole", "name": "Covers the North Pole",
      "description": "An irregular ring between 55 and 70 degrees north...",
      "polygon": { "type": "Polygon", "coordinates": [[[-180, 60], "...", [-180, 60]]] },
      "expected_valid": true }
  ],
  "reference": {
    "north_pole": { "inside_indices": [3, 17], "skipped_indices": [412],
                    "area_m2": 2.82e13, "bbox": { "west": -180, "south": 55, "east": 180, "north": 90 } }
  },
  "systems": [
    { "id": "shapely", "name": "Shapely (GEOS)", "version": "2.1.2",
      "semantics": "planar", "notes": "Planar geometry engine..." }
  ],
  "variants": {
    "shapely": [
      { "id": "raw", "name": "Raw input", "description": "The polygon as-is...",
        "tradeoffs": ["Nothing to remember, but geodetic cases are wrong."] }
    ]
  },
  "results": [
    { "polygon_id": "north_pole", "system_id": "shapely", "variant_id": "raw",
      "outcome": "accepted_but_wrong", "accepted": true, "validation_errors": [],
      "error_message": null,
      "submitted_geometry": { "type": "Polygon", "coordinates": [["..."]] },
      "agreement_pct": 81.2, "false_positive_indices": [22], "false_negative_indices": [3, 17],
      "area_m2": null, "area_error_pct": null,
      "bbox": { "west": -180, "south": 55, "east": 135, "north": 70 },
      "bbox_covers_expected": false, "duration_ms": 12.4 }
  ]
}
```
