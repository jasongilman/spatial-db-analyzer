import { describe, expect, it } from "vitest";

import { buildDataset } from "./data";
import { classifyPoints, defaultVisibility, drawsAnyPoints } from "./detail";
import { POINT_CLASS_ORDER } from "./map";
import { requireAt } from "./arrays";
import type { CombinationResult, ResultsFile } from "./generated/results";
import type { PointClass } from "./palette";

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
    outcome: "rejected",
    accepted: false,
    validation_errors: ["Self-intersection"],
    error_message: null,
    submitted_geometry: polygon,
    agreement_pct: null,
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

// Point 0 is inside by the reference, point 1 outside, point 2 too close to score.
const file: ResultsFile = {
  schema_version: 4,
  generated_at: "2026-09-20T12:00:00Z",
  grid: { point_count: 3, region: null, edge_tolerance_deg: 0.25 },
  points: [
    [5, 5],
    [80, 40],
    [0, 5],
  ],
  polygons: [
    { id: "square", name: "Square", description: "A box.", polygon, expected_valid: true },
  ],
  reference: {
    square: { inside_indices: [0], skipped_indices: [2], area_m2: 1e12, bbox: null },
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
  ],
  variants: {
    shapely: [
      {
        id: "raw",
        name: "Raw",
        description: "As-is.",
        tradeoffs: [],
        how_it_helps: "",
        workaround_ids: [],
      },
      {
        id: "fixed",
        name: "Fixed",
        description: "Preprocessed.",
        tradeoffs: [],
        how_it_helps: "",
        workaround_ids: [],
      },
    ],
  },
  workarounds: [],
  results: [
    result(),
    result({
      variant_id: "fixed",
      outcome: "disagrees",
      accepted: true,
      validation_errors: [],
      agreement_pct: 50,
      false_positive_indices: [1],
    }),
  ],
};

const dataset = buildDataset(file);

function classesOf(variantId: string): PointClass[] {
  const { classes } = classifyPoints(dataset, {
    kind: "combo",
    polygonId: "square",
    systemId: "shapely",
    variantId,
  });
  return [...classes].map((code) => requireAt(POINT_CLASS_ORDER, code));
}

describe("classifyPoints", () => {
  it("scores a library that answered against the reference", () => {
    expect(classesOf("fixed")).toEqual(["correctInside", "falsePositive", "skipped"]);
  });

  it("never claims a library got points right when it gave no answer", () => {
    // The reference still says point 0 is inside, but a rejected library said
    // nothing at all, so calling that "Correct: inside" would credit it for an
    // answer it never gave.
    expect(classesOf("raw")).toEqual(["referenceInside", "referenceOutside", "skipped"]);
  });
});

describe("defaultVisibility", () => {
  it("starts with the boxes, skipped points and reference answer hidden", () => {
    const visible = defaultVisibility();
    const hidden = Object.entries(visible)
      .filter(([, shown]) => !shown)
      .map(([layer]) => layer);
    expect(hidden.sort()).toEqual(
      ["expectedBBox", "libraryBBox", "referenceInside", "referenceOutside", "skipped"].sort(),
    );
  });

  it("returns a fresh record each time, so one render cannot change the next", () => {
    const first = defaultVisibility();
    first.truth = false;
    expect(defaultVisibility().truth).toBe(true);
  });
});

describe("drawsAnyPoints", () => {
  const codes = (...names: PointClass[]): Uint8Array =>
    Uint8Array.from(names.map((name) => POINT_CLASS_ORDER.indexOf(name)));

  it("is false where the library never answered, until a grey entry is turned on", () => {
    // "Correct: inside" is on by default, but no point has that class here.
    const classes = codes("referenceInside", "referenceOutside", "skipped");
    const visible = defaultVisibility();
    expect(drawsAnyPoints(visible, classes)).toBe(false);
    visible.referenceOutside = true;
    expect(drawsAnyPoints(visible, classes)).toBe(true);
  });

  it("is true by default where the library answered", () => {
    expect(drawsAnyPoints(defaultVisibility(), codes("correctOutside"))).toBe(true);
  });
});
