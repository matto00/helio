import { act, renderHook, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";

import { httpClient } from "../../../services/httpClient";
import { useAsk } from "./useAsk";

jest.mock("../../../services/httpClient", () => ({ httpClient: { post: jest.fn() } }));
const http = jest.mocked(httpClient);

const body = (answer: string) => ({ data: { answer, citations: [], citedOutputs: [], pin: null } });

function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => jest.resetAllMocks());

describe("useAsk", () => {
  it("goes idle -> pending -> answered, trimming the question", async () => {
    const d = deferred();
    http.post.mockReturnValue(d.promise as never);
    const { result } = renderHook(() => useAsk({ kind: "dashboard", id: "d-1" }));
    expect(result.current.state.status).toBe("idle");
    act(() => void result.current.ask("  why?  "));
    expect(result.current.state).toEqual({ status: "pending", question: "why?" });
    await act(async () => d.resolve(body("Because.")));
    await waitFor(() => expect(result.current.state.status).toBe("answered"));
    expect(http.post).toHaveBeenCalledWith("/api/dashboards/d-1/ask", { question: "why?" });
  });

  it("sends nothing for an empty or over-long question", async () => {
    const { result } = renderHook(() => useAsk({ kind: "output", id: "o-1" }));
    await act(async () => result.current.ask("   "));
    await act(async () => result.current.ask("x".repeat(2001)));
    expect(http.post).not.toHaveBeenCalled();
  });

  it("an error keeps the question, and retry re-sends the SAME question", async () => {
    http.post.mockRejectedValueOnce(
      new AxiosError("x", undefined, undefined, undefined, {
        status: 503,
        data: {},
      } as AxiosResponse),
    );
    http.post.mockResolvedValueOnce(body("Fine.") as never);
    const { result } = renderHook(() => useAsk({ kind: "dashboard", id: "d-1" }));
    await act(async () => result.current.ask("why?"));
    expect(result.current.state).toEqual({
      status: "error",
      question: "why?",
      error: { kind: "unavailable" },
    });
    await act(async () => result.current.retry());
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(http.post.mock.calls[1]).toEqual(["/api/dashboards/d-1/ask", { question: "why?" }]);
    expect(result.current.state.status).toBe("answered");
  });

  it("drops a stale response that settles after a newer ask", async () => {
    const first = deferred();
    const second = deferred();
    http.post
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const { result } = renderHook(() => useAsk({ kind: "dashboard", id: "d-1" }));
    act(() => void result.current.ask("one"));
    act(() => void result.current.ask("two"));
    await act(async () => second.resolve(body("Answer two")));
    await act(async () => first.resolve(body("Answer one")));
    expect(result.current.state).toMatchObject({ status: "answered", question: "two" });
    expect(JSON.stringify(result.current.state)).not.toContain("Answer one");
  });

  it("drops a response that arrives after unmount, and resets when the scope changes", async () => {
    const d = deferred();
    http.post.mockReturnValue(d.promise as never);
    const { result, unmount, rerender } = renderHook(
      ({ id }) => useAsk({ kind: "dashboard", id }),
      {
        initialProps: { id: "d-1" },
      },
    );
    act(() => void result.current.ask("one"));
    rerender({ id: "d-2" });
    await act(async () => d.resolve(body("late")));
    expect(result.current.state.status).toBe("idle");
    unmount();
  });
});
