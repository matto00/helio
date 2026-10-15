import { render, screen } from "@testing-library/react";

import { CollectionRenderer } from "./CollectionRenderer";
import { MetricRenderer, formatMetricValue, metricBaselineText } from "./MetricRenderer";
import type { ConditionalFormatRule } from "./conditionalFormatting";
import type { MetricComparison } from "../../history/metricHistoryView";

// HEL-1308 task 4.2.
describe("formatMetricValue -- duration", () => {
  it("duration reads seconds, durationMs reads milliseconds", () => {
    expect(formatMetricValue("330", "duration")).toBe("5m 30s");
    expect(formatMetricValue("330000", "durationMs")).toBe("5m 30s");
    expect(formatMetricValue("3629500", "durationMs")).toBe("1h");
  });

  // GUARD (passes on base behaviour: the early returns precede the format switch). Mutation that turns it
  // red: delete `if (!Number.isFinite(n)) return value;` in formatMetricValue (red-guard-metric-fallback.log).
  it("falls back exactly like the other formats for empty / non-numeric / undefined", () => {
    expect(formatMetricValue(undefined, "duration")).toBeUndefined();
    expect(formatMetricValue("", "duration")).toBe("");
    expect(formatMetricValue("n/a", "durationMs")).toBe("n/a");
    expect(formatMetricValue("Infinity", "duration")).toBe("Infinity");
  });
});

describe("MetricRenderer -- duration", () => {
  it("renders the duration text for the value", () => {
    render(<MetricRenderer data={{ value: "330" }} format="duration" />);
    expect(screen.getByText("5m 30s")).toBeInTheDocument();
  });

  it("a HEL-1307 rule compares the RAW value: text formatted, tone from 700 > 600", () => {
    const rule: ConditionalFormatRule = { op: "gt", value: 600, tone: "warning" };
    const { container } = render(
      <MetricRenderer data={{ value: "700" }} format="duration" conditionalFormats={[rule]} />,
    );
    const figure = container.querySelector(".panel-content__metric-figure");
    expect(figure).toHaveClass("panel-content__metric-figure--tone-warning");
    expect(figure).toHaveTextContent("11m 40s");
  });

  it("the comparison delta reads as duration text", () => {
    const comparison: MetricComparison = {
      kind: "delta",
      direction: "up",
      pct: null,
      absDelta: 65,
      label: "yesterday",
      words: "vs yesterday",
      baselineAt: "2026-10-01T00:00:00Z",
      baselineValue: 40,
    };
    const { container } = render(
      <MetricRenderer data={{ value: "330" }} format="duration" comparison={comparison} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).toHaveTextContent(
      "1m 5s vs yesterday",
    );
  });
});

describe("CollectionRenderer -- duration", () => {
  it("an item with value 90 renders 1m 30s", () => {
    render(
      <CollectionRenderer
        fieldMapping={{ value: "d", label: "name" }}
        layout="grid"
        format="duration"
        rawRows={[["job", "90"]]}
        headers={["name", "d"]}
      />,
    );
    expect(screen.getByText("1m 30s")).toBeInTheDocument();
  });
});

// HEL-1308 owner ruling on P6: the metric `unit` suffix is HIDDEN for a duration-formatted value (the stored
// `unit` config is untouched; this is a display rule). "5m 30s s" must never render.
describe("duration format hides the unit suffix", () => {
  it.each(["duration", "durationMs"] as const)(
    "metric format %s renders no unit element",
    (format) => {
      const value = format === "duration" ? "330" : "330000";
      const { container } = render(<MetricRenderer data={{ value, unit: "s" }} format={format} />);
      expect(container.querySelector(".panel-content__metric-unit")).toBeNull();
      expect(container.querySelector(".panel-content__metric-value")).toHaveTextContent(/^5m 30s$/);
    },
  );

  it("keeps the unit for a non-duration format (guard: unchanged behaviour)", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "330", unit: "s" }} format="number" />,
    );
    expect(container.querySelector(".panel-content__metric-unit")).toHaveTextContent("s");
  });

  it("a unit column bound through fieldMapping is hidden too", () => {
    const { container } = render(
      <CollectionRenderer
        fieldMapping={{ value: "d", label: "name", unit: "u" }}
        layout="grid"
        format="durationMs"
        rawRows={[["job", "90000", "ms"]]}
        headers={["name", "d", "u"]}
      />,
    );
    expect(container.querySelector(".panel-content__metric-unit")).toBeNull();
  });

  it("the history baseline text drops the unit for duration and keeps it otherwise", () => {
    expect(metricBaselineText(330, "duration", "s")).toBe("5m 30s");
    expect(metricBaselineText(330000, "durationMs", "ms")).toBe("5m 30s");
    expect(metricBaselineText(330, "number", "s")).toBe("330 s");
    expect(metricBaselineText(330, null, undefined)).toBe("330");
  });
});
