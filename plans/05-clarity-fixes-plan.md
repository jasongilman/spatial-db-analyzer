# Clarity Fixes Plan

> **Status: complete** (verified 2026-09-25 on `clarity-fixes`). Sections A, B and C are done,
> every exit criterion passes (`scripts/lint.sh`, `scripts/test.sh` with 116 pytest and 80 vitest,
> both generate scripts, `npm run build`), and Jason finished the manual verification. The one
> change from review, dropping the word "agree", is under
> [Implementation notes](#implementation-notes).
>
> This is the first of three plans that address Jason's post-Phase 1 review of the site. It is the small one. The others are
> [06-map-interaction-plan.md](06-map-interaction-plan.md) (zoom and an interactive legend) and
> [07-explanatory-pages-plan.md](07-explanatory-pages-plan.md) (an intro page and a page covering
> the libraries and their fixes). Do them in order: 06 rebuilds the legend that this plan
> recolors, and 07 reuses both.

This plan covers three review items that make the current screens mislead less. None of them adds
a feature.

| Review item | Section |
|---|---|
| 2. On a rejected polygon, the point grid looks like measurements | [A](#a-rejected-and-errored-combinations-show-no-measurements) |
| 3. "Accepted but wrong" is confusing | [B](#b-retire-accepted-but-wrong) |
| 8. False positive and false negative colors are too close | [C](#c-separate-the-colors) |

## Working this plan

* Read `CLAUDE.md` first. It has the commands (including the nvm `PATH` fix for `npm`), the
  conventions, and the Python ↔ TypeScript contract. Everything else this plan needs is named
  below by file and function; read those files rather than relying on this summary of them.
* Work on a branch, `clarity-fixes`, not on `main`.
* **Check the decisions below before writing code.** Each one is marked *Confirmed* or
  *Proposed*. If any is still *Proposed*, ask Jason about those first, then record his answer here.
* Stop and report at each checkpoint and at the end, with the manual verification list, because
  Jason signs off on each plan by checking it himself. Commit only when he asks.
* If this plan turns out to be wrong about the code, follow the code and note the discrepancy in
  the report.

## Decisions to confirm before starting

Each has a recommendation, which the implementation follows unless Jason says otherwise.

1. *Confirmed (Jason):* **Rejected maps hide the grid by default** (A). The alternative is to keep all-grey points.
   Recommended because any dot on a map reads as a measurement, whatever its color.
2. *Confirmed (Jason):* **No verdict word for this outcome** (B). The cell shows only the agreement
   percentage, on its color. The percentage, the non-blue color and the missing word "Correct"
   together say it isn't fully right. Words like "Incorrect" or "Partially correct" sound absolute
   next to a number like 99.4% (and "partially" is wrong at 0.0%, `spherely/default` on
   `both_poles`).
3. *Confirmed (Jason):* **Still rename the enum** (B), from `accepted_but_wrong` to `disagrees` (the library
   disagreed with the reference on at least one point). Nobody reads the enum on the site, but it
   appears in `results.json`, the CLI and the tests, and "accepted but wrong" is the phrasing being
   retired. This touches Python, so it needs a `schema_version` bump from 2 to 3.
4. *Confirmed (Jason, after comparing it on a test page):* **The section C palette as written.**

## A. Rejected and errored combinations show no measurements

*Status: done.*

**Today:** since the Phase 1 code-review fixes, `classifyPoints` in
[detail.ts](../frontend/src/detail.ts) already draws a rejected or errored combination's points as
`referenceInside`/`referenceOutside` (dark and light grey), with legend text saying the library
gave no answer. It still draws 5,000 dots, though, and at a glance that reads as a result. The
four rejected combinations today are `north_pole` and `south_pole` × `shapely/raw` and
`duckdb_spatial/raw`. Error combinations follow the same path, but no current combination
produces one.

**Change:**

* When `outcomeHasAnswer(result.outcome)` is false, each map draws the truth polygon and **no
  points**. Over the canvas, centered, it shows a label: "Not measured — {system name} rejected
  this polygon" (or "…raised an error" for `error`). This is an absolutely positioned HTML element
  over the `<figure>`, not text drawn on the canvas, so it stays sharp and selectable.
* The existing `NO_ANSWER_NOTE` paragraph stays above the maps.
* A checkbox in the legend, "Show the reference answer for these points", is **off by default**.
  Turning it on draws the grey reference classes that are drawn today. Its legend entries appear
  only while it is on. This reuses the mechanism of the existing "skipped" toggle.
* The side panel's validation-error list moves to the top of the panel on rejected combinations,
  because the rejection is the result and the reader should see why first.

**Tests (vitest):** `classifyPoints` is unchanged. Add a DOM-free helper,
`shouldDrawPoints(outcome, showReference)`, and test all 5 outcomes × both toggle states.

## B. Retire "accepted but wrong"

*Status: done. Cells and chips show the bare percentage ("99.4%"), without "agree"; see
[Implementation notes](#implementation-notes).*

**On the site: no label, just the number.**

* **Matrix cell:** only the percentage, formatted as "99.4% agree", with no outcome word.
  `correct` cells keep "Correct" with "100% agree", so the word appears only when it's fully true.
  `rejected`, `error` and `no_data` keep their words. They have no percentage, and their words
  describe what happened, not a grade. This needs `summary.ts` to stop appending `cell-outcome` for
  this one outcome.
* **Detail-page chip:** "99.4% agree", with no label before it.
* **Cell tooltip** (`title`): "{polygon} — {column}: 99.4% of scored points agree with the
  reference".
* **Summary legend:** the swatch still needs a key, so it gets a description rather than a verdict:
  "**Below 100%** — The library accepted the polygon, but disagreed with the reference on at least
  one point. The number is the share of scored points it got right." In `palette.ts`,
  `OUTCOME_LABELS` gets "Below 100%" for this outcome, used only by the legend. Cells and chips
  don't use it.

**In the code:** rename the enum from `accepted_but_wrong` to `disagrees`. Files:

* `src/spatial_db_analyzer/models.py`: the `Outcome` literal, plus `schema_version` to 3 (the
  default and the `Literal`).
* `src/spatial_db_analyzer/runner.py:90`, and the CLI's short label in `cli.py:81` (`WRONG` stays
  as is).
* `tests/spatial_db_analyzer_tests/test_systems.py:101,116`.
* `frontend/src/palette.ts`: the key, plus the legend label and description above.
* `frontend/src/data.ts`: accept only schema version 3.
* `frontend/src/{summary,palette.test,detail.test}.ts`.
* Then run `scripts/generate_types.sh` and `scripts/generate_results.sh`.
* `plans/01-design-decisions.md`, line 80: update the outcome list. Leave the Phase 1 plan and
  findings as they are, because they are historical records.

**Tests:** `palette.test.ts` asserts that cell text for this outcome contains no outcome word,
only the "% agree" string. Move the cell-text formatting into a pure function (for example,
`cellText(outcome, agreementPct)`) so it can be unit tested without the DOM.

## C. Separate the colors

*Status: done. The palette below is as implemented, and every pair passes the ΔE test with no
substitutions.*

The problem appears twice. Points use false positive `#D55E00` (vermillion) and false negative
`#E69F00` (orange). The matrix uses the same pair for "accepted but wrong" and "rejected".

**Palette (confirmed).** Keep Okabe-Ito where possible:

| Role | Now | Proposed | Notes |
|---|---|---|---|
| False positive (point) | `#D55E00` filled | `#D55E00` filled, 3px | unchanged |
| False negative (point) | `#E69F00` filled + stroke | `#CC79A7`, hollow ring, 2px stroke, white fill | the shape differs as well as the hue |
| Submitted geometry (line) | `#CC79A7` dashed | `#009E73` dashed | frees purple for false negatives |
| Below 100% (outcome) | `#D55E00` | `#D55E00` | unchanged; matches false positive |
| Rejected (outcome) | `#E69F00` | `#F0E442` with dark cell text | yellow, clearly not red |
| Error (outcome) | `#8B4513` | `#333333` | brown was also close to vermillion |
| No data (outcome) | `#767676` | `#BBBBBB` + diagonal hatch, dark text | the hatch reads as "nothing here" |

Cell text color becomes per outcome (`OUTCOME_TEXT_COLORS` in `palette.ts`), because white on
yellow is unreadable.

**Pin it with a test, not by eye.** `palette.test.ts` gets a small sRGB → CIELAB conversion and a
Machado 2009 (severity 1.0) simulation of deuteranopia and protanopia. It asserts:

* Among the point colors that can appear together (correct inside, false positive, false negative,
  and the submitted line): pairwise CIE76 ΔE ≥ 25 under normal vision and ≥ 15 under each
  simulation.
* Among the five outcome colors: the same thresholds.

If a proposed color fails, adjust it within Okabe-Ito, and report the substitution at the
checkpoint rather than lowering the threshold.

## Implementation notes

Where the code differed from this plan, or the plan left a choice open:

* `schema_version` 2 also appeared in `runner.py:322`, `test_cli.py`, `test_models.py`,
  `data.test.ts` and `detail.test.ts`. All of them now say 3.
* `results.json` also changes `duration_ms` on every result (timing), besides the rename,
  `schema_version` and `generated_at`. Nothing else differs.
* A `disagrees` percentage is truncated, not rounded, so a single wrong point can never read
  "100.0%". Exactly 100 shows as "100%".
* After review, Jason dropped the word "agree": cells and chips show just "99.4%" (and "100%"
  over "Correct"). The tooltip keeps its full sentence. A cell's percentage doesn't wrap.
* The "Not measured" label hides while "Show the reference answer" is on. The "Skipped" toggle
  shows only while points are drawn, because it has no effect otherwise.
* The submitted geometry's translucent fill in `map.ts` changed from purple to green as well,
  and `.line-submitted` takes its color from `GEOMETRY_COLORS` instead of hard-coding it.

## Exit criteria

*Status: all pass.*

```bash
scripts/lint.sh && scripts/test.sh
scripts/generate_types.sh && scripts/generate_results.sh   # the only results diff should be the rename, schema_version and generated_at
(cd frontend && npm run build)
```

## Manual verification (Jason)

*Status: done. Jason completed the visual review on 2026-09-25.*

With `(cd frontend && npm run dev)`:

1. `#/combo/north_pole/shapely/raw`: both maps show the polygon outline and the "Not measured"
   label, with no dots. Validation errors are at the top of the side panel. Ticking "Show the
   reference answer" brings back grey dots with "by the reference" legend entries.
2. `#/combo/both_poles/shapely/raw`: false positives (red-orange dots) and false negatives (purple
   rings) are distinguishable at a glance, including where they sit next to each other.
3. Summary matrix: the `north_pole` and `south_pole` raw cells are yellow "Rejected". The
   `both_poles` cells show only "0.9%" and "0.0%", with no outcome word. Nothing says
   "Accepted but wrong".
4. Optional: view the matrix through a color-blindness simulator (for example, the Chrome DevTools
   Rendering tab → "Emulate vision deficiencies" → deuteranopia).
