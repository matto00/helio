import { act, fireEvent, render } from "@testing-library/react";
import { Profiler } from "react";

import { useScrollEdges } from "./useScrollEdges";

// HEL-1809: a measure that finds the same edges must not set state, so the owner (a DataGrid) does not re-render.
// Counts committed renders of the owner (React Profiler), never time. Rendered WITHOUT StrictMode.

const commits = { n: 0 };

function Harness() {
  const { ref, edges } = useScrollEdges<HTMLDivElement>();
  return (
    <div
      data-testid="scroller"
      ref={(el) => {
        ref.current = el;
        if (el) {
          Object.defineProperty(el, "scrollWidth", { configurable: true, value: 900 });
          Object.defineProperty(el, "clientWidth", { configurable: true, value: 300 });
          Object.defineProperty(el, "scrollLeft", { configurable: true, writable: true, value: 0 });
        }
      }}
    >
      {String(edges.right)}
    </div>
  );
}

describe("useScrollEdges unchanged-edge bail-out (HEL-1809)", () => {
  beforeEach(() => {
    commits.n = 0;
  });

  it("does not re-render when a scroll or window resize measures the same edges", () => {
    const { getByTestId } = render(
      <Profiler id="h" onRender={() => void (commits.n += 1)}>
        <Harness />
      </Profiler>,
    );
    const afterMount = commits.n;
    expect(getByTestId("scroller")).toHaveTextContent("true");

    act(() => {
      fireEvent.scroll(getByTestId("scroller"));
      window.dispatchEvent(new Event("resize"));
      fireEvent.scroll(getByTestId("scroller"));
    });

    expect(commits.n).toBe(afterMount);
  });

  it("still re-renders when the edges really change (and measures synchronously)", () => {
    const { getByTestId } = render(
      <Profiler id="h" onRender={() => void (commits.n += 1)}>
        <Harness />
      </Profiler>,
    );
    const afterMount = commits.n;
    const el = getByTestId("scroller");
    (el as unknown as { scrollLeft: number }).scrollLeft = 600;
    fireEvent.scroll(el);
    expect(commits.n).toBeGreaterThan(afterMount);
  });
});
