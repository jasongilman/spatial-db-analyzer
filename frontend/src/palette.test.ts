import { describe, expect, it } from "vitest";

import {
  GEOMETRY_COLORS,
  OUTCOME_COLORS,
  OUTCOME_DESCRIPTIONS,
  OUTCOME_LABELS,
  OUTCOME_TEXT_COLORS,
  POINT_COLORS,
  cellText,
  outcomeHasAnswer,
  outcomeStyle,
} from "./palette";
import type { Outcome } from "./palette";

const OUTCOMES: Outcome[] = ["correct", "disagrees", "rejected", "error", "no_data"];

describe("outcomeStyle", () => {
  it("maps each outcome to its colors, label and hatch", () => {
    expect(outcomeStyle("correct")).toEqual({
      color: "#0072B2",
      textColor: "#FFFFFF",
      label: "Correct",
      hatched: false,
    });
    expect(outcomeStyle("disagrees")).toEqual({
      color: "#D55E00",
      textColor: "#FFFFFF",
      label: "Below 100%",
      hatched: false,
    });
    expect(outcomeStyle("rejected")).toEqual({
      color: "#F0E442",
      textColor: "#1A1A1A",
      label: "Rejected",
      hatched: false,
    });
    expect(outcomeStyle("error")).toEqual({
      color: "#333333",
      textColor: "#FFFFFF",
      label: "Error",
      hatched: false,
    });
    expect(outcomeStyle("no_data")).toEqual({
      color: "#BBBBBB",
      textColor: "#1A1A1A",
      label: "No data",
      hatched: true,
    });
  });

  it("covers every outcome", () => {
    for (const outcome of OUTCOMES) {
      expect(outcomeStyle(outcome).label).toBeTruthy();
      expect(OUTCOME_DESCRIPTIONS[outcome]).toBeTruthy();
    }
  });
});

describe("the palette", () => {
  it("gives every outcome a distinct color", () => {
    const colors = OUTCOMES.map((outcome) => OUTCOME_COLORS[outcome]);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("gives every point class a distinct color", () => {
    const colors = Object.values(POINT_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("uses well-formed hex colors throughout", () => {
    for (const color of [
      ...Object.values(POINT_COLORS),
      ...Object.values(OUTCOME_COLORS),
      ...Object.values(OUTCOME_TEXT_COLORS),
      ...Object.values(GEOMETRY_COLORS),
    ]) {
      expect(color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("labels every outcome", () => {
    expect(Object.keys(OUTCOME_LABELS).sort()).toEqual([...OUTCOMES].sort());
  });
});

describe("outcomeHasAnswer", () => {
  it("is false only where the library never answered", () => {
    expect(outcomeHasAnswer("rejected")).toBe(false);
    expect(outcomeHasAnswer("error")).toBe(false);
    expect(outcomeHasAnswer("correct")).toBe(true);
    expect(outcomeHasAnswer("disagrees")).toBe(true);
    // The library answered; there was just nothing to compare it to.
    expect(outcomeHasAnswer("no_data")).toBe(true);
  });
});

describe("cellText", () => {
  it("shows only the percentage when the library disagrees", () => {
    const text = cellText("disagrees", 99.4187);
    expect(text).toEqual({ pct: "99.4%", word: null });
    const all = Object.values(OUTCOME_LABELS).map((label) => label.toLowerCase());
    for (const label of all) {
      expect(text.pct?.toLowerCase()).not.toContain(label);
    }
    expect(cellText("disagrees", 0)).toEqual({ pct: "0.0%", word: null });
  });

  it("never rounds a disagreement up to 100%", () => {
    expect(cellText("disagrees", 99.98).pct).toBe("99.9%");
  });

  it("says Correct only when every point agreed", () => {
    expect(cellText("correct", 100)).toEqual({ pct: "100%", word: "Correct" });
  });

  it("gives the no-percentage outcomes their word alone", () => {
    expect(cellText("rejected", null)).toEqual({ pct: null, word: "Rejected" });
    expect(cellText("error", null)).toEqual({ pct: null, word: "Error" });
    expect(cellText("no_data", null)).toEqual({ pct: null, word: "No data" });
  });

  it("never uses the retired phrasing", () => {
    for (const outcome of OUTCOMES) {
      const { pct, word } = cellText(outcome, 50);
      expect(`${pct ?? ""} ${word ?? ""} ${OUTCOME_LABELS[outcome]}`).not.toMatch(/wrong/i);
    }
  });
});

// ---------- Color separation ----------
//
// Pinned by numbers rather than by eye: sRGB -> CIELAB, CIE76 distance, and the
// Machado, Oliveira & Fernandes (2009) dichromacy matrices at severity 1.0,
// which operate on linear RGB.

type Vec3 = [number, number, number];

const MACHADO: Record<"deuteranopia" | "protanopia", [Vec3, Vec3, Vec3]> = {
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};

function toLinear(hex: string): Vec3 {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5)];
}

function simulate(rgb: Vec3, matrix: [Vec3, Vec3, Vec3]): Vec3 {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const row = (r: Vec3): number => clamp(r[0] * rgb[0] + r[1] * rgb[1] + r[2] * rgb[2]);
  return [row(matrix[0]), row(matrix[1]), row(matrix[2])];
}

function toLab([r, g, b]: Vec3): Vec3 {
  // sRGB D65 -> XYZ, normalized by the D65 white point.
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const VISIONS = [
  { name: "normal vision", matrix: null, threshold: 25 },
  { name: "deuteranopia", matrix: MACHADO.deuteranopia, threshold: 15 },
  { name: "protanopia", matrix: MACHADO.protanopia, threshold: 15 },
] as const;

function closestPairs(
  colors: Record<string, string>,
): { vision: string; pair: string; d: number }[] {
  const failures: { vision: string; pair: string; d: number }[] = [];
  const entries = Object.entries(colors);
  for (const vision of VISIONS) {
    const lab = (hex: string): Vec3 => {
      const linear = toLinear(hex);
      return toLab(vision.matrix === null ? linear : simulate(linear, vision.matrix));
    };
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [nameA, hexA] = entries[i] ?? ["", ""];
        const [nameB, hexB] = entries[j] ?? ["", ""];
        const d = deltaE(lab(hexA), lab(hexB));
        if (d < vision.threshold) {
          failures.push({ vision: vision.name, pair: `${nameA}/${nameB}`, d });
        }
      }
    }
  }
  return failures;
}

describe("color separation", () => {
  it("computes CIELAB the standard way", () => {
    const white = toLab(toLinear("#FFFFFF"));
    expect(white[0]).toBeCloseTo(100, 1);
    expect(Math.abs(white[1])).toBeLessThan(0.5);
    expect(toLab(toLinear("#000000"))).toEqual([0, 0, 0]);
  });

  it("keeps the point colors that appear together apart", () => {
    const failures = closestPairs({
      correctInside: POINT_COLORS.correctInside,
      falsePositive: POINT_COLORS.falsePositive,
      falseNegative: POINT_COLORS.falseNegative,
      submitted: GEOMETRY_COLORS.submitted,
    });
    expect(failures).toEqual([]);
  });

  it("keeps the outcome colors apart", () => {
    expect(closestPairs(OUTCOME_COLORS)).toEqual([]);
  });
});
