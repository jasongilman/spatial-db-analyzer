/**
 * One canvas map renderer, used by both projections and both views.
 *
 * Canvas rather than SVG because the points layer is up to 5,000 marks per map.
 * With SVG, dragging the globe would mean rewriting cx/cy on 5,000 DOM nodes
 * every frame, and every navigation between combinations would build and tear
 * down two full sets of them. `d3.geoPath(projection, context)` draws the same
 * geometry to a canvas that `d3.geoPath(projection)` would write as an SVG path,
 * so nothing is lost but the DOM.
 */

import { geoEquirectangular, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { GeoPermissibleObjects, GeoProjection } from "d3-geo";
import { drag } from "d3-drag";
import { select } from "d3-selection";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import land110m from "world-atlas/land-110m.json";

import { codeAt, numberAt, requireAt } from "./arrays";
import { GEOMETRY_COLORS, POINT_COLORS } from "./palette";
import type { PointClass } from "./palette";
import type { D3Geometry, Position } from "./geo";
import { unitVector } from "./geo";

/** Which projection a map uses. */
export type ProjectionKind = "orthographic" | "equirectangular";

/** One point to draw, with the class that decides its color. */
export interface ClassifiedPoints {
  lons: Float64Array;
  lats: Float64Array;
  classes: Uint8Array;
}

/** The order classes are drawn in, back to front, and their numeric codes. */
export const POINT_CLASS_ORDER: PointClass[] = [
  "correctOutside",
  "referenceOutside",
  "skipped",
  "referenceInside",
  "correctInside",
  "falseNegative",
  "falsePositive",
];

/** What one map draws. */
export interface Scene {
  /** The polygon as it really is, with great-circle edges. */
  truth: D3Geometry;
  /** What the library was handed, drawn the way that library sees it. */
  submitted: D3Geometry | null;
  points: ClassifiedPoints;
  /** Where to center an orthographic globe. */
  center: Position;
  showSkipped: boolean;
}

const landFeature = feature(
  land110m as unknown as Topology,
  (land110m as unknown as Topology).objects.land as never,
) as unknown as GeoPermissibleObjects;

const graticule = geoGraticule10();

const POINT_RADIUS: Record<PointClass, number> = {
  correctInside: 1.9,
  correctOutside: 1.1,
  falsePositive: 3,
  falseNegative: 3,
  skipped: 1.6,
  referenceInside: 1.9,
  referenceOutside: 1.1,
};

/** A map attached to a canvas, redrawn on demand. */
export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly kind: ProjectionKind;
  private readonly projection: GeoProjection;
  private scene: Scene | null = null;
  private rotation: [number, number] = [0, 0];
  private projected = new Float64Array(0);

  constructor(canvas: HTMLCanvasElement, kind: ProjectionKind) {
    this.canvas = canvas;
    this.kind = kind;
    this.projection = kind === "orthographic" ? geoOrthographic() : geoEquirectangular();
    if (kind === "orthographic") {
      this.enableDrag();
    }
  }

  /**
   * Replace what this map draws and redraw it.
   *
   * @param scene - The new scene.
   */
  setScene(scene: Scene): void {
    this.scene = scene;
    this.rotation = [-scene.center[0], -scene.center[1]];
    this.projected = new Float64Array(scene.points.lons.length * 2);
    this.render();
  }

  /** Resize the backing store to the element and redraw. */
  resize(): void {
    this.render();
  }

  /**
   * Redraw the scene already set, for a control that changed it in place.
   *
   * Separate from {@link setScene} because that recenters the globe, which
   * would throw away a rotation the viewer had dragged to.
   */
  redraw(): void {
    this.render();
  }

  private enableDrag(): void {
    let start: [number, number] = [0, 0];
    let startRotation: [number, number] = [0, 0];

    const behavior = drag<HTMLCanvasElement, unknown>()
      .on("start", (event: { x: number; y: number }) => {
        start = [event.x, event.y];
        startRotation = [...this.rotation];
      })
      .on("drag", (event: { x: number; y: number }) => {
        // 0.4 degrees per pixel keeps a full turn about two screen widths wide.
        const sensitivity = 0.4;
        const yaw = startRotation[0] + (event.x - start[0]) * sensitivity;
        const pitch = startRotation[1] - (event.y - start[1]) * sensitivity;
        this.rotation = [yaw, Math.max(-90, Math.min(90, pitch))];
        this.render();
      });

    select(this.canvas).call(behavior);
  }

  private render(): void {
    const scene = this.scene;
    const context = this.canvas.getContext("2d");
    if (scene === null || context === null) {
      return;
    }

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }

    // Without scaling the backing store by the device pixel ratio, everything
    // is soft on a retina display.
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    this.configureProjection(width, height);
    const path = geoPath(this.projection, context);

    this.drawBase(context, path, width, height);
    this.drawGeometry(context, path, scene);
    this.drawPoints(context, scene);
  }

  private configureProjection(width: number, height: number): void {
    if (this.kind === "orthographic") {
      this.projection.rotate([this.rotation[0], this.rotation[1]]).fitExtent(
        [
          [6, 6],
          [width - 6, height - 6],
        ],
        { type: "Sphere" },
      );
      return;
    }
    this.projection.rotate([0, 0]).fitExtent(
      [
        [2, 2],
        [width - 2, height - 2],
      ],
      { type: "Sphere" },
    );
  }

  private drawBase(
    context: CanvasRenderingContext2D,
    path: ReturnType<typeof geoPath>,
    width: number,
    height: number,
  ): void {
    context.beginPath();
    path({ type: "Sphere" });
    context.fillStyle = GEOMETRY_COLORS.sphere;
    context.fill();

    context.beginPath();
    path(landFeature);
    context.fillStyle = GEOMETRY_COLORS.land;
    context.fill();
    context.strokeStyle = GEOMETRY_COLORS.landStroke;
    context.lineWidth = 0.5;
    context.stroke();

    context.beginPath();
    path(graticule);
    context.strokeStyle = GEOMETRY_COLORS.graticule;
    context.lineWidth = 0.5;
    context.stroke();

    if (this.kind === "equirectangular") {
      context.strokeStyle = GEOMETRY_COLORS.landStroke;
      context.strokeRect(0.5, 0.5, width - 1, height - 1);
    } else {
      context.beginPath();
      path({ type: "Sphere" });
      context.strokeStyle = GEOMETRY_COLORS.landStroke;
      context.lineWidth = 1;
      context.stroke();
    }
  }

  private drawGeometry(
    context: CanvasRenderingContext2D,
    path: ReturnType<typeof geoPath>,
    scene: Scene,
  ): void {
    context.beginPath();
    path(scene.truth as unknown as GeoPermissibleObjects);
    context.fillStyle = "rgba(17, 17, 17, 0.08)";
    context.fill();
    context.strokeStyle = GEOMETRY_COLORS.truth;
    context.lineWidth = 1.6;
    context.stroke();

    if (scene.submitted !== null) {
      context.beginPath();
      path(scene.submitted as unknown as GeoPermissibleObjects);
      context.fillStyle = "rgba(204, 121, 167, 0.12)";
      context.fill();
      context.strokeStyle = GEOMETRY_COLORS.submitted;
      context.lineWidth = 1.6;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }

  private drawPoints(context: CanvasRenderingContext2D, scene: Scene): void {
    const { lons, lats, classes } = scene.points;

    // Project every point once per frame into a reusable buffer, then draw in
    // one pass per class so fillStyle is set five times rather than 5,000.
    const [rotationLon, rotationLat] = this.rotation;
    const center = unitVector(-rotationLon, -rotationLat);

    for (let index = 0; index < lons.length; index += 1) {
      const lon = numberAt(lons, index);
      const lat = numberAt(lats, index);

      if (this.kind === "orthographic") {
        // d3's projection does not cull the far hemisphere on its own: it
        // mirrors hidden points onto the visible disk. A dot product against
        // the rotation center drops them.
        const [x, y, z] = unitVector(lon, lat);
        if (x * center[0] + y * center[1] + z * center[2] <= 0) {
          this.projected[index * 2] = Number.NaN;
          continue;
        }
      }

      const point = this.projection([lon, lat]);
      if (point === null) {
        this.projected[index * 2] = Number.NaN;
        continue;
      }
      this.projected[index * 2] = point[0];
      this.projected[index * 2 + 1] = point[1];
    }

    for (let code = 0; code < POINT_CLASS_ORDER.length; code += 1) {
      const pointClass = requireAt(POINT_CLASS_ORDER, code);
      if (pointClass === "skipped" && !scene.showSkipped) {
        continue;
      }

      const radius = POINT_RADIUS[pointClass];
      const hollow = pointClass === "falseNegative";
      context.fillStyle = POINT_COLORS[pointClass];
      context.strokeStyle = "#333333";
      context.lineWidth = 1;
      context.beginPath();

      for (let index = 0; index < lons.length; index += 1) {
        if (codeAt(classes, index) !== code) {
          continue;
        }
        const x = numberAt(this.projected, index * 2);
        if (Number.isNaN(x)) {
          continue;
        }
        const y = numberAt(this.projected, index * 2 + 1);
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }

      context.fill();
      if (hollow) {
        context.stroke();
      }
    }
  }
}
