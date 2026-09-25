import { describe, expect, it } from "vitest";

import {
  bboxOutline,
  densifyPlanar,
  orientPlanarForD3,
  planarSignedArea,
  isMultiPolygon,
  reversePolygon,
  ringCentroid,
  ringStretch,
  ringsOf,
  toD3Geometry,
  toD3Winding,
  vertexCount,
  toDrawableSubmitted,
  unitVector,
} from "./geo";
import type { Position } from "./geo";
import { requireAt } from "./arrays";
import type { GeoJsonMultiPolygon, GeoJsonPolygon } from "./generated/results";

const SQUARE: Position[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
];

const polygon: GeoJsonPolygon = { type: "Polygon", coordinates: [SQUARE] };
const multiPolygon: GeoJsonMultiPolygon = {
  type: "MultiPolygon",
  coordinates: [[SQUARE], [SQUARE]],
};

describe("toD3Winding", () => {
  it("reverses the ring", () => {
    expect(toD3Winding(SQUARE)).toEqual([...SQUARE].reverse());
  });

  it("does not mutate its input", () => {
    const original = [...SQUARE];
    toD3Winding(SQUARE);
    expect(SQUARE).toEqual(original);
  });

  it("round-trips", () => {
    expect(toD3Winding(toD3Winding(SQUARE))).toEqual(SQUARE);
  });
});

describe("toD3Geometry", () => {
  it("rewinds a polygon's ring, because d3 treats clockwise as the interior", () => {
    const result = toD3Geometry(polygon);
    expect(result.type).toBe("Polygon");
    expect(result.coordinates[0]).toEqual([...SQUARE].reverse());
  });

  it("rewinds every part of a multipolygon", () => {
    const result = toD3Geometry(multiPolygon);
    expect(result.type).toBe("MultiPolygon");
    expect(result.coordinates).toHaveLength(2);
  });
});

describe("ringsOf", () => {
  it("returns one ring for a polygon", () => {
    expect(ringsOf(polygon)).toHaveLength(1);
  });

  it("returns one ring per part for a multipolygon", () => {
    expect(ringsOf(multiPolygon)).toHaveLength(2);
  });
});

describe("isMultiPolygon", () => {
  it("discriminates the union", () => {
    expect(isMultiPolygon(polygon)).toBe(false);
    expect(isMultiPolygon(multiPolygon)).toBe(true);
  });
});

describe("densifyPlanar", () => {
  it("adds points along a straight lon/lat line", () => {
    const result = densifyPlanar(
      [
        [0, 0],
        [10, 0],
      ],
      1,
    );
    expect(result).toHaveLength(11);
    expect(result[5]).toEqual([5, 0]);
  });

  it("interpolates linearly, not along the great circle", () => {
    // The great-circle midpoint of these two would sit well north of 50.
    const result = densifyPlanar(
      [
        [-80, 50],
        [80, 50],
      ],
      10,
    );
    for (const [, lat] of result) {
      expect(lat).toBeCloseTo(50, 10);
    }
  });

  it("drags an antimeridian wrap back across the map, as a planar library does", () => {
    const result = densifyPlanar(
      [
        [170, 0],
        [-170, 0],
      ],
      10,
    );
    // 340 degrees the long way round, not 20 the short way.
    expect(result).toHaveLength(35);
    expect(result.some(([lon]) => Math.abs(lon) < 1)).toBe(true);
  });

  it("keeps the ring closed", () => {
    const result = densifyPlanar(SQUARE, 2);
    expect(result[0]).toEqual(result[result.length - 1]);
  });

  it("returns the endpoints unchanged", () => {
    const result = densifyPlanar(SQUARE, 3);
    expect(result[0]).toEqual([0, 0]);
    expect(result[result.length - 1]).toEqual([0, 0]);
  });
});

describe("planarSignedArea", () => {
  it("is positive for a counter-clockwise ring in the plane", () => {
    expect(planarSignedArea(SQUARE)).toBeGreaterThan(0);
  });

  it("is negative for a clockwise ring in the plane", () => {
    expect(planarSignedArea([...SQUARE].reverse())).toBeLessThan(0);
  });

  it("reads the antimeridian box as clockwise in the plane", () => {
    // Counter-clockwise on the sphere, where it is a Pacific box; clockwise in
    // the plane, where a planar library reads it as a world-spanning band.
    const antimeridianBox: Position[] = [
      [160, -20],
      [-160, -20],
      [-160, 20],
      [160, 20],
      [160, -20],
    ];
    expect(planarSignedArea(antimeridianBox)).toBeLessThan(0);
  });
});

describe("orientPlanarForD3", () => {
  it("makes a counter-clockwise ring clockwise", () => {
    expect(planarSignedArea(orientPlanarForD3(SQUARE))).toBeLessThan(0);
  });

  it("leaves an already-clockwise ring alone", () => {
    const clockwise = [...SQUARE].reverse();
    expect(orientPlanarForD3(clockwise)).toEqual(clockwise);
  });

  it("never mutates its input", () => {
    const original = [...SQUARE];
    orientPlanarForD3(SQUARE);
    expect(SQUARE).toEqual(original);
  });
});

describe("toDrawableSubmitted", () => {
  it("densifies for a planar system, so its edges draw straight", () => {
    const result = toDrawableSubmitted(polygon, "planar");
    expect(result.coordinates[0]?.length).toBeGreaterThan(SQUARE.length);
  });

  it("fills the band a planar library builds from an antimeridian box, not its complement", () => {
    const antimeridianBox = {
      type: "Polygon" as const,
      coordinates: [
        [
          [160, -20],
          [-160, -20],
          [-160, 20],
          [160, 20],
          [160, -20],
        ],
      ] as [[number, number][]],
    };
    const result = toDrawableSubmitted(antimeridianBox, "planar");
    const ring = result.coordinates[0] as Position[];
    // Clockwise in the plane is what d3 fills.
    expect(planarSignedArea(ring)).toBeLessThan(0);
    // And the ring really does sweep the long way round.
    expect(ring.some(([lon]) => Math.abs(lon) < 1)).toBe(true);
  });

  it("leaves a spherical system's geometry to d3's great-circle drawing", () => {
    const result = toDrawableSubmitted(polygon, "spherical");
    expect(result.coordinates[0]).toHaveLength(SQUARE.length);
  });

  it("handles a multipolygon from the antimeridian fix", () => {
    const result = toDrawableSubmitted(multiPolygon, "planar");
    expect(result.type).toBe("MultiPolygon");
    expect(result.coordinates).toHaveLength(2);
  });
});

describe("ringCentroid", () => {
  it("finds the middle of an equatorial box", () => {
    // A mean of unit vectors, not a mean of degrees, so the latitude lands at
    // 5.019 rather than exactly 5. Only used to centre the globe, so a
    // fiftieth of a degree does not matter.
    const [lon, lat] = ringCentroid(SQUARE);
    expect(lon).toBeCloseTo(5, 6);
    expect(lat).toBeCloseTo(5, 1);
  });

  it("stays sane across the antimeridian, where averaging degrees would not", () => {
    const [lon] = ringCentroid([
      [170, 0],
      [-170, 0],
      [-170, 10],
      [170, 10],
      [170, 0],
    ]);
    expect(Math.abs(lon)).toBeCloseTo(180, 6);
  });
});

describe("unitVector", () => {
  it("maps the origin to the x axis", () => {
    expect(unitVector(0, 0)).toEqual([1, 0, 0]);
  });

  it("maps the north pole to the z axis", () => {
    const [x, y, z] = unitVector(0, 90);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
    expect(z).toBeCloseTo(1, 12);
  });

  it("returns unit length", () => {
    const [x, y, z] = unitVector(123, -45);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
  });
});

describe("bboxOutline", () => {
  it("draws a normal box as four edges, with the parallels densified", () => {
    const outline = bboxOutline({ west: -110, south: 30, east: -90, north: 45.44 });
    expect(outline.type).toBe("MultiLineString");
    expect(outline.coordinates).toHaveLength(4);

    const [top, bottom] = outline.coordinates;
    // 20° of longitude at 1° steps: 21 positions, all on the parallel.
    expect(top).toHaveLength(21);
    expect(top?.every(([, lat]) => lat === 45.44)).toBe(true);
    expect(bottom?.every(([, lat]) => lat === 30)).toBe(true);
    expect(top?.[0]).toEqual([-110, 45.44]);
    expect(top?.[20]).toEqual([-90, 45.44]);
  });

  it("runs an antimeridian box east through 180, not back through 0", () => {
    const outline = bboxOutline({ west: 160, south: -21.17, east: -160, north: 21.17 });
    const top = outline.coordinates[0] ?? [];
    const lons = top.map(([lon]) => lon);

    expect(top).toHaveLength(41);
    expect(lons).toContain(180);
    expect(lons.every((lon) => Math.abs(lon) >= 160)).toBe(true);
    // Every step is 1°, so no segment jumps across the map.
    for (let index = 1; index < lons.length; index += 1) {
      const step = ((requireAt(lons, index) - requireAt(lons, index - 1) + 540) % 360) - 180;
      expect(step).toBeCloseTo(1);
    }
  });

  it("leaves out the top edge of a box that reaches 90°N", () => {
    const outline = bboxOutline({ west: -80, south: 50, east: 80, north: 90 });
    expect(outline.coordinates).toHaveLength(3);
    const lats = outline.coordinates.flatMap((line) => line.map(([, lat]) => lat));
    // The meridian edges still reach the pole; only the parallel is gone.
    expect(outline.coordinates.filter((line) => line.every(([, lat]) => lat === 90))).toEqual([]);
    expect(lats).toContain(90);
  });

  it("draws no side edges for a box spanning every longitude", () => {
    const outline = bboxOutline({ west: -180, south: -21, east: 180, north: 21 });
    expect(outline.coordinates).toHaveLength(2);
  });

  it("draws nothing for a box covering the whole sphere", () => {
    expect(bboxOutline({ west: -180, south: -90, east: 180, north: 90 }).coordinates).toEqual([]);
  });
});

describe("reversePolygon", () => {
  it("reverses the ring and leaves the input alone", () => {
    const polygon = {
      type: "Polygon" as const,
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 0],
        ],
      ] as [[number, number][]],
    };
    expect(reversePolygon(polygon).coordinates[0]).toEqual([
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 0],
    ]);
    expect(polygon.coordinates[0][1]).toEqual([10, 0]);
  });
});

describe("vertexCount", () => {
  it("counts distinct vertices across every part", () => {
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    expect(vertexCount({ type: "Polygon", coordinates: [ring] })).toBe(3);
    expect(vertexCount({ type: "MultiPolygon", coordinates: [[ring], [ring]] })).toBe(6);
  });
});

describe("ringStretch", () => {
  const ring: [number, number][] = [
    [0, 0],
    [5, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];

  it("walks forward from start to end", () => {
    expect(ringStretch(ring, [0, 0], [10, 0])).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
  });

  it("wraps past the closing position", () => {
    expect(ringStretch(ring, [0, 10], [5, 0])).toEqual([
      [0, 10],
      [0, 0],
      [5, 0],
    ]);
  });

  it("matches the nearest positions, not exact ones", () => {
    expect(ringStretch(ring, [10.000001, 0], [9.999999, 10])).toEqual([
      [10, 0],
      [10, 10],
    ]);
  });
});
