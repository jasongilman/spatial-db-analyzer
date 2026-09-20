/**
 * The summary matrix: polygons as rows, system/variant as columns.
 *
 * This is the page that has to land the whole point of the project in one
 * screen, so it leads with an explainer and a legend before the grid.
 */

import { select } from "d3-selection";
import type { BaseType, Selection } from "d3-selection";

import { findResult, formatAgreement } from "./data";
import type { Column, Dataset } from "./data";
import { formatRoute } from "./routing";
import { OUTCOME_DESCRIPTIONS, OUTCOME_LABELS, outcomeStyle } from "./palette";
import type { Outcome } from "./palette";

const OUTCOME_ORDER: Outcome[] = ["correct", "accepted_but_wrong", "rejected", "error"];

/**
 * Render the summary view into a container.
 *
 * @param container - Where to render.
 * @param dataset - The loaded results.
 */
export function renderSummary(container: HTMLElement, dataset: Dataset): void {
  container.textContent = "";
  const root = select(container).append("div").attr("class", "summary");

  renderIntro(root.append("header").attr("class", "intro"), dataset);
  renderLegend(root.append("div").attr("class", "legend"));
  renderMatrix(root.append("div").attr("class", "matrix-wrapper"), dataset);
}

/**
 * A d3 selection of one element, with no bound datum.
 *
 * Generic over the element type because d3's Selection is invariant in it, so a
 * `Selection<HTMLDivElement, ...>` is not assignable to a
 * `Selection<HTMLElement, ...>`.
 */
type Block<E extends BaseType> = Selection<E, unknown, null, undefined>;

function renderIntro<E extends BaseType>(intro: Block<E>, dataset: Dataset): void {
  intro.append("h1").text("How spatial libraries handle geodetic polygons");

  intro
    .append("p")
    .text(
      "A geodetic polygon is a polygon on a sphere. Its edges are great-circle arcs, the " +
        "shortest path between two points on the Earth, not straight lines in longitude and " +
        "latitude. That difference is invisible for a small box in the middle of a map, and " +
        "decisive for a polygon that contains a pole, crosses the 180-degree line, or is simply " +
        "wide.",
    );

  intro
    .append("p")
    .text(
      "A library that treats longitude and latitude as x and y on a flat plane is not broken by " +
        "its own rules; it just uses different rules. The cells below show where those rules " +
        "give a different answer from spherical geometry, and the detail view shows what each " +
        "common workaround costs.",
    );

  const grid = dataset.file.grid;
  intro
    .append("p")
    .attr("class", "meta")
    .text(
      `Each cell is one polygon tested against one library, over ${String(
        dataset.file.points.length,
      )} points spread evenly across the globe. Points within ${String(
        grid.edge_tolerance_deg ?? 0.25,
      )} degrees of a boundary are skipped, because behavior on the boundary is ambiguous.`,
    );
}

function renderLegend<E extends BaseType>(legend: Block<E>): void {
  legend.append("h2").text("Outcomes");

  const items = legend.append("ul").attr("class", "legend-items");
  for (const outcome of OUTCOME_ORDER) {
    const item = items.append("li");
    item
      .append("span")
      .attr("class", "swatch")
      .style("background-color", outcomeStyle(outcome).color);
    item.append("strong").text(OUTCOME_LABELS[outcome]);
    item.append("span").attr("class", "legend-text").text(OUTCOME_DESCRIPTIONS[outcome]);
  }
}

function columnLabel(column: Column): string {
  return `${column.system.name} — ${column.variant.name}`;
}

function renderMatrix<E extends BaseType>(wrapper: Block<E>, dataset: Dataset): void {
  const table = wrapper.append("table").attr("class", "matrix");

  const headerRow = table.append("thead").append("tr");
  headerRow.append("th").attr("class", "corner").text("Polygon");

  for (const column of dataset.columns) {
    const cell = headerRow
      .append("th")
      .attr("class", "column-head")
      .attr("title", `${columnLabel(column)}: ${column.variant.description}`);
    cell.append("span").attr("class", "system-name").text(column.system.name);
    cell.append("span").attr("class", "variant-name").text(column.variant.name);
    cell
      .append("span")
      .attr("class", `badge badge-${column.system.semantics}`)
      .text(column.system.semantics);
  }

  const body = table.append("tbody");
  for (const polygon of dataset.polygons) {
    const row = body.append("tr");
    row
      .append("th")
      .attr("class", "row-head")
      .attr("title", polygon.description)
      .text(polygon.name);

    for (const column of dataset.columns) {
      const result = findResult(dataset, polygon.id, column.system.id, column.variant.id);
      const cell = row.append("td").attr("class", "cell");

      if (result === undefined) {
        cell.attr("class", "cell cell-missing").text("—");
        continue;
      }

      const style = outcomeStyle(result.outcome);
      const link = cell
        .append("a")
        .attr("class", "cell-link")
        .attr(
          "href",
          formatRoute({
            kind: "combo",
            polygonId: polygon.id,
            systemId: column.system.id,
            variantId: column.variant.id,
          }),
        )
        .attr("title", `${polygon.name} — ${columnLabel(column)}: ${style.label}`)
        .style("background-color", style.color);

      link.append("span").attr("class", "cell-pct").text(formatAgreement(result.agreement_pct));
      link.append("span").attr("class", "cell-outcome").text(style.label);
    }
  }
}
