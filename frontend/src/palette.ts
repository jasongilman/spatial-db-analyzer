/**
 * The colorblind-safe palette, in TypeScript rather than CSS.
 *
 * Canvas sets `fillStyle` from a string, so these values have to be reachable
 * from code. Keeping them here rather than in style.css means the maps and the
 * matrix cannot drift apart, and the mapping is unit-testable.
 *
 * The hues are Okabe-Ito, which stay distinguishable under the common forms of
 * color vision deficiency.
 */

export const POINT_COLORS = {
  /** Correctly reported as inside. */
  correctInside: "#0072B2",
  /** Correctly reported as outside. Drawn small and faint; it is the background. */
  correctOutside: "#BBBBBB",
  /** Reported inside, actually outside. */
  falsePositive: "#D55E00",
  /** Reported outside, actually inside. */
  falseNegative: "#E69F00",
  /** Too close to an edge to score. Hidden unless the toggle is on. */
  skipped: "#7F7F7F",
} as const;

export type PointClass = keyof typeof POINT_COLORS;

export const OUTCOME_COLORS = {
  correct: "#0072B2",
  accepted_but_wrong: "#D55E00",
  rejected: "#E69F00",
  error: "#8B4513",
} as const;

export type Outcome = keyof typeof OUTCOME_COLORS;

/** Human-readable labels for each outcome, used in the legend and the matrix. */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  correct: "Correct",
  accepted_but_wrong: "Accepted but wrong",
  rejected: "Rejected",
  error: "Error",
};

/** One-line explanations of what each outcome means. */
export const OUTCOME_DESCRIPTIONS: Record<Outcome, string> = {
  correct: "Every scored point matched the reference.",
  accepted_but_wrong: "The library took the polygon, then answered wrongly for some points.",
  rejected: "The library refused the polygon, or its own validation reported errors.",
  error: "The run raised an unexpected exception.",
};

/** Geometry stroke colors, shared by both maps. */
export const GEOMETRY_COLORS = {
  /** The polygon as it really is on a sphere. */
  truth: "#111111",
  /** What the library was actually handed after any workaround. */
  submitted: "#CC79A7",
  graticule: "#E4E4E4",
  land: "#F2F0EB",
  landStroke: "#DCD8D0",
  sphere: "#FFFFFF",
} as const;

/**
 * Pick the style for one outcome.
 *
 * @param outcome - The combination's outcome.
 * @returns Its color and label.
 */
export function outcomeStyle(outcome: Outcome): { color: string; label: string } {
  return { color: OUTCOME_COLORS[outcome], label: OUTCOME_LABELS[outcome] };
}
