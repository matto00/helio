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

type Options = { contentFade?: boolean; block?: boolean; keepContentMounted?: boolean };

function renderWithOptions(loading: boolean, options: Options) {
  const wrap = (isLoading: boolean) => (
    <Crossfade
      loading={isLoading}
      skeleton={<div data-testid="skeleton">loading</div>}
      {...options}
    >
      <div data-testid="content">content</div>
    </Crossfade>
  );
  const view = render(wrap(loading));
  return { setLoading: (next: boolean) => view.rerender(wrap(next)), container: view.container };
}
const contentLayer = () => screen.getByTestId("content").parentElement as HTMLElement;

describe("Crossfade options (HEL-1584)", () => {
  it("contentFade={false}: the skeleton still fades out but the content layer gets no entering class", () => {
    reportAnimations(1);
    const { setLoading } = renderWithOptions(true, { contentFade: false });
    setLoading(false);
    expect(skeletonLayer()).toHaveClass("crossfade__skeleton--leaving");
    expect(contentLayer()).not.toHaveClass("crossfade__content--entering");
  });

  it("block: the root carries the block modifier so both layers are blocks", () => {
    const { container } = renderWithOptions(true, { block: true });
    expect(container.firstElementChild).toHaveClass("crossfade", "crossfade--block");
    const plain = renderWithOptions(true, {});
    expect(plain.container.firstElementChild).not.toHaveClass("crossfade--block");
  });

  describe("keepContentMounted", () => {
    it("mounts the content while loading, invisible, inert and hidden from assistive technology", () => {
      renderWithOptions(true, { keepContentMounted: true });
      expect(screen.getByTestId("content")).toBeInTheDocument();
      expect(contentLayer()).toHaveClass("crossfade__content--pending");
      expect(contentLayer()).toHaveAttribute("inert");
      expect(contentLayer()).toHaveAttribute("aria-hidden", "true");
    });

    it("loading that ends after the skeleton painted: the skeleton fades out and the content fades in", () => {
      reportAnimations(1);
      const { setLoading } = renderWithOptions(true, { keepContentMounted: true });
      flushFrame();
      setLoading(false);
      expect(contentLayer()).not.toHaveClass("crossfade__content--pending");
      expect(contentLayer()).not.toHaveAttribute("inert");
      expect(contentLayer()).toHaveClass("crossfade__content--entering");
      expect(skeletonLayer()).toHaveClass("crossfade__skeleton--leaving");
      expect(skeletonLayer()).toHaveAttribute("aria-hidden", "true");
    });

    it("loading that ends before the first frame: the skeleton is gone and the content has no entering class", () => {
      const { setLoading } = renderWithOptions(true, { keepContentMounted: true });
      setLoading(false);
      expect(screen.queryByTestId("skeleton")).toBeNull();
      expect(contentLayer()).not.toHaveClass("crossfade__content--entering");
      expect(contentLayer()).not.toHaveClass("crossfade__content--pending");
    });

    it("the content element survives the loading flip (a Suspense boundary inside it is not remounted)", () => {
      const { setLoading } = renderWithOptions(true, { keepContentMounted: true });
      const before = screen.getByTestId("content");
      flushFrame();
      setLoading(false);
      expect(screen.getByTestId("content")).toBe(before);
    });
  });
});

describe("Crossfade.css sizing (C3)", () => {
  const css = fs
    .readFileSync(path.join(__dirname, "Crossfade.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  it("lets the body shrink with its card: the layer's child has min-width: 0 (a real-browser case is in the e2e)", () => {
    expect(css).toMatch(/\.crossfade__layer\s*>\s*\*\s*\{[^}]*min-width:\s*0/);
  });

  it("lays the layers out as blocks under the block modifier, and hides a pending layer", () => {
    expect(css).toMatch(/\.crossfade--block\s*>\s*\.crossfade__layer\s*\{[^}]*display:\s*block/);
    expect(/\.crossfade__content--pending\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/opacity:\s*0/);
  });

  it("fades the content in with a backwards fill, so a settled body keeps no animation or stacking context", () => {
    const rule = /\.crossfade__content--entering\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/\bbackwards\s*;/);
    expect(rule).not.toMatch(/\bboth\b/);
  });
});
