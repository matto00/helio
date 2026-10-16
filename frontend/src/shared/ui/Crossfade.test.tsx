import { act, fireEvent, render, screen } from "@testing-library/react";
import fs from "fs";
import path from "path";

import { Crossfade } from "./Crossfade";

type AnimatableLayer = HTMLElement;

/** jsdom has no Web Animations; install (or remove) a `getAnimations` that reports `count` running animations. */
function reportAnimations(count: number | null) {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (count === null) delete proto.getAnimations;
  else proto.getAnimations = () => new Array(count).fill({});
}

function renderCrossfade(loading: boolean) {
  const wrap = (isLoading: boolean) => (
    <Crossfade loading={isLoading} skeleton={<div data-testid="skeleton">loading</div>}>
      <div data-testid="content">content</div>
    </Crossfade>
  );
  const view = render(wrap(loading));
  return { setLoading: (next: boolean) => view.rerender(wrap(next)) };
}

const skeletonLayer = () => screen.getByTestId("skeleton").parentElement as AnimatableLayer;

function flushFrame() {
  act(() => {
    jest.advanceTimersByTime(20);
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  reportAnimations(null);
});

describe("Crossfade", () => {
  it("shows only the skeleton while loading; children are not rendered", () => {
    renderCrossfade(true);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).toBeNull();
  });

  it("renders children alone, with no fade-in, when it never loaded", () => {
    renderCrossfade(false);
    expect(screen.queryByTestId("skeleton")).toBeNull();
    expect(screen.getByTestId("content").parentElement).not.toHaveClass(
      "crossfade__content--entering",
    );
  });

  it("when loading ends, hides the skeleton from assistive tech at once and fades the content in", () => {
    reportAnimations(1);
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    const layer = skeletonLayer();
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).toHaveAttribute("inert");
    expect(layer).toHaveClass("crossfade__skeleton--leaving");
    expect(screen.getByTestId("content").parentElement).toHaveClass("crossfade__content--entering");
  });

  it("unmounts the skeleton on transitionend", () => {
    reportAnimations(1);
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    flushFrame();
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    fireEvent.transitionEnd(skeletonLayer());
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("unmounts the skeleton on transitioncancel", () => {
    reportAnimations(1);
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    flushFrame();
    fireEvent(skeletonLayer(), new Event("transitioncancel"));
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("ignores a transition bubbling up from inside the skeleton", () => {
    reportAnimations(1);
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    flushFrame();
    fireEvent.transitionEnd(screen.getByTestId("skeleton"));
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
  });

  it("unmounts on the next frame when no transition is running (loading ended before the skeleton painted)", () => {
    reportAnimations(0);
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    flushFrame();
    expect(screen.queryByTestId("skeleton")).toBeNull();
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("unmounts on the next frame when getAnimations is unavailable (jsdom)", () => {
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    flushFrame();
    expect(screen.queryByTestId("skeleton")).toBeNull();
  });

  it("brings the skeleton back when loading starts again", () => {
    const { setLoading } = renderCrossfade(true);
    setLoading(false);
    flushFrame();
    setLoading(true);
    expect(screen.getByTestId("skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("skeleton").parentElement).not.toHaveAttribute("aria-hidden");
    expect(screen.queryByTestId("content")).toBeNull();
  });
});

describe("Crossfade.css sizing (C3)", () => {
  const css = fs
    .readFileSync(path.join(__dirname, "Crossfade.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("lets the body shrink with its card: the layer's child has min-width: 0 (a real-browser case is in the e2e)", () => {
    expect(css).toMatch(/\.crossfade__layer\s*>\s*\*\s*\{[^}]*min-width:\s*0/);
  });

  it("fades the content in with a backwards fill, so a settled body keeps no animation or stacking context", () => {
    const rule = /\.crossfade__content--entering\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/\bbackwards\s*;/);
    expect(rule).not.toMatch(/\bboth\b/);
  });
});
