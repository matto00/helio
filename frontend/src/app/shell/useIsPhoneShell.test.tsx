import { act, renderHook } from "@testing-library/react";

import { PHONE_SHELL_QUERY, useIsPhoneShell } from "./useIsPhoneShell";

type Listener = () => void;

/** A matchMedia that evaluates `(max-width: Npx)` against a settable width, like a browser. */
function installMatchMedia(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<Listener>();
  const queries: string[] = [];
  window.matchMedia = ((query: string) => {
    queries.push(query);
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
    return {
      get matches() {
        return width <= max;
      },
      media: query,
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    queries,
    resize(next: number) {
      width = next;
      act(() => listeners.forEach((l) => l()));
    },
  };
}

describe("useIsPhoneShell", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("uses the same (max-width: 768px) query as every shell stylesheet", () => {
    expect(PHONE_SHELL_QUERY).toBe("(max-width: 768px)");
  });

  it("treats exactly 768px as a phone shell and 769px as the rail shell", () => {
    const media = installMatchMedia(768);
    const { result } = renderHook(() => useIsPhoneShell());
    expect(result.current).toBe(true);
    media.resize(769);
    expect(result.current).toBe(false);
    media.resize(768);
    expect(result.current).toBe(true);
    expect(new Set(media.queries)).toEqual(new Set([PHONE_SHELL_QUERY]));
  });

  it("is false when matchMedia is unavailable (desktop shell in jsdom)", () => {
    // @ts-expect-error -- simulating an environment without matchMedia
    window.matchMedia = undefined;
    const { result } = renderHook(() => useIsPhoneShell());
    expect(result.current).toBe(false);
  });
});
