/**
 * The libraries page: one section per system, then the shared workarounds.
 *
 * Everything said about a particular library or variant comes from the results
 * file, where the adapters define it next to the code it describes. Only the
 * page's own framing is written here.
 */

import { select } from "d3-selection";
import type { BaseType } from "d3-selection";

import { findResult } from "./data";
import type { Column, Dataset } from "./data";
import { renderFigure } from "./figures";
import {
  densifyPlanar,
  ringStretch,
  ringsOf,
  toD3Geometry,
  toDrawableSubmitted,
  vertexCount,
} from "./geo";
import type { D3Lines, Position } from "./geo";
import type { SystemInfo, WorkaroundInfo } from "./generated/results";
import { appendHelp } from "./help";
import { scrollToSection } from "./howItWorks";
import { GEOMETRY_COLORS } from "./palette";
import { formatRoute } from "./routing";
import type { LibrariesRoute } from "./routing";
import { appendOutcomeCell } from "./summary";
import type { Block } from "./summary";
import { requireAt } from "./arrays";

/**
 * Render the libraries page into a container.
 *
 * @param container - Where to render.
 * @param dataset - The loaded results.
 * @param route - The route, which may name a system or workaround to scroll to.
 */
export function renderLibraries(
  container: HTMLElement,
  dataset: Dataset,
  route: LibrariesRoute,
): void {
  container.textContent = "";
  const root = select(container).append("div").attr("class", "explainer libraries");

  const header = root.append("header").attr("class", "intro");
  header.append("h1").text("Libraries & fixes");
  header
    .append("p")
    .text(
      "Every library gets the same polygons. For each one: what it is, where it falls short " +
        "with geodetic data, and each variant this site runs, with what it changes, what it " +
        "costs, and how it scored. The workarounds shared by several libraries are explained " +
        "once, at the end.",
    );

  const contents = header.append("nav").attr("class", "contents").append("ul");
  for (const system of dataset.file.systems) {
    contents
      .append("li")
      .append("a")
      .attr("href", formatRoute({ kind: "libraries", systemId: system.id }))
      .text(plain(system.name));
  }
  for (const workaround of dataset.file.workarounds) {
    contents
      .append("li")
      .append("a")
      .attr("href", formatRoute({ kind: "libraries", workaroundId: workaround.id }))
      .text(workaround.name);
  }

  for (const system of dataset.file.systems) {
    renderSystem(root, dataset, system);
  }

  root.append("h2").attr("class", "part-heading").text("Shared workarounds");
  for (const workaround of dataset.file.workarounds) {
    renderWorkaround(root, dataset, workaround);
  }

  let target: string | null = null;
  if (route.systemId !== undefined) {
    target = `library-${route.systemId}`;
  } else if (route.workaroundId !== undefined) {
    target = `fix-${route.workaroundId}`;
  }
  scrollToSection(target);
}

function renderSystem<E extends BaseType>(
  root: Block<E>,
  dataset: Dataset,
  system: SystemInfo,
): void {
  const element = root
    .append("section")
    .attr("class", "library")
    .attr("id", `library-${system.id}`);
  const heading = element.append("div").attr("class", "library-heading");
  appendWithCode(heading.append("h2"), system.name);
  heading.append("span").attr("class", "library-version").text(`version ${system.version}`);
  heading.append("span").attr("class", `badge badge-${system.semantics}`).text(system.semantics);
  heading
    .append("a")
    .attr("class", "library-docs")
    .attr("href", system.docs_url)
    .attr("target", "_blank")
    .attr("rel", "noopener")
    .text("Documentation ↗");

  appendWithCode(element.append("p"), system.notes);

  if (system.limitations.length > 0) {
    element.append("h3").text("Known limitations for geodetic data");
    const list = element.append("ul").attr("class", "limitations");
    for (const limitation of system.limitations) {
      appendWithCode(list.append("li"), limitation);
    }
  }

  element.append("h3").text("Variants");
  const workaroundById = new Map(dataset.file.workarounds.map((w) => [w.id, w]));
  for (const variant of dataset.file.variants[system.id] ?? []) {
    const block = element.append("div").attr("class", "variant");
    block.append("h4").text(variant.name);
    appendWithCode(block.append("p"), variant.description);

    const helps = block.append("p");
    helps.append("strong").text("How it helps: ");
    appendWithCode(helps.append("span"), variant.how_it_helps);

    if (variant.workaround_ids.length > 0) {
      const uses = block.append("p").attr("class", "variant-uses");
      uses.append("span").text("Applies: ");
      variant.workaround_ids.forEach((id, index) => {
        if (index > 0) {
          uses.append("span").text(", then ");
        }
        uses
          .append("a")
          .attr("href", formatRoute({ kind: "libraries", workaroundId: id }))
          .text(workaroundById.get(id)?.name ?? id);
      });
    }

    if (variant.tradeoffs.length > 0) {
      const list = block.append("ul").attr("class", "tradeoffs");
      for (const tradeoff of variant.tradeoffs) {
        appendWithCode(list.append("li"), tradeoff);
      }
    }

    renderOutcomeStrip(block, dataset, { system, variant });
  }
}

/**
 * Append text, rendering `backticked` spans as code.
 *
 * @param target - Where to append.
 * @param text - The text, with any code in backticks.
 */
function appendWithCode<E extends BaseType>(target: Block<E>, text: string): void {
  text.split("`").forEach((part, index) => {
    if (part.length === 0) {
      return;
    }
    if (index % 2 === 1) {
      target.append("code").text(part);
    } else {
      target.append("span").text(part);
    }
  });
}

/**
 * Text with its backticks dropped, for places that can't hold markup.
 *
 * @param text - The text.
 * @returns It without backticks.
 */
function plain(text: string): string {
  return text.replaceAll("`", "");
}

/** One row of outcome cells across every polygon, the same cells as the matrix column. */
function renderOutcomeStrip<E extends BaseType>(
  block: Block<E>,
  dataset: Dataset,
  column: Column,
): void {
  const wrapper = block.append("div").attr("class", "strip-wrapper");
  const table = wrapper.append("table").attr("class", "matrix strip");
  const headRow = table.append("thead").append("tr");
  for (const polygon of dataset.polygons) {
    const head = headRow.append("th").attr("class", "strip-head");
    head.append("span").text(polygon.name);
    appendHelp(
      head,
      `help-strip-${column.system.id}-${column.variant.id}-${polygon.id}`,
      `About: ${polygon.name}`,
      polygon.description,
    );
  }
  const row = table.append("tbody").append("tr");
  for (const polygon of dataset.polygons) {
    appendOutcomeCell(row.append("td"), dataset, polygon, column);
  }
}

function renderWorkaround<E extends BaseType>(
  root: Block<E>,
  dataset: Dataset,
  workaround: WorkaroundInfo,
): void {
  const element = root
    .append("section")
    .attr("class", "workaround explainer-section")
    .attr("id", `fix-${workaround.id}`);
  element.append("h2").text(workaround.name);
  const body = element.append("div").attr("class", "explainer-body");
  const text = body.append("div").attr("class", "explainer-text");
  const figures = body.append("div").attr("class", "explainer-figures");
  for (const paragraph of workaround.explanation.split("\n\n")) {
    appendWithCode(text.append("p"), paragraph);
  }

  const users = dataset.columns.filter((column) =>
    column.variant.workaround_ids.includes(workaround.id),
  );
  if (users.length > 0) {
    const list = text.append("p").attr("class", "variant-uses");
    list.append("span").text("Used by: ");
    users.forEach((column, index) => {
      if (index > 0) {
        list.append("span").text(", ");
      }
      list
        .append("a")
        .attr("href", formatRoute({ kind: "libraries", systemId: column.system.id }))
        .text(`${plain(column.system.name)} — ${column.variant.name}`);
    });
  }

  if (workaround.id === "densify") {
    renderDensifyFigure(text, figures, dataset);
  } else if (workaround.id === "antimeridian") {
    renderAntimeridianFigures(figures, dataset);
  }
}

/** The inputs to the densification figure, all taken from the results file. */
export interface DensifyFigure {
  /** The edge's two ends, as the polygon lists them. */
  ends: [Position, Position];
  /** The same edge after densifying, pulled out of the submitted ring. */
  densified: Position[];
  /** Vertices before and after densifying, across the whole polygon. */
  before: number;
  after: number;
}

/**
 * Pull the densification figure's data out of the results.
 *
 * Uses the top edge of `wide`, the third edge of its ring: at 160° of longitude
 * it bows furthest from the straight chord, so all three lines separate.
 *
 * @param dataset - The loaded results.
 * @returns The figure's data, or null when the run didn't include it.
 */
export function densifyFigure(dataset: Dataset): DensifyFigure | null {
  const polygon = dataset.polygonById.get("wide");
  const raw = findResult(dataset, "wide", "shapely", "raw");
  const densified = findResult(dataset, "wide", "shapely", "densified_fix");
  if (polygon === undefined || raw === undefined || densified === undefined) {
    return null;
  }
  const ring = polygon.polygon.coordinates[0];
  const ends: [Position, Position] = [requireAt(ring, 2), requireAt(ring, 3)];
  const densifiedRing = requireAt(ringsOf(densified.submitted_geometry), 0);
  return {
    ends,
    densified: ringStretch(densifiedRing, ends[0], ends[1]),
    before: vertexCount(raw.submitted_geometry),
    after: vertexCount(densified.submitted_geometry),
  };
}

function lines(...paths: Position[][]): D3Lines {
  return { type: "MultiLineString", coordinates: paths };
}

function renderDensifyFigure<E extends BaseType, F extends BaseType>(
  text: Block<E>,
  figures: Block<F>,
  dataset: Dataset,
): void {
  const data = densifyFigure(dataset);
  const polygon = dataset.polygonById.get("wide");
  if (data === null || polygon === undefined) {
    return;
  }
  text
    .append("p")
    .attr("class", "muted")
    .text(
      `On the “${polygon.name}” example, densifying at 1° takes the polygon from ${String(data.before)} ` +
        `vertices to ${String(data.after)}.`,
    );

  const [start, end] = data.ends;
  renderFigure(figures, {
    projection: "equirectangular",
    center: [0, 0],
    caption:
      `The top edge of the “${polygon.name}” example, from ${String(start[0])}° to ${String(end[0])}° at ` +
      `${String(start[1])}°N. Black: the true great-circle arc. Green, dashed: the single ` +
      "straight chord a planar library draws between the two corners. Blue dots: the vertices " +
      "densifying adds, which sit on the arc, joined by the short chords the library draws.",
    truth: toD3Geometry(polygon.polygon),
    layers: [],
    overlays: [
      // Wider than the densified line drawn over it, so the arc shows on both sides.
      { geometry: lines(data.ends), stroke: GEOMETRY_COLORS.truth, lineWidth: 4 },
      {
        geometry: lines(densifyPlanar(data.ends)),
        stroke: GEOMETRY_COLORS.submitted,
        dash: [5, 4],
        lineWidth: 2,
      },
      {
        geometry: lines(densifyPlanar(data.densified)),
        stroke: GEOMETRY_COLORS.alternate,
        lineWidth: 1,
      },
      {
        geometry: { type: "MultiPoint", coordinates: data.densified },
        stroke: "#FFFFFF",
        fill: GEOMETRY_COLORS.alternate,
        lineWidth: 1,
        radius: 3,
      },
    ],
    extent: { west: -90, south: 55, east: 90, north: 90 },
  });
}

function renderAntimeridianFigures<F extends BaseType>(figures: Block<F>, dataset: Dataset): void {
  const system = dataset.systemById.get("shapely");
  const polygon = dataset.polygonById.get("antimeridian");
  const raw = findResult(dataset, "antimeridian", "shapely", "raw");
  const fixed = findResult(dataset, "antimeridian", "shapely", "antimeridian_fix");
  if (system !== undefined && polygon !== undefined && raw !== undefined && fixed !== undefined) {
    const extent = { west: -180, south: -45, east: 180, north: 45 };
    renderFigure(figures, {
      projection: "equirectangular",
      center: [0, 0],
      caption:
        `Before: the “${polygon.name}” example as ${system.name} reads the raw ring (green, dashed), ` +
        "against the true box (black).",
      truth: toD3Geometry(polygon.polygon),
      submitted: toDrawableSubmitted(raw.submitted_geometry, system.semantics),
      layers: ["truth", "submitted"],
      extent,
    });
    const tints = [
      { stroke: GEOMETRY_COLORS.submitted, fill: "rgba(0, 158, 115, 0.25)" },
      { stroke: GEOMETRY_COLORS.alternate, fill: "rgba(0, 114, 178, 0.25)" },
    ];
    const parts = ringsOf(fixed.submitted_geometry).map((ring, index) => ({
      geometry: toDrawableSubmitted({ type: "Polygon", coordinates: [ring] }, system.semantics),
      ...requireAt(tints, index % tints.length),
    }));
    renderFigure(figures, {
      projection: "equirectangular",
      center: [0, 0],
      caption:
        `After: the fix splits it at ±180° into ${String(parts.length)} parts, one each side ` +
        "(green and blue), which a planar library reads correctly.",
      truth: toD3Geometry(polygon.polygon),
      layers: [],
      overlays: parts,
      extent,
    });
  }

  const pole = dataset.polygonById.get("north_pole");
  const poleFixed = findResult(dataset, "north_pole", "shapely", "antimeridian_fix");
  if (system !== undefined && pole !== undefined && poleFixed !== undefined) {
    renderFigure(figures, {
      projection: "equirectangular",
      center: [0, 0],
      caption:
        `The same fix on a polygon that contains a pole: the “${pole.name}” example, after the fix ` +
        "(green, dashed). The ring is closed along 90°N, so the cap becomes a band across the " +
        "top of the map. Its edges are still straight, so it takes in slivers just below the " +
        "true cap (black).",
      truth: toD3Geometry(pole.polygon),
      submitted: toDrawableSubmitted(poleFixed.submitted_geometry, system.semantics),
      layers: ["truth", "submitted"],
      extent: { west: -180, south: 30, east: 180, north: 90 },
    });
  }
}
