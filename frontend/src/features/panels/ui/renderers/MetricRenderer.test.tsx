import { render, screen } from "@testing-library/react";

import { MetricRenderer } from "./MetricRenderer";
import type { MetricComparison } from "../../history/metricHistoryView";

describe("MetricRenderer — unit rendering", () => {
  it("renders the unit adjacent to the value when both are present", () => {
    const { container } = render(<MetricRenderer data={{ value: "84", unit: "/100" }} />);
    const valueEl = container.querySelector(".panel-content__metric-value");
    expect(valueEl).toHaveTextContent("84/100");
    expect(container.querySelector(".panel-content__metric-unit")).toHaveTextContent("/100");
  });

  it("does not render a unit span when unit is absent", () => {
    const { container } = render(<MetricRenderer data={{ value: "84" }} />);
    expect(container.querySelector(".panel-content__metric-unit")).not.toBeInTheDocument();
  });
});

describe("MetricRenderer — label / No data fallback", () => {
  it("value with no label renders no 'No data' text and no label line", () => {
    render(<MetricRenderer data={{ value: "84" }} />);
    expect(screen.getByText("84")).toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  it("renders 'No data' only when the value is genuinely absent", () => {
    render(<MetricRenderer data={{ label: "Revenue" }} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders 'No data' when data is null", () => {
    render(<MetricRenderer data={null} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.getByText("--")).toBeInTheDocument();
  });

  it("value + label + trend still renders all three lines (regression)", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "42", label: "Revenue", trend: "+3.2%" }} />,
    );
    expect(container.querySelector(".panel-content__metric-value")).toHaveTextContent("42");
    expect(container.querySelector(".panel-content__metric-label")).toHaveTextContent("Revenue");
    expect(container.querySelector(".panel-content__metric-trend")).toHaveTextContent("+3.2%");
  });
});

describe("MetricRenderer — value formatting (HEL-297)", () => {
  it("rounds a long/repeating decimal to 2 fraction digits", () => {
    render(<MetricRenderer data={{ value: "3.3333333333333335" }} />);
    expect(screen.getByText("3.33")).toBeInTheDocument();
  });

  it("renders an integer value unchanged (no added decimals, no thousands separator)", () => {
    render(<MetricRenderer data={{ value: "1500" }} />);
    expect(screen.getByText("1500")).toBeInTheDocument();
  });

  it("renders a non-numeric string value unchanged", () => {
    render(<MetricRenderer data={{ value: "Active" }} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders the literal string 'Infinity' unchanged", () => {
    render(<MetricRenderer data={{ value: "Infinity" }} />);
    expect(screen.getByText("Infinity")).toBeInTheDocument();
  });
});

describe("MetricRenderer — trend direction classes", () => {
  it("applies the --up class when trend starts with '+'", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "100", label: "Revenue", trend: "+3.2%" }} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).toHaveClass(
      "panel-content__metric-trend--up",
    );
  });

  it("applies the --down class when trend starts with '-'", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "100", label: "Revenue", trend: "-1.1%" }} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).toHaveClass(
      "panel-content__metric-trend--down",
    );
  });

  it("applies the --flat class for a neutral trend string", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "100", label: "Revenue", trend: "0%" }} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).toHaveClass(
      "panel-content__metric-trend--flat",
    );
  });

  it("does not render a trend indicator when trend is absent", () => {
    const { container } = render(<MetricRenderer data={{ value: "100", label: "Revenue" }} />);
    expect(container.querySelector(".panel-content__metric-trend")).not.toBeInTheDocument();
  });
});

describe("MetricRenderer format (HEL-876)", () => {
  it("defaults to the pre-HEL-876 2-decimal, no-grouping formatting when format is absent", () => {
    render(<MetricRenderer data={{ value: "1234.5678" }} />);
    expect(screen.getByText("1234.57")).toBeInTheDocument();
  });

  it("rounds to a whole number for format: integer", () => {
    render(<MetricRenderer data={{ value: "1234.5678" }} format="integer" />);
    expect(screen.getByText("1,235")).toBeInTheDocument();
  });

  it("renders a currency symbol and grouping for format: currency", () => {
    render(<MetricRenderer data={{ value: "1234.5" }} format="currency" />);
    expect(screen.getByText("$1,234.50")).toBeInTheDocument();
  });

  it("multiplies by 100 and appends % for format: percent", () => {
    render(<MetricRenderer data={{ value: "0.4213" }} format="percent" />);
    expect(screen.getByText("42.13%")).toBeInTheDocument();
  });
});

describe("MetricRenderer — history comparison (HEL-1275)", () => {
  const delta = (over: Partial<Extract<MetricComparison, { kind: "delta" }>> = {}) =>
    ({
      kind: "delta",
      direction: "up",
      pct: 12,
      absDelta: 129,
      label: "7d",
      words: "versus 7 days earlier",
      baselineAt: "2026-09-28T09:00:00Z",
      baselineValue: 1075,
      ...over,
    }) as MetricComparison;

  it("renders up with the up modifier and an accessible name", () => {
    render(<MetricRenderer data={{ value: "1204" }} format="integer" comparison={delta()} />);
    expect(screen.getByText("1,204")).toBeInTheDocument();
    const el = screen.getByRole("img", { name: "up 12% versus 7 days earlier" });
    expect(el).toHaveTextContent("▲ 12% vs 7d");
    expect(el).toHaveClass("panel-content__metric-trend--up");
  });

  it("renders down", () => {
    render(
      <MetricRenderer data={{ value: "1" }} comparison={delta({ direction: "down", pct: 8.5 })} />,
    );
    const el = screen.getByRole("img", { name: /^down 8\.5%/ });
    expect(el).toHaveTextContent("▼ 8.5% vs 7d");
    expect(el).toHaveClass("panel-content__metric-trend--down");
  });

  it("renders flat with 0%", () => {
    render(
      <MetricRenderer data={{ value: "1" }} comparison={delta({ direction: "flat", pct: 0 })} />,
    );
    const el = screen.getByRole("img", { name: /^unchanged 0%/ });
    expect(el).toHaveTextContent("▬ 0% vs 7d");
    expect(el).toHaveClass("panel-content__metric-trend--flat");
  });

  it("shows the absolute delta in the headline's format when pct is null", () => {
    render(
      <MetricRenderer
        data={{ value: "5" }}
        format="integer"
        comparison={delta({ pct: null, absDelta: 5 })}
      />,
    );
    expect(screen.getByRole("img", { name: /^up 5 / })).toHaveTextContent("▲ 5 vs 7d");
  });

  it("labels previous_run as 'previous', never 'previous run'", () => {
    const { container } = render(
      <MetricRenderer
        data={{ value: "1" }}
        comparison={delta({ label: "previous", words: "versus the previous point" })}
      />,
    );
    expect(container).toHaveTextContent("vs previous");
    expect(container.textContent).not.toMatch(/previous run/i);
    expect(screen.getByRole("img").getAttribute("aria-label")).not.toMatch(/previous run/i);
  });

  it("renders the available-from note and no delta glyph", () => {
    const { container } = render(
      <MetricRenderer
        data={{ value: "1" }}
        comparison={{ kind: "availableFrom", label: "7d", availableFrom: "2026-10-12T09:00:00Z" }}
      />,
    );
    expect(container).toHaveTextContent(
      `7d comparison available from ${new Date("2026-10-12T09:00:00Z").toLocaleDateString()}`,
    );
    expect(container.textContent).not.toMatch(/[▲▼]/);
  });

  it("renders a focusable filtered marker with a tooltip and description", () => {
    render(<MetricRenderer data={{ value: "1" }} comparison={{ kind: "filtered" }} />);
    const marker = screen.getByTitle("comparison reflects unfiltered data");
    expect(marker).toHaveAttribute("tabindex", "0");
    expect(marker).toHaveAccessibleDescription("comparison reflects unfiltered data");
  });

  it("renders a sparkline only with at least two values", () => {
    const { rerender } = render(<MetricRenderer data={{ value: "1" }} sparkline={[1, 2, 3]} />);
    expect(
      screen.getByRole("img", { name: /Trend over 3 data points, rising/ }),
    ).toBeInTheDocument();
    rerender(<MetricRenderer data={{ value: "1" }} sparkline={[1]} />);
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<MetricRenderer data={{ value: "1" }} sparkline={null} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
