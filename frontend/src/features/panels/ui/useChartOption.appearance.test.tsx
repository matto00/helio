import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { ThemeProvider, useTheme } from "../../../theme/ThemeProvider";
import { useChartOption } from "./useChartOption";

// HEL-1572: a live type-style / motion switch must rebuild chart options (they resolve --font-sans and the
// reduced-motion flag from the DOM once per build). jsdom loads no theme.css, so the test installs the cascade the
// real attribute drives: a distinct --font-sans per data-type-style.
const SANS = "SansFace, sans-serif";
const MONO = "MonoFace, monospace";

let styleEl: HTMLStyleElement;
beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.motion;
  styleEl = document.createElement("style");
  styleEl.textContent = `
    :root { --font-sans: ${SANS}; }
    :root[data-type-style="mono"] { --font-sans: ${MONO}; }`;
  document.head.appendChild(styleEl);
  jest.useFakeTimers();
});
afterEach(() => {
  styleEl.remove();
  jest.useRealTimers();
});

function Wrapper({ children }: PropsWithChildren) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function render() {
  return renderHook(
    () => ({
      theme: useTheme(),
      option: useChartOption({
        appearance: undefined,
        rawRows: [
          ["a", "1"],
          ["b", "2"],
        ],
        headers: ["k", "v"],
        fieldMapping: { xAxis: "k", yAxis: "v" },
        effectiveCompact: false,
        measuredPieLegendOverlap: false,
      }),
    }),
    { wrapper: Wrapper },
  );
}

describe("useChartOption follows live appearance switches (HEL-1572)", () => {
  it("rebuilds the global text style when the type style switches to Mono", () => {
    const { result } = render();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    const before = (result.current.option.textStyle as { fontFamily: string }).fontFamily;
    expect(before).toBe(SANS);

    act(() => result.current.theme.setTypeStyle("mono"));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect((result.current.option.textStyle as { fontFamily: string }).fontFamily).toBe(MONO);
  });

  it("rebuilds series animation when motion switches Off, and back with Full", () => {
    const { result } = render();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    const animation = () =>
      (result.current.option.series as Array<{ animation?: boolean }>).map((s) => s.animation);
    expect(animation().every((a) => a === undefined)).toBe(true);

    act(() => result.current.theme.setMotion("off"));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    const off = animation();
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((a) => a === false)).toBe(true);

    act(() => result.current.theme.setMotion("full"));
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(animation().every((a) => a === undefined)).toBe(true);
  });
});
