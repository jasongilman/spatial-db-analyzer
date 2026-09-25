# Design Decisions

This document records the decisions made after reviewing [00-initial-project-description.md](00-initial-project-description.md). Where the two disagree, this document wins.

## Scope Clarifications

* **Containment, not intersection.** The core question is "does this library correctly decide whether a point is inside a geodetic polygon?" Polygon-to-polygon intersection is in the parking lot.
* **Correct means spherical.** The expected answer assumes a spherical Earth, with edges following great-circle arcs between vertices. A library with planar semantics is not "buggy," but it does not match this definition. The display should explain that difference.
* **No custom polygons in the first version.** The first version is a static website with precomputed results. There is no backend at runtime and no deployment yet.
* **No polygons with holes.** No invalid polygons yet (parking lot).
* **The time budget in `00` is a budget on Jason's time**, meaning review, decisions and checking results, not on implementation wall-clock time. Plans should therefore minimize review cycles and pin expected values up front, rather than cutting scope to save typing.

## Input Format and Winding Order

* Test polygons are stored as **GeoJSON** (`[lon, lat]`, longitudes in -180..180).
* Rings follow the **GeoJSON (RFC 7946) convention**: the exterior ring is counter-clockwise, meaning the interior is on the left of each edge. This is what lets a polygon contain one or both poles.
* Each library adapter converts to the orientation that library expects (for example, MongoDB's `strictwinding` CRS, or d3-geo's clockwise-is-interior convention on the front end).

## Reference Implementation (Source of Truth)

* We write a small, self-contained Python module for spherical point-in-polygon, plus spherical area.
  * Approach: convert vertices and points to 3D unit vectors, then count great-circle edge crossings along an arc from a known reference point. The ring's orientation determines whether the reference point is inside.
  * Target: a few hundred lines at most, with thorough unit tests (poles, antimeridian, hemisphere-sized polygons).
* **Risk:** the reference could be wrong too. To reduce that risk, we cross-check it against spherely (S2) in tests and treat any disagreement as something to investigate, not automatically a library failure. We'll reevaluate this approach once the results are in.

## Libraries and Databases

| System | Semantics | Runs as | Phase |
|---|---|---|---|
| Reference (ours) | Spherical | In-process | 1 |
| Shapely (GEOS) | Planar | In-process | 1 |
| spherely (S2) | Spherical | In-process | 1 |
| DuckDB + `spatial` extension | Planar | In-process | 1 |
| DuckDB + `geography` extension (S2-based) | Spherical | In-process | 2 |
| PostGIS `geography` and `geometry` | Spherical and planar | Docker | 2 |
| MongoDB `2dsphere` | Spherical | Docker | 2 |
| Elasticsearch `geo_shape` | Mixed | Docker | 3 |
| NASA CMR spatial library | Spherical | JVM, TBD | Stretch |

Shapely and DuckDB `spatial` are included deliberately to show what happens when a planar library is used outside its intended purpose.

## Workarounds

Each system is tested with its **documented or common workaround** applied, not just raw input. Examples:

* Densifying edges along great circles, so planar libraries approximate curved edges.
* Splitting at the antimeridian.
* Setting orientation or CRS options (Elasticsearch `orientation`, MongoDB `strictwinding`).
* Expanding pole-covering polygons to reach ±90 latitude for planar libraries.

The display must make each workaround and its tradeoffs very obvious. Examples of tradeoffs: more vertices, approximation error, the stored shape differing from the input, or behavior that only works if the caller knows the right trick. Where it's cheap, we also record the raw (no workaround) result for comparison.

## Test Polygons

Polygons are deliberately **large**, so the problems are obvious and a coarse point grid is enough.

1. "Normal" polygon (control case)
2. Covers the North Pole
3. Covers the South Pole
4. Contains both poles
5. Crosses the antimeridian
6. Crosses the antimeridian **and** covers a pole
7. Wide polygon (shows the difference between Cartesian and great-circle edges)
8. Long, thin polygon along a line of latitude (great-circle edges bow toward the pole)
9. Larger than a hemisphere, containing neither pole
10. The same polygon as #1 with reversed winding (tests how winding is interpreted)
11. A vertex exactly at a pole
12. An edge passing through a pole
13. An edge spanning 180° or more of longitude (ambiguous case)
14. A very small polygon (precision)

## Checks per Test Combination

A test combination is one polygon, run against one system, with or without a workaround. Each combination records:

* **Validity:** does the library accept the polygon, and does its own validation (for example `ST_IsValid`, `is_valid`, or a rejected insert) return an empty error list? Error messages are recorded verbatim.
* **Point containment:** agreement with the reference over the point grid. We record the percentage plus the lists of false positives and false negatives, so the front end can draw them.
* **Area:** the library's reported area compared with the reference's spherical area, where the library reports area in comparable units. Otherwise N/A.
* **Bounding box:** the library's bounding box compared with the expected geodetic bounding box, where the library exposes one.
* **Outcome category:** rejected / disagrees (accepted, but disagreed with the reference on at least one point) / correct. The build also has `error` (an unexpected exception) and `no_data` (no grid point could be scored), which is never shown as a pass.

### Point Grid

* Points come from a **Fibonacci sphere**, which spreads them evenly over the globe.
* The point count is **configurable**. An optional region limit (a latitude/longitude window) can restrict the grid to part of the Earth.
* Points within a small tolerance of a polygon edge are **skipped**, because boundary behavior is ambiguous.

## Front End

* **TypeScript** (strict), **Vite**, and **d3-geo**, with no UI framework. This keeps it small and quick.
* **Lint, format and test:** ESLint (typescript-eslint, strict), Prettier, and Vitest.
* **Two linked views:**
  * **Orthographic globe** (rotatable), for a realistic picture.
  * **Equirectangular flat map**, chosen over Mercator because it shows the poles, and because a planar library's straight edges are straight lines in this projection. That makes it easy to overlay "what a planar library thinks this polygon is" against the true great-circle polygon.
* **Pages:**
  1. A summary matrix of polygons × systems, colored by outcome.
  2. A detail view for one combination: the polygon, the grid points colored correct / false positive / false negative, the workaround notes, and error messages.
  3. "How it works" (`#/how-it-works`): the concepts (great-circle edges, poles, the antimeridian, winding order, planar vs spherical), how a combination is scored, and what each outcome means, each with a figure drawn from the results file.
  4. "Libraries & fixes" (`#/libraries`, `#/libraries/{systemId}`): each library's limitations and variants, with each variant's outcome strip, then the shared workarounds explained once. Per-system and per-variant prose lives on the Python adapters (`SystemInfo.limitations`, `Variant.how_it_helps`, `WorkaroundInfo`), so a new system can't be added without it.
* A nav bar on every page links Results · How it works · Libraries & fixes.
* The front end reads precomputed result JSON produced by the Python backend.

## Code Standards

These are as described in `00`: Python 3.13, uv, ruff, pyright strict, pytest, and pydantic (strict, extra forbid, frozen). Bash with shellcheck. We take the ruff and pyright rule sets from Element84/natural-language-geocoding and update them to current versions.

## First Slice (Phase 1)

**Status: complete.** See [02-phase-1-plan.md](02-phase-1-plan.md) for what was built and
[03-phase-1-findings.md](03-phase-1-findings.md) for what it found.

The goal is an end-to-end thin slice, run locally:

1. Project scaffolding: a uv project with lint, type-check and test scripts; a Vite + TypeScript front end with lint and test.
2. Pydantic models for polygons, points, the point grid, and results.
3. The reference implementation, with tests.
4. Adapters for Shapely, spherely, and DuckDB `spatial`, including their workarounds.
5. About 6 test polygons (#1–#7, excluding #6).
6. A CLI that runs every combination and writes the results JSON.
7. A static front end with the summary matrix and a detail view in both projections.

Then comes Phase 2 (the Docker-based systems plus the DuckDB `geography` extension) and the remaining polygons.

## Parking Lot

* Polygon-to-polygon intersection tests
* Invalid polygons (self-intersecting and similar)
* Longitudes in 0–360 (dropped)
* Reading geometry back from the library to detect silent splitting or normalization
* Custom or user-drawn polygons, and the runtime backend they need
* AWS deployment (S3 + CloudFront for the static site; cost controls for any backend)
* NASA CMR spatial library (stretch goal)
* Conversation transcripts for auditing (asked for in `00`) — Jason is handling this outside these plans.

Explicitly excluded: polygon-vs-box queries.

## Open Questions

* ~~Does the DuckDB `geography` community extension support the containment and area functions we need?~~ Yes: verified during Phase 1 planning (`s2_contains`, `s2_area`, `s2_bounds_box`, `s2_is_valid_reason`).
