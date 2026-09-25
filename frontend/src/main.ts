/**
 * Entry point: load the results, then render whichever view the hash names.
 */

import "./style.css";

import { loadResults } from "./data";
import type { Dataset } from "./data";
import { disposeDetail, renderDetail } from "./detail";
import { disposeFigures } from "./figures";
import { renderHowItWorks } from "./howItWorks";
import { renderLibraries } from "./libraries";
import { formatRoute, parseRoute } from "./routing";
import type { Route } from "./routing";
import { renderSummary } from "./summary";

/** The site's pages, in nav order. The detail view counts as part of Results. */
const NAV_ITEMS: { label: string; route: Route; owns: Route["kind"][] }[] = [
  { label: "Results", route: { kind: "summary" }, owns: ["summary", "combo"] },
  { label: "How it works", route: { kind: "how-it-works" }, owns: ["how-it-works"] },
  { label: "Libraries & fixes", route: { kind: "libraries" }, owns: ["libraries"] },
];

/**
 * Build the header with the nav bar, once, above the page content.
 *
 * @param app - The app's root element.
 * @returns The element each page renders into.
 */
function buildShell(app: HTMLElement): HTMLElement {
  app.textContent = "";
  const header = document.createElement("header");
  header.className = "site-header";

  const title = document.createElement("a");
  title.className = "site-title";
  title.href = formatRoute({ kind: "summary" });
  title.textContent = "Geodetic polygon checks";

  const nav = document.createElement("nav");
  nav.className = "site-nav";
  nav.setAttribute("aria-label", "Pages");
  for (const item of NAV_ITEMS) {
    const link = document.createElement("a");
    link.href = formatRoute(item.route);
    link.textContent = item.label;
    link.dataset.owns = item.owns.join(" ");
    nav.append(link);
  }

  header.append(title, nav);
  const page = document.createElement("main");
  app.append(header, page);
  return page;
}

function markCurrentPage(app: HTMLElement, route: Route): void {
  for (const link of app.querySelectorAll<HTMLAnchorElement>(".site-nav a")) {
    const owns = (link.dataset.owns ?? "").split(" ");
    if (owns.includes(route.kind)) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}

function render(app: HTMLElement, container: HTMLElement, dataset: Dataset): void {
  const route = parseRoute(window.location.hash);
  // Whatever we render next replaces the container's contents, so the maps the
  // previous view was holding are about to be detached.
  disposeDetail();
  disposeFigures();
  markCurrentPage(app, route);

  switch (route.kind) {
    case "combo":
      if (renderDetail(container, dataset, route)) {
        window.scrollTo(0, 0);
        return;
      }
      // An unknown combination falls back to the summary rather than a blank page.
      window.location.hash = formatRoute({ kind: "summary" });
      return;
    case "how-it-works":
      renderHowItWorks(container, dataset, route);
      return;
    case "libraries":
      renderLibraries(container, dataset, route);
      return;
    case "summary":
      renderSummary(container, dataset);
      window.scrollTo(0, 0);
      return;
  }
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
  const app = document.querySelector<HTMLDivElement>("#app");
  if (app === null) {
    return;
  }
  const container = buildShell(app);

  try {
    const dataset = await loadResults(import.meta.env.BASE_URL);
    render(app, container, dataset);
    window.addEventListener("hashchange", () => {
      render(app, container, dataset);
    });
  } catch (error) {
    renderError(container, error);
  }
}

void main();
