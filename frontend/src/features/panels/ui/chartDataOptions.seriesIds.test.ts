import { buildAggregateDataOption, buildDataOption, withSeriesIds } from "./chartDataOptions";

// HEL-1584 D10: every series carries a stable id so a same-shape refresh can update it in place.

const ids = (option: { series?: unknown }) =>
  (option.series as Array<{ id?: string }>).map((s) => s.id);

describe("series ids (HEL-1584 D10)", () => {
  const headers = ["day", "amount", "region"];
  const rows = [
    ["a", "1", "east"],
    ["b", "2", "west"],
  ];

  it("a single series is `<type>:<name>`", () => {
    const option = buildDataOption(rows, headers, { xAxis: "day", yAxis: "amount" }, "line");
    expect(ids(option)).toEqual(["line:amount"]);
  });

  it("series grouped by a column get one id per group", () => {
    const option = buildDataOption(
      rows,
      headers,
      { xAxis: "day", yAxis: "amount", series: "region" },
      "bar",
    );
    expect(ids(option)).toEqual(["bar:east", "bar:west"]);
  });

  it("the same type and name twice are index-suffixed", () => {
    const option = withSeriesIds(
      {
        series: [
          { type: "line", name: "x", data: [] },
          { type: "line", name: "x", data: [] },
        ],
      },
      "line",
    );
    expect(ids(option)).toEqual(["line:x", "line:x#1"]);
  });

  it("the ids do not depend on the data, so a refresh keeps them", () => {
    const first = buildDataOption(rows, headers, { xAxis: "day", yAxis: "amount" }, "line");
    const refreshed = buildDataOption(
      [
        ["a", "9"],
        ["b", "8"],
        ["c", "7"],
      ],
      headers,
      { xAxis: "day", yAxis: "amount" },
      "line",
    );
    expect(ids(refreshed)).toEqual(ids(first));
  });

  it("a pie slice series and an aggregate series are identified too", () => {
    expect(ids(buildDataOption(rows, headers, { xAxis: "day", yAxis: "amount" }, "pie"))).toEqual([
      "pie:",
    ]);
    const aggregate = { categories: ["a"], values: [1], seriesName: "Total" } as never;
    expect(ids(buildAggregateDataOption(aggregate, "bar"))).toEqual(["bar:Total"]);
  });

  it("keeps an id a builder already set, and leaves an option with no series alone", () => {
    expect(ids(withSeriesIds({ series: [{ type: "line", id: "mine" }] }, "line"))).toEqual([
      "mine",
    ]);
    expect(withSeriesIds({}, "line")).toEqual({});
  });
});
