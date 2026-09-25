/**
 * Entry point: load the results, then render whichever view the hash names.
 */

import "./style.css";

import { loadResults } from "./data";
import type { Dataset } from "./data";
import { disposeDetail, renderDetail } from "./detail";
import { formatRoute, parseRoute } from "./routing";
import { renderSummary } from "./summary";

function render(container: HTMLElement, dataset: Dataset): void {
  const route = parseRoute(window.location.hash);
  // Whatever we render next replaces the container's contents, so the maps the
  // detail view was holding are about to be detached.
  disposeDetail();

  if (route.kind === "combo" && renderDetail(container, dataset, route)) {
    window.scrollTo(0, 0);
    return;
  }

  // An unknown combination falls back to the summary rather than a blank page.
  if (route.kind === "combo") {
    window.location.hash = formatRoute({ kind: "summary" });
    return;
  }

  renderSummary(container, dataset);
}

function renderError(container: HTMLElement, error: unknown): void {
  container.textContent = "";
  const message = error instanceof Error ? error.message : String(error);
  const box = document.createElement("div");
  box.className = "load-error";

  const heading = document.createElement("h1");
  heading.textContent = "Could not load the results";
  const detail = document.createElement("p");
  detail.textContent = message;
  const hint = document.createElement("p");
  hint.className = "muted";
  hint.textContent = "Run scripts/generate_results.sh, then reload this page.";

  box.append(heading, detail, hint);
  container.append(box);
}

async function main(): Promise<void> {
  const container = document.querySelector<HTMLDivElement>("#app");
  if (container === null) {
    return;
  }

  try {
    const dataset = await loadResults(import.meta.env.BASE_URL);
    render(container, dataset);
    window.addEventListener("hashchange", () => {
      render(container, dataset);
    });
  } catch (error) {
    renderError(container, error);
  }
}

void main();
