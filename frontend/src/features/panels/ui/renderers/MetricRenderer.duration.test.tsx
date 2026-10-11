import { render, screen } from "@testing-library/react";

import { CollectionRenderer } from "./CollectionRenderer";
import { MetricRenderer, formatMetricValue } from "./MetricRenderer";
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
