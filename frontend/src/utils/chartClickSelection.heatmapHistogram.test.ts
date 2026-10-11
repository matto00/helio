import { mapChartClickToSelection } from "./chartClickSelection";

describe("heatmap/histogram clicks select nothing (HEL-1311)", () => {
  const headers = ["day", "test", "n"];
  const rows = [["Mon", "a", "1"]];
  it.each(["heatmap", "histogram"] as const)("mapChartClickToSelection is null for %s", (type) => {
    expect(
      mapChartClickToSelection(
        { componentType: "series", name: "Mon", value: [0, 0, 1] },
        type,
        { xAxis: "day", series: "test", yAxis: "n" },
        headers,
        rows,
      ),
    ).toBeNull();
  });

  it("still maps a bar click", () => {
    expect(
      mapChartClickToSelection(
        { componentType: "series", name: "Mon", seriesName: "n", value: 1 },
        "bar",
        { xAxis: "day", yAxis: "n" },
        headers,
        rows,
      ),
    ).not.toBeNull();
  });
});
