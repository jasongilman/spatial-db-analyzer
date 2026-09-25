# Map Interaction Plan: Zoom and an Interactive Legend

> **Status: not started.** Second of three review-driven plans. It follows
> [05-clarity-fixes-plan.md](05-clarity-fixes-plan.md), whose colors and "no measurements" state it
> builds on. It precedes [07-explanatory-pages-plan.md](07-explanatory-pages-plan.md), which
> reuses its help text.

| Review item | Section |
|---|---|
| 1. Scroll to zoom on either map | [A](#a-zoom) |
| 7. Bounding box as a toggle; possibly toggle every layer | [B](#b-every-legend-entry-is-a-toggle) |
| 6. A "?" button with a pop-up explanation on each legend item | [C](#c-help-pop-ups) |

B and C both rebuild the legend under the maps, so they are done together. A is independent and
comes first.

## Working this plan

* Read `CLAUDE.md` first. It has the commands (including the nvm `PATH` fix for `npm`), the
  conventions, and the Python ↔ TypeScript contract. Everything else this plan needs is named
  below by file and function; read those files rather than relying on this summary of them.
* Work on a branch, `map-interaction`, not on `main`.
* **Check the decisions below before writing code.** Each one is marked *Confirmed* or
  *Proposed*. If any is still *Proposed*, ask Jason about those first, then record his answer here.
* Stop and report at each checkpoint and at the end, with the manual verification list, because
  Jason signs off on each plan by checking it himself. Commit only when he asks.
* If this plan turns out to be wrong about the code, follow the code and note the discrepancy in
  the report.

## Decisions to confirm before starting

1. *Proposed:* **Each map zooms on its own** (A). The two maps are not linked, because a zoom level means
   something different on a globe than on a flat map.
2. *Proposed:* **The wheel always zooms while the pointer is over a map**, as asked. The cost: scrolling the
   page past the maps with the pointer over them zooms the map instead. The maps are about half the
   viewport tall, so this is tolerable. If it proves annoying, the fallback is Google Maps' "hold
   Ctrl/⌘ to zoom" rule.
3. *Proposed:* **Toggle state carries across navigation** (B). If you turn the bounding boxes on and click to a
   sibling combination, they stay on. The state lives in memory only and resets on reload. It is
   not stored in `localStorage`.
4. *Proposed:* **Both bounding boxes are off by default** (B). Every other layer defaults to on, except
   skipped points and, from plan 05, the reference answer on rejected combinations.

## A. Zoom

Add `d3-zoom` (with `@types/d3-zoom`) to [map.ts](../frontend/src/map.ts).

* **Equirectangular:** the wheel and pinch zoom toward the pointer, and dragging pans. The scale
  runs from 1× to 20×, and `translateExtent` keeps the map from being dragged off screen. The zoom
  transform is applied by adjusting the projection's `scale` and `translate` after `fitExtent`,
  not with `context.setTransform`. That way line widths and point radii stay in screen pixels.
* **Orthographic:** the wheel and pinch change the projection scale, from 1× to 20× of the fitted
  scale, about the globe's center. Drag keeps rotating, as it does today. A d3-zoom `filter` passes
  only `wheel` and `dblclick` events (and touch pinch), so zoom and the existing `d3-drag` rotation
  don't fight over the pointer. Rotation sensitivity is divided by the zoom factor, so a drag at
  10× doesn't spin the globe ten times too fast.
* **Culling at zoom:** the orthographic back-hemisphere dot-product test is still correct. Points
  projected outside the canvas can be skipped with a bounds check for speed.
* **Reset:** a small "Reset view" button sits in each map's corner and appears only when that map
  is zoomed or rotated away from its initial view. Double-click zooms in (d3's default).
* `setScene` resets the zoom as well as the rotation. `redraw` keeps both.

**Known limit:** the grid is 5,000 points, so points are about 3° apart. At 20× zoom you can see
that spacing. That is honest: the grid really is that coarse. A denser grid is a separate CLI
change (`--points`), not part of this plan.

**Tests:** zoom is interaction, so it is verified manually. Pull the pure pieces into functions and
unit test them: `zoomedScale(fitted, k)` and `rotationSensitivity(k)`.

## B. Every legend entry is a toggle

**New map layers.** Draw two bounding boxes, from data already in `results.json`:

* **Library bbox:** `result.bbox`, the box the library reported, in the submitted geometry's color
  with a dotted line.
* **Expected bbox:** `reference.bbox`, the true geodetic box, in the truth color with a dotted
  line.

A lon/lat box on a sphere is **not** four great-circle edges. Its top and bottom edges are
parallels. So add `bboxOutline(bbox: BBox): D3Geometry` to [geo.ts](../frontend/src/geo.ts). It
returns a `MultiLineString`, stroked and never filled, so winding cannot go wrong. The parallels are
densified at 1°. When `west > east`, the box crosses the antimeridian: it runs east from `west`
through 180 to `east`. A box with `north === 90` has no top edge. Unit tests in `geo.test.ts`:

* A normal box: 4 edges, with the parallel edges densified.
* The antimeridian box from `antimeridian`'s expected bbox (`W 160, E -160`): its longitudes pass
  through 180, not through 0.
* A box reaching 90°N: no degenerate top edge.

**Layer model.** Replace `Scene.showSkipped` with `Scene.visible: Record<LayerId, boolean>`, where
`LayerId` is `truth | submitted | libraryBBox | expectedBBox | ` plus each `PointClass`. `MapView`
skips each hidden layer. Module-level state in `detail.ts` holds the current visibility and is
copied into each new scene.

**Legend.** Each entry becomes a `<button aria-pressed>` that holds its swatch and label. The
entry fades when its layer is off. Rows:

1. Geometry: truth polygon · submitted geometry · library bbox · expected bbox
2. Points: whichever classes are present, as today, including skipped and the rejected-case
   reference classes from plan 05.

An entry appears only if there is something to draw. For example, no library bbox appears when
`result.bbox` is null, and no submitted-geometry entry appears on rejected combinations.

## C. Help pop-ups

Each legend entry gets a small `?` button next to it. Use the native Popover API: a
`<button popovertarget="help-{layer}">` and a `<div popover id="help-{layer}">`. This gives Escape
and click-outside dismissal and keyboard focus with no library. The popover is positioned under its
button by a few lines of JS on the `toggle` event. CSS anchor positioning isn't in every browser
yet.

Help text goes in a new module, `frontend/src/help.ts`, as `LAYER_HELP: Record<LayerId, string>`,
so plan 07's intro page can reuse it. A test asserts that every `LayerId` has an entry. Draft text,
to be reviewed at the checkpoint:

* **Truth polygon:** "The test polygon as it really is on a sphere: each edge is the shortest path
  (a great-circle arc) between its two vertices. Every point is scored against this shape."
* **Submitted geometry:** "What the library was actually given after any workaround, drawn the way
  the library interprets it. A planar library draws straight lines in longitude/latitude, so on
  the flat map its edges are straight."
* **Library bbox:** "The bounding box the library reported. A database can use a box like this to
  pre-filter queries, so a box that misses part of the polygon causes wrong results even when the
  containment test is right."
* **Expected bbox:** "The true longitude/latitude bounding box of the spherical polygon. Great-circle
  edges bow toward the poles, so it often extends past the vertices."
* **Correct inside / outside:** "The library and the reference agree that this point is
  inside/outside."
* **False positive:** "The library says inside; the reference says outside."
* **False negative:** "The library says outside; the reference says inside."
* **Skipped:** "Within {tolerance}° of an edge. Boundary behavior is ambiguous, so these points
  aren't scored." The tolerance comes from `grid.edge_tolerance_deg`.
* **Reference inside / outside:** "The library never answered, so this shows only where the point
  truly lies. It is not a mark for or against the library."

## Exit criteria

```bash
scripts/lint.sh && scripts/test.sh
(cd frontend && npm run build)
```

`results.json` is unchanged by this plan.

## Manual verification (Jason)

1. `#/combo/wide/shapely/raw`, flat map: the wheel zooms toward the pointer, dragging pans, the map
   can't be dragged off screen, and "Reset view" restores it. Points stay the same size at every
   zoom.
2. The same page, globe: the wheel zooms, drag still rotates at a sensible speed while zoomed, and
   no points from the back hemisphere show through.
3. `#/combo/antimeridian/shapely/raw`: turn on both bounding boxes. The expected box wraps across
   180°. The library box is the complement band through 0° (finding 5 in
   [03-phase-1-findings.md](03-phase-1-findings.md)).
4. `#/combo/normal/shapely/raw`: the expected box's northern edge sits slightly above the polygon's
   top vertices (45.44° vs 45°).
5. Every legend entry hides and shows its layer on both maps. Clicking a sibling link keeps the
   toggles as they were.
6. Every `?` opens readable help text, and Escape or clicking elsewhere closes it.
