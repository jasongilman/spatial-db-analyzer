# Misc Follow-ups Plan: Rejected Geometry, Point Hovers, Colors, Deployment

> **Status: implemented, awaiting Jason's verification.** The last plan. It follows [05](05-clarity-fixes-plan.md),
> [06](06-map-interaction-plan.md) and [07](07-explanatory-pages-plan.md), and builds on 06's map
> renderer and legend and 05's palette.

| Item | Section |
|---|---|
| 1. Rejected combinations that still say `accepted: true` | [A](#a-built-but-invalid-combinations) |
| 2. Hovering over a point shows information about it | [B](#b-point-hovers) |
| 3. A more pleasing color palette | [C](#c-colors) |
| 4. Deploy to GitHub Pages | [D](#d-github-pages) |

A is small and changes only text and tests. B and C both touch `map.ts` and `palette.ts`, so B
goes first and C then recolors whatever B added. D goes last, so the first public version has
everything else in it.

There is **one checkpoint**, in C: Jason picks a palette from a comparison page before any color
changes.

## Working this plan

* Read `CLAUDE.md` first. It has the commands (including the nvm `PATH` fix for `npm`), the
  conventions, and the Python ↔ TypeScript contract. Everything else this plan needs is named
  below by file and function; read those files rather than relying on this summary of them.
* Work on a branch, `misc-followups`, not on `main`.
* **Check the decisions below before writing code.** Each one is marked *Confirmed* or
  *Proposed*. If any is still *Proposed*, ask Jason about those first, then record his answer here.
* Stop and report at the checkpoint and at the end, with the manual verification list, because
  Jason signs off on each plan by checking it himself. Commit only when he asks.
* If this plan turns out to be wrong about the code, follow the code and note the discrepancy in
  the report.
* When starting, set the status line at the top to in progress. At the end, add an
  "Implementation notes" section, as plans 06 and 07 did, for anything that differs from this plan.

## Decisions to confirm before starting

1. *Confirmed (Jason):* **Built-but-invalid stays `rejected` and keeps `accepted: true`** (A). The data is
   truthful: the library did take the polygon, and drawing what it built is the best explanation
   of why its own validation failed. The fix is wording, not data: tighten `accepted`'s
   description and say on the detail page what happened. No new outcome.
2. *Confirmed (Jason):* **Hovers show on the two detail maps only** (B), not on the explanatory figures,
   which have no scored points.
3. *Confirmed (Jason), changed from the proposal:* **No distance to the nearest edge on the hover
   card** (B). Keep it simple: the card shows only what `results.json` already holds, with no
   port of `spherical.angular_distance_to_edges`.
4. *Confirmed (Jason):* **Hovering a point on one map highlights the same point on the other** (B).
5. *Confirmed (Jason):* **One palette for everyone, unless Jason prefers one that fails the color-blind check** (C).
   The default is a palette that passes **the color-blind check**, which already exists: the
   `color separation` tests in `palette.test.ts` (CIE76 ΔE ≥ 25 between colors in normal vision,
   ≥ 15 after the Machado 2009 deuteranopia and protanopia simulations). It rules out little. A second palette
   has real costs: figure captions name colors, color-blind readers land on the default because no
   browser setting reveals color blindness, and every color choice and test doubles. Only if Jason
   picks a candidate that fails those tests on the comparison page does the
   fallback apply: a "Colorblind-safe colors" toggle that keeps today's Okabe-Ito palette (see C).
6. *Confirmed (Jason):* **The palette covers the maps as well as the matrix** (C). The matrix and the maps
   share hues on purpose (`correct` = correct-inside, `disagrees` = false positive), so changing
   one without the other would break that link.
7. *Confirmed (Jason):* **Deploy with a GitHub Actions workflow on every push to `main`** (D), which runs
   the front-end lint and tests, builds, and publishes `frontend/dist`. It does not regenerate
   `results.json`; the committed file is what ships.
8. *Confirmed (Jason):* **The repository is public**, so Pages needs no paid plan. Pages is enabled in the repo.
9. *Confirmed (Jason):* **Shade "below 100%" cells by agreement** (C). Today 99.9% and 40% look
   the same. The chosen palette's `disagrees` hue becomes a ramp from light (near 100%) to strong
   (low agreement), and the text color flips where the background gets dark.

10. *Confirmed (Jason), at the C checkpoint:* **Keep the current Okabe-Ito palette.** It passes the
    color-blind check, so there is no toggle. C reduces to the agreement ramp (decision 9).

## A. Built-but-invalid combinations

**Seen in:** `#/combo/north_pole/shapely/raw`, found while verifying plan 06. The committed
`results.json` has four such combinations:

| Combination | Validation message |
|---|---|
| `north_pole` / `shapely` / `raw` | `Self-intersection[-115.27… 59.38…]` |
| `south_pole` / `shapely` / `raw` | `Self-intersection[115.27… -59.38…]` |
| `north_pole` / `duckdb_spatial` / `raw` | `ST_IsValid returned false (no reason available)` |
| `south_pole` / `duckdb_spatial` / `raw` | `ST_IsValid returned false (no reason available)` |

`runner._score` marks a combination `rejected` when the library refused the polygon (`accepted` is
false) **or** when the library reported validation errors on a polygon that `expected_valid` says
is valid. The second case keeps `accepted: true`. The detail page decides whether to draw the
submitted geometry from `accepted` (`renderDetail` in `detail.ts`), not from the outcome, so these
four show a submitted geometry and a library bounding box, and every other rejected combination
shows neither.

**Why keep it (decision 1).** The alternatives each lose something:

| Option | Against |
|---|---|
| Runner sets `accepted: false` | Throws away the shape that explains the rejection (the zigzag band below the ring). |
| Front end draws from the outcome | Same loss, on the display side. |
| Split the outcome into "refused" and "invalid" | A sixth matrix color, for four cells, in the same plan that is trying to calm the palette down. The distinction fits in text on the detail page. |

**Changes:**

* `models.py`: reword `accepted`'s description to "Whether the library built the polygon at all.
  It can be true on a rejected combination whose own validation reported errors." Then run
  `scripts/generate_types.sh` and `scripts/generate_results.sh`. The schema version does not
  change, because the shape doesn't.
* `detail.ts`: when `outcome` is `rejected` and `accepted` is true, replace the no-answer note with
  "{System} built this shape, but its own validation reported it invalid, so its answers were not
  scored. The library's view below is what it built." Keep the validation messages in the side
  panel as they are.
* `notMeasuredLabel` in `detail.ts` says "rejected this polygon" for both cases. Give the
  built-but-invalid case its own wording ("reported this polygon invalid").
* Tests: a pytest that `_score` returns `rejected` for an accepted polygon with validation errors
  and `expected_valid` true, and a vitest in `detail.test.ts` for the new note.

## B. Point hovers

Hovering over a test point on either detail map shows a small card about that point.

**The card:**

```
Point #2817 · 12.4°N, 71.9°W
Reference: inside
Shapely (raw): outside
False negative: the library said outside, the reference says inside.
```

* The first line is the index into `ResultsFile.points` and the coordinates, formatted like the
  rest of the page (N/S/E/W, one decimal).
* **Reference:** inside, outside, or "not scored: within {tolerance}° of an edge". No distance to
  the edge (decision 3).
* **Library:** its answer, derived from the reference and the false-positive/negative lists (the
  results file stores no raw answers, and doesn't need to). On a combination the library never
  answered, this line says "no answer ({system} rejected this polygon)".
* **Verdict:** one line, reusing the legend's label for the point's class, so the card and the
  legend never disagree.

**Picking.** `MapView.drawPoints` already fills `this.projected` with every visible point's screen
position each frame, and NaN for culled ones. On `pointermove`, scan that buffer for the nearest
point within 8 px whose class is currently visible. A linear scan of 5,000 points per move is well
under a millisecond, so no spatial index. Only visible classes are hoverable, so a hidden layer
can't produce a card.

* Hide the card while dragging or zooming, and on `pointerleave`.
* Draw a ring around the hovered point, in the ink color.
* Touch: a tap shows the card for the nearest point, and a tap on empty map hides it. A drag is
  never a tap.
* The card is an absolutely positioned element over the canvas, kept inside the map's bounds. It
  is not focusable and not announced; the side panel remains the accessible summary.
* Decision 4: `renderDetail` passes a shared `onHover(index | null)` to both `MapView`s, and each
  draws the ring for that index, so the same point lights up on both.

**Files:** `map.ts` (picking, ring, events), `detail.ts` (the card and the shared hover) and
`style.css`, with tests in `detail.test.ts` for the card text.

## C. Colors

The matrix colors are Okabe-Ito: blue for correct, vermillion for below 100%, bright yellow for
rejected, near-black for error, hatched grey for no data. They are safe for color-blind readers,
but the saturated blue and yellow side by side look harsh, and the whole page reads as a warning.

**Scope (decision 6):** everything in `palette.ts` (`OUTCOME_COLORS`, `OUTCOME_TEXT_COLORS`,
`POINT_COLORS`, `GEOMETRY_COLORS`) and the colors in `style.css`, including the `--planar` and
`--spherical` badge colors. Explanatory figures pick these up automatically because they read
the same constants.

**Checkpoint: a comparison page first.** Before changing any code, build a single static HTML page
that shows the same slice of the real matrix (every polygon, four or five columns) and one detail
map under each candidate palette, side by side, each also shown under a simulated deuteranopia and
protanopia filter (an SVG `feColorMatrix` with the same Machado matrices the tests use). Generate
it from the committed `results.json` with a throwaway script in the scratchpad; it is not part of
the site and is not committed. Publish it as a private artifact and ask Jason to pick. Add a
candidate or two of your own if they look better and pass the check. Candidates to start
from:

| Candidate | Correct | Below 100% | Rejected | Error | Notes |
|---|---|---|---|---|---|
| Current (Okabe-Ito) | `#0072B2` | `#D55E00` | `#F0E442` | `#333333` | For reference. |
| Teal and coral | `#2A9D8F` | `#E76F51` | `#E9C46A` | `#264653` | Softer, one harmonious family. Fails the check by a hair: correct vs no-data grey is ΔE 15.0 under protanopia. Darken the teal slightly. |
| Muted traffic light | `#4E9A6B` | `#C8553D` | `#E3A33B` | `#3E4A59` | The most familiar meaning. Passes the check, because the green and red differ in lightness, not just hue. |

The check results above were measured against the existing thresholds with no data at
`#BBBBBB`. Rerun them for any candidate that changes, and show pass/fail on the page. No data stays
light grey with its hatch in every candidate. Every candidate shows its "below
100%" cells shaded by agreement (decision 9), using the real percentages from the matrix.

After Jason picks:

* Update `palette.ts`. Point colors follow the outcome hues they're tied to; false negatives need a
  new partner hue that stays apart from both. Re-check `GEOMETRY_COLORS.submitted` and
  `alternate` against the new point colors.
* Add `disagreesColor(agreementPct)` to `palette.ts` for the ramp (decision 9), used by matrix
  cells and the detail page's outcome chip, and the matching text color. Test that the ends of
  the ramp stay apart from `correct` and `rejected`, and that the text stays readable along it.
  The legend swatch for "Below 100%" shows the ramp as a gradient.
* Only if the toggle is needed (decision 5): palettes become a `Record<PaletteId, Palette>`, a
  getter replaces the direct constant imports, the site header gets a "Colorblind-safe colors"
  switch, and changing it re-renders the current route. Store the choice in `localStorage`,
  wrapped in try/catch. Figure captions in `howItWorks.ts` and `libraries.ts` that name colors
  ("Green, dashed", "orange dots") are rewritten to describe the item instead ("the library's
  shape, dashed"), with a legend swatch beside the caption where one helps.
* Keep `palette.test.ts`'s separation tests passing (distinct colors, CIELAB distance for colors
  that appear together, readable text over each outcome). Add a contrast test for
  `OUTCOME_TEXT_COLORS` if the new backgrounds need different text colors.
* Update the "How it works" and "Libraries & fixes" figure captions wherever they name a color
  that changed (`howItWorks.ts` around line 170 and 248, `libraries.ts` around lines 322–400:
  "Green, dashed", "Blue dots", "orange dots", "pink rings").

## D. GitHub Pages

The site is static and `results.json` is committed, so deployment is a build and an upload.

* `frontend/vite.config.ts`: set `base: "./"`. Hash routing means every route loads the same
  `index.html`, so relative asset paths work at any Pages URL, including a later custom domain.
  `loadResults` already takes `import.meta.env.BASE_URL`.
* `frontend/index.html`: check that the favicon's `/favicon.svg` gets the base in the build output,
  and change it to `favicon.svg` if it doesn't.
* `.github/workflows/pages.yml`: on push to `main` and on manual dispatch, check out, set up Node
  24 with the npm cache, `npm ci`, `npm run lint`, `npx vitest run`, `npm run build`, then
  `actions/upload-pages-artifact` with `frontend/dist` and `actions/deploy-pages`. Use the
  `pages: write` and `id-token: write` permissions and one `concurrency` group so deploys don't
  overlap. Pin actions to major versions.
* The Python side is not run in CI (decision 7). Regenerating needs every library under test
  installed and changes the results, which should stay a deliberate, reviewed commit.
* Show `generated_at` in the site footer ("Results generated 2026-09-25"), so a visitor can tell
  how old the numbers are.
* The site will live at <https://jasongilman.github.io/spatial-db-analyzer/>.
* Docs: `CLAUDE.md` says "nothing is deployed"; replace that with where the site lives and how it
  deploys. `plans/01-design-decisions.md` says "no deployment yet" and lists AWS for Phase 2; add a
  line that Phase 1 is on GitHub Pages. Add the live URL to the README.
* Workflow files can't be tested locally. As the stand-in, build, copy `frontend/dist` into a
  scratch folder named `spatial-db-analyzer/`, serve that folder's parent with
  `python3 -m http.server`, open `/spatial-db-analyzer/`, and click through every route. That
  checks the subpath the way Pages will serve it; `vite preview` serves from the root and would
  hide a base-path bug. Verify the real deploy after merge.

## Exit criteria

* `scripts/lint.sh` passes (including shellcheck, if any script changes).
* `scripts/test.sh` passes, with the new tests from A, B and C.
* `npm run build` succeeds and the built site works when served under `/spatial-db-analyzer/`.
* The four built-but-invalid combinations show the new note, and every other rejected combination
  is unchanged.
* Every color in `palette.ts` and `style.css` comes from the palette Jason picked.

## Manual verification (Jason)

1. Open `#/combo/north_pole/shapely/raw`. The note says Shapely built the shape but reported it
   invalid. Open `#/combo/north_pole/duckdb_spatial/raw` and see the same. Open a combination
   that was refused outright and see no submitted geometry.
2. On any detail page, hover points on the globe and the flat map: the card appears, the point is
   ringed on both maps, and the card follows the legend's wording. Turn a layer off and check its
   points no longer respond. Drag the globe and check the card hides.
3. On a phone or with touch emulation, tap a point, then tap empty map.
4. Look over the summary matrix and two or three detail pages in the new palette. If there is a
   toggle, switch it, reload, and check the figure captions still make sense.
5. After merge, open <https://jasongilman.github.io/spatial-db-analyzer/>, follow a deep link such as `#/combo/wide/shapely/raw`, and
   check the footer date.

## Implementation notes

Differences from the plan above, and choices it left open.

* **Order.** D's code was built before C, while waiting on the palette pick. Nothing deploys until
  a push to `main`, so the first public version still has everything in it.
* **A.** `scripts/generate_results.sh` was not rerun. `results.json` holds no field descriptions,
  so the reworded `accepted` changes only `frontend/src/generated/results.ts`; a rerun would
  only have churned timings and `generated_at`. The built-but-invalid note replaces the no-answer
  note outright, so those four pages no longer point at the grey reference layers. The shared
  wording lives in `noAnswerReason` in `detail.ts`, used by the map label and the hover card.
* **B.** The card was reworded after Jason's first look: the "Reference / library / verdict"
  lines read as confusing, especially on the reference column. It is now two lines, the point
  and its coordinates, then plain sentences: "This point is inside the polygon. The library
  correctly marks it as inside." (or "wrongly marks it as outside", or "gave no answer: it
  rejected this polygon"). The reference column shows only the first sentence, since it defines
  the right answer. A skipped point says it is within the edge tolerance and not counted, since
  the results file keeps no answer for it. The card no longer reuses the legend labels. Picking is `nearestPoint` in `map.ts` (unit tested);
  `MapView` takes an optional fifth `onHover` argument, so the explanatory figures do no picking.
  Only mouse and pen hover; a touch shows the card on `pointerup` within 6 px of `pointerdown`.
  Switching any legend layer clears the hover.
* **C.** The palette stays Okabe-Ito (decision 10), so no figure captions changed. New in
  `palette.ts`: `disagreesColor`, `disagreesTextColor`, `disagreesGradient`, `readableTextColor`
  and `contrastRatio`. `outcomeStyle` takes an optional agreement, which is how the matrix cells,
  the libraries strip (through `appendOutcomeCell`), the detail chip and the sibling dots pick up
  the ramp. The ramp interpolates in CIELAB from `#FCC5A6` (vermillion at 36% over white) to
  `#D55E00`, positioned by the error share raised to the 0.4 power, so 99.4% and 96% look
  different. Near-black text beats white at every point on this ramp (4.5:1 at the strong end
  against white's 3.9:1), so the text never actually flips. `OUTCOME_TEXT_COLORS.disagrees`
  changed from white to near-black to match, and a test now holds every outcome's text at WCAG
  4.5:1 or better. The ramp's light end is closer to the no-data grey than the check allows
  (ΔE about 20 in normal vision); no data keeps its hatch, so that pair is not tested.
* **D.** Actions are pinned to the current majors: `checkout@v7`, `setup-node@v7`,
  `upload-pages-artifact@v5`, `deploy-pages@v5`. The favicon needed no change: with `base: "./"`,
  Vite writes it as `./favicon.svg`. The footer is hidden until results load, so a load error
  shows no stale date.

