/**
 * Loads the precomputed results file and builds the lookups the views need.
 *
 * Everything here is pure apart from {@link loadResults}, so the lookup and
 * formatting logic can be unit tested without a DOM or a network.
 */

import type {
  BBox,
  CombinationResult,
  ReferenceResult,
  ResultsFile,
  SystemInfo,
  TestPolygon,
  Variant,
} from "./generated/results";

/** The schema version this front end understands. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** One column of the summary matrix: a system paired with one of its variants. */
export interface Column {
  system: SystemInfo;
  variant: Variant;
}

/** The results file plus the lookups built from it. */
export interface Dataset {
  file: ResultsFile;
  polygons: TestPolygon[];
  columns: Column[];
  polygonById: Map<string, TestPolygon>;
  systemById: Map<string, SystemInfo>;
  resultByKey: Map<string, CombinationResult>;
  referenceByPolygon: Map<string, ReferenceResult>;
}

/**
 * Build the key used to look one combination up.
 *
 * @param polygonId - The polygon's id.
 * @param systemId - The system's id.
 * @param variantId - The variant's id.
 * @returns The lookup key.
 */
export function comboKey(polygonId: string, systemId: string, variantId: string): string {
  return `${polygonId}\u0000${systemId}\u0000${variantId}`;
}

/**
 * Build the lookups the views need from a parsed results file.
 *
 * @param file - The parsed results file.
 * @returns The dataset.
 */
export function buildDataset(file: ResultsFile): Dataset {
  const columns: Column[] = [];
  for (const system of file.systems) {
    for (const variant of file.variants[system.id] ?? []) {
      columns.push({ system, variant });
    }
  }

  const resultByKey = new Map<string, CombinationResult>();
  for (const result of file.results) {
    resultByKey.set(comboKey(result.polygon_id, result.system_id, result.variant_id), result);
  }

  return {
    file,
    polygons: [...file.polygons],
    columns,
    polygonById: new Map(file.polygons.map((polygon) => [polygon.id, polygon])),
    systemById: new Map(file.systems.map((system) => [system.id, system])),
    resultByKey,
    referenceByPolygon: new Map(Object.entries(file.reference)),
  };
}

/**
 * Look one combination up.
 *
 * @param dataset - The dataset.
 * @param polygonId - The polygon's id.
 * @param systemId - The system's id.
 * @param variantId - The variant's id.
 * @returns The result, or undefined when the combination does not exist.
 */
export function findResult(
  dataset: Dataset,
  polygonId: string,
  systemId: string,
  variantId: string,
): CombinationResult | undefined {
  return dataset.resultByKey.get(comboKey(polygonId, systemId, variantId));
}

/**
 * Find a system's variant by id.
 *
 * @param file - The results file.
 * @param systemId - The system's id.
 * @param variantId - The variant's id.
 * @returns The variant, or undefined when it does not exist.
 */
export function findVariant(
  file: ResultsFile,
  systemId: string,
  variantId: string,
): Variant | undefined {
  return (file.variants[systemId] ?? []).find((variant) => variant.id === variantId);
}

/**
 * Format an agreement percentage for display.
 *
 * A missing percentage means the combination was never scored, which is not
 * the same as scoring zero, so it renders as an em dash rather than "0%".
 *
 * @param value - The percentage, or null when the combination was not scored.
 * @returns The formatted string.
 */
export function formatAgreement(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

/**
 * Format an area in square meters as millions of square kilometers.
 *
 * @param value - The area, or null when the library reports none.
 * @returns The formatted string.
 */
export function formatArea(value: number | null): string {
  if (value === null) {
    return "not reported";
  }
  const millionsOfSquareKm = value / 1e12;
  return `${millionsOfSquareKm.toFixed(2)} million km²`;
}

/**
 * Format a signed percentage error.
 *
 * @param value - The error, or null when there is nothing to compare.
 * @returns The formatted string.
 */
export function formatErrorPct(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * Format a bounding box, noting when it crosses the antimeridian.
 *
 * @param box - The box, or null when the library exposes none.
 * @returns The formatted string.
 */
export function formatBBox(box: BBox | null): string {
  if (box === null) {
    return "not reported";
  }
  const parts = [
    `W ${box.west.toFixed(2)}`,
    `S ${box.south.toFixed(2)}`,
    `E ${box.east.toFixed(2)}`,
    `N ${box.north.toFixed(2)}`,
  ].join(", ");
  return box.west > box.east ? `${parts} (crosses the antimeridian)` : parts;
}

/**
 * Fetch and validate the results file.
 *
 * @param baseUrl - The site's base URL, from `import.meta.env.BASE_URL`.
 * @returns The dataset.
 * @throws If the file cannot be fetched or its schema version is not supported.
 */
export async function loadResults(baseUrl: string): Promise<Dataset> {
  const response = await fetch(`${baseUrl}results.json`);
  if (!response.ok) {
    throw new Error(`Could not load results.json: ${String(response.status)}`);
  }

  const file = (await response.json()) as ResultsFile;
  if (file.schema_version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `results.json is schema version ${String(file.schema_version)}, ` +
        `but this page understands version ${String(SUPPORTED_SCHEMA_VERSION)}. ` +
        `Re-run scripts/generate_results.sh.`,
    );
  }
  return buildDataset(file);
}
