import type { EChartsOption } from "echarts";

import { chartShapeSignature, ShapeMemory } from "./chartShapeSignature";

// HEL-1584 D10: two options share a signature exactly when they differ only in data payloads.

const base = (): EChartsOption => ({
  legend: { data: ["amount"] },
  xAxis: { type: "category", name: "Day", data: ["a", "b"] },
  yAxis: { type: "value", min: 0, axisLabel: { formatter: (v: number) => `${v}%` } },
  series: [{ id: "line:amount", type: "line", name: "amount", data: [1, 2] }],
});

describe("chartShapeSignature", () => {
  it("is the same for a pure data refresh (series data and category data)", () => {
    const refreshed = base();
    (refreshed.series as Array<{ data: number[] }>)[0].data = [5, 6, 7];
    (refreshed.xAxis as { data: string[] }).data = ["a", "b", "c"];
    expect(chartShapeSignature(refreshed)).toBe(chartShapeSignature(base()));
  });

  it("is the same when a formatter is rebuilt with identical source", () => {
    const rebuilt = base();
    (rebuilt.yAxis as { axisLabel: { formatter: unknown } }).axisLabel.formatter = (v: number) =>
      `${v}%`;
    expect(chartShapeSignature(rebuilt)).toBe(chartShapeSignature(base()));
  });

  it("is the same whatever order the keys were written in", () => {
    const reordered = {
      series: base().series,
      yAxis: base().yAxis,
      xAxis: base().xAxis,
      legend: base().legend,
    };
    expect(chartShapeSignature(reordered as EChartsOption)).toBe(chartShapeSignature(base()));
  });

  it.each([
    [
      "the chart type",
      (o: EChartsOption) => ((o.series as Array<{ type: string }>)[0].type = "bar"),
    ],
    [
      "a series being added",
      (o: EChartsOption) => (o.series as unknown[]).push({ type: "line", name: "b" }),
    ],
    [
      "a series id",
      (o: EChartsOption) => ((o.series as Array<{ id: string }>)[0].id = "line:other"),
    ],
    ["an axis name removed", (o: EChartsOption) => delete (o.xAxis as { name?: string }).name],
    ["an axis min removed", (o: EChartsOption) => delete (o.yAxis as { min?: number }).min],
    [
      "a different formatter",
      (o: EChartsOption) =>
        ((o.yAxis as { axisLabel: { formatter: unknown } }).axisLabel.formatter = (v: number) =>
          `${v}!`),
    ],
    ["a legend setting", (o: EChartsOption) => ((o.legend as { show?: boolean }).show = false)],
    [
      "a series losing its data field",
      (o: EChartsOption) => delete (o.series as Array<{ data?: unknown }>)[0].data,
    ],
  ])("changes with %s", (_label, mutate) => {
    const changed = base();
    mutate(changed);
    expect(chartShapeSignature(changed)).not.toBe(chartShapeSignature(base()));
  });

  it("strips dataset sources and a heatmap's data-derived visualMap bounds, but not its other settings", () => {
    const heat = (min: number, calculable: boolean): EChartsOption => ({
      dataset: { source: [[min]] },
      visualMap: { min, max: min + 10, calculable },
      series: [{ type: "heatmap" }],
    });
    expect(chartShapeSignature(heat(0, true))).toBe(chartShapeSignature(heat(5, true)));
    expect(chartShapeSignature(heat(0, true))).not.toBe(chartShapeSignature(heat(0, false)));
  });
});

describe("ShapeMemory", () => {
  it("matches nothing until something is committed, then only that signature", () => {
    const memory = new ShapeMemory();
    expect(memory.matches("a")).toBe(false);
    memory.commit("a");
    expect(memory.matches("a")).toBe(true);
    expect(memory.matches("b")).toBe(false);
  });
});
