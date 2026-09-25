import { describe, expect, it } from "vitest";

import { buildDataset } from "./data";
import { classifyPoints, shouldDrawPoints } from "./detail";
import { POINT_CLASS_ORDER } from "./map";
import { requireAt } from "./arrays";
import type { CombinationResult, ResultsFile } from "./generated/results";
import type { Outcome, PointClass } from "./palette";

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
  schema_version: 3,
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
    },
  ],
  variants: {
    shapely: [
      { id: "raw", name: "Raw", description: "As-is.", tradeoffs: [] },
      { id: "fixed", name: "Fixed", description: "Preprocessed.", tradeoffs: [] },
    ],
  },
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

describe("shouldDrawPoints", () => {
  const cases: [Outcome, boolean, boolean][] = [
    ["correct", false, true],
    ["correct", true, true],
    ["disagrees", false, true],
    ["disagrees", true, true],
    ["no_data", false, true],
    ["no_data", true, true],
    // The library never answered: no dots unless the viewer asks for the reference.
    ["rejected", false, false],
    ["rejected", true, true],
    ["error", false, false],
    ["error", true, true],
  ];

  it.each(cases)("%s with the reference toggle %s draws points: %s", (outcome, show, drawn) => {
    expect(shouldDrawPoints(outcome, show)).toBe(drawn);
  });
});
