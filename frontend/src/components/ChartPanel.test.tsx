import { getChartOption } from "./ChartPanel";

describe("getChartOption", () => {
  describe("line chart", () => {
    it("returns series[0].type === 'line'", () => {
      const option = getChartOption("line");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("line");
    });

    it("includes xAxis and yAxis", () => {
      const option = getChartOption("line");
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  describe("bar chart", () => {
    it("returns series[0].type === 'bar'", () => {
      const option = getChartOption("bar");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("bar");
    });

    it("includes xAxis and yAxis", () => {
      const option = getChartOption("bar");
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  describe("pie chart", () => {
    it("returns series[0].type === 'pie'", () => {
      const option = getChartOption("pie");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("pie");
    });

    it("omits xAxis and yAxis", () => {
      const option = getChartOption("pie");
      expect(option.xAxis).toBeUndefined();
      expect(option.yAxis).toBeUndefined();
    });
  });

  describe("scatter chart", () => {
    it("returns series[0].type === 'scatter'", () => {
      const option = getChartOption("scatter");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("scatter");
    });

    it("includes xAxis and yAxis", () => {
      const option = getChartOption("scatter");
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  describe("default", () => {
    it("defaults to line when no argument given", () => {
      const option = getChartOption();
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("line");
    });
  });
});
