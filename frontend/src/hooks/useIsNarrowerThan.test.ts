import { renderHook, act } from "@testing-library/react";

import { useIsNarrowerThan } from "./useIsNarrowerThan";

function mockMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  let changeHandler: ((event: MediaQueryListEvent) => void) | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    media: "",
    addEventListener: jest.fn((event: string, handler: (event: MediaQueryListEvent) => void) => {
      if (event === "change") changeHandler = handler;
    }),
    removeEventListener: jest.fn(),
  };
  window.matchMedia = jest.fn().mockReturnValue(mql);
  return {
    fireChange(newMatches: boolean) {
      matches = newMatches;
      changeHandler?.({ matches: newMatches } as MediaQueryListEvent);
    },
  };
}

describe("useIsNarrowerThan", () => {
  it("reads the initial match state from matchMedia", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsNarrowerThan(1100));
    expect(result.current).toBe(true);
  });

  it("stays live across a matchMedia change event", () => {
    const { fireChange } = mockMatchMedia(false);
    const { result } = renderHook(() => useIsNarrowerThan(1100));
    expect(result.current).toBe(false);

    act(() => fireChange(true));
    expect(result.current).toBe(true);

    act(() => fireChange(false));
    expect(result.current).toBe(false);
  });

  it("queries max-width at breakpoint - 1, matching the human's below/at-and-above split", () => {
    mockMatchMedia(false);
    renderHook(() => useIsNarrowerThan(1100));
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 1099px)");
  });

  it("returns false without throwing when matchMedia is unavailable", () => {
    const original = window.matchMedia;
    // @ts-expect-error -- deliberately simulating an environment without matchMedia.
    delete window.matchMedia;
    const { result } = renderHook(() => useIsNarrowerThan(1100));
    expect(result.current).toBe(false);
    window.matchMedia = original;
  });
});
