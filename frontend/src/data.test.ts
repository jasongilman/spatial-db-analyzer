import { describe, expect, it } from "vitest";

import {
  buildDataset,
  comboKey,
  findResult,
  findVariant,
  formatArea,
  formatBBox,
  formatGeneratedDate,
  formatLonLat,
  formatErrorPct,
} from "./data";
import type { CombinationResult, ResultsFile } from "./generated/results";

const polygon = {
  type: "Polygon" as const,
  coordinates: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
  ] as [[number, number][]],
};

function result(overrides: Partial<CombinationResult> = {}): CombinationResult {
  return {
    polygon_id: "square",
    system_id: "shapely",
    variant_id: "raw",
    outcome: "correct",
    accepted: true,
    validation_errors: [],
    error_message: null,
    submitted_geometry: polygon,
    agreement_pct: 100,
    false_positive_indices: [],
    false_negative_indices: [],
    area_m2: null,
    area_error_pct: null,
    bbox: null,
    bbox_covers_expected: null,
    duration_ms: 1,
    ...overrides,
  };
}

const file: ResultsFile = {
  schema_version: 4,
  generated_at: "2026-09-20T12:00:00Z",
  grid: { point_count: 3, region: null, edge_tolerance_deg: 0.25 },
  points: [
    [0, 0],
    [5, 5],
    [90, 45],
  ],
  polygons: [
    {
      id: "square",
      name: "Square",
      description: "A box.",
      polygon,
      expected_valid: true,
    },
  ],
  reference: {
    square: { inside_indices: [1], skipped_indices: [0], area_m2: 1e12, bbox: null },
  },
  systems: [
    {
      id: "shapely",
      name: "Shapely (GEOS)",
      version: "2.1.2",
      semantics: "planar",
      notes: "Planar.",
      limitations: [],
      docs_url: "https://example.com/",
    },
    {
      id: "spherely",
      name: "spherely (S2)",
      version: "0.1.1",
      semantics: "spherical",
      notes: "Spherical.",
      limitations: [],
      docs_url: "https://example.com/",
    },
  ],
  variants: {
    shapely: [
      {
        id: "raw",
        name: "Raw",
        description: "As-is.",
        tradeoffs: ["Wrong."],
        how_it_helps: "",
        workaround_ids: [],
      },
    ],
    spherely: [
      {
        id: "oriented",
        name: "Oriented",
        description: "Honors winding.",
        tradeoffs: [],
        how_it_helps: "",
        workaround_ids: [],
      },
    ],
  },
  workarounds: [],
  results: [result(), result({ system_id: "spherely", variant_id: "oriented" })],
};

describe("buildDataset", () => {
  it("builds one column per system variant, in order", () => {
    const dataset = buildDataset(file);
    expect(dataset.columns.map((column) => `${column.system.id}/${column.variant.id}`)).toEqual([
      "shapely/raw",
      "spherely/oriented",
    ]);
  });

  it("indexes polygons, systems and reference results", () => {
    const dataset = buildDataset(file);
    expect(dataset.polygonById.get("square")?.name).toBe("Square");
    expect(dataset.systemById.get("spherely")?.semantics).toBe("spherical");
    expect(dataset.referenceByPolygon.get("square")?.inside_indices).toEqual([1]);
  });
});

describe("findResult", () => {
  it("finds an existing combination", () => {
    const dataset = buildDataset(file);
    expect(findResult(dataset, "square", "shapely", "raw")?.outcome).toBe("correct");
  });

  it("returns undefined for one that does not exist", () => {
    const dataset = buildDataset(file);
    expect(findResult(dataset, "square", "nope", "raw")).toBeUndefined();
  });
});

describe("comboKey", () => {
  it("cannot collide across differently-split ids", () => {
    expect(comboKey("a/b", "c", "d")).not.toBe(comboKey("a", "b/c", "d"));
  });
});

describe("findVariant", () => {
  it("finds a variant by id", () => {
    expect(findVariant(file, "shapely", "raw")?.name).toBe("Raw");
  });

  it("returns undefined for an unknown system", () => {
    expect(findVariant(file, "nope", "raw")).toBeUndefined();
  });
});

describe("formatArea", () => {
  it("says so when the library reports none", () => {
    expect(formatArea(null)).toBe("not reported");
  });

  it("renders square meters as millions of square kilometers", () => {
    expect(formatArea(5.1e14)).toBe("510.00 million km²");
  });
});

describe("formatErrorPct", () => {
  it("signs a positive difference", () => {
    expect(formatErrorPct(2.5)).toBe("+2.5%");
  });

  it("leaves a negative difference signed by the number itself", () => {
    expect(formatErrorPct(-2.5)).toBe("-2.5%");
  });

  it("renders a missing value as an em dash", () => {
    expect(formatErrorPct(null)).toBe("—");
  });
});

describe("formatBBox", () => {
  it("says so when the library reports none", () => {
    expect(formatBBox(null)).toBe("not reported");
  });

  it("formats an ordinary box", () => {
    expect(formatBBox({ west: -10, south: -5, east: 10, north: 5 })).toBe(
      "W -10.00, S -5.00, E 10.00, N 5.00",
    );
  });

  it("flags a box that crosses the antimeridian", () => {
    expect(formatBBox({ west: 160, south: -20, east: -160, north: 20 })).toContain(
      "crosses the antimeridian",
    );
  });
});

describe("formatLonLat", () => {
  it("gives latitude first, with hemisphere letters and one decimal", () => {
    expect(formatLonLat(-71.94, 12.41)).toBe("12.4°N, 71.9°W");
    expect(formatLonLat(115.27, -59.38)).toBe("59.4°S, 115.3°E");
  });
});

describe("formatGeneratedDate", () => {
  it("keeps the date of an ISO timestamp", () => {
    expect(formatGeneratedDate("2026-09-25T21:11:50.168410Z")).toBe("2026-09-25");
  });

  it("passes anything else through", () => {
    expect(formatGeneratedDate("yesterday")).toBe("yesterday");
  });
});
