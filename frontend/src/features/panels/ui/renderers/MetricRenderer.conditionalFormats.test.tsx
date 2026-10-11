import { render, screen } from "@testing-library/react";

import { MetricRenderer } from "./MetricRenderer";
import { CollectionRenderer } from "./CollectionRenderer";
import type { ConditionalFormatRule } from "./conditionalFormatting";
import type { MetricComparison } from "../../history/metricHistoryView";

// HEL-1307 task 4.4 (metric + collection). Jest maps `.css` to a style mock, so these prove CLASSES and DOM
// only; the resolved colours are proven by the Playwright computed-style spec (C5).

const lt50: ConditionalFormatRule = { op: "lt", value: 50, tone: "error", label: "Failing" };
const lt80: ConditionalFormatRule = { op: "lt", value: 80, tone: "warning" };
const ladder = [lt50, lt80];

describe("MetricRenderer -- conditional formatting", () => {
  it("wraps the value in a tone figure with a glyph, a title and sr text (labelled rule)", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "42" }} conditionalFormats={ladder} />,
    );
    const figure = container.querySelector(".panel-content__metric-figure");
    expect(figure).toHaveClass("panel-content__metric-figure--tone-error");
    expect(figure).toHaveAttribute("title", "Failing");
    expect(figure).toHaveTextContent("42");
    expect(figure?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(figure?.querySelector(".sr-only")).toHaveTextContent("Failing");
  });

  it("falls back to the tone word when the rule has no label", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "60" }} conditionalFormats={ladder} />,
    );
    const figure = container.querySelector(".panel-content__metric-figure");
    expect(figure).toHaveClass("panel-content__metric-figure--tone-warning");
    expect(figure).toHaveAttribute("title", "Warning");
    expect(figure?.querySelector(".sr-only")).toHaveTextContent("Warning");
  });

  it.each([
    ["success", "Good"],
    ["warning", "Warning"],
    ["error", "Critical"],
  ] as const)("uses a distinct glyph per tone (%s)", (tone, word) => {
    const { container } = render(
      <MetricRenderer data={{ value: "1" }} conditionalFormats={[{ op: "gt", value: 0, tone }]} />,
    );
    expect(container.querySelector(".sr-only")).toHaveTextContent(word);
    expect(container.querySelector(`.panel-content__metric-figure--tone-${tone}`)).not.toBeNull();
  });

  it("renders three different glyph shapes for the three tones", () => {
    const shapes = (["success", "warning", "error"] as const).map((tone) => {
      const { container, unmount } = render(
        <MetricRenderer
          data={{ value: "1" }}
          conditionalFormats={[{ op: "gt", value: 0, tone }]}
        />,
      );
      const html = container.querySelector(".panel-content__metric-figure svg")?.innerHTML ?? "";
      unmount();
      return html;
    });
    expect(new Set(shapes).size).toBe(3);
  });

  it("evaluates the RAW value while showing the formatted one", () => {
    const { container } = render(
      <MetricRenderer
        data={{ value: "0.75" }}
        format="percent"
        conditionalFormats={[{ op: "lt", value: 0.8, tone: "error" }]}
      />,
    );
    const figure = container.querySelector(".panel-content__metric-figure");
    expect(figure).toHaveTextContent("75%");
    expect(figure).toHaveClass("panel-content__metric-figure--tone-error");
  });

  it("renders nothing conditional when no rule matches or the value is absent", () => {
    for (const data of [{ value: "99" }, { value: "" }, null]) {
      const { container, unmount } = render(
        <MetricRenderer data={data} conditionalFormats={ladder} />,
      );
      expect(container.querySelector(".panel-content__metric-figure")).toBeNull();
      unmount();
    }
  });

  it("is DOM-identical to the pre-change render with no rules, an empty list or null", () => {
    const base = render(<MetricRenderer data={{ value: "42", unit: "ms", label: "p95" }} />)
      .container.innerHTML;
    for (const rules of [undefined, null, []]) {
      const { container, unmount } = render(
        <MetricRenderer
          data={{ value: "42", unit: "ms", label: "p95" }}
          conditionalFormats={rules}
        />,
      );
      expect(container.innerHTML).toBe(base);
      unmount();
    }
  });

  // STRUCTURAL GUARD (not behavioural): the unit must stay OUTSIDE the toned element and carry no tone class.
  // It would fail on the round-2 defect (tone class on the outer value span) -- but only the Playwright
  // computed-colour check (4.7b) proves the unit's colour on a panel with a custom text colour.
  it("GUARD: keeps the unit outside the toned element, with no tone class", () => {
    const { container } = render(
      <MetricRenderer data={{ value: "42", unit: "ms" }} conditionalFormats={ladder} />,
    );
    const figure = container.querySelector(".panel-content__metric-figure") as HTMLElement;
    const unit = container.querySelector(".panel-content__metric-unit") as HTMLElement;
    expect(unit).toHaveTextContent("ms");
    expect(figure.contains(unit)).toBe(false);
    expect(unit.className).toBe("panel-content__metric-unit");
    const outer = container.querySelector(".panel-content__metric-value") as HTMLElement;
    expect(outer.className).toBe("panel-content__metric-value");
    expect(unit.parentElement).toBe(outer);
  });

  it("leaves the delta line's own up/down/flat classes untouched", () => {
    const comparison: MetricComparison = {
      kind: "delta",
      direction: "up",
      pct: 12.5,
      absDelta: 5,
      label: "yesterday",
      words: "vs yesterday",
      baselineAt: "2026-10-01T00:00:00Z",
      baselineValue: 40,
    };
    const { container } = render(
      <MetricRenderer data={{ value: "42" }} comparison={comparison} conditionalFormats={ladder} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).toHaveClass(
      "panel-content__metric-trend--up",
    );
    expect(container.querySelector(".panel-content__metric-trend")?.className).not.toMatch(/tone/);
  });
});

describe("CollectionRenderer -- conditional formatting", () => {
  const HEADERS = ["region", "amount"];
  const ROWS = [
    ["North", "10"],
    ["South", "60"],
    ["East", "95"],
  ];

  it("evaluates each item's own value", () => {
    const { container } = render(
      <CollectionRenderer
        fieldMapping={{ value: "amount", label: "region" }}
        layout="grid"
        rawRows={ROWS}
        headers={HEADERS}
        conditionalFormats={ladder}
      />,
    );
    const items = Array.from(container.querySelectorAll(".panel-content__collection-item"));
    expect(items[0].querySelector(".panel-content__metric-figure")).toHaveClass(
      "panel-content__metric-figure--tone-error",
    );
    expect(items[1].querySelector(".panel-content__metric-figure")).toHaveClass(
      "panel-content__metric-figure--tone-warning",
    );
    expect(items[2].querySelector(".panel-content__metric-figure")).toBeNull();
    expect(screen.getByText("North")).toBeInTheDocument();
  });

  it("is DOM-identical with no rules", () => {
    const props = {
      fieldMapping: { value: "amount" },
      layout: "list" as const,
      rawRows: ROWS,
      headers: HEADERS,
    };
    const a = render(<CollectionRenderer {...props} />).container.innerHTML;
    const b = render(<CollectionRenderer {...props} conditionalFormats={[]} />).container.innerHTML;
    expect(b).toBe(a);
  });
});
