/**
 * The detail view for one combination: the maps, the points, and the tradeoffs.
 *
 * The side panel leads with the variant's description and tradeoffs, because
 * that is the actual lesson. The maps show where the disagreement is; the
 * tradeoffs say what it costs to make it go away.
 */

import { select } from "d3-selection";
import type { BaseType, Selection } from "d3-selection";

import { findResult, findVariant, formatArea, formatBBox, formatErrorPct } from "./data";
import type { Dataset } from "./data";
import { bboxOutline, ringCentroid, ringsOf, toD3Geometry, toDrawableSubmitted } from "./geo";
import type { D3Lines, Position } from "./geo";
import type { BBox } from "./generated/results";
import { layerHelp } from "./help";
import { MapView } from "./map";
import type { ClassifiedPoints, LayerId, Scene } from "./map";
import { LAYER_IDS, POINT_CLASS_ORDER } from "./map";
import {
  GEOMETRY_COLORS,
  OUTCOME_DESCRIPTIONS,
  POINT_COLORS,
  cellText,
  outcomeHasAnswer,
  outcomeStyle,
} from "./palette";
import type { Outcome, PointClass } from "./palette";
import { formatRoute } from "./routing";
import type { ComboRoute } from "./routing";
import { requireAt } from "./arrays";

type Block<E extends BaseType> = Selection<E, unknown, null, undefined>;

const LAYER_LABELS: Record<LayerId, string> = {
  truth: "The polygon as it really is (great-circle edges)",
  submitted: "What the library was handed, as the library sees it",
  libraryBBox: "Bounding box the library reported",
  expectedBBox: "Expected bounding box",
  correctInside: "Correct: inside",
  correctOutside: "Correct: outside",
  falsePositive: "False positive: called inside, is outside",
  falseNegative: "False negative: called outside, is inside",
  skipped: "Skipped: too close to an edge to score",
  referenceInside: "Inside, by the reference — the library gave no answer",
  referenceOutside: "Outside, by the reference — the library gave no answer",
};

const NO_ANSWER_NOTE =
  "This library never answered for this polygon, so there is nothing of its to show on the " +
  "maps. Turn on the grey reference entries below the maps to see where the points truly lie; " +
  "none of it is a mark for or against the library.";

/** The legend lists point classes in reading order, not the maps' drawing order. */
const LEGEND_POINT_ORDER: PointClass[] = [
  "correctInside",
  "correctOutside",
  "falsePositive",
  "falseNegative",
  "skipped",
  "referenceInside",
  "referenceOutside",
];

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
 * Which layers a combination's maps draw before the viewer changes anything.
 *
 * The bounding boxes and the skipped points start hidden, as extra detail. The
 * grey reference classes also start hidden: they only appear when the library
 * never answered, and any dot on a map reads as a measurement, so that case
 * shows no points until the viewer asks for them. Each render starts over from
 * these, rather than carrying the last combination's choices along.
 *
 * @returns A fresh visibility record.
 */
export function defaultVisibility(): Record<LayerId, boolean> {
  const hiddenByDefault = new Set<LayerId>([
    "libraryBBox",
    "expectedBBox",
    "skipped",
    "referenceInside",
    "referenceOutside",
  ]);
  return Object.fromEntries(
    LAYER_IDS.map((layer) => [layer, !hiddenByDefault.has(layer)]),
  ) as Record<LayerId, boolean>;
}

/**
 * Whether the maps draw any point at all.
 *
 * A class switched on counts only if some point has it: on a map the library
 * never answered, "Correct: inside" is on by default but there are none.
 *
 * @param visible - The current layer visibility.
 * @param classes - Each point's class code.
 * @returns True when at least one point is drawn.
 */
export function drawsAnyPoints(visible: Record<LayerId, boolean>, classes: Uint8Array): boolean {
  const present = new Set(classes);
  return POINT_CLASS_ORDER.some((pointClass, code) => visible[pointClass] && present.has(code));
}

/**
 * Outline a bounding box for the maps, if there is one with edges to draw.
 *
 * @param bbox - The box, or null when there is none.
 * @returns Its outline, or null when there is nothing to draw.
 */
function outlineOrNull(bbox: BBox | null | undefined): D3Lines | null {
  if (bbox === null || bbox === undefined) {
    return null;
  }
  const outline = bboxOutline(bbox);
  // A box covering the whole sphere has no edges.
  return outline.coordinates.length > 0 ? outline : null;
}

/**
 * The label shown over each map when the library never answered.
 *
 * @param systemName - The library's display name.
 * @param outcome - The combination's outcome.
 * @returns The label text.
 */
function notMeasuredLabel(systemName: string, outcome: Outcome): string {
  const what = outcome === "error" ? "raised an error" : "rejected this polygon";
  return `Not measured — ${systemName} ${what}`;
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
  const text = cellText(result.outcome, result.agreement_pct);
  summary
    .append("span")
    .attr("class", style.hatched ? "chip chip-outcome hatched" : "chip chip-outcome")
    .style("background-color", style.color)
    .style("color", style.textColor)
    .text([text.word, text.pct].filter((part) => part !== null).join(" · "));
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
    libraryBBox: outlineOrNull(result.bbox),
    expectedBBox: outlineOrNull(dataset.referenceByPolygon.get(route.polygonId)?.bbox),
    points,
    center,
    visible: defaultVisibility(),
  };

  const answered = outcomeHasAnswer(result.outcome);
  if (!answered) {
    maps.append("p").attr("class", "maps-note").text(NO_ANSWER_NOTE);
  }

  const views: MapView[] = [];
  for (const kind of ["orthographic", "equirectangular"] as const) {
    const figure = maps.append("figure").attr("class", `map map-${kind}`);
    figure
      .append("figcaption")
      .text(
        kind === "orthographic"
          ? "Globe (drag to rotate, scroll to zoom)"
          : "Equirectangular — a planar library's edges are straight lines here (scroll to zoom)",
      );
    const frame = figure.append("div").attr("class", "map-frame");
    const canvas = frame.append("canvas").node();
    if (!answered) {
      frame
        .append("div")
        .attr("class", "not-measured")
        .text(notMeasuredLabel(system.name, result.outcome));
    }
    const reset = frame
      .append("button")
      .attr("type", "button")
      .attr("class", "reset-view")
      .property("hidden", true)
      .text("Reset view");
    if (canvas !== null) {
      const view = new MapView(canvas, kind, (moved) => reset.property("hidden", !moved));
      reset.on("click", () => {
        view.resetView();
      });
      view.setScene(scene);
      views.push(view);
    }
  }

  // "Not measured" and a dot on the map contradict each other, so the label
  // goes whenever the viewer switches a point layer on.
  const overlays = maps.selectAll<HTMLDivElement, unknown>(".not-measured");
  const syncOverlays = (): void => {
    overlays.style("display", drawsAnyPoints(scene.visible, scene.points.classes) ? "none" : "");
  };
  syncOverlays();
  renderMapLegend(
    maps.append("div").attr("class", "map-legend"),
    scene,
    views,
    dataset.file.grid.edge_tolerance_deg ?? 0.25,
    syncOverlays,
  );

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
  toleranceDeg: number,
  onVisibilityChange: () => void,
): void {
  const toggle = (layer: LayerId): boolean => {
    scene.visible[layer] = !scene.visible[layer];
    for (const view of views) {
      // redraw, not setScene: the scene is the same object, and resetting the
      // view here would throw away the viewer's zoom and rotation.
      view.redraw();
    }
    onVisibilityChange();
    return scene.visible[layer];
  };

  // Only list what there is to draw. A legend entry for "Correct: inside" on a
  // map where the library never answered is exactly the claim to avoid.
  const geometryLayers: LayerId[] = ["truth"];
  if (scene.submitted !== null) {
    geometryLayers.push("submitted");
  }
  if (scene.libraryBBox !== null) {
    geometryLayers.push("libraryBBox");
  }
  if (scene.expectedBBox !== null) {
    geometryLayers.push("expectedBBox");
  }

  const present = new Set(scene.points.classes);
  const pointLayers = LEGEND_POINT_ORDER.filter((pointClass) =>
    present.has(POINT_CLASS_ORDER.indexOf(pointClass)),
  );

  for (const layers of [geometryLayers, pointLayers]) {
    const row = legend.append("div").attr("class", "legend-row");
    for (const layer of layers) {
      appendLegendEntry(row, layer, scene.visible[layer], layerHelp(layer, toleranceDeg), toggle);
    }
  }
}

function appendLegendEntry<E extends BaseType>(
  row: Block<E>,
  layer: LayerId,
  initiallyVisible: boolean,
  help: string,
  onToggle: (layer: LayerId) => boolean,
): void {
  const entry = row.append("span").attr("class", "legend-entry");

  const button = entry
    .append("button")
    .attr("type", "button")
    .attr("class", "legend-toggle")
    .attr("aria-pressed", String(initiallyVisible))
    .attr("title", "Show or hide on both maps");
  appendSwatch(button, layer);
  button.append("span").text(LAYER_LABELS[layer]);
  button.on("click", () => {
    button.attr("aria-pressed", String(onToggle(layer)));
  });

  // The native Popover API gives Escape and click-outside dismissal and focus
  // handling with no library.
  const popoverId = `help-${layer}`;
  const helpButton = entry
    .append("button")
    .attr("type", "button")
    .attr("class", "help-button")
    .attr("popovertarget", popoverId)
    .attr("aria-label", `About: ${LAYER_LABELS[layer]}`)
    .text("?");
  const popover = entry
    .append("div")
    .attr("id", popoverId)
    .attr("popover", "")
    .attr("class", "help-popover")
    .text(help);

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

function appendSwatch<E extends BaseType>(button: Block<E>, layer: LayerId): void {
  switch (layer) {
    case "truth":
      button.append("span").attr("class", "line line-truth");
      return;
    case "submitted":
      button
        .append("span")
        .attr("class", "line line-submitted")
        .style("border-top-color", GEOMETRY_COLORS.submitted);
      return;
    case "libraryBBox":
    case "expectedBBox":
      button
        .append("span")
        .attr("class", "line line-bbox")
        .style(
          "border-top-color",
          layer === "libraryBBox" ? GEOMETRY_COLORS.submitted : GEOMETRY_COLORS.truth,
        );
      return;
    case "falseNegative":
      // Drawn as a ring on the map, so its key is one too.
      button
        .append("span")
        .attr("class", "dot dot-ring")
        .style("border-color", POINT_COLORS[layer]);
      return;
    default:
      button.append("span").attr("class", "dot").style("background-color", POINT_COLORS[layer]);
  }
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

  // On a combination the library never answered, the rejection is the result,
  // so why it happened comes first.
  const answered = outcomeHasAnswer(result.outcome);
  if (!answered) {
    renderErrors(
      panel.append("div").attr("class", "side-rejection"),
      result.validation_errors,
      result.error_message,
    );
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

  if (answered) {
    renderErrors(panel, result.validation_errors, result.error_message);
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

function renderErrors<E extends BaseType>(
  panel: Block<E>,
  validationErrors: readonly string[],
  errorMessage: string | null,
): void {
  if (validationErrors.length > 0) {
    panel.append("h3").text("Validation errors");
    const list = panel.append("ul").attr("class", "errors");
    for (const message of validationErrors) {
      list.append("li").append("code").text(message);
    }
  }

  if (errorMessage !== null) {
    panel.append("h3").text("Error");
    panel.append("pre").attr("class", "errors").text(errorMessage);
  }
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
    link
      .append("span")
      .attr("class", style.hatched ? "dot hatched" : "dot")
      .style("background-color", style.color);
    link.append("span").text(`${column.system.name} — ${column.variant.name}`);
    link
      .append("span")
      .attr("class", "sibling-pct")
      .text(cellText(sibling.outcome, sibling.agreement_pct).pct ?? "—");
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
