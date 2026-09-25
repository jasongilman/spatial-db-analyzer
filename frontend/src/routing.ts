/**
 * Hash routing: `#/` for the summary, `#/combo/{polygon}/{system}/{variant}`
 * for one combination's detail view, `#/how-it-works` for the intro page, and
 * `#/libraries` for the libraries page.
 */

/** The summary matrix. */
export interface SummaryRoute {
  kind: "summary";
}

/** One combination's detail view. */
export interface ComboRoute {
  kind: "combo";
  polygonId: string;
  systemId: string;
  variantId: string;
}

/**
 * The page explaining the concepts, optionally scrolled to one section.
 *
 * `#/how-it-works` or `#/how-it-works/{sectionId}`.
 */
export interface HowItWorksRoute {
  kind: "how-it-works";
  sectionId?: string;
}

/**
 * The page describing each library and workaround, optionally scrolled to one.
 *
 * `#/libraries`, `#/libraries/{systemId}`, or `#/libraries/fixes/{workaroundId}`.
 */
export interface LibrariesRoute {
  kind: "libraries";
  systemId?: string;
  workaroundId?: string;
}

/** Any route the app understands. */
export type Route = SummaryRoute | ComboRoute | HowItWorksRoute | LibrariesRoute;

/** The path segment that puts a libraries route on a workaround rather than a system. */
const FIXES_SEGMENT = "fixes";

/**
 * Parse a location hash into a route.
 *
 * Anything unrecognized falls back to the summary, so a stale or hand-edited
 * link lands somewhere useful rather than on a blank page.
 *
 * @param hash - The location hash, with or without its leading "#".
 * @returns The route.
 */
export function parseRoute(hash: string): Route {
  const trimmed = hash.replace(/^#/, "").replace(/^\//, "");
  const parts = trimmed.split("/").filter((part) => part.length > 0);
  const [prefix, first, second, third] = parts;

  if (
    prefix === "combo" &&
    first !== undefined &&
    second !== undefined &&
    third !== undefined &&
    parts.length === 4
  ) {
    return {
      kind: "combo",
      polygonId: decodeURIComponent(first),
      systemId: decodeURIComponent(second),
      variantId: decodeURIComponent(third),
    };
  }

  if (prefix === "how-it-works" && parts.length <= 2) {
    return first === undefined
      ? { kind: "how-it-works" }
      : { kind: "how-it-works", sectionId: decodeURIComponent(first) };
  }

  if (prefix === "libraries") {
    if (parts.length === 1) {
      return { kind: "libraries" };
    }
    if (first !== undefined && parts.length === 2) {
      return { kind: "libraries", systemId: decodeURIComponent(first) };
    }
    if (first === FIXES_SEGMENT && second !== undefined && parts.length === 3) {
      return { kind: "libraries", workaroundId: decodeURIComponent(second) };
    }
  }

  return { kind: "summary" };
}

/**
 * Build the hash for a route.
 *
 * @param route - The route to format.
 * @returns The hash, including its leading "#".
 */
export function formatRoute(route: Route): string {
  switch (route.kind) {
    case "summary":
      return "#/";
    case "combo": {
      const parts = [route.polygonId, route.systemId, route.variantId].map(encodeURIComponent);
      return `#/combo/${parts.join("/")}`;
    }
    case "how-it-works":
      return route.sectionId === undefined
        ? "#/how-it-works"
        : `#/how-it-works/${encodeURIComponent(route.sectionId)}`;
    case "libraries":
      if (route.workaroundId !== undefined) {
        return `#/libraries/${FIXES_SEGMENT}/${encodeURIComponent(route.workaroundId)}`;
      }
      return route.systemId === undefined
        ? "#/libraries"
        : `#/libraries/${encodeURIComponent(route.systemId)}`;
  }
}
