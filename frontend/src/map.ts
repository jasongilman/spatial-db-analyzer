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
import { zoom, zoomIdentity } from "d3-zoom";
import type { ZoomBehavior, ZoomTransform } from "d3-zoom";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import land110m from "world-atlas/land-110m.json";

import { codeAt, numberAt, requireAt } from "./arrays";
import { GEOMETRY_COLORS, POINT_COLORS } from "./palette";
import type { PointClass } from "./palette";
import type { D3Geometry, D3Lines, D3Points, Position } from "./geo";
import { unitVector } from "./geo";
import type { BBox } from "./generated/results";

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

/** Every layer a map can draw, each switched on and off from the legend. */
export const LAYER_IDS = [
  "truth",
  "submitted",
  "libraryBBox",
  "expectedBBox",
  ...POINT_CLASS_ORDER,
] as const;

/** One layer a map can draw. */
export type LayerId = (typeof LAYER_IDS)[number];

/**
 * Extra geometry drawn over everything but the bounding boxes.
 *
 * The explanatory figures use these for what the detail view never shows: a
 * second library geometry in its own color, a single edge, or a vertex list.
 */
export interface Overlay {
  geometry: D3Geometry | D3Lines | D3Points;
  stroke: string;
  /** Fill for a polygon. Left out, the polygon is only stroked. */
  fill?: string;
  /** Canvas line dash, in pixels. Left out, the line is solid. */
  dash?: number[];
  /** Stroke width in pixels. Defaults to 1.6, the width of the polygon layers. */
  lineWidth?: number;
  /** Dot radius in pixels, for a MultiPoint. Defaults to 3. */
  radius?: number;
}

/** What one map draws. */
export interface Scene {
  /** The polygon as it really is, with great-circle edges. */
  truth: D3Geometry;
  /** What the library was handed, drawn the way that library sees it. */
  submitted: D3Geometry | null;
  /** The bounding box the library reported. */
  libraryBBox: D3Lines | null;
  /** The true geodetic bounding box of the polygon. */
  expectedBBox: D3Lines | null;
  points: ClassifiedPoints;
  /** Where to center an orthographic globe. */
  center: Position;
  /** Which layers are drawn. The legend changes this in place, then calls {@link MapView.redraw}. */
  visible: Record<LayerId, boolean>;
  /** Fill for the true polygon. Defaults to a faint grey, to sit under points. */
  truthFill?: string;
  /** Extra geometry, drawn in order over the points. */
  overlays?: Overlay[];
  /**
   * A box the flat map fits instead of the whole sphere. Ignored by the globe,
   * and it must not cross the antimeridian.
   */
  extent?: BBox;
}

/** How a map responds to the pointer. */
export interface Interaction {
  /** Wheel, double-click and pinch zoom, plus panning the flat map once zoomed. */
  zoom: boolean;
  /** Dragging the globe to rotate it. Ignored by the flat map. */
  rotate: boolean;
}

/** The detail view's maps: everything on. */
const FULL_INTERACTION: Interaction = { zoom: true, rotate: true };

/** Most a map zooms in, as a multiple of its fitted scale. */
export const MAX_ZOOM = 20;

/** Degrees the globe turns per pixel dragged, at the fitted scale. */
const BASE_ROTATION_SENSITIVITY = 0.4;

/**
 * The projection scale at a zoom factor.
 *
 * @param fitted - The scale that fits the whole sphere in the canvas.
 * @param k - The zoom factor, 1 when not zoomed.
 * @returns The scale to draw at.
 */
export function zoomedScale(fitted: number, k: number): number {
  return fitted * k;
}

/**
 * The projection translate for a zoom transform on a flat map.
 *
 * Applying the zoom here, rather than with `context.setTransform`, keeps line
 * widths and point radii in screen pixels at every zoom.
 *
 * @param fitted - The translate that fits the whole sphere in the canvas.
 * @param transform - The zoom transform, in screen pixels.
 * @param transform.k - The zoom factor.
 * @param transform.x - The horizontal offset.
 * @param transform.y - The vertical offset.
 * @returns The translate to draw at.
 */
export function zoomedTranslate(
  fitted: [number, number],
  transform: { k: number; x: number; y: number },
): [number, number] {
  return [fitted[0] * transform.k + transform.x, fitted[1] * transform.k + transform.y];
}

/**
 * Degrees the globe turns per pixel dragged at a zoom factor.
 *
 * Divided by the zoom, so the ground under the pointer moves at about the
 * pointer's speed whether the globe is zoomed in or not.
 *
 * @param k - The zoom factor, 1 when not zoomed.
 * @returns Degrees per pixel.
 */
export function rotationSensitivity(k: number): number {
  return BASE_ROTATION_SENSITIVITY / k;
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

/**
 * How many fingers a pointer event carries, 0 for a mouse.
 *
 * Checked by property rather than `instanceof TouchEvent`, because desktop
 * Safari has no `TouchEvent` constructor at all.
 *
 * @param event - The event to inspect.
 * @returns The number of touches.
 */
function touchCount(event: Event): number {
  return "touches" in event ? (event as TouchEvent).touches.length : 0;
}

/**
 * The corners of a box, for fitting a projection to it.
 *
 * @param box - The box, which must not cross the antimeridian.
 * @returns Its four corners.
 */
function extentCorners(box: BBox): D3Points {
  return {
    type: "MultiPoint",
    coordinates: [
      [box.west, box.south],
      [box.east, box.south],
      [box.east, box.north],
      [box.west, box.north],
    ],
  };
}

/** A map attached to a canvas, redrawn on demand. */
export class MapView {
  private readonly canvas: HTMLCanvasElement;
  private readonly kind: ProjectionKind;
  private readonly projection: GeoProjection;
  private readonly zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;
  private readonly interaction: Interaction;
  private readonly onViewChange: (moved: boolean) => void;
  private scene: Scene | null = null;
  private initialRotation: [number, number] = [0, 0];
  private rotation: [number, number] = [0, 0];
  private transform: ZoomTransform = zoomIdentity;
  private projected = new Float64Array(0);

  /**
   * @param canvas - The canvas to draw on.
   * @param kind - Which projection to use.
   * @param onViewChange - Called after every redraw with whether the view is
   *   zoomed or rotated away from where {@link setScene} put it, so the caller
   *   can show a reset control only when there is something to reset.
   * @param interaction - Which pointer gestures the map answers to.
   */
  constructor(
    canvas: HTMLCanvasElement,
    kind: ProjectionKind,
    onViewChange: (moved: boolean) => void = () => undefined,
    interaction: Interaction = FULL_INTERACTION,
  ) {
    this.canvas = canvas;
    this.kind = kind;
    this.onViewChange = onViewChange;
    this.interaction = interaction;
    this.projection = kind === "orthographic" ? geoOrthographic() : geoEquirectangular();
    this.zoomBehavior = this.enableZoom();
    if (kind === "orthographic" && interaction.rotate) {
      this.enableDrag();
    }
  }

  /**
   * Replace what this map draws, reset the view, and redraw.
   *
   * @param scene - The new scene.
   */
  setScene(scene: Scene): void {
    this.scene = scene;
    this.initialRotation = [-scene.center[0], -scene.center[1]];
    this.projected = new Float64Array(scene.points.lons.length * 2);
    this.resetView();
  }

  /** Undo any zoom, pan or rotation, and redraw. */
  resetView(): void {
    this.rotation = [...this.initialRotation];
    if (!this.interaction.zoom) {
      // The behavior was never attached to the canvas, so there is no zoom
      // event to do the redraw.
      this.transform = zoomIdentity;
      this.render();
      return;
    }
    // Setting the transform through the behavior keeps d3-zoom's own record of
    // it in step. Its zoom event does the redraw.
    this.zoomBehavior.transform(select(this.canvas), zoomIdentity);
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

  private isMoved(): boolean {
    // The globe ignores the transform's x and y (see configureProjection), so
    // only the flat map counts them.
    const panned =
      this.kind === "equirectangular" && (this.transform.x !== 0 || this.transform.y !== 0);
    return (
      this.transform.k !== 1 ||
      panned ||
      this.rotation[0] !== this.initialRotation[0] ||
      this.rotation[1] !== this.initialRotation[1]
    );
  }

  private enableZoom(): ZoomBehavior<HTMLCanvasElement, unknown> {
    const behavior = zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([1, MAX_ZOOM])
      .on("zoom", (event: { transform: ZoomTransform }) => {
        this.transform = event.transform;
        this.render();
      });

    if (this.kind === "orthographic") {
      // Dragging the globe rotates it (d3-drag), so zoom takes only the wheel,
      // double-click and a two-finger pinch. Without this filter both
      // behaviors would claim every drag.
      behavior.filter((event: Event) => {
        if (event.type === "wheel" || event.type === "dblclick") {
          return true;
        }
        return touchCount(event) > 1;
      });
    }

    // Attaching the behavior also sets `touch-action: none`, which would stop a
    // phone scrolling the page past a figure that can't zoom anyway.
    if (this.interaction.zoom) {
      select(this.canvas).call(behavior);
    }
    return behavior;
  }

  private enableDrag(): void {
    let start: [number, number] = [0, 0];
    let startRotation: [number, number] = [0, 0];

    const behavior = drag<HTMLCanvasElement, unknown>()
      // Keep d3-drag's default filter (primary button, no ctrl-click), and leave
      // a second finger to the pinch zoom rather than a rotation.
      .filter(
        (event: MouseEvent | TouchEvent) =>
          !event.ctrlKey && !("button" in event && event.button) && touchCount(event) <= 1,
      )
      .on("start", (event: { x: number; y: number }) => {
        start = [event.x, event.y];
        startRotation = [...this.rotation];
      })
      .on("drag", (event: { x: number; y: number }) => {
        const sensitivity = rotationSensitivity(this.transform.k);
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

    this.configureProjection(width, height, scene.extent);
    const path = geoPath(this.projection, context);

    this.drawBase(context, path, width, height);
    this.drawGeometry(context, path, scene);
    this.drawPoints(context, scene, width, height);
    this.drawOverlays(context, path, scene.overlays ?? []);
    // Boxes go over the points: under them, a dotted line vanishes into the grid.
    this.drawBBoxes(context, path, scene);
    this.onViewChange(this.isMoved());
  }

  private configureProjection(width: number, height: number, extent: BBox | undefined): void {
    const k = this.transform.k;
    if (this.kind === "orthographic") {
      this.projection.rotate([this.rotation[0], this.rotation[1]]).fitExtent(
        [
          [6, 6],
          [width - 6, height - 6],
        ],
        { type: "Sphere" },
      );
      // The globe zooms about its center: the transform's x and y, which
      // d3-zoom aims at the pointer, are ignored. Rotation does the panning.
      this.projection.scale(zoomedScale(this.projection.scale(), k));
      return;
    }

    this.projection.rotate([0, 0]).fitExtent(
      [
        [2, 2],
        [width - 2, height - 2],
      ],
      extent === undefined ? { type: "Sphere" } : extentCorners(extent),
    );
    const fitted = this.projection.translate();
    this.projection
      .scale(zoomedScale(this.projection.scale(), k))
      .translate(zoomedTranslate(fitted, this.transform));
    // Panning stops at the map's edges. Set on every render because the
    // canvas can have been resized since the last one.
    this.zoomBehavior.translateExtent([
      [0, 0],
      [width, height],
    ]);
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
    if (scene.visible.truth) {
      context.beginPath();
      path(scene.truth as unknown as GeoPermissibleObjects);
      context.fillStyle = scene.truthFill ?? "rgba(17, 17, 17, 0.08)";
      context.fill();
      context.strokeStyle = GEOMETRY_COLORS.truth;
      context.lineWidth = 1.6;
      context.stroke();
    }

    if (scene.submitted !== null && scene.visible.submitted) {
      context.beginPath();
      path(scene.submitted as unknown as GeoPermissibleObjects);
      context.fillStyle = "rgba(0, 158, 115, 0.12)";
      context.fill();
      context.strokeStyle = GEOMETRY_COLORS.submitted;
      context.lineWidth = 1.6;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
    }
  }

  private drawOverlays(
    context: CanvasRenderingContext2D,
    path: ReturnType<typeof geoPath>,
    overlays: Overlay[],
  ): void {
    for (const overlay of overlays) {
      path.pointRadius(overlay.radius ?? 3);
      context.beginPath();
      path(overlay.geometry as unknown as GeoPermissibleObjects);
      if (overlay.fill !== undefined) {
        context.fillStyle = overlay.fill;
        context.fill();
      }
      context.strokeStyle = overlay.stroke;
      context.lineWidth = overlay.lineWidth ?? 1.6;
      context.setLineDash(overlay.dash ?? []);
      context.stroke();
      context.setLineDash([]);
    }
  }

  private drawBBoxes(
    context: CanvasRenderingContext2D,
    path: ReturnType<typeof geoPath>,
    scene: Scene,
  ): void {
    if (scene.libraryBBox !== null && scene.visible.libraryBBox) {
      this.drawBBox(context, path, scene.libraryBBox, GEOMETRY_COLORS.submitted);
    }
    if (scene.expectedBBox !== null && scene.visible.expectedBBox) {
      this.drawBBox(context, path, scene.expectedBBox, GEOMETRY_COLORS.truth);
    }
  }

  private drawBBox(
    context: CanvasRenderingContext2D,
    path: ReturnType<typeof geoPath>,
    outline: D3Lines,
    color: string,
  ): void {
    // Dotted, where the submitted geometry is dashed, so a box never reads as a polygon edge.
    context.beginPath();
    path(outline);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.lineCap = "round";
    context.setLineDash([0.1, 4]);
    context.stroke();
    context.setLineDash([]);
    context.lineCap = "butt";
  }

  private drawPoints(
    context: CanvasRenderingContext2D,
    scene: Scene,
    width: number,
    height: number,
  ): void {
    if (!POINT_CLASS_ORDER.some((pointClass) => scene.visible[pointClass])) {
      return;
    }
    const { lons, lats, classes } = scene.points;
    // Zoomed in, most points project off the canvas; skipping them early saves
    // the arc calls. The margin keeps a dot whose center is just outside.
    const margin = 4;

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
      if (
        point === null ||
        point[0] < -margin ||
        point[0] > width + margin ||
        point[1] < -margin ||
        point[1] > height + margin
      ) {
        this.projected[index * 2] = Number.NaN;
        continue;
      }
      this.projected[index * 2] = point[0];
      this.projected[index * 2 + 1] = point[1];
    }

    for (let code = 0; code < POINT_CLASS_ORDER.length; code += 1) {
      const pointClass = requireAt(POINT_CLASS_ORDER, code);
      if (!scene.visible[pointClass]) {
        continue;
      }

      const radius = POINT_RADIUS[pointClass];
      // A false negative is a ring: the color is the stroke, over a white fill.
      const hollow = pointClass === "falseNegative";
      context.fillStyle = hollow ? "#FFFFFF" : POINT_COLORS[pointClass];
      context.strokeStyle = POINT_COLORS[pointClass];
      context.lineWidth = 2;
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
