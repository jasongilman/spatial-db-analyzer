import { describe, expect, it } from "vitest";

import { formatRoute, parseRoute } from "./routing";

describe("parseRoute", () => {
  it("reads an empty hash as the summary", () => {
    expect(parseRoute("")).toEqual({ kind: "summary" });
    expect(parseRoute("#")).toEqual({ kind: "summary" });
    expect(parseRoute("#/")).toEqual({ kind: "summary" });
  });

  it("reads a combination route", () => {
    expect(parseRoute("#/combo/north_pole/shapely/raw")).toEqual({
      kind: "combo",
      polygonId: "north_pole",
      systemId: "shapely",
      variantId: "raw",
    });
  });

  it("decodes percent-encoded ids", () => {
    const route = parseRoute("#/combo/a%2Fb/shapely/raw");
    expect(route).toMatchObject({ polygonId: "a/b" });
  });

  it("falls back to the summary for anything unrecognized", () => {
    expect(parseRoute("#/nonsense")).toEqual({ kind: "summary" });
    expect(parseRoute("#/combo/too/few")).toEqual({ kind: "summary" });
    expect(parseRoute("#/combo/a/b/c/d")).toEqual({ kind: "summary" });
    expect(parseRoute("#/how-it-works/a/b")).toEqual({ kind: "summary" });
    expect(parseRoute("#/libraries/a/b")).toEqual({ kind: "summary" });
    expect(parseRoute("#/libraries/fixes/a/b")).toEqual({ kind: "summary" });
  });

  it("reads the how-it-works page, with or without a section", () => {
    expect(parseRoute("#/how-it-works")).toEqual({ kind: "how-it-works" });
    expect(parseRoute("#/how-it-works/outcomes")).toEqual({
      kind: "how-it-works",
      sectionId: "outcomes",
    });
  });

  it("reads the libraries page, a system on it, or a workaround on it", () => {
    expect(parseRoute("#/libraries")).toEqual({ kind: "libraries" });
    expect(parseRoute("#/libraries/shapely")).toEqual({ kind: "libraries", systemId: "shapely" });
    expect(parseRoute("#/libraries/fixes/densify")).toEqual({
      kind: "libraries",
      workaroundId: "densify",
    });
  });
});

describe("formatRoute", () => {
  it("formats the summary", () => {
    expect(formatRoute({ kind: "summary" })).toBe("#/");
  });

  it("formats a combination", () => {
    expect(
      formatRoute({
        kind: "combo",
        polygonId: "north_pole",
        systemId: "shapely",
        variantId: "raw",
      }),
    ).toBe("#/combo/north_pole/shapely/raw");
  });

  it("round-trips through parseRoute", () => {
    const route = {
      kind: "combo",
      polygonId: "both_poles",
      systemId: "duckdb_spatial",
      variantId: "densified_fix",
    } as const;
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it("round-trips every page route through parseRoute", () => {
    const routes = [
      { kind: "how-it-works" },
      { kind: "how-it-works", sectionId: "outcomes" },
      { kind: "libraries" },
      { kind: "libraries", systemId: "duckdb_spatial" },
      { kind: "libraries", workaroundId: "antimeridian" },
    ] as const;
    for (const route of routes) {
      expect(parseRoute(formatRoute(route))).toEqual(route);
    }
  });

  it("encodes ids that would otherwise break the path", () => {
    const hash = formatRoute({
      kind: "combo",
      polygonId: "a/b",
      systemId: "s",
      variantId: "v",
    });
    expect(hash).toBe("#/combo/a%2Fb/s/v");
    expect(parseRoute(hash)).toMatchObject({ polygonId: "a/b" });
  });
});
