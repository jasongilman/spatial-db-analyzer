/**
 * Pure geometry helpers for the maps.
 *
 * Two conversions live here, and both exist because d3-geo and GeoJSON
 * disagree about conventions that matter enormously for this project's data.
 */

import { requireAt } from "./arrays";
import type { GeoJsonMultiPolygon, GeoJsonPolygon } from "./generated/results";

/** Either geometry the results file can carry. */
export type Geometry = GeoJsonPolygon | GeoJsonMultiPolygon;

/** A `[lon, lat]` position in degrees. */
export type Position = [number, number];

/** A GeoJSON geometry in the shape d3-geo accepts. */
export interface D3Geometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: Position[][] | Position[][][];
}

/**
 * Test whether a geometry is a MultiPolygon.
 *
 * @param geometry - The geometry to test.
 * @returns True when it is a MultiPolygon.
 */
export function isMultiPolygon(geometry: Geometry): geometry is GeoJsonMultiPolygon {
  return geometry.type === "MultiPolygon";
}

/**
 * Get every ring in a geometry, whichever kind it is.
 *
 * @param geometry - The geometry to read.
 * @returns One entry per ring.
 */
export function ringsOf(geometry: Geometry): Position[][] {
  if (isMultiPolygon(geometry)) {
    return geometry.coordinates.map((part) => part[0] as Position[]);
  }
  return [geometry.coordinates[0]];
}

/**
 * Reverse a ring's winding.
 *
 * d3-geo treats a **clockwise** ring as enclosing its interior, which is the
 * opposite of the GeoJSON (RFC 7946) rule this project's data follows. Without
 * this conversion, a polygon that contains a pole renders inside-out: d3 fills
 * the entire rest of the globe instead.
 *
 * @param ring - The ring to reverse.
 * @returns A new ring in the opposite winding.
 */
export function toD3Winding(ring: Position[]): Position[] {
  return [...ring].reverse();
}

/**
 * Convert one of this project's geometries into one d3-geo will draw correctly.
 *
 * @param geometry - The geometry to convert.
 * @returns The same shape with every ring rewound for d3.
 */
export function toD3Geometry(geometry: Geometry): D3Geometry {
  if (isMultiPolygon(geometry)) {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((part) => [toD3Winding(requireAt(part, 0))]),
    };
  }
  return {
    type: "Polygon",
    coordinates: [toD3Winding(geometry.coordinates[0])],
  };
}

/**
 * Add vertices along each edge, interpolating linearly in lon/lat.
 *
 * This is deliberately *not* great-circle interpolation. d3-geo draws the
 * great-circle arc between two positions, which is the right picture for
 * spherical data and the wrong one for a planar library: a planar engine
 * believes its edges are straight lines in lon/lat space. Subdividing linearly
 * first pins those intermediate points down, so the drawn edge matches what the
 * library actually thinks the shape is.
 *
 * An edge whose longitudes jump by more than 180 degrees is subdivided like any
 * other, and that is the point. A planar library reads the step from 160 to
 * -160 as a journey backwards across the whole map, so the drawn edge has to
 * make that journey too. Without it, an antimeridian-crossing polygon would be
 * drawn as the compact box the author meant rather than the world-spanning band
 * the library actually built, and the map would contradict the false positives
 * plotted on top of it.
 *
 * @param ring - The ring to subdivide.
 * @param maxStepDeg - Largest gap between consecutive output positions.
 * @returns The subdivided ring.
 */
export function densifyPlanar(ring: Position[], maxStepDeg = 1): Position[] {
  const output: Position[] = [];

  for (let index = 0; index < ring.length - 1; index += 1) {
    const [startLon, startLat] = requireAt(ring, index);
    const [endLon, endLat] = requireAt(ring, index + 1);
    output.push([startLon, startLat]);

    const deltaLon = endLon - startLon;
    const deltaLat = endLat - startLat;

    const steps = Math.ceil(Math.max(Math.abs(deltaLon), Math.abs(deltaLat)) / maxStepDeg);
    for (let step = 1; step < steps; step += 1) {
      const fraction = step / steps;
      output.push([startLon + deltaLon * fraction, startLat + deltaLat * fraction]);
    }
  }

  const last = ring[ring.length - 1];
  if (last !== undefined) {
    output.push([last[0], last[1]]);
  }
  return output;
}

/**
 * Twice the signed area of a ring, treating lon/lat as a flat plane.
 *
 * Positive means counter-clockwise in that plane. Only the sign is used.
 *
 * @param ring - The ring to measure.
 * @returns Twice the signed area, in square degrees.
 */
export function planarSignedArea(ring: Position[]): number {
  let total = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = requireAt(ring, index);
    const [x2, y2] = requireAt(ring, index + 1);
    total += x1 * y2 - x2 * y1;
  }
  return total;
}

/**
 * Orient a ring so d3 fills the region a planar library considers its interior.
 *
 * The usual {@link toD3Winding} reversal assumes the ring follows the GeoJSON
 * rule, which is a statement about the *spherical* interior. Once the same ring
 * is re-read as a flat shape, its planar orientation can be the opposite: the
 * antimeridian box is counter-clockwise on the sphere and clockwise in the
 * plane. Reversing it unconditionally would make d3 fill the complement of what
 * the library actually built, contradicting the false positives drawn on top.
 *
 * So the sign is measured rather than assumed, and the ring is made clockwise
 * in lon/lat, which is what d3 fills.
 *
 * @param ring - The ring to orient.
 * @returns The ring, clockwise in the plane.
 */
export function orientPlanarForD3(ring: Position[]): Position[] {
  return planarSignedArea(ring) > 0 ? [...ring].reverse() : [...ring];
}

/**
 * Prepare a library's submitted geometry for drawing.
 *
 * Planar systems get their edges subdivided first so they draw as the straight
 * lines the library believes in, then oriented by their planar signed area;
 * spherical systems are drawn as-is, with d3 following the great circle.
 *
 * @param geometry - The submitted geometry.
 * @param semantics - The system's semantics.
 * @returns The geometry ready for d3.
 */
export function toDrawableSubmitted(
  geometry: Geometry,
  semantics: "planar" | "spherical",
): D3Geometry {
  if (semantics === "spherical") {
    return toD3Geometry(geometry);
  }
  const rings = ringsOf(geometry).map((ring) => orientPlanarForD3(densifyPlanar(ring)));
  if (isMultiPolygon(geometry)) {
    return { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
  }
  return { type: "Polygon", coordinates: [requireAt(rings, 0)] };
}

/**
 * Find the centroid of a ring, for centering the globe on it.
 *
 * Averages the vertices as 3D unit vectors, which stays correct across the
 * antimeridian and near the poles where averaging degrees does not.
 *
 * @param ring - The ring to average.
 * @returns A `[lon, lat]` centroid in degrees.
 */
export function ringCentroid(ring: Position[]): Position {
  const toRadians = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;

  // The closing position repeats the first, so it is left out of the average.
  const vertices = ring.slice(0, -1);
  for (const [lon, lat] of vertices) {
    const lonRad = lon * toRadians;
    const latRad = lat * toRadians;
    const cosLat = Math.cos(latRad);
    x += cosLat * Math.cos(lonRad);
    y += cosLat * Math.sin(lonRad);
    z += Math.sin(latRad);
  }

  if (x === 0 && y === 0 && z === 0) {
    return [0, 0];
  }
  return [Math.atan2(y, x) / toRadians, Math.atan2(z, Math.hypot(x, y)) / toRadians];
}

/**
 * Convert lon/lat degrees to a 3D unit vector.
 *
 * Used to cull the far hemisphere on the orthographic projection.
 *
 * @param lon - Longitude in degrees.
 * @param lat - Latitude in degrees.
 * @returns The unit vector.
 */
export function unitVector(lon: number, lat: number): [number, number, number] {
  const toRadians = Math.PI / 180;
  const lonRad = lon * toRadians;
  const latRad = lat * toRadians;
  const cosLat = Math.cos(latRad);
  return [cosLat * Math.cos(lonRad), cosLat * Math.sin(lonRad), Math.sin(latRad)];
}
