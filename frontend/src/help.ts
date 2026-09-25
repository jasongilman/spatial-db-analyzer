/**
 * Plain-language explanations of each map layer.
 *
 * Kept apart from the legend that shows them so other pages can reuse the same
 * wording rather than drifting from it.
 */

import type { BaseType, Selection } from "d3-selection";

import type { LayerId } from "./map";

const REFERENCE_ONLY =
  "The library never answered, so this shows only where the point truly lies. It is not a " +
  "mark for or against the library.";

/**
 * What each layer shows. `{tolerance}` stands for the edge tolerance in
 * degrees; use {@link layerHelp} to fill it in.
 */
export const LAYER_HELP: Record<LayerId, string> = {
  truth:
    "The test polygon as it really is on a sphere: each edge is the shortest path (a " +
    "great-circle arc) between its two vertices. Every point is scored against this shape.",
  submitted:
    "What the library was actually given after any workaround, drawn the way the library " +
    "interprets it. A planar library draws straight lines in longitude/latitude, so on the " +
    "flat map its edges are straight.",
  libraryBBox:
    "The bounding box the library reported. A database can use a box like this to pre-filter " +
    "queries, so a box that misses part of the polygon causes wrong results even when the " +
    "containment test is right.",
  expectedBBox:
    "The true longitude/latitude bounding box of the spherical polygon. Great-circle edges bow " +
    "toward the poles, so it often extends past the vertices.",
  correctInside: "The library and the reference agree that this point is inside.",
  correctOutside: "The library and the reference agree that this point is outside.",
  falsePositive: "The library says inside; the reference says outside.",
  falseNegative: "The library says outside; the reference says inside.",
  skipped:
    "Within {tolerance}° of an edge. Boundary behavior is ambiguous, so these points aren't " +
    "scored.",
  referenceInside: `Inside the polygon. ${REFERENCE_ONLY}`,
  referenceOutside: `Outside the polygon. ${REFERENCE_ONLY}`,
};

/**
 * The help text for one layer, with the edge tolerance filled in.
 *
 * @param layer - The layer to explain.
 * @param toleranceDeg - The grid's edge tolerance, in degrees.
 * @returns The text to show.
 */
export function layerHelp(layer: LayerId, toleranceDeg: number): string {
  return LAYER_HELP[layer].replace("{tolerance}", String(toleranceDeg));
}

/**
 * Append a "?" button that opens a pop-up with help text.
 *
 * Used instead of a `title` tooltip, which browsers show late or not at all
 * and never on touch screens. The native Popover API gives Escape and
 * click-outside dismissal and focus handling with no library.
 *
 * @param parent - Where to append the button and its pop-up.
 * @param id - A page-unique id for the pop-up.
 * @param label - The button's accessible name.
 * @param text - The help text.
 */
export function appendHelp<E extends BaseType>(
  parent: Selection<E, unknown, null, undefined>,
  id: string,
  label: string,
  text: string,
): void {
  const helpButton = parent
    .append("button")
    .attr("type", "button")
    .attr("class", "help-button")
    .attr("popovertarget", id)
    .attr("aria-label", label)
    .text("?");
  const popover = parent
    .append("div")
    .attr("id", id)
    .attr("popover", "")
    .attr("class", "help-popover")
    .text(text);

  // CSS anchor positioning is not in every browser yet, so the pop-up is placed
  // under its button by hand: once before it shows, then again once its real
  // width is known, to keep it on screen.
  const place = (): void => {
    const anchor = helpButton.node();
    const element = popover.node();
    if (anchor === null || element === null) {
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const gutter = 8;
    const maxLeft = window.innerWidth - element.offsetWidth - gutter;
    const left = Math.max(gutter, Math.min(rect.left, maxLeft));
    element.style.top = `${String(rect.bottom + window.scrollY + 4)}px`;
    element.style.left = `${String(left + window.scrollX)}px`;
  };
  popover.on("beforetoggle", place).on("toggle", place);
}
