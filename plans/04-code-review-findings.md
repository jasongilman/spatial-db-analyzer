# Code Review Findings — Phase 1

Findings from a review of the full Phase 1 branch diff (`main...HEAD`, 62 files / ~9.8k lines).
Every source hunk was read; the top three findings were confirmed by running the code. Nothing in
this document has been fixed — it is a review queue.

Ordered most severe first. Each entry says what is wrong, how it was confirmed, why it matters for
this project specifically, and the smallest fix that would close it.

**Status: all seven are fixed**, along with one more the fixes uncovered. See
[Resolution](#resolution) at the end for what changed and what it cost.

---

## 1. Zero scored points reports 100% correct

**Where:** [runner.py:78](../src/spatial_db_analyzer/runner.py#L78)

```python
agreement = 100.0 * (scored_count - wrong) / scored_count if scored_count else 100.0
```

When `scored_count == 0` there is nothing to disagree about, so `wrong` is 0, the outcome is
`"correct"` and the agreement is `100.0`. The guard exists to avoid a division by zero and picks
the wrong answer for the empty case.

**How to reach it:** any polygon whose region contains no grid points, or whose points all fall
inside `edge_tolerance_deg` and are therefore skipped. Both get more likely as polygons get
smaller or the tolerance gets wider — exactly what Phase 2 adds.

**Confirmed by running:**

```python
run(grid=GridConfig(point_count=200000, region=BBox(-110.1, 36.0, -109.95, 36.4)))
```

Zero points landed in the region, and every column — including `shapely/raw` and
`spherely/default` on the pole polygons, which cannot be correct — printed `correct 100.0`.

**Why it matters here:** this is the one failure mode the whole tool exists to prevent. A matrix
full of green that means "we tested nothing" is worse than a crash, because it reads as a result.

**Fix:** treat zero scored points as its own outcome rather than folding it into `correct`. Either
return `None` agreement with a `no_data` outcome, or refuse to score and let the runner surface it.
The UI needs a corresponding cell state so it cannot render as a pass.

---

## 2. DuckDB point cache is keyed on grid length alone

**Where:** [duckdb_spatial.py:97](../src/spatial_db_analyzer/systems/duckdb_spatial.py#L97)

```python
if self._grid_size == len(lons):
    return connection
```

`DuckDbSpatialSystem` is instantiated once at module level in `ALL_SYSTEMS`, so the instance — and
its `points` table — outlives a single run. A second grid with the same number of points silently
reuses the first grid's coordinates.

**Confirmed by running:** two `evaluate()` calls with the grids swapped both returned
`(True, False)`. The second call should have returned `(False, True)`.

**Why it matters here:** within one CLI invocation the grid is fixed, so today this is latent. It
stops being latent the moment anything runs two grids in one process — the grid-resolution sweep
that [03-phase-1-findings.md](03-phase-1-findings.md) recommends for Phase 2 is precisely that, and
it would produce plausible, wrong, quietly-cached numbers.

**Fix:** key the cache on the grid's identity, not its length — hash the coordinate arrays, or
carry a grid id through `evaluate()`. Alternatively drop the module-level singleton and build
systems per run, which removes the shared-state question entirely.

---

## 3. Empty `--polygons` crashes after the output file is written

**Where:** [cli.py:67](../src/spatial_db_analyzer/cli.py#L67)

`_parse_ids("")` returns `()`, which is not `None`, so the unknown-id guard sees a valid (empty)
selection and lets it through. The run produces a `ResultsFile` with no polygons, writes it, and
then `summary_table` calls `max()` over the empty `results.polygons`:

```
ValueError: max() iterable argument is empty
```

**Confirmed by running.** The output file was already written at that point, and the process exited
on a traceback rather than with the intended exit code 2.

**Why it matters here:** `--polygons ''` is an easy thing for a shell script to produce from an
unset variable. The damaging part is the ordering: `frontend/public/results.json` is overwritten
with an empty result set before the crash, so a scripted run can silently blank the committed
results.

**Fix:** treat an empty selection as an error in the same guard that catches unknown ids, and
validate before anything is written.

---

## 4. `_bbox_covers` ignores an antimeridian-crossing *expected* box

**Where:** [runner.py:109](../src/spatial_db_analyzer/runner.py#L109)

```python
# A library reporting west > east would mean an antimeridian-crossing box.
# None of the planar systems do that, so a straight comparison is enough.
return theirs.west <= expected.west and theirs.east >= expected.east
```

The comment reasons about the *library's* box, but the same wraparound applies to the *reference's*.
The reference bbox for `antimeridian` is `west=160, east=-160`, which wraps. A planar box of
`west=-160, east=160` — covering none of the band the polygon actually occupies — satisfies both
comparisons.

**Status:** currently masked by the latitude check (`-20.0` vs `-21.17`), so no cell in the
committed results is wrong today. It is a correct-by-accident, and the accident is one polygon's
latitude extent.

**Why it matters here:** the bbox column is a secondary signal for exactly the failure the
antimeridian polygon is meant to demonstrate. Phase 2 adds engines whose bbox behaviour is the
interesting part.

**Fix:** detect `expected.west > expected.east` and require the library's box to cover both
longitude runs (or to wrap the same way). Rewrite the comment to name which box it is reasoning
about.

---

## 5. Resize listener added on every render, never removed

**Where:** [detail.ts:173](../frontend/src/detail.ts#L173)

`window.addEventListener("resize", onResize)` runs each time the detail view renders, and nothing
removes it. Every hashchange adds another listener, and each one closes over `views` — retaining
two detached canvases and their projection buffers.

**Why it matters here:** the detail view is the part of the UI a user clicks through repeatedly,
one cell after another. The retained buffers scale with the grid size, so this gets worse as the
grid gets denser.

**Fix:** return a teardown from the render and call it on the next navigation, or register the
listener once at module scope against the current view.

---

## 6. `classifyPoints` ignores the outcome

**Where:** [detail.ts:65](../frontend/src/detail.ts#L65)

Classification starts from the reference and then overlays the library's false positives and
negatives. For a `rejected` or `error` combination there are no such indices, so every
reference-inside point is painted **"Correct: inside"** — for a library that never answered at all.

**Reproduce:** `#/combo/north_pole/shapely/raw`.

**Why it matters here:** `rejected` is the honest failure mode that
[03-phase-1-findings.md](03-phase-1-findings.md) argues is the *good* case, and the detail view
currently renders it as a flawless pass. That inverts the story the tool is trying to tell, on the
screen where a reader looks closest.

**Fix:** branch on the outcome. When the library did not answer, draw the reference classes in a
neutral "no answer" style and label the map as showing ground truth only.

---

## 7. `setScene` resets the rotation

**Where:** [map.ts:97](../frontend/src/map.ts#L97)

```ts
this.rotation = [-scene.center[0], -scene.center[1]];
```

Recentring is right when the scene is a different polygon, but `setScene` is also how the
"show skipped" checkbox re-renders. Ticking it snaps a globe the user has dragged back to the
polygon centroid.

**Fix:** only recentre when the polygon changes — compare the incoming scene's identity, or give
the checkbox a path that updates the point classes without replacing the scene.

---

## Checked and cleared

Examined closely and found correct; recorded so the next review does not repeat the work.

- **The spherical math.** `_crossings` matches S2's simple-crossing test. The area calculation is
  Van Oosterom–Strackee including the `+4π` branch. `angular_distance_to_edges` has the right
  endpoint fallback for the degenerate projection.
- **`_longitude_span` omits the closing edge.** Harmless: a ring that encircles the globe always
  has a pole inside it and hits the early return before the span is used.
- **The Fibonacci grid wrap**, `parseRoute` / `formatRoute`, and the d3 winding conversions.

## Suggested order

1–3 are real bugs with confirmed reproductions; 1 and 3 can both corrupt a committed results file
and are small fixes. 4 is latent but sits on the antimeridian case, so it is worth closing before
Phase 2 adds engines. 6 is the highest-value UI fix — it misrepresents the central finding. 5 and 7
are quality issues that can ride along with 6, since all three are in the detail view.

---

## Resolution

All seven are fixed. `scripts/lint.sh` and `scripts/test.sh` pass, and
`frontend/public/results.json` has been regenerated.

**Not one scored value changed.** Comparing the regenerated file against the committed one across
all 60 combinations, every `outcome`, `agreement_pct`, `bbox`, `bbox_covers_expected`,
`area_error_pct` and index list is identical, as are the point grid and the reference. The matrix
in [03-phase-1-findings.md](03-phase-1-findings.md) still stands exactly as written. The only
difference in the file is `schema_version`.

### What each fix did

1. **Zero scored points** — a new `no_data` outcome, distinct from `correct`. `_score` returns it
   before computing agreement, and the reference control column reports it too, so an empty run
   cannot show a row of perfect scores. The CLI renders it as `NONE`; the front end gives it a
   neutral swatch and a legend entry that says plainly that it is not agreement.
2. **DuckDB point cache** — keyed on a blake2b digest of the coordinates instead of the array
   length, so two different grids of the same size can no longer share a table.
3. **Empty `--polygons`** — `_parse_ids` now raises `argparse.ArgumentTypeError`, which fails at
   parse time, before anything is written. It covers `--systems` for free. `summary_table`'s
   `max()` also got a `default=0` so the function is total.
4. **`bbox_covers`** — splits both boxes into non-wrapping longitude segments and requires every
   part of the expected range to sit inside one of the library's. The comment now names which box
   it is reasoning about. Renamed from `_bbox_covers` to make it directly testable under pyright
   strict.
5. **Resize listener** — one module-level listener over an `activeViews` array, plus an exported
   `disposeDetail()` that `main.ts` calls before rendering any view.
6. **`classifyPoints`** — branches on `outcomeHasAnswer(result.outcome)`. A rejected or errored
   combination paints two new neutral classes, `referenceInside` and `referenceOutside`, labeled
   "the library gave no answer", and the maps carry a note saying the points are ground truth
   only. The legend now lists only the classes actually present, so it cannot claim "Correct:
   inside" on a map where nothing was answered.
7. **`setScene`** — the "show skipped" toggle calls a new `redraw()` instead. `setScene` keeps its
   recentering, which is right for an actual scene change.

### One more, found by the fix for 1

Making empty grids a supported path exposed that `DuckDbSpatialSystem` raises on one:
`executemany` rejects an empty parameter list, so the run reported `error` rather than `no_data`.
The insert is now skipped when there are no rows.

### Schema version bumped to 2

Adding `no_data` changes the set of values a consumer can see, which is what `schema_version`
documents. The practical benefit is that a stale `results.json` — one generated before this fix,
which could contain exactly the bogus `correct 100%` cells finding 1 describes — now fails to load
with "Re-run scripts/generate_results.sh" instead of rendering them.

### Tests added

- `test_a_run_with_nothing_to_score_is_not_reported_as_correct` — runs the empty region from the
  review and pins the two cells that used to read 100%.
- `test_an_empty_selection_is_rejected_before_anything_is_written` — asserts exit code 2 *and*
  that no file was created.
- `test_duckdb_does_not_reuse_a_stale_point_grid` — the two-swapped-grids repro.
- `test_a_bbox_check_handles_an_expected_box_that_crosses_the_antimeridian` — latitudes held equal
  on purpose, so only the longitudes can decide it.
- `frontend/src/detail.test.ts` — a rejected combination classifies as reference-only, an
  answering one still scores against the reference.

### Verified in the browser

Checked against the dev server with headless Chrome. Findings 5 and 7 were checked by reverting
the fix, re-running, and confirming the check reports the original bug — so these are
discriminating tests, not just green results.

| Check | With the fix | With the old code |
|---|---|---|
| Summary legend carries a "No data" outcome | present | n/a (outcome did not exist) |
| Rejected combination (`#/combo/north_pole/shapely/raw`) | note shown; points read "Inside/Outside, by the reference — the library gave no answer"; legend lists only those two classes | every reference-inside point read "Correct: inside" |
| Answering combination (`#/combo/wide/shapely/raw`) | legend lists correct/false-positive/false-negative only, no reference classes | unchanged |
| Drag the globe, toggle skipped on and off | canvas pixel-identical to the dragged state; did not return to center | returned to the centered view |
| Six navigations between combinations | 1 window `resize` listener throughout | grew 1 → 6, and stayed at 6 after returning to the summary |

One cosmetic note, not a regression: the outcomes legend on the summary is a four-column grid, so
the fifth entry now starts a second row and "No data" wraps its label. It was already wrapping
"Accepted but wrong" the same way before this change.
