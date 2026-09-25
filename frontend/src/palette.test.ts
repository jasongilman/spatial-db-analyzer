import { describe, expect, it } from "vitest";

import {
  OUTCOME_COLORS,
  OUTCOME_DESCRIPTIONS,
  OUTCOME_LABELS,
  POINT_COLORS,
  outcomeHasAnswer,
  outcomeStyle,
} from "./palette";
import type { Outcome } from "./palette";

const OUTCOMES: Outcome[] = ["correct", "accepted_but_wrong", "rejected", "error", "no_data"];

describe("outcomeStyle", () => {
  it("maps each outcome to its color and label", () => {
    expect(outcomeStyle("correct")).toEqual({ color: "#0072B2", label: "Correct" });
    expect(outcomeStyle("accepted_but_wrong")).toEqual({
      color: "#D55E00",
      label: "Accepted but wrong",
    });
    expect(outcomeStyle("rejected")).toEqual({ color: "#E69F00", label: "Rejected" });
    expect(outcomeStyle("error")).toEqual({ color: "#8B4513", label: "Error" });
    expect(outcomeStyle("no_data")).toEqual({ color: "#767676", label: "No data" });
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
    for (const color of [...Object.values(POINT_COLORS), ...Object.values(OUTCOME_COLORS)]) {
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
    expect(outcomeHasAnswer("accepted_but_wrong")).toBe(true);
    // The library answered; there was just nothing to compare it to.
    expect(outcomeHasAnswer("no_data")).toBe(true);
  });
});
