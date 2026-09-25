# Explanatory Pages Plan: Intro and Libraries

> **Status: not started.** Third of three review-driven plans, after
> [05-clarity-fixes-plan.md](05-clarity-fixes-plan.md) and
> [06-map-interaction-plan.md](06-map-interaction-plan.md). It reuses 06's help text and map
> renderer.

| Review item | Section |
|---|---|
| 5. An intro page explaining the concepts, each with a visual example | [B](#b-how-it-works-page) |
| 4. A description of each library and variant: limitations, and what each fix does | [C](#c-libraries-and-workarounds-page) |
| 4.1 Where this content should live | [A](#a-where-it-lives) |

This is the largest of the three plans, and most of it is prose, which only Jason can approve. It
therefore has **two checkpoints**: one after B, and one after C.

## Working this plan

* Read `CLAUDE.md` first. It has the commands (including the nvm `PATH` fix for `npm`), the
  conventions, and the Python ↔ TypeScript contract. Everything else this plan needs is named
  below by file and function; read those files rather than relying on this summary of them.
* Work on a branch, `explanatory-pages`, not on `main`.
* **Check the decisions below before writing code.** Each one is marked *Confirmed* or
  *Proposed*. If any is still *Proposed*, ask Jason about those first, then record his answer here.
* Stop and report at each checkpoint and at the end, with the manual verification list, because
  Jason signs off on each plan by checking it himself. Commit only when he asks.
* If this plan turns out to be wrong about the code, follow the code and note the discrepancy in
  the report.

## Decisions to confirm before starting

1. *Proposed:* separate linked pages, as laid out in section A.
2. *Proposed:* per-system and per-variant prose lives in the Python models (section C).

## A. Where it lives

Three options were considered for item 4.1:

| Option | For | Against |
|---|---|---|
| A section at the bottom of the summary page | Nothing extra to navigate | Pushes 7+ system sections under a matrix nobody scrolls past. Can't deep-link from a column header without scroll hacks. Grows with every Phase 2 system. |
| Expandable text inside the matrix column headers | Right where the question comes up | Column headers are narrow, and the text needs figures. |
| **Separate linked pages (recommended)** | Room for figures. Deep links from wherever a library is mentioned. The results page stays one screen. | One more route |

**Recommended structure:** a nav bar in a slim site header on every page:
**Results · How it works · Libraries & fixes**.

* `#/` — Results (the summary matrix). The two intro paragraphs shrink to one sentence and a
  "New here? Read how it works →" link.
* `#/how-it-works` — the intro page (B).
* `#/libraries` and `#/libraries/{systemId}` — the libraries page (C). The second form scrolls to
  that system's section.
* **Links into it:** each matrix column header's system name links to `#/libraries/{systemId}`.
  In the detail view, "About this library" gets a "How {system} works and what each fix does →"
  link.

`routing.ts` gains `HowItWorksRoute` and `LibrariesRoute { systemId?: string }`, with tests.
Unknown system IDs fall back to the top of the page.

## Shared piece: figure maps

Both pages need small static maps. Add a thin wrapper around 06's `MapView`:
`renderFigure(container, { projection, center, extent?, layers })`. It draws one small map with no
points or a caller-chosen subset, a caption, and no legend. `extent` is an optional `BBox` to fit
instead of the whole sphere; the densification figure needs it to zoom in on one edge. Build it on
06's zoom support (a fixed initial transform) or on `fitExtent` against the box, whichever is
simpler. Figures are built **from `results.json`** (polygons, submitted geometries and results),
never from hand-drawn shapes, so a figure can't illustrate something the data doesn't show. The
one exception is derived geometry, such as a reversed ring or a single edge pulled out of a
polygon, which is computed from that data in `geo.ts`. The globe figures can be dragged. The flat
figures are static.

`MapView` needs a few extra options for figures: fill or no fill per geometry, a second submitted
geometry with its own color, and extra line layers. Extend the `Scene` for these. Don't fork the
renderer.

## B. "How it works" page

Each section pairs a short explanation (about 3–5 sentences) with a figure beside it, stacked on
narrow screens. The prose extends the two paragraphs now at the top of the summary page. Draft
sections:

1. **Great-circle edges, not straight lines.** Figure: the `wide` polygon on the flat map, with the
   truth outline (curved) and Shapely's submitted outline (straight). The gap between them is where
   the false positives are.
2. **A polygon can contain a pole.** Figure: `north_pole` on a globe centered on the pole, next to
   the flat map, where the same ring becomes a band across the top.
3. **A polygon can cross the antimeridian.** Figure: `antimeridian` on the flat map, with the truth
   next to Shapely's raw interpretation, which covers the other 320° of longitude.
4. **Winding order says which side is inside.** Figure: two globes of the same `both_poles` ring,
   one filled per RFC 7946 (88% of the globe) and one per "smaller side" (12%), which is what
   spherely's default does. **Note:** `spherely/default`'s `submitted_geometry` in `results.json`
   is the input ring unchanged. The library's reinterpretation happens inside spherely, so it isn't
   visible in the data. Draw the 12% globe from the **reversed** `both_poles` ring (reverse the
   ring, then convert with `toD3Geometry`). Check it against the 12% area in the
   `antimeridian_fix_rewound` tradeoff text.
5. **Planar isn't broken, it's different.** Text only: a planar library is correct by its own
   rules, and this site measures against spherical rules.
6. **How each combination is scored.** Figure: `wide` × `shapely/raw` with points on. Covers the
   Fibonacci grid, the reference implementation (and its cross-check against spherely), skipped
   points, and each point color. The color explanations reuse `LAYER_HELP` from plan 06.
7. **What the outcomes mean.** The outcome legend, moved here from the summary page. The summary
   keeps a compact swatch row.

**Checkpoint 1:** Jason reviews the page and its prose before C starts.

## C. "Libraries & fixes" page

One section per system, in `ALL_SYSTEMS` order. Each section has:

1. **Header:** name, version, a planar/spherical badge, and a link to the project's documentation.
2. **What it is:** one paragraph (today's `notes`).
3. **Known limitations for geodetic data:** a short bullet list, specific to this library. For
   Shapely: no great circles, no antimeridian wrap, no poles, and `orient()` assumes planar winding.
4. **Each variant:** what it does, **how it addresses the limitation**, its tradeoffs (the existing
   list), and a one-row strip of its outcome cells across all polygons, linking to each detail
   view.

**Workarounds are explained once, not per variant**, because they are shared across adapters
(`workarounds.py`). Each gets its own subsection at the end of the page, which the variants link
to:

* **Great-circle densification.** Figure: one edge of `normal`, zoomed on the flat map, drawn three
  ways: the true arc, the single straight chord a planar library draws, and the 1°-step polyline
  after densifying. Text: the chord cuts the corner, so points between it and the arc are
  misclassified. Densifying replaces one long chord with many short ones that hug the arc. The
  remaining error shrinks roughly with the square of the step size, at the cost of many more
  vertices. The vertex counts before and after come from `results.json` (the submitted geometry of
  `raw` vs `densified_fix`).
* **Antimeridian fix.** Figure: the `antimeridian` polygon, before and after, with the two pieces
  of the resulting MultiPolygon in different tints. Text: what splitting does, why pole coverage
  gets closed along ±90°, and what `fix_winding` changes (the `rewound` variant).
* **spherely `oriented`.** Text only: why S2 has to guess which side is inside when winding isn't
  trusted.

**Where the prose is stored:** per-system and per-variant content lives in **Python**, on the
adapter, next to the existing `notes`, `description` and `tradeoffs`. That keeps `models.py` the
single source, and pydantic makes the fields required, so a Phase 2 adapter can't be added without
its explanation. New fields:

* `SystemInfo.limitations: list[str]` and `SystemInfo.docs_url: str`
* `Variant.how_it_helps: str` and `Variant.workaround_ids: list[str]` (for example,
  `["densify", "antimeridian"]`)
* A top-level `workarounds: list[WorkaroundInfo]` (`id`, `name`, `explanation`), defined once in
  `workarounds.py`

Every `SystemInfo` and `Variant` must fill these fields, and that includes the reference control
column. Its `REFERENCE_INFO` lives in `systems/reference_system.py` rather than on an adapter
(`limitations: []`, `docs_url` pointing to this repo's `reference.py`, `workaround_ids: []`). The
other `SystemInfo` instances are in `systems/{shapely_system,duckdb_spatial,spherely_system}.py`.
The variants are defined next to them.

If plan 05 has shipped, `schema_version` is 3 and this bumps it to 4. Otherwise, bump it by one
from whatever it is. Then run `generate_types.sh` and `generate_results.sh`.
Section-level page prose (B, and the introductions in C) stays in TypeScript, because it is about
the site, not about a system.

**Checkpoint 2:** Jason reviews the libraries page.

## Exit criteria

```bash
scripts/lint.sh && scripts/test.sh
scripts/generate_types.sh && scripts/generate_results.sh
(cd frontend && npm run build)
```

Plus a vitest that every system and variant in `results.json` has non-empty `limitations` and
`how_it_helps`, and that every `workaround_ids` entry resolves.

Update `plans/01-design-decisions.md` § Front End → Pages to list the two new pages.

## Manual verification (Jason)

1. The nav bar reaches all three pages from every page, including a detail view.
2. How it works: every section's figure shows what its text claims. In particular, the `wide`
   figure's straight and curved outlines visibly differ, and the `both_poles` pair shows 88% vs 12%.
3. Libraries & fixes: clicking "Shapely" in a matrix column header lands on the Shapely section.
   The densification figure shows the chord, the arc and the densified polyline as distinguishable
   lines. Each variant's outcome strip matches the matrix column.
4. Reading the Shapely and DuckDB sections cold, it's clear why `densified_fix` passes `wide` while
   `antimeridian_fix` fails it.
