/**
 * The intro page: the concepts behind the matrix, each with a figure.
 *
 * The prose is about the site and the geometry, not about any one library, so
 * it lives here rather than in the results file. Every figure is drawn from the
 * results file; a figure whose data is missing (a filtered run) is left out
 * rather than faked.
 */

import { select } from "d3-selection";
import type { BaseType } from "d3-selection";

import { findResult } from "./data";
import type { Dataset } from "./data";
import { LAYER_LABELS, appendSwatch, classifyPoints } from "./detail";
import { renderFigure } from "./figures";
import {
  reversePolygon,
  ringCentroid,
  ringsOf,
  sphereFraction,
  toD3Geometry,
  toDrawableSubmitted,
} from "./geo";
import type { Position } from "./geo";
import type { TestPolygon } from "./generated/results";
import { layerHelp } from "./help";
import type { LayerId } from "./map";
import { requireAt } from "./arrays";
import { formatRoute } from "./routing";
import type { HowItWorksRoute } from "./routing";
import { renderOutcomeLegend } from "./summary";
import type { Block } from "./summary";

/** The layers the scoring section's color key explains, in reading order. */
const KEY_LAYERS: LayerId[] = [
  "truth",
  "submitted",
  "correctInside",
  "correctOutside",
  "falsePositive",
  "falseNegative",
  "skipped",
  "referenceInside",
  "referenceOutside",
];

/**
 * Render the intro page into a container.
 *
 * @param container - Where to render.
 * @param dataset - The loaded results.
 * @param route - The route, which may name a section to scroll to.
 */
export function renderHowItWorks(
  container: HTMLElement,
  dataset: Dataset,
  route: HowItWorksRoute,
): void {
  container.textContent = "";
  const root = select(container).append("div").attr("class", "explainer");

  const header = root.append("header").attr("class", "intro");
  header.append("h1").text("How it works");
  header
    .append("p")
    .text(
      "This site checks how spatial libraries handle geodetic polygons: polygons drawn on the " +
        "Earth as a sphere, rather than on a flat map. The sections below explain what makes " +
        "those polygons hard, how each result is scored, and what the colors mean.",
    );

  renderGreatCircles(
    section(root, "great-circles", "Great-circle edges, not straight lines"),
    dataset,
  );
  renderPoles(section(root, "poles", "A polygon can contain a pole"), dataset);
  renderAntimeridian(
    section(root, "antimeridian", "A polygon can cross the antimeridian"),
    dataset,
  );
  renderWinding(section(root, "winding", "Winding order says which side is inside"), dataset);
  renderPlanar(section(root, "planar", "Planar isn't broken, it's different"));
  renderScoring(section(root, "scoring", "How each combination is scored"), dataset);
  renderOutcomes(section(root, "outcomes", "What the outcomes mean"));

  scrollToSection(route.sectionId === undefined ? null : `how-${route.sectionId}`);
}

/**
 * Scroll to an element by id once layout settles, or to the top.
 *
 * @param elementId - The element to show, or null for the top of the page.
 */
export function scrollToSection(elementId: string | null): void {
  const target = elementId === null ? null : document.getElementById(elementId);
  if (target === null) {
    window.scrollTo(0, 0);
    return;
  }
  requestAnimationFrame(() => {
    target.scrollIntoView({ block: "start" });
  });
}

/** One page section: a heading, then text beside its figures. */
interface Section {
  text: Block<HTMLDivElement>;
  figures: Block<HTMLDivElement>;
}

function section<E extends BaseType>(root: Block<E>, id: string, title: string): Section {
  const element = root.append("section").attr("class", "explainer-section").attr("id", `how-${id}`);
  element.append("h2").text(title);
  const body = element.append("div").attr("class", "explainer-body");
  return {
    text: body.append("div").attr("class", "explainer-text"),
    figures: body.append("div").attr("class", "explainer-figures"),
  };
}

function paragraph(target: Block<HTMLDivElement>, text: string): void {
  target.append("p").text(text);
}

function centerOf(polygon: TestPolygon): Position {
  return ringCentroid(requireAt(ringsOf(polygon.polygon), 0));
}

function comboLink(
  target: Block<HTMLDivElement>,
  polygon: TestPolygon,
  systemId: string,
  variantId: string,
  label: string,
): void {
  target
    .append("p")
    .attr("class", "explainer-link")
    .append("a")
    .attr("href", formatRoute({ kind: "combo", polygonId: polygon.id, systemId, variantId }))
    .text(label);
}

function renderGreatCircles(section: Section, dataset: Dataset): void {
  paragraph(
    section.text,
    "Each edge of a geodetic polygon is a great-circle arc: the shortest path between two " +
      "points on the Earth. On a flat map in longitude and latitude, that arc bows toward the " +
      "nearer pole, and the longer the edge, the further it bows. For a small box the " +
      "difference is a sliver. For a polygon with long edges it changes the whole shape.",
  );
  paragraph(
    section.text,
    "A planar library joins the same corners with straight lines, so it builds a different " +
      "polygon. Every point between the two outlines gets the wrong answer.",
  );

  const polygon = dataset.polygonById.get("wide");
  const system = dataset.systemById.get("shapely");
  const result = findResult(dataset, "wide", "shapely", "raw");
  if (polygon === undefined || system === undefined || result === undefined) {
    return;
  }
  renderFigure(section.figures, {
    projection: "equirectangular",
    center: centerOf(polygon),
    caption:
      `The “${polygon.name}” example on the flat map. Black: the polygon as it really is, a crescent near ` +
      `the pole. Green, dashed: the rectangle ${system.name} builds from the same four ` +
      "corners. The orange dots (called inside, actually outside) and pink rings (called " +
      "outside, actually inside) are the points it gets wrong.",
    truth: toD3Geometry(polygon.polygon),
    submitted: toDrawableSubmitted(result.submitted_geometry, system.semantics),
    points: classifyPoints(dataset, {
      kind: "combo",
      polygonId: "wide",
      systemId: "shapely",
      variantId: "raw",
    }),
    layers: ["truth", "submitted", "falsePositive", "falseNegative"],
    extent: { west: -100, south: 40, east: 100, north: 90 },
  });
  comboLink(section.text, polygon, "shapely", "raw", `See ${polygon.name} × ${system.name} →`);
}

function renderPoles(section: Section, dataset: Dataset): void {
  paragraph(
    section.text,
    "A ring that runs right around the world, like the one in the “Covers the North Pole” example, encloses " +
      "the cap of the Earth above it, pole included. On a globe that is an ordinary shape.",
  );
  paragraph(
    section.text,
    "A flat map stretches the pole into the whole top edge, so the same cap becomes a band " +
      "across the full width of the map, and the ring no longer closes around anything. A " +
      "planar library sees only the ring: a zigzag line from one side of the map to the " +
      "other. Both planar libraries here reject it as invalid.",
  );

  const polygon = dataset.polygonById.get("north_pole");
  if (polygon === undefined) {
    return;
  }
  const truth = toD3Geometry(polygon.polygon);
  renderFigure(section.figures, {
    projection: "orthographic",
    center: [0, 90],
    caption: `The “${polygon.name}” example on a globe centered on the pole: a cap.`,
    truth,
    layers: ["truth"],
  });
  renderFigure(section.figures, {
    projection: "equirectangular",
    center: [0, 0],
    caption: "The same polygon on the flat map: a band across the top.",
    truth,
    layers: ["truth"],
    extent: { west: -180, south: 0, east: 180, north: 90 },
  });
}

function renderAntimeridian(section: Section, dataset: Dataset): void {
  paragraph(
    section.text,
    "Longitude jumps from +180 to -180 at the antimeridian, the line down the middle of the " +
      "Pacific. The “Crosses the antimeridian” example is a box from 160°E to 160°W that straddles it: on " +
      "the sphere, its edge from 160 to -160 is a short hop of 40° east.",
  );
  paragraph(
    section.text,
    "A planar library reads the same numbers as a trip 320° west across the whole map. It " +
      "builds a band around the world with a hole where the box should be, which is the " +
      "opposite of what was meant.",
  );

  const polygon = dataset.polygonById.get("antimeridian");
  const system = dataset.systemById.get("shapely");
  const result = findResult(dataset, "antimeridian", "shapely", "raw");
  if (polygon === undefined || system === undefined || result === undefined) {
    return;
  }
  renderFigure(section.figures, {
    projection: "equirectangular",
    center: [0, 0],
    caption:
      `The “${polygon.name}” example on the flat map. Black: the box as it really is, split by the map's ` +
      `edges. Green, dashed: what ${system.name} builds from the same corners, covering the ` +
      "other 320° of longitude.",
    truth: toD3Geometry(polygon.polygon),
    submitted: toDrawableSubmitted(result.submitted_geometry, system.semantics),
    layers: ["truth", "submitted"],
    extent: { west: -180, south: -45, east: 180, north: 45 },
  });
  comboLink(section.text, polygon, "shapely", "raw", `See ${polygon.name} × ${system.name} →`);
}

/**
 * The areas behind the winding figure, as shares of the globe.
 *
 * @param polygon - The polygon, wound as GeoJSON says.
 * @returns The share it covers as written, and the share of its complement.
 */
export function windingShares(polygon: TestPolygon): { asWritten: number; reversed: number } {
  return {
    asWritten: sphereFraction(toD3Geometry(polygon.polygon)),
    reversed: sphereFraction(toD3Geometry(reversePolygon(polygon.polygon))),
  };
}

function percent(fraction: number): string {
  return `${String(Math.round(fraction * 100))}%`;
}

function renderWinding(section: Section, dataset: Dataset): void {
  const polygon = dataset.polygonById.get("both_poles");
  const shares = polygon === undefined ? null : windingShares(polygon);

  paragraph(
    section.text,
    "Any ring on a sphere splits it into two regions, and the ring alone doesn't say which " +
      "one is the polygon. GeoJSON (RFC 7946) settles it with winding order: walk the ring in " +
      "order and the interior is on your left, so an exterior ring runs counter-clockwise " +
      "around what it encloses.",
  );
  paragraph(
    section.text,
    "The “Contains both poles” example is wound so that its interior is everything outside a box from " +
      `150°W to 80°W${shares === null ? "" : `: ${percent(shares.asWritten)} of the globe`}, ` +
      "both poles included. A library that ignores winding has to guess which side was meant. " +
      "spherely's default guesses the smaller side, which is the box " +
      `${shares === null ? "" : `(${percent(shares.reversed)}) `}and exactly wrong.`,
  );

  if (polygon === undefined || shares === null) {
    return;
  }
  const center = centerOf(polygon);
  renderFigure(section.figures, {
    projection: "orthographic",
    center,
    caption: `As written, by RFC 7946: everything but the box, ${percent(shares.asWritten)} of the globe.`,
    truth: toD3Geometry(polygon.polygon),
    layers: ["truth"],
  });
  renderFigure(section.figures, {
    projection: "orthographic",
    center,
    caption: `The smaller side, as spherely's default reads it: the box, ${percent(shares.reversed)}.`,
    truth: toD3Geometry(reversePolygon(polygon.polygon)),
    layers: ["truth"],
  });
  comboLink(
    section.text,
    polygon,
    "spherely",
    "default",
    `See ${polygon.name} × spherely default →`,
  );
}

function renderPlanar(section: Section): void {
  paragraph(
    section.text,
    "A library that treats longitude and latitude as x and y on a flat plane isn't broken by " +
      "its own rules. It uses different rules: straight edges, no wraparound at ±180°, and no " +
      "poles. For data that really is flat, such as a projected city map, those are the right " +
      "rules.",
  );
  paragraph(
    section.text,
    "This site measures every library against spherical rules, because that is what " +
      "longitude and latitude on the Earth mean. A planar library's wrong answers here are the " +
      "cost of using it on the wrong kind of data, not bugs, and the workarounds on the " +
      "libraries page are what people do to close the gap.",
  );
  section.text
    .append("p")
    .attr("class", "explainer-link")
    .append("a")
    .attr("href", formatRoute({ kind: "libraries" }))
    .text("Libraries & fixes →");
}

function renderScoring(section: Section, dataset: Dataset): void {
  const tolerance = dataset.file.grid.edge_tolerance_deg ?? 0.25;
  paragraph(
    section.text,
    `Each polygon is tested at ${String(dataset.file.points.length)} points spread evenly over ` +
      "the globe on a Fibonacci spiral, so every region gets about the same number. The right " +
      "answer for each point comes from this project's own spherical implementation, which " +
      "counts crossings of great-circle edges. It never comes from a library under test, and " +
      "the test suite checks it against spherely at every point.",
  );
  paragraph(
    section.text,
    `Points within ${String(tolerance)}° of an edge are skipped, because on the boundary ` +
      "“inside” is ambiguous. A combination's percentage is the share of the remaining points " +
      "where the library agrees with the reference. Only containment counts: area and bounding " +
      "box are shown on the detail view but never change the outcome.",
  );

  const key = section.text.append("ul").attr("class", "color-key");
  for (const layer of KEY_LAYERS) {
    const item = key.append("li");
    appendSwatch(item.append("span").attr("class", "color-key-swatch"), layer);
    const words = item.append("span");
    words.append("strong").text(LAYER_LABELS[layer]);
    words.append("span").text(` ${layerHelp(layer, tolerance)}`);
  }

  const polygon = dataset.polygonById.get("wide");
  const system = dataset.systemById.get("shapely");
  const result = findResult(dataset, "wide", "shapely", "raw");
  if (polygon === undefined || system === undefined || result === undefined) {
    return;
  }
  renderFigure(section.figures, {
    projection: "orthographic",
    center: centerOf(polygon),
    caption: `${polygon.name} × ${system.name}, raw input, with every scored and skipped point.`,
    truth: toD3Geometry(polygon.polygon),
    submitted: toDrawableSubmitted(result.submitted_geometry, system.semantics),
    points: classifyPoints(dataset, {
      kind: "combo",
      polygonId: "wide",
      systemId: "shapely",
      variantId: "raw",
    }),
    layers: [
      "truth",
      "submitted",
      "correctInside",
      "correctOutside",
      "falsePositive",
      "falseNegative",
      "skipped",
    ],
  });
}

function renderOutcomes(section: Section): void {
  paragraph(
    section.text,
    "Each cell of the results matrix gets one of these outcomes. Its color is the outcome, and " +
      "a cell that scored points also shows its percentage.",
  );
  renderOutcomeLegend(section.text.append("div").attr("class", "legend"));
}
