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
  // Near-black reads better than white on vermillion (4.5:1 against 3.9:1),
  // and on every lighter shade of the agreement ramp.
  disagrees: "#1A1A1A",
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
  /**
   * A second library geometry in an explanatory figure, set against `submitted`:
   * the densified edge, or the other half of a split polygon. Never on a map
   * with points, where this blue means "correct: inside".
   */
  alternate: "#0072B2",
  graticule: "#E4E4E4",
  land: "#F2F0EB",
  landStroke: "#DCD8D0",
  sphere: "#FFFFFF",
} as const;

// ---------- The agreement ramp ----------
//
// A "below 100%" cell is shaded by how much it got right, so 99.9% and 40% no
// longer look alike: light vermillion near 100%, the full `disagrees` color
// near 0%. The shades are interpolated in CIELAB, where equal steps look equal.

/** The ramp's light end, near 100% agreement: `disagrees` at 36% strength over white. */
export const DISAGREES_LIGHT = "#FCC5A6";

/** Near-black text, used wherever white would be harder to read. */
const DARK_TEXT = "#1A1A1A";

type Triple = [number, number, number];

/** D65 reference white, for normalizing XYZ. */
const WHITE_XYZ: Triple = [0.95047, 1, 1.08883];

function hexToLinear(hex: string): Triple {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

function linearToHex(rgb: Triple): string {
  const encode = (value: number): string => {
    const clamped = Math.min(1, Math.max(0, value));
    const gamma = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(gamma * 255)
      .toString(16)
      .toUpperCase()
      .padStart(2, "0");
  };
  return `#${rgb.map(encode).join("")}`;
}

function hexToLab(hex: string): Triple {
  const [r, g, b] = hexToLinear(hex);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / WHITE_XYZ[0];
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / WHITE_XYZ[1];
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / WHITE_XYZ[2];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function labToHex([l, a, b]: Triple): string {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (t: number): number =>
    t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27);
  const x = inverse(fx) * WHITE_XYZ[0];
  const y = inverse(fy) * WHITE_XYZ[1];
  const z = inverse(fz) * WHITE_XYZ[2];
  return linearToHex([
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ]);
}

/**
 * WCAG 2 contrast ratio between two colors.
 *
 * @param first - One color, as #RRGGBB.
 * @param second - The other.
 * @returns The ratio, from 1 to 21.
 */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = hexToLinear(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((p, q) => q - p);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * White or near-black, whichever reads better over a background.
 *
 * @param background - The background, as #RRGGBB.
 * @returns The text color.
 */
export function readableTextColor(background: string): string {
  return contrastRatio(background, "#FFFFFF") >= contrastRatio(background, DARK_TEXT)
    ? "#FFFFFF"
    : DARK_TEXT;
}

/**
 * The background for a "below 100%" result at some agreement.
 *
 * The position along the ramp is the error share raised to the 0.4 power.
 * Linear in agreement, 99.4% and 96% would be nearly the same pale shade,
 * though one is seven times as wrong as the other.
 *
 * @param agreementPct - The share of scored points the library got right, 0 to 100.
 * @returns The shade, as #RRGGBB.
 */
export function disagreesColor(agreementPct: number): string {
  const errorShare = Math.min(100, Math.max(0, 100 - agreementPct)) / 100;
  const t = errorShare ** 0.4;
  const light = hexToLab(DISAGREES_LIGHT);
  const strong = hexToLab(OUTCOME_COLORS.disagrees);
  return labToHex([
    light[0] + (strong[0] - light[0]) * t,
    light[1] + (strong[1] - light[1]) * t,
    light[2] + (strong[2] - light[2]) * t,
  ]);
}

/**
 * The text color over {@link disagreesColor} at the same agreement.
 *
 * @param agreementPct - The share of scored points the library got right.
 * @returns The text color.
 */
export function disagreesTextColor(agreementPct: number): string {
  return readableTextColor(disagreesColor(agreementPct));
}

/**
 * A CSS gradient across the whole ramp, for the legend swatch.
 *
 * @returns A `linear-gradient(...)` value, light (100%) on the left.
 */
export function disagreesGradient(): string {
  const stops = [100, 99, 96, 88, 66, 30, 0].map((pct) => disagreesColor(pct));
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

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
 * @param agreementPct - The agreement, which shades a `disagrees` result along
 *   the ramp. Left out or null, `disagrees` gets its full color.
 * @returns Its colors, label and hatch flag.
 */
export function outcomeStyle(outcome: Outcome, agreementPct: number | null = null): OutcomeStyle {
  if (outcome === "disagrees" && agreementPct !== null) {
    return {
      color: disagreesColor(agreementPct),
      textColor: disagreesTextColor(agreementPct),
      label: OUTCOME_LABELS.disagrees,
      hatched: false,
    };
  }
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
