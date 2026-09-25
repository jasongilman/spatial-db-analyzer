/**
 * Checks on the committed results.json itself: the explanatory pages depend on
 * prose and geometry in it that the type checker can't see.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildDataset } from "./data";
import type { ResultsFile } from "./generated/results";
import { windingShares } from "./howItWorks";
import { densifyFigure } from "./libraries";

const file = JSON.parse(
  readFileSync(new URL("../public/results.json", import.meta.url), "utf8"),
) as ResultsFile;
const dataset = buildDataset(file);

describe("the committed results.json", () => {
  it("explains every library except the reference control", () => {
    for (const system of file.systems) {
      expect(system.docs_url).toMatch(/^https:\/\//);
      if (system.id === "reference") {
        expect(system.limitations).toEqual([]);
      } else {
        expect(system.limitations.length).toBeGreaterThan(0);
        for (const limitation of system.limitations) {
          expect(limitation.trim()).not.toBe("");
        }
      }
    }
  });

  it("says how every variant helps", () => {
    for (const variants of Object.values(file.variants)) {
      for (const variant of variants) {
        expect(variant.how_it_helps.trim()).not.toBe("");
      }
    }
  });

  it("resolves every workaround a variant names", () => {
    const known = new Set(file.workarounds.map((workaround) => workaround.id));
    for (const variants of Object.values(file.variants)) {
      for (const variant of variants) {
        for (const id of variant.workaround_ids) {
          expect(known).toContain(id);
        }
      }
    }
    for (const workaround of file.workarounds) {
      expect(workaround.explanation.trim()).not.toBe("");
    }
  });
});

describe("the explanatory figures", () => {
  it("draws both_poles as 88% as written and 12% reversed", () => {
    const polygon = dataset.polygonById.get("both_poles");
    expect(polygon).toBeDefined();
    if (polygon === undefined) {
      return;
    }
    const shares = windingShares(polygon);
    expect(Math.round(shares.asWritten * 100)).toBe(88);
    expect(Math.round(shares.reversed * 100)).toBe(12);
    // The text on the libraries page quotes the same split.
    const rewound = file.variants.shapely?.find((v) => v.id === "antimeridian_fix_rewound");
    expect(rewound?.tradeoffs.join(" ")).toContain("88% of the globe to the 12%");
  });

  it("pulls wide's top edge, densified, out of the submitted ring", () => {
    const figure = densifyFigure(dataset);
    expect(figure).not.toBeNull();
    if (figure === null) {
      return;
    }
    expect(figure.ends).toEqual([
      [80, 70],
      [-80, 70],
    ]);
    const first = figure.densified[0];
    const last = figure.densified[figure.densified.length - 1];
    expect(first?.[0]).toBeCloseTo(80, 6);
    expect(last?.[0]).toBeCloseTo(-80, 6);
    // A 39.4° arc at 1° steps: 40 segments.
    expect(figure.densified.length).toBe(41);
    // Every vertex sits on the arc, which bows far north of the 70° chord.
    const peak = Math.max(...figure.densified.map(([, lat]) => lat));
    expect(peak).toBeGreaterThan(86);
    expect(figure.before).toBe(4);
    expect(figure.after).toBeGreaterThan(100);
  });
});
