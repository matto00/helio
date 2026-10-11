// HEL-1305 -- the "vs" overlay, reference marks, tooltip and UTC on a time x axis.
import * as echarts from "echarts";

import {
  build,
  internals,
  SERIES_HEADERS,
  SERIES_MAPPING,
  seriesOf,
  TIMESTAMP_X,
  utc,
  xAxisOf,
} from "./timeAxisTestSupport";
import { REFERENCE_CARRIER_ID } from "./referenceMarksOption";

beforeAll(() => {
  jest
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(
      () => ({ measureText: (t: string) => ({ width: t.length * 6 }), font: "" }) as never,
    );
});

const mapping = { xAxis: "day", yAxis: "amount" };
const rows = [
  ["2026-10-09", "9", "e"],
  ["2026-10-01", "1", "e"],
  ["2026-10-02", "2", "e"],
];
const single = { rows, headers: SERIES_HEADERS, fieldMapping: mapping, fieldTypes: TIMESTAMP_X };

type Formatter = (params: unknown) => string;
const tooltipFormatter = (o: ReturnType<typeof build>) =>
  (o.tooltip as { formatter: Formatter }).formatter;

describe("the 'vs' overlay on a time axis aligns by instant", () => {
  const overlay = {
    label: "vs 7d",
    points: [
      ["2026-10-01T00:00:00Z", 3],
      ["2026-10-09", 5],
      [null, 99],
    ] as Array<[string | number | null, number | null]>,
  };

  it("appends a labelled series with a value at each matching instant and null elsewhere", () => {
    const option = build("line", { ...single, overlay });
    const [primary, vs] = seriesOf(option);
    expect(primary.data).toHaveLength(3);
    expect(vs.name).toBe("vs 7d");
    expect(vs.data).toEqual([
      { name: "2026-10-01", value: [utc("2026-10-01"), 3] },
      { name: "2026-10-02", value: [utc("2026-10-02"), null] },
      { name: "2026-10-09", value: [utc("2026-10-09"), 5] },
    ]);
    expect((option.legend as { data: unknown[] }).data).toContain("vs 7d");
  });

  it("is ignored when no primary instant matches", () => {
    const option = build("line", {
      ...single,
      overlay: { label: "vs", points: [["2025-01-01", 1]] },
    });
    expect(seriesOf(option)).toHaveLength(1);
  });

  it("is still ignored for a multi-series primary", () => {
    const option = build("line", {
      rows: [
        ["2026-10-01", "1", "A"],
        ["2026-10-01", "2", "B"],
      ],
      headers: SERIES_HEADERS,
      fieldMapping: SERIES_MAPPING,
      fieldTypes: TIMESTAMP_X,
      overlay,
    });
    expect(seriesOf(option).map((s) => s.name)).toEqual(["A", "B"]);
  });

  it("an off-midnight overlay point cannot turn the date-only tooltip into a date-time", () => {
    const option = build("line", {
      ...single,
      overlay: {
        label: "vs",
        points: [
          ["2026-10-01T12:00:00Z", 3],
          ["2026-10-02", 4],
        ],
      },
    });
    const text = tooltipFormatter(option)([
      { value: [utc("2026-10-02"), 2], seriesName: "amount", marker: "" },
    ]);
    expect(text.startsWith("2026-10-02<br/>")).toBe(true);
  });
});

describe("reference marks on a time-axis line (marks sit on the value axis, so they are unaffected)", () => {
  it("keeps the carrier series and a value axis widened to the mark", () => {
    const option = build("line", {
      ...single,
      referenceMarks: { lines: [{ value: 95 }], bands: [{ from: 60, to: 120 }] },
    });
    expect(seriesOf(option).some((s) => s.id === REFERENCE_CARRIER_ID)).toBe(true);
    const chart = echarts.init(null as never, undefined, {
      renderer: "svg",
      ssr: true,
      width: 600,
      height: 400,
    });
    chart.setOption(option);
    const extent = internals(chart).getModel().getComponent("yAxis").axis.scale.getExtent();
    chart.dispose();
    expect(extent[1]).toBeGreaterThanOrEqual(120);
    expect(xAxisOf(option).type).toBe("time");
  });
});

describe("the time-axis tooltip", () => {
  it("shows the UTC date when every plotted x is midnight UTC", () => {
    const text = tooltipFormatter(build("line", single))({
      value: [utc("2026-10-02"), 2.5],
      seriesName: "amount",
      marker: "<i></i>",
    });
    expect(text).toBe("2026-10-02<br/><i></i>amount: <b>2.5</b>");
  });

  it("shows the UTC date and time when any plotted x is not midnight", () => {
    const option = build("line", { ...single, rows: [...rows, ["2026-10-03T07:30", "3", "e"]] });
    const text = tooltipFormatter(option)({
      value: [utc("2026-10-03T07:30"), 3],
      seriesName: "amount",
    });
    expect(text.startsWith("2026-10-03 07:30<br/>")).toBe(true);
  });

  it("renders a gap as an em dash on a multi-series axis tooltip, never 0", () => {
    const option = build("line", {
      rows: [
        ["2026-10-01", "1", "A"],
        ["2026-10-02", "2", "A"],
        ["2026-10-01", "5", "B"],
      ],
      headers: SERIES_HEADERS,
      fieldMapping: SERIES_MAPPING,
      fieldTypes: TIMESTAMP_X,
    });
    expect((option.tooltip as { trigger?: string }).trigger).toBe("axis");
    const text = tooltipFormatter(option)([
      { value: [utc("2026-10-02"), 2], seriesName: "A", marker: "" },
      { value: [utc("2026-10-02"), null], seriesName: "B", marker: "" },
    ]);
    expect(text).toBe("2026-10-02<br/>A: <b>2</b><br/>B: <b>—</b>");
  });

  it("renders a series name literally, never as markup", () => {
    const text = tooltipFormatter(build("line", single))({
      value: [utc("2026-10-02"), 2],
      seriesName: "<b>x</b>",
    });
    expect(text).toContain("&lt;b&gt;x&lt;/b&gt;: ");
    expect(text).not.toContain("<b>x</b>");
  });

  it("a category chart has no custom tooltip formatter and no UTC flag", () => {
    const option = build("line", { ...single, fieldTypes: { day: "string" } });
    expect((option.tooltip as { formatter?: unknown }).formatter).toBeUndefined();
    expect(option.useUTC).toBeUndefined();
  });
});
