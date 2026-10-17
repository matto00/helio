import { act, render, screen } from "@testing-library/react";
import { lazy } from "react";

import { PanelSuspenseFallback, PageSuspenseFallback, RouteSuspense } from "./SuspenseFallback";

describe("PanelSuspenseFallback", () => {
  it("renders a labelled skeleton matching the panel data-loading pattern (HEL-528 design.md D6)", () => {
    const { container } = render(<PanelSuspenseFallback />);
    expect(container.querySelector('[aria-label="Loading data"]')).toBeInTheDocument();
    expect(container.querySelector(".panel-body-skeleton")).toBeInTheDocument();
    expect(container.querySelector(".ui-skeleton")).toBeInTheDocument();
    // No spinner here anymore — the chunk-load and data-load states share
    // one skeleton treatment (design.md D6), not a spinner.
    expect(container.querySelector(".ui-spinner")).not.toBeInTheDocument();
  });
});

describe("PageSuspenseFallback", () => {
  it("renders an unlabelled full-width loading indicator", () => {
    const { container } = render(<PageSuspenseFallback />);
    expect(container.querySelector('[aria-label="Loading"]')).toBeInTheDocument();
    expect(container.querySelector(".ui-spinner--2xl")).toBeInTheDocument();
  });
});

// HEL-1584 D6: a route-level boundary that crossfades its fallback into the loaded route.
describe("RouteSuspense", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function deferredPage() {
    let resolve!: (module: { default: () => React.ReactElement }) => void;
    const promise = new Promise<{ default: () => React.ReactElement }>((r) => (resolve = r));
    const Page = lazy(() => promise);
    return { Page, load: () => resolve({ default: () => <p>Loaded page</p> }) };
  }
  const frame = () => act(() => void jest.advanceTimersByTime(20));
  const flush = async () => {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };

  it("shows the fallback while the chunk loads, the route mounted but hidden and inert", () => {
    const { Page } = deferredPage();
    const { container } = render(
      <RouteSuspense>
        <Page />
      </RouteSuspense>,
    );
    expect(container.querySelector('[aria-label="Loading"]')).toBeInTheDocument();
    expect(container.querySelector(".crossfade")).toHaveClass("crossfade--block");
    expect(container.querySelector(".crossfade__content--pending")).toHaveAttribute("inert");
    expect(screen.queryByText("Loaded page")).toBeNull();
  });

  it("a chunk that resolves after the fallback painted fades the fallback out and the route in", async () => {
    const { Page, load } = deferredPage();
    const { container } = render(
      <RouteSuspense>
        <Page />
      </RouteSuspense>,
    );
    frame();
    load();
    await flush();
    expect(screen.getByText("Loaded page")).toBeInTheDocument();
    expect(container.querySelector(".crossfade__skeleton--leaving")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector(".crossfade__content--entering")).toBeInTheDocument();
    expect(container.querySelector(".crossfade__content--pending")).toBeNull();
  });

  it("a chunk that resolves before the first frame swaps with no fade", async () => {
    const { Page, load } = deferredPage();
    const { container } = render(
      <RouteSuspense>
        <Page />
      </RouteSuspense>,
    );
    load();
    await flush();
    expect(screen.getByText("Loaded page")).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Loading"]')).toBeNull();
    expect(container.querySelector(".crossfade__content--entering")).toBeNull();
  });
});
