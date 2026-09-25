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
  /**
   * Reported outside, actually inside. Drawn as a hollow ring, so it differs
   * from a false positive in shape as well as hue.
   */
  falseNegative: "#CC79A7",
  /** Too close to an edge to score. Hidden unless the toggle is on. */
  skipped: "#7F7F7F",
  /** Inside by the reference, where the library never answered. Neutral on purpose. */
  referenceInside: "#555555",
  /** Outside by the reference, where the library never answered. */
  referenceOutside: "#DDDDDD",
} as const;

export type PointClass = keyof typeof POINT_COLORS;

export const OUTCOME_COLORS = {
  correct: "#0072B2",
  /** Matches the false-positive point color on purpose. */
  disagrees: "#D55E00",
  /** Yellow, so it cannot be mistaken for the red-orange of `disagrees`. */
  rejected: "#F0E442",
  error: "#333333",
  /** Also drawn with a diagonal hatch (`.hatched` in style.css): nothing here. */
  no_data: "#BBBBBB",
} as const;

export type Outcome = keyof typeof OUTCOME_COLORS;

/** Text color over each outcome's background. White is unreadable on yellow and light grey. */
export const OUTCOME_TEXT_COLORS: Record<Outcome, string> = {
  correct: "#FFFFFF",
  disagrees: "#FFFFFF",
  rejected: "#1A1A1A",
  error: "#FFFFFF",
  no_data: "#1A1A1A",
};

/**
 * Human-readable labels for each outcome.
 *
 * `disagrees` has a description rather than a verdict, and only the legend
 * uses it: a matrix cell or chip for that outcome shows just its percentage
 * (see `cellText`).
 */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  correct: "Correct",
  disagrees: "Below 100%",
  rejected: "Rejected",
  error: "Error",
  no_data: "No data",
};

/** One-line explanations of what each outcome means. */
export const OUTCOME_DESCRIPTIONS: Record<Outcome, string> = {
  correct: "Every scored point matched the reference.",
  disagrees:
    "The library accepted the polygon, but disagreed with the reference on at least one point. " +
    "The number is the share of scored points it got right.",
  rejected: "The library refused the polygon, or its own validation reported errors.",
  error: "The run raised an unexpected exception.",
  no_data:
    "Nothing was scored: no test points landed here, or every one of them was too close to an " +
    "edge. This is not agreement.",
};

/** Geometry stroke colors, shared by both maps. */
export const GEOMETRY_COLORS = {
  /** The polygon as it really is on a sphere. */
  truth: "#111111",
  /** What the library was actually handed after any workaround. */
  submitted: "#009E73",
  graticule: "#E4E4E4",
  land: "#F2F0EB",
  landStroke: "#DCD8D0",
  sphere: "#FFFFFF",
} as const;

/** How to draw one outcome. */
export interface OutcomeStyle {
  color: string;
  textColor: string;
  label: string;
  /** Whether to add the diagonal hatch over the color. */
  hatched: boolean;
}

/**
 * Pick the style for one outcome.
 *
 * @param outcome - The combination's outcome.
 * @returns Its colors, label and hatch flag.
 */
export function outcomeStyle(outcome: Outcome): OutcomeStyle {
  return {
    color: OUTCOME_COLORS[outcome],
    textColor: OUTCOME_TEXT_COLORS[outcome],
    label: OUTCOME_LABELS[outcome],
    hatched: outcome === "no_data",
  };
}

/** What a matrix cell or outcome chip says. Either part may be absent. */
export interface CellText {
  /** "99.4%", or null when there is no percentage. */
  pct: string | null;
  /** The outcome word, or null where the number has to speak for itself. */
  word: string | null;
}

/**
 * Format an agreement percentage as "99.4%".
 *
 * Exactly 100 shows as "100%". A `disagrees` result is truncated rather
 * than rounded, so one wrong point in a large grid never displays as 100%.
 *
 * @param outcome - The combination's outcome.
 * @param agreementPct - The agreement percentage.
 * @returns The formatted string.
 */
function formatPct(outcome: Outcome, agreementPct: number): string {
  if (agreementPct === 100) {
    return "100%";
  }
  const shown = outcome === "disagrees" ? Math.floor(agreementPct * 10) / 10 : agreementPct;
  return `${shown.toFixed(1)}%`;
}

/**
 * The text for one matrix cell or outcome chip.
 *
 * `disagrees` gets no outcome word: the percentage, the non-blue color and the
 * missing "Correct" together say it is not fully right, and any verdict word
 * sounds absolute next to 99.4%. `rejected`, `error` and `no_data` have no
 * percentage; their words describe what happened, not a grade.
 *
 * @param outcome - The combination's outcome.
 * @param agreementPct - The agreement percentage, or null when nothing was scored.
 * @returns The percentage and word to show.
 */
export function cellText(outcome: Outcome, agreementPct: number | null): CellText {
  const pct = agreementPct === null ? null : formatPct(outcome, agreementPct);
  switch (outcome) {
    case "correct":
      return { pct, word: OUTCOME_LABELS.correct };
    case "disagrees":
      return { pct, word: null };
    default:
      return { pct: null, word: OUTCOME_LABELS[outcome] };
  }
}

/**
 * Whether the library gave containment answers at all for this outcome.
 *
 * A rejected or errored combination never answered, so there is nothing of the
 * library's to draw or score against. `no_data` did answer; there was just
 * nothing to compare the answers to.
 *
 * @param outcome - The combination's outcome.
 * @returns True when the library answered.
 */
export function outcomeHasAnswer(outcome: Outcome): boolean {
  return outcome !== "rejected" && outcome !== "error";
}
