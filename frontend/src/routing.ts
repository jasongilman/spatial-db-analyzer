/**
 * Hash routing: `#/` for the summary, `#/combo/{polygon}/{system}/{variant}`
 * for one combination's detail view.
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

/** Any route the app understands. */
export type Route = SummaryRoute | ComboRoute;

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

  const [prefix, polygonId, systemId, variantId] = parts;
  if (
    prefix === "combo" &&
    polygonId !== undefined &&
    systemId !== undefined &&
    variantId !== undefined &&
    parts.length === 4
  ) {
    return {
      kind: "combo",
      polygonId: decodeURIComponent(polygonId),
      systemId: decodeURIComponent(systemId),
      variantId: decodeURIComponent(variantId),
    };
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
  if (route.kind === "summary") {
    return "#/";
  }
  const parts = [route.polygonId, route.systemId, route.variantId].map(encodeURIComponent);
  return `#/combo/${parts.join("/")}`;
}
