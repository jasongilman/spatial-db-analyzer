/**
 * The detail view for one combination: the maps, the points, and the tradeoffs.
 *
 * The side panel leads with the variant's description and tradeoffs, because
 * that is the actual lesson. The maps show where the disagreement is; the
 * tradeoffs say what it costs to make it go away.
 */

import { select } from "d3-selection";
import type { BaseType, Selection } from "d3-selection";

import {
  findResult,
  findVariant,
  formatAgreement,
  formatArea,
  formatBBox,
  formatErrorPct,
} from "./data";
import type { Dataset } from "./data";
import { ringCentroid, ringsOf, toD3Geometry, toDrawableSubmitted } from "./geo";
import type { Position } from "./geo";
import { MapView } from "./map";
import type { ClassifiedPoints, Scene } from "./map";
import { POINT_CLASS_ORDER } from "./map";
import { OUTCOME_DESCRIPTIONS, POINT_COLORS, outcomeHasAnswer, outcomeStyle } from "./palette";
import type { PointClass } from "./palette";
import { formatRoute } from "./routing";
import type { ComboRoute } from "./routing";
import { requireAt } from "./arrays";

type Block<E extends BaseType> = Selection<E, unknown, null, undefined>;

const POINT_LABELS: Record<PointClass, string> = {
  correctInside: "Correct: inside",
  correctOutside: "Correct: outside",
  falsePositive: "False positive: called inside, is outside",
  falseNegative: "False negative: called outside, is inside",
  skipped: "Skipped: too close to an edge to score",
  referenceInside: "Inside, by the reference — the library gave no answer",
  referenceOutside: "Outside, by the reference — the library gave no answer",
};

const NO_ANSWER_NOTE =
  "This library never answered for this polygon, so the points below are ground truth only. " +
  "None of them is a mark for or against the library.";

/**
 * The maps the detail view currently owns.
 *
 * Module scope, with a single resize listener over it, because the view is
 * re-rendered on every navigation: registering a listener per render would
 * leak one closure — and two detached canvases — per click.
 */
let activeViews: MapView[] = [];
let resizeListening = false;

function resizeActiveViews(): void {
  for (const view of activeViews) {
    view.resize();
  }
}

/**
 * Release the maps the detail view was holding.
 *
 * Call before rendering any other view, so the resize listener stops retaining
 * canvases that are no longer on the page.
 */
export function disposeDetail(): void {
  activeViews = [];
}

/**
 * Classify every grid point for drawing.
 *
 * @param dataset - The loaded results.
 * @param route - Which combination is being shown.
 * @returns Parallel arrays of coordinates and class codes.
 */
export function classifyPoints(dataset: Dataset, route: ComboRoute): ClassifiedPoints {
  const points = dataset.file.points;
  const reference = dataset.referenceByPolygon.get(route.polygonId);
  const result = findResult(dataset, route.polygonId, route.systemId, route.variantId);
  // A rejected or errored library never said anything about these points, so
  // "correct" is not available to describe them: they are drawn as ground
  // truth in a neutral style instead.
  const answered = result !== undefined && outcomeHasAnswer(result.outcome);

  const lons = new Float64Array(points.length);
  const lats = new Float64Array(points.length);
  const classes = new Uint8Array(points.length);

  for (let index = 0; index < points.length; index += 1) {
    const [lon, lat] = requireAt(points, index);
    lons[index] = lon;
    lats[index] = lat;
  }

  const codeOf = (name: PointClass): number => POINT_CLASS_ORDER.indexOf(name);
  classes.fill(codeOf(answered ? "correctOutside" : "referenceOutside"));

  for (const index of reference?.inside_indices ?? []) {
    classes[index] = codeOf(answered ? "correctInside" : "referenceInside");
  }
  for (const index of reference?.skipped_indices ?? []) {
    classes[index] = codeOf("skipped");
  }
  if (answered) {
    for (const index of result.false_positive_indices) {
      classes[index] = codeOf("falsePositive");
    }
    for (const index of result.false_negative_indices) {
      classes[index] = codeOf("falseNegative");
    }
  }

  return { lons, lats, classes };
}

/**
 * Render the detail view into a container.
 *
 * @param container - Where to render.
 * @param dataset - The loaded results.
 * @param route - Which combination to show.
 * @returns True when the combination exists and was rendered.
 */
export function renderDetail(container: HTMLElement, dataset: Dataset, route: ComboRoute): boolean {
  const polygon = dataset.polygonById.get(route.polygonId);
  const system = dataset.systemById.get(route.systemId);
  const variant = findVariant(dataset.file, route.systemId, route.variantId);
  const result = findResult(dataset, route.polygonId, route.systemId, route.variantId);

  if (
    polygon === undefined ||
    system === undefined ||
    variant === undefined ||
    result === undefined
  ) {
    return false;
  }

  container.textContent = "";
  const root = select(container).append("div").attr("class", "detail");

  const style = outcomeStyle(result.outcome);
  const header = root.append("header").attr("class", "detail-header");
  header
    .append("a")
    .attr("class", "back-link")
    .attr("href", formatRoute({ kind: "summary" }))
    .text("← All results");
  header.append("h1").text(polygon.name);
  header.append("p").attr("class", "polygon-description").text(polygon.description);

  const summary = header.append("div").attr("class", "detail-summary");
  summary.append("span").attr("class", "chip").text(system.name);
  summary.append("span").attr("class", "chip").text(variant.name);
  summary.append("span").attr("class", `chip badge-${system.semantics}`).text(system.semantics);
  summary
    .append("span")
    .attr("class", "chip chip-outcome")
    .style("background-color", style.color)
    .text(`${style.label} · ${formatAgreement(result.agreement_pct)}`);
  summary.append("span").attr("class", "outcome-note").text(OUTCOME_DESCRIPTIONS[result.outcome]);

  const layout = root.append("div").attr("class", "detail-layout");
  const maps = layout.append("div").attr("class", "maps");
  renderSidePanel(layout.append("aside").attr("class", "side-panel"), dataset, route);

  const points = classifyPoints(dataset, route);
  const ring = requireAt(ringsOf(polygon.polygon), 0);
  const center: Position = ringCentroid(ring);

  const scene: Scene = {
    truth: toD3Geometry(polygon.polygon),
    submitted: result.accepted
      ? toDrawableSubmitted(result.submitted_geometry, system.semantics)
      : null,
    points,
    center,
    showSkipped: false,
  };

  if (!outcomeHasAnswer(result.outcome)) {
    maps.append("p").attr("class", "maps-note").text(NO_ANSWER_NOTE);
  }

  const views: MapView[] = [];
  for (const kind of ["orthographic", "equirectangular"] as const) {
    const figure = maps.append("figure").attr("class", `map map-${kind}`);
    figure
      .append("figcaption")
      .text(
        kind === "orthographic"
          ? "Globe (drag to rotate)"
          : "Equirectangular — a planar library's edges are straight lines here",
      );
    const canvas = figure.append("canvas").node();
    if (canvas !== null) {
      const view = new MapView(canvas, kind);
      view.setScene(scene);
      views.push(view);
    }
  }

  renderMapLegend(maps.append("div").attr("class", "map-legend"), scene, views);

  activeViews = views;
  if (!resizeListening) {
    window.addEventListener("resize", resizeActiveViews);
    resizeListening = true;
  }
  // Re-render once after layout settles, so the canvases pick up their real size.
  requestAnimationFrame(resizeActiveViews);

  return true;
}

function renderMapLegend<E extends BaseType>(
  legend: Block<E>,
  scene: Scene,
  views: MapView[],
): void {
  const geometry = legend.append("div").attr("class", "legend-row");
  const truth = geometry.append("span").attr("class", "legend-item");
  truth.append("span").attr("class", "line line-truth");
  truth.append("span").text("The polygon as it really is (great-circle edges)");

  if (scene.submitted !== null) {
    const submitted = geometry.append("span").attr("class", "legend-item");
    submitted.append("span").attr("class", "line line-submitted");
    submitted.append("span").text("What the library was handed, as the library sees it");
  }

  // Only label what is actually drawn. A legend entry for "Correct: inside" on
  // a map where the library never answered is exactly the claim to avoid.
  const present = new Set(scene.points.classes);
  const pointRow = legend.append("div").attr("class", "legend-row");
  for (const [code, pointClass] of POINT_CLASS_ORDER.entries()) {
    if (pointClass === "skipped" || !present.has(code)) {
      continue;
    }
    const item = pointRow.append("span").attr("class", "legend-item");
    item.append("span").attr("class", "dot").style("background-color", POINT_COLORS[pointClass]);
    item.append("span").text(POINT_LABELS[pointClass]);
  }

  if (!present.has(POINT_CLASS_ORDER.indexOf("skipped"))) {
    return;
  }

  const toggle = legend.append("label").attr("class", "toggle");
  toggle
    .append("input")
    .attr("type", "checkbox")
    .on("change", (event: Event) => {
      const input = event.currentTarget;
      if (input instanceof HTMLInputElement) {
        scene.showSkipped = input.checked;
        for (const view of views) {
          // redraw, not setScene: the scene is the same object, and recentering
          // here would snap a globe the viewer had dragged back to the start.
          view.redraw();
        }
      }
    });
  toggle.append("span").text(POINT_LABELS.skipped);
}

function renderSidePanel<E extends BaseType>(
  panel: Block<E>,
  dataset: Dataset,
  route: ComboRoute,
): void {
  const variant = findVariant(dataset.file, route.systemId, route.variantId);
  const system = dataset.systemById.get(route.systemId);
  const result = findResult(dataset, route.polygonId, route.systemId, route.variantId);
  const reference = dataset.referenceByPolygon.get(route.polygonId);
  if (variant === undefined || system === undefined || result === undefined) {
    return;
  }

  panel.append("h2").text("What this variant does");
  panel.append("p").text(variant.description);

  if (variant.tradeoffs.length > 0) {
    panel.append("h3").text("Tradeoffs");
    const list = panel.append("ul").attr("class", "tradeoffs");
    for (const tradeoff of variant.tradeoffs) {
      list.append("li").text(tradeoff);
    }
  }

  panel.append("h3").text("About this library");
  panel.append("p").attr("class", "muted").text(system.notes);

  if (result.validation_errors.length > 0) {
    panel.append("h3").text("Validation errors");
    const list = panel.append("ul").attr("class", "errors");
    for (const message of result.validation_errors) {
      list.append("li").append("code").text(message);
    }
  }

  if (result.error_message !== null) {
    panel.append("h3").text("Error");
    panel.append("pre").attr("class", "errors").text(result.error_message);
  }

  panel.append("h3").text("Area");
  const areaRows: [string, string][] = [
    ["Library", formatArea(result.area_m2)],
    ["Reference", formatArea(reference?.area_m2 ?? null)],
    ["Difference", formatErrorPct(result.area_error_pct)],
  ];
  appendTable(panel, areaRows);

  panel.append("h3").text("Bounding box");
  const bboxRows: [string, string][] = [
    ["Library", formatBBox(result.bbox)],
    ["Expected", reference?.bbox == null ? "not computed" : formatBBox(reference.bbox)],
    [
      "Covers expected",
      result.bbox_covers_expected === null ? "—" : result.bbox_covers_expected ? "yes" : "no",
    ],
  ];
  appendTable(panel, bboxRows);

  renderSiblingLinks(panel, dataset, route);
}

function renderSiblingLinks<E extends BaseType>(
  panel: Block<E>,
  dataset: Dataset,
  route: ComboRoute,
): void {
  panel.append("h3").text("Same polygon, other libraries");
  const list = panel.append("ul").attr("class", "siblings");

  for (const column of dataset.columns) {
    const sibling = findResult(dataset, route.polygonId, column.system.id, column.variant.id);
    if (sibling === undefined) {
      continue;
    }
    const current = column.system.id === route.systemId && column.variant.id === route.variantId;
    const item = list.append("li").attr("class", current ? "current" : null);
    const style = outcomeStyle(sibling.outcome);

    const link = item.append("a").attr(
      "href",
      formatRoute({
        kind: "combo",
        polygonId: route.polygonId,
        systemId: column.system.id,
        variantId: column.variant.id,
      }),
    );
    link.append("span").attr("class", "dot").style("background-color", style.color);
    link.append("span").text(`${column.system.name} — ${column.variant.name}`);
    link.append("span").attr("class", "sibling-pct").text(formatAgreement(sibling.agreement_pct));
  }
}

function appendTable<E extends BaseType>(panel: Block<E>, rows: [string, string][]): void {
  const table = panel.append("table").attr("class", "facts");
  for (const [label, value] of rows) {
    const row = table.append("tr");
    row.append("th").text(label);
    row.append("td").text(value);
  }
}
