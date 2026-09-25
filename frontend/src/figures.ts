/**
 * Small static maps for the explanatory pages.
 *
 * A thin wrapper over {@link MapView}: one map, no legend, a caption, and
 * whichever layers the caller names. Every figure is built from the results
 * file, never from hand-drawn shapes, so a figure can't show something the
 * data doesn't. Globes can be dragged; flat maps are static, and neither
 * zooms, so the page scrolls normally over them.
 */

import type { BaseType, Selection } from "d3-selection";

import type { D3Geometry, Position } from "./geo";
import type { BBox } from "./generated/results";
import { LAYER_IDS, MapView } from "./map";
import type { ClassifiedPoints, LayerId, Overlay, ProjectionKind, Scene } from "./map";

type Block<E extends BaseType> = Selection<E, unknown, null, undefined>;

/** What one figure draws. */
export interface FigureOptions {
  projection: ProjectionKind;
  /** Where to center the globe. The flat map ignores it. */
  center: Position;
  /** Text under the map. */
  caption: string;
  /** The polygon as it really is. Drawn only when `layers` includes "truth". */
  truth: D3Geometry;
  /** What a library was handed. Drawn only when `layers` includes "submitted". */
  submitted?: D3Geometry;
  /** Grid points. Only the classes named in `layers` are drawn. */
  points?: ClassifiedPoints;
  /** The layers to draw. Everything else stays hidden. */
  layers: LayerId[];
  overlays?: Overlay[];
  /** A box for the flat map to fit instead of the whole sphere. */
  extent?: BBox;
}

const NO_POINTS: ClassifiedPoints = {
  lons: new Float64Array(0),
  lats: new Float64Array(0),
  classes: new Uint8Array(0),
};

/**
 * The figures currently on the page.
 *
 * Module scope, with one resize listener over it, for the same reason as the
 * detail view's maps: pages are re-rendered on every navigation.
 */
let activeFigures: MapView[] = [];
let resizeListening = false;

function resizeFigures(): void {
  for (const view of activeFigures) {
    view.resize();
  }
}

/**
 * Release the figures on the page. Call before rendering any other view.
 */
export function disposeFigures(): void {
  activeFigures = [];
}

/**
 * Build the scene a figure draws.
 *
 * @param options - The figure.
 * @returns The scene.
 */
export function figureScene(options: FigureOptions): Scene {
  const shown = new Set(options.layers);
  const scene: Scene = {
    truth: options.truth,
    submitted: options.submitted ?? null,
    libraryBBox: null,
    expectedBBox: null,
    points: options.points ?? NO_POINTS,
    center: options.center,
    visible: Object.fromEntries(LAYER_IDS.map((layer) => [layer, shown.has(layer)])) as Record<
      LayerId,
      boolean
    >,
  };
  // Darker than the detail view's, which has to stay light under 5,000 points:
  // a figure's fill is often the whole point, as in the 88% / 12% pair.
  scene.truthFill =
    options.points === undefined ? "rgba(17, 17, 17, 0.2)" : "rgba(17, 17, 17, 0.1)";
  if (options.overlays !== undefined) {
    scene.overlays = options.overlays;
  }
  if (options.extent !== undefined) {
    scene.extent = options.extent;
  }
  return scene;
}

/**
 * Draw one figure into a container.
 *
 * A flat map with an extent takes the extent's own shape, so a zoomed strip
 * isn't padded out with empty sky.
 *
 * @param container - Where to append the figure.
 * @param options - What to draw.
 * @returns The figure element, for the caller to place.
 */
export function renderFigure<E extends BaseType>(
  container: Block<E>,
  options: FigureOptions,
): Block<HTMLElement> {
  const figure = container
    .append("figure")
    .attr("class", `figure figure-${options.projection}`) as unknown as Block<HTMLElement>;
  const canvas = figure.append("canvas");
  const extent = options.extent;
  if (options.projection === "equirectangular" && extent !== undefined) {
    canvas.style(
      "aspect-ratio",
      `${String(extent.east - extent.west)} / ${String(extent.north - extent.south)}`,
    );
  }
  const caption =
    options.projection === "orthographic" ? `${options.caption} Drag to rotate.` : options.caption;
  figure.append("figcaption").text(caption);

  const node = canvas.node();
  if (node !== null) {
    const view = new MapView(node, options.projection, () => undefined, {
      zoom: false,
      rotate: true,
    });
    view.setScene(figureScene(options));
    activeFigures.push(view);
  }

  if (!resizeListening) {
    window.addEventListener("resize", resizeFigures);
    resizeListening = true;
  }
  // Draw again once layout settles, so the canvas picks up its real size.
  requestAnimationFrame(resizeFigures);
  return figure;
}
