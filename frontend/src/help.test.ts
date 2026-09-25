import { describe, expect, it } from "vitest";

import { LAYER_HELP, layerHelp } from "./help";
import { LAYER_IDS } from "./map";

describe("LAYER_HELP", () => {
  it.each(LAYER_IDS)("explains %s", (layer) => {
    expect(LAYER_HELP[layer].length).toBeGreaterThan(20);
  });

  it("has no entries for layers that do not exist", () => {
    expect(Object.keys(LAYER_HELP).sort()).toEqual([...LAYER_IDS].sort());
  });
});

describe("layerHelp", () => {
  it("fills in the edge tolerance", () => {
    expect(layerHelp("skipped", 0.25)).toContain("Within 0.25° of an edge");
  });
});
