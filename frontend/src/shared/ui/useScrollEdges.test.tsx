import { fireEvent, render, screen } from "@testing-library/react";

import { useScrollEdges } from "./useScrollEdges";

/** jsdom performs no real layout, so `scrollWidth`/`clientWidth`/`scrollLeft`
 *  are always 0 by default — stub them on the specific element under test,
 *  mirroring `DataGrid.test.tsx`'s `getBoundingClientRect` stub pattern. */
function stubScrollMetrics(
  el: HTMLElement,
  metrics: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: metrics.scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: metrics.clientWidth });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    writable: true,
    value: metrics.scrollLeft,
  });
}

function Harness({
  scrollWidth,
  clientWidth,
  scrollLeft,
}: {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}) {
  const { ref, edges } = useScrollEdges<HTMLDivElement>();
  return (
    <div
      data-testid="scroller"
      ref={(el) => {
        ref.current = el;
        if (el) stubScrollMetrics(el, { scrollWidth, clientWidth, scrollLeft });
      }}
    >
      <span data-testid="left">{String(edges.left)}</span>
      <span data-testid="right">{String(edges.right)}</span>
    </div>
  );
}

describe("useScrollEdges (HEL a11y/ux sweep F-164)", () => {
  it("reports no scrollable edges when content fits (scrollWidth === clientWidth)", () => {
    render(<Harness scrollWidth={300} clientWidth={300} scrollLeft={0} />);
    expect(screen.getByTestId("left")).toHaveTextContent("false");
    expect(screen.getByTestId("right")).toHaveTextContent("false");
  });

  it("reports a right edge when scrolled to the start of overflowing content", () => {
    render(<Harness scrollWidth={900} clientWidth={300} scrollLeft={0} />);
    expect(screen.getByTestId("left")).toHaveTextContent("false");
    expect(screen.getByTestId("right")).toHaveTextContent("true");
  });

  it("reports both edges once scrolled into the middle of overflowing content", () => {
    render(<Harness scrollWidth={900} clientWidth={300} scrollLeft={300} />);
    const scroller = screen.getByTestId("scroller");
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("left")).toHaveTextContent("true");
    expect(screen.getByTestId("right")).toHaveTextContent("true");
  });

  it("reports only a left edge once scrolled all the way to the end", () => {
    render(<Harness scrollWidth={900} clientWidth={300} scrollLeft={600} />);
    const scroller = screen.getByTestId("scroller");
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("left")).toHaveTextContent("true");
    expect(screen.getByTestId("right")).toHaveTextContent("false");
  });
});

/** Vertical axis (HEL-1449): same stub pattern, on the Y metrics. */
function VerticalHarness({
  scrollHeight,
  clientHeight,
  scrollTop,
}: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) {
  const { ref, edges } = useScrollEdges<HTMLDivElement>();
  return (
    <div
      data-testid="scroller"
      ref={(el) => {
        ref.current = el;
        if (!el) return;
        Object.defineProperty(el, "scrollHeight", { configurable: true, value: scrollHeight });
        Object.defineProperty(el, "clientHeight", { configurable: true, value: clientHeight });
        Object.defineProperty(el, "scrollTop", {
          configurable: true,
          writable: true,
          value: scrollTop,
        });
      }}
    >
      <span data-testid="top">{String(edges.top)}</span>
      <span data-testid="bottom">{String(edges.bottom)}</span>
      <span data-testid="overflowingY">{String(edges.overflowingY)}</span>
      <span data-testid="overflowing">{String(edges.overflowing)}</span>
    </div>
  );
}

describe("useScrollEdges vertical axis (HEL-1449)", () => {
  it("reports nothing when content fits vertically", () => {
    render(<VerticalHarness scrollHeight={400} clientHeight={400} scrollTop={0} />);
    expect(screen.getByTestId("top")).toHaveTextContent("false");
    expect(screen.getByTestId("bottom")).toHaveTextContent("false");
    expect(screen.getByTestId("overflowingY")).toHaveTextContent("false");
  });

  it("tolerates a 1px rounding overflow", () => {
    render(<VerticalHarness scrollHeight={401} clientHeight={400} scrollTop={0} />);
    expect(screen.getByTestId("bottom")).toHaveTextContent("false");
    expect(screen.getByTestId("overflowingY")).toHaveTextContent("false");
  });

  it("reports only a bottom edge at the top of overflowing content", () => {
    render(<VerticalHarness scrollHeight={900} clientHeight={300} scrollTop={0} />);
    expect(screen.getByTestId("top")).toHaveTextContent("false");
    expect(screen.getByTestId("bottom")).toHaveTextContent("true");
    expect(screen.getByTestId("overflowingY")).toHaveTextContent("true");
  });

  it("reports both edges in the middle", () => {
    render(<VerticalHarness scrollHeight={900} clientHeight={300} scrollTop={300} />);
    expect(screen.getByTestId("top")).toHaveTextContent("true");
    expect(screen.getByTestId("bottom")).toHaveTextContent("true");
  });

  it("reports only a top edge at the end, and follows a scroll event", () => {
    render(<VerticalHarness scrollHeight={900} clientHeight={300} scrollTop={600} />);
    fireEvent.scroll(screen.getByTestId("scroller"));
    expect(screen.getByTestId("top")).toHaveTextContent("true");
    expect(screen.getByTestId("bottom")).toHaveTextContent("false");
    expect(screen.getByTestId("overflowingY")).toHaveTextContent("true");
  });

  it("leaves the horizontal `overflowing` flag horizontal-only", () => {
    render(<VerticalHarness scrollHeight={900} clientHeight={300} scrollTop={0} />);
    expect(screen.getByTestId("overflowing")).toHaveTextContent("false");
  });
});
