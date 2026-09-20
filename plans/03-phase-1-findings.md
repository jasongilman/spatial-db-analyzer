# Phase 1 Findings

What Phase 1 turned up that the plan did not already predict, written to feed Phase 2. The
numbers come from the committed `frontend/public/results.json`: 6 polygons × 10 columns over a
5,000-point grid.

## The headline result

| Polygon | shapely/raw | shapely/densified_fix | spherely/default | spherely/oriented |
|---|---|---|---|---|
| Ordinary box | 100% | 100% | 100% | 100% |
| Covers the North Pole | **rejected** | 100% | 100% | 100% |
| Covers the South Pole | **rejected** | 100% | 100% | 100% |
| Contains both poles | 0.9% | 88.0% | **0.0%** | 100% |
| Crosses the antimeridian | 65.7% | 100% | 100% | 100% |
| Wide band of latitude | 96.0% | 100% | 100% | 100% |

## 1. Planar libraries reject the pole polygons rather than answering wrongly

The plan expected wrong answers. What actually happens is cleaner and more useful: read as a flat
ring, a polygon that encircles the globe has a closing edge that runs all the way back across the
map, which crosses the other edges. GEOS reports it precisely:

```
Self-intersection[-115.27397260274 59.3835616438356]
```

So for pole coverage, a planar engine fails loudly. That is the good case. The dangerous cases are
the ones where it accepts the polygon and returns a confident wrong answer, which is what the
antimeridian (65.7%) and both-poles (0.9%) rows show.

**For Phase 2:** worth checking whether PostGIS `geometry`, MongoDB and Elasticsearch also refuse
these, or accept them silently. An engine that accepts a self-intersecting ring without complaint
is a materially worse failure mode than one that rejects it, and the UI currently treats
`rejected` as a middling outcome rather than a relatively honest one.

## 2. Densifying rescues more than expected

`densified_fix` reaches 100% on `north_pole`, `south_pole`, `wide` and `antimeridian` for both
planar engines. A vertex every 1° along each great-circle edge is enough to make a planar engine
agree with spherical truth at this grid resolution.

That is worth stating carefully: it did not make the library spherical. It moved the
approximation error below the spacing of the test grid. A finer grid, or a tolerance tighter than
the 0.25° edge skip, would start to show the chords again. The cost is visible in the data: the
`wide` polygon goes from 5 vertices to 160.

**For Phase 2:** vary the densify step and the grid size together, and show where the
approximation starts to fail. The current single 1° step makes densifying look like a solution
rather than a trade.

## 3. `both_poles` is the only case no workaround fixes

Every planar variant tops out at 88.0%, and `spherely/default` scores **0.0%** — a perfect
inversion, since it returns exactly the complement. The antimeridian fix cannot help, because
nothing here crosses the antimeridian; the problem is purely that the meaning lives in the
winding order, and a planar engine has no way to express "everything except this box".

The area numbers make it concrete: `spherely/default` reports an area **86.2% below** the
reference, because it picked the 12% box instead of the 88% remainder. Every other spherely
result matches the reference area to within floating-point noise.

**For Phase 2:** this is the polygon to lead with when testing a new system. It separates
"handles winding order" from "handles the antimeridian", which most of the other cases conflate.

## 4. Rewinding is a silent, total failure

`shapely/antimeridian_fix_rewound` differs from `antimeridian_fix` by one keyword argument, and
that argument is the library's **default**. On `both_poles` it drops agreement from 88.0% to 0.9%.
Nothing warns; the fix succeeds and returns a valid polygon that means the opposite of the input.

This is the most transferable lesson in the set, because it is not really about the antimeridian
package. It is about any preprocessing step that normalizes ring orientation.

**For Phase 2:** MongoDB's `strictwinding` and Elasticsearch's `orientation` are the same class of
option. Test them both ways, as done here, rather than picking the setting that works.

## 5. Bounding boxes disagree more often than containment

25 of the 48 combinations that report a bounding box fail to cover the true one. A planar engine
cannot express a box with `west > east`, so for the antimeridian polygon it reports the exact
complement (`W -160, E 160` instead of `W 160, E -160`) while still being merely "wrong" on
containment. Latitude extremes are also consistently short, because great-circle edges bow beyond
their endpoints: the `normal` box's true northern limit is 45.44°, not the 45.00° both engines
report.

**For Phase 2:** the bounding box is a cheaper and sharper signal than containment. A system whose
bbox is wrong will fail any index-backed query that uses it as a pre-filter, whichever way the
containment test then goes. Worth promoting from a detail-panel fact to something the matrix shows.

## 6. Performance is not a concern yet, but DuckDB is 30× slower

Across all 6 polygons at 5,000 points: DuckDB ~970 ms, spherely ~39 ms, Shapely ~29 ms. The gap is
almost entirely per-query overhead — one `ST_Contains` query per polygon against a 5,000-row table,
versus a single vectorized call in-process.

This does not matter for a precomputed site, and it will matter in Phase 2 when Docker-based
systems arrive and each query crosses a network boundary. Batch the points per query rather than
per point.

## 7. Practical notes

- **The reference and spherely agree everywhere.** Over all 6 polygons and every non-skipped point,
  zero disagreements, and areas match to 1e-9 relative. The reference implementation can be
  trusted as ground truth for Phase 2 without re-litigating it.
- **json-schema-to-typescript cannot read pydantic's tuples.** It renders draft 2020-12
  `prefixItems` as `unknown`. `scripts/schema_for_typescript.py` rewrites them to the draft-07
  spelling first. Any new tuple-typed field will need that rewrite to keep working.
- **Drawing "the library's view" needs its own winding rule.** Reversing every ring for d3 is
  correct for spherical geometry and wrong for planar: re-read as a flat shape, the antimeridian
  box is clockwise rather than counter-clockwise, and reversing it made d3 fill the complement.
  Planar rings are now oriented by their own planar signed area. Any new planar system inherits
  this automatically; any new spherical one must not.
- **vitest's default thread pool hangs on this machine.** `pool: "forks"` in
  `frontend/vite.config.ts`.
- **`--region` needs `=`.** argparse reads `--region -10,...` as a flag.

## Carried into Phase 2 unchanged

The parking lot in [01-design-decisions.md](01-design-decisions.md) still stands. Nothing found
here argues for pulling anything forward, except that **reading geometry back from the library**
(currently parked) would have answered questions 1 and 5 directly rather than by inference.
