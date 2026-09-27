import { describe, expect, it } from "vitest";

import { MAX_ZOOM, nearestPoint, rotationSensitivity, zoomedScale, zoomedTranslate } from "./map";

describe("zoomedScale", () => {
  it("is the fitted scale when not zoomed", () => {
    expect(zoomedScale(150, 1)).toBe(150);
  });

  it("multiplies the fitted scale by the zoom", () => {
    expect(zoomedScale(150, MAX_ZOOM)).toBe(150 * MAX_ZOOM);
  });
});

describe("zoomedTranslate", () => {
  it("is the fitted translate at the identity transform", () => {
    expect(zoomedTranslate([400, 200], { k: 1, x: 0, y: 0 })).toEqual([400, 200]);
  });

  it("keeps the screen point under the zoom's anchor fixed", () => {
    // d3-zoom anchors a 2× zoom at screen (100, 50) with x = -100, y = -50.
    // The map center (400, 200) then moves to 2 * 400 - 100 = 700.
    expect(zoomedTranslate([400, 200], { k: 2, x: -100, y: -50 })).toEqual([700, 350]);
  });
});

describe("rotationSensitivity", () => {
  it("is 0.4° per pixel at the fitted scale", () => {
    expect(rotationSensitivity(1)).toBeCloseTo(0.4);
  });

  it("slows in proportion to the zoom", () => {
    expect(rotationSensitivity(10)).toBeCloseTo(0.04);
  });
});

describe("nearestPoint", () => {
  // Three points at x = 10, 20 and 30 on one row, and a fourth culled (NaN).
  const projected = Float64Array.from([10, 0, 20, 0, 30, 0, Number.NaN, 0]);
  const classes = Uint8Array.from([0, 1, 0, 0]);

  it("picks the nearest drawn point within reach", () => {
    expect(nearestPoint(projected, classes, new Set([0, 1]), 18, 1)).toEqual({
      index: 1,
      x: 20,
      y: 0,
    });
  });

  it("ignores points of a class that is not drawn", () => {
    expect(nearestPoint(projected, classes, new Set([0]), 15, 1)?.index).toBe(0);
  });

  it("finds nothing beyond the hover radius, or where a point is culled", () => {
    expect(nearestPoint(projected, classes, new Set([0, 1]), 50, 0)).toBeNull();
    expect(nearestPoint(projected, classes, new Set([0, 1]), 10, 20)).toBeNull();
  });
});
