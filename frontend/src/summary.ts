/**
 * The summary matrix: polygons as rows, system/variant as columns.
 *
 * This is the page that has to land the whole point of the project in one
 * screen, so it leads with an explainer and a legend before the grid.
 */

import { select } from "d3-selection";
import type { BaseType, Selection } from "d3-selection";

import { findResult } from "./data";
import type { Column, Dataset } from "./data";
import type { TestPolygon } from "./generated/results";
import { appendHelp } from "./help";
import { formatRoute } from "./routing";
import { OUTCOME_DESCRIPTIONS, OUTCOME_LABELS, cellText, outcomeStyle } from "./palette";
import type { Outcome } from "./palette";

const OUTCOME_ORDER: Outcome[] = ["correct", "disagrees", "rejected", "error", "no_data"];

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
export type Block<E extends BaseType> = Selection<E, unknown, null, undefined>;

function renderIntro<E extends BaseType>(intro: Block<E>, dataset: Dataset): void {
  intro.append("h1").text("How spatial libraries handle geodetic polygons");

  const lead = intro.append("p");
  lead
    .append("span")
    .text(
      "Polygons on a sphere have curved edges, can contain a pole, and can cross the 180-degree " +
        "line; each cell below shows how one library handles one such polygon. ",
    );
  lead
    .append("a")
    .attr("href", formatRoute({ kind: "how-it-works" }))
    .text("New here? Read how it works →");

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

/** The summary's compact key: a swatch and a label per outcome, and a link to the full legend. */
function renderLegend<E extends BaseType>(legend: Block<E>): void {
  const items = legend.append("ul").attr("class", "legend-swatches");
  for (const outcome of OUTCOME_ORDER) {
    const item = items.append("li").attr("title", OUTCOME_DESCRIPTIONS[outcome]);
    appendOutcomeSwatch(item, outcome);
    item.append("span").text(OUTCOME_LABELS[outcome]);
  }
  items
    .append("li")
    .append("a")
    .attr("href", formatRoute({ kind: "how-it-works", sectionId: "outcomes" }))
    .text("What the outcomes mean →");
}

function appendOutcomeSwatch<E extends BaseType>(parent: Block<E>, outcome: Outcome): void {
  const style = outcomeStyle(outcome);
  parent
    .append("span")
    .attr("class", style.hatched ? "swatch hatched" : "swatch")
    .style("background-color", style.color);
}

/**
 * The full outcome legend: every outcome with its swatch, label and meaning.
 *
 * @param legend - Where to render it.
 */
export function renderOutcomeLegend<E extends BaseType>(legend: Block<E>): void {
  const items = legend.append("ul").attr("class", "legend-items");
  for (const outcome of OUTCOME_ORDER) {
    const item = items.append("li");
    appendOutcomeSwatch(item, outcome);
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
    cell
      .append("a")
      .attr("class", "system-name")
      .attr("href", formatRoute({ kind: "libraries", systemId: column.system.id }))
      .attr("title", `How ${column.system.name} works and what each fix does`)
      .text(column.system.name);
    cell.append("span").attr("class", "variant-name").text(column.variant.name);
    cell
      .append("span")
      .attr("class", `badge badge-${column.system.semantics}`)
      .text(column.system.semantics);
  }

  const body = table.append("tbody");
  for (const polygon of dataset.polygons) {
    const row = body.append("tr");
    const head = row.append("th").attr("class", "row-head");
    head.append("span").text(polygon.name);
    appendHelp(head, `help-polygon-${polygon.id}`, `About: ${polygon.name}`, polygon.description);

    for (const column of dataset.columns) {
      appendOutcomeCell(row.append("td"), dataset, polygon, column);
    }
  }
}

/**
 * Fill one matrix cell: the outcome's color and text, linking to its detail view.
 *
 * @param cell - The table cell to fill.
 * @param dataset - The loaded results.
 * @param polygon - The row's polygon.
 * @param column - The column's system and variant.
 */
export function appendOutcomeCell<E extends BaseType>(
  cell: Block<E>,
  dataset: Dataset,
  polygon: TestPolygon,
  column: Column,
): void {
  const result = findResult(dataset, polygon.id, column.system.id, column.variant.id);
  cell.attr("class", "cell");

  if (result === undefined) {
    cell.attr("class", "cell cell-missing").text("—");
    return;
  }

  const style = outcomeStyle(result.outcome);
  const text = cellText(result.outcome, result.agreement_pct);
  const verdict =
    result.outcome === "disagrees"
      ? `${text.pct ?? "—"} of scored points agree with the reference`
      : style.label;
  const link = cell
    .append("a")
    .attr("class", style.hatched ? "cell-link hatched" : "cell-link")
    .attr(
      "href",
      formatRoute({
        kind: "combo",
        polygonId: polygon.id,
        systemId: column.system.id,
        variantId: column.variant.id,
      }),
    )
    .attr("title", `${polygon.name} — ${columnLabel(column)}: ${verdict}`)
    .style("background-color", style.color)
    .style("color", style.textColor);

  if (text.pct !== null) {
    link.append("span").attr("class", "cell-pct").text(text.pct);
  }
  if (text.word !== null) {
    link.append("span").attr("class", "cell-outcome").text(text.word);
  }
}
