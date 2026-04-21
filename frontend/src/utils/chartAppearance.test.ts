import { appearanceToEChartsOption } from "./chartAppearance";
import type { ChartAppearance } from "../types/models";

const baseChart: ChartAppearance = {
  seriesColors: [],
  legend: { show: true, position: "top" },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X" },
    y: { show: true, label: "Y" },
  },
};

describe("appearanceToEChartsOption", () => {
  it("sets color array when seriesColors is non-empty", () => {
    const chart = { ...baseChart, seriesColors: ["#ff0000", "#00ff00"] };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.color).toEqual(["#ff0000", "#00ff00"]);
  });

  it("omits color key when seriesColors is empty", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.color).toBeUndefined();
  });

  it("maps legend show=true and position=top to horizontal orient at top", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.legend).toMatchObject({ show: true, orient: "horizontal", top: 0 });
  });

  it("maps legend show=false to hidden legend", () => {
    const chart = { ...baseChart, legend: { show: false, position: "top" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ show: false });
  });

  it("maps legend position=bottom to bottom orient", () => {
    const chart = { ...baseChart, legend: { show: true, position: "bottom" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ orient: "horizontal", bottom: 0 });
  });

  it("maps legend position=left to vertical orient", () => {
    const chart = { ...baseChart, legend: { show: true, position: "left" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ orient: "vertical", left: 0 });
  });

  it("maps legend position=right to vertical orient", () => {
    const chart = { ...baseChart, legend: { show: true, position: "right" as const } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.legend).toMatchObject({ orient: "vertical", right: 0 });
  });

  it("maps tooltip.enabled=true to show:true", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.tooltip).toMatchObject({ show: true });
  });

  it("maps tooltip.enabled=false to show:false", () => {
    const chart = { ...baseChart, tooltip: { enabled: false } };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.tooltip).toMatchObject({ show: false });
  });

  it("maps axisLabels.x.show=true and label to xAxis", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.xAxis).toMatchObject({ axisLabel: { show: true }, name: "X" });
  });

  it("maps axisLabels.x.show=false to xAxis axisLabel.show false", () => {
    const chart = {
      ...baseChart,
      axisLabels: { ...baseChart.axisLabels, x: { show: false, label: "X" } },
    };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.xAxis).toMatchObject({ axisLabel: { show: false } });
  });

  it("maps axisLabels.y.show and label to yAxis", () => {
    const { option } = appearanceToEChartsOption(baseChart);
    expect(option.yAxis).toMatchObject({ axisLabel: { show: true }, name: "Y" });
  });

  it("defaults to empty string when label is undefined", () => {
    const chart = {
      ...baseChart,
      axisLabels: {
        x: { show: true },
        y: { show: true },
      },
    };
    const { option } = appearanceToEChartsOption(chart);
    expect(option.xAxis).toMatchObject({ name: "" });
    expect(option.yAxis).toMatchObject({ name: "" });
  });

  describe("chartType propagation", () => {
    it('returns chartType="line" when chartType is undefined', () => {
      const { chartType } = appearanceToEChartsOption(baseChart);
      expect(chartType).toBe("line");
    });

    it('returns chartType="bar" when chartType is bar', () => {
      const chart = { ...baseChart, chartType: "bar" as const };
      const { chartType } = appearanceToEChartsOption(chart);
      expect(chartType).toBe("bar");
    });

    it('returns chartType="pie" when chartType is pie', () => {
      const chart = { ...baseChart, chartType: "pie" as const };
      const { chartType } = appearanceToEChartsOption(chart);
      expect(chartType).toBe("pie");
    });

    it('returns chartType="scatter" when chartType is scatter', () => {
      const chart = { ...baseChart, chartType: "scatter" as const };
      const { chartType } = appearanceToEChartsOption(chart);
      expect(chartType).toBe("scatter");
    });
  });
});
