import { act, renderHook, waitFor } from "@testing-library/react";

import { httpClient } from "../../../services/httpClient";
import { makeOutput } from "../../../test/remountFixtures";
import { resetOutputFreshness, retain } from "../state/outputFreshness";
import { fetchOutputMeta } from "../state/outputMetaCache";
import { useOutputMeta } from "./useOutputMeta";

// HEL-1380 -- GUARD tests (behaviour pins, NOT the red/green proof): a bare `renderHook` cannot
// show the redundant mount render, because React's eager-state bailout drops a same-value update
// without re-invoking a component with nothing else pending. The render-count proofs live in
// `PanelCardBody.mountRenders.test.tsx`. These pin that skipping same-value mount updates did not
// change any loading-state transition. Failable by mutation: removing the cache-miss
// `setIsLoading(true)` entirely fails the "loaded -> uncached id" guard.
jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const http = jest.mocked(httpClient);

beforeEach(() => {
  jest.clearAllMocks();
  resetOutputFreshness();
});

describe("useOutputMeta loading transitions (GUARD)", () => {
  it("cache-miss mount is loading, then resolves to the Output", async () => {
    http.get.mockResolvedValue({ data: makeOutput("o1", "table", {}) });
    const { result } = renderHook(() => useOutputMeta("o1"));
    expect(result.current).toEqual({ output: null, isLoading: true });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.output?.id).toBe("o1");
  });

  it("a rejected fetch ends not-loading with a null output", async () => {
    http.get.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOutputMeta("o1"));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.output).toBeNull();
  });

  it("a null outputId is not loading with a null output", async () => {
    const { result } = renderHook(() => useOutputMeta(null));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toEqual({ output: null, isLoading: false });
    expect(http.get).not.toHaveBeenCalled();
  });

  it("a cache-hit mount starts loaded with no fetch and no loading flash", async () => {
    http.get.mockResolvedValue({ data: makeOutput("o1", "table", {}) });
    await fetchOutputMeta("o1");
    retain("o1");
    http.get.mockClear();
    const { result } = renderHook(() => useOutputMeta("o1"));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.output?.id).toBe("o1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.isLoading).toBe(false);
    expect(http.get).not.toHaveBeenCalled();
  });

  it("switching from a loaded Output to an uncached id shows loading before it resolves", async () => {
    http.get.mockResolvedValueOnce({ data: makeOutput("o1", "table", {}) });
    const { result, rerender } = renderHook(({ id }) => useOutputMeta(id), {
      initialProps: { id: "o1" as string | null },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolveO2: (v: unknown) => void = () => {};
    http.get.mockReturnValueOnce(new Promise((r) => (resolveO2 = r)));
    rerender({ id: "o2" });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    await act(async () => {
      resolveO2({ data: makeOutput("o2", "table", {}) });
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.output?.id).toBe("o2");
  });

  it("switching from a loaded Output to null clears the output and loading", async () => {
    http.get.mockResolvedValueOnce({ data: makeOutput("o1", "table", {}) });
    const { result, rerender } = renderHook(({ id }) => useOutputMeta(id), {
      initialProps: { id: "o1" as string | null },
    });
    await waitFor(() => expect(result.current.output?.id).toBe("o1"));
    rerender({ id: null });
    await waitFor(() => expect(result.current.output).toBeNull());
    expect(result.current.isLoading).toBe(false);
  });

  it("switching from a still-loading Output to null stops loading", async () => {
    http.get.mockReturnValueOnce(new Promise(() => {}));
    const { result, rerender } = renderHook(({ id }) => useOutputMeta(id), {
      initialProps: { id: "o1" as string | null },
    });
    expect(result.current.isLoading).toBe(true);
    rerender({ id: null });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.output).toBeNull();
  });
});
