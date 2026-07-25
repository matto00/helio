// HEL-399 — panel-type → shape-id mapping (design.md Decision 4).

import { PANEL_TYPE_SHAPES, shapesForPanelType } from "./panelShapes";

describe("PANEL_TYPE_SHAPES", () => {
  it("maps metric to single-row only", () => {
    expect(PANEL_TYPE_SHAPES.metric).toEqual(["single-row"]);
  });

  it("maps chart to time-series and top-n", () => {
    expect(PANEL_TYPE_SHAPES.chart).toEqual(["time-series", "top-n"]);
  });

  it("maps table to top-n and pivot-matrix", () => {
    expect(PANEL_TYPE_SHAPES.table).toEqual(["top-n", "pivot-matrix"]);
  });

  it("has no entry for text, markdown, collection, or timeline", () => {
    expect(PANEL_TYPE_SHAPES.text).toBeUndefined();
    expect(PANEL_TYPE_SHAPES.markdown).toBeUndefined();
    expect(PANEL_TYPE_SHAPES.collection).toBeUndefined();
    expect(PANEL_TYPE_SHAPES.timeline).toBeUndefined();
  });
});

describe("shapesForPanelType", () => {
  it("returns the mapped shape ids for metric/chart/table", () => {
    expect(shapesForPanelType("metric")).toEqual(["single-row"]);
    expect(shapesForPanelType("chart")).toEqual(["time-series", "top-n"]);
    expect(shapesForPanelType("table")).toEqual(["top-n", "pivot-matrix"]);
  });

  it("returns an empty array for unmapped panel types", () => {
    expect(shapesForPanelType("text")).toEqual([]);
    expect(shapesForPanelType("markdown")).toEqual([]);
    expect(shapesForPanelType("image")).toEqual([]);
  });

  it("returns an empty array for null", () => {
    expect(shapesForPanelType(null)).toEqual([]);
  });
});
