import { renderHook, waitFor } from "@testing-library/react";

import { postRefinement, RefinementRequestError } from "../services/refinementService";
import { useRefinement } from "./useRefinement";
import type { RefinementResult } from "../types/refinement";

jest.mock("../services/refinementService", () => ({
  postRefinement: jest.fn(),
  RefinementRequestError: jest.requireActual("../services/refinementService")
    .RefinementRequestError,
}));

const mockedPostRefinement = jest.mocked(postRefinement);

beforeEach(() => {
  jest.resetAllMocks();
});

describe("useRefinement", () => {
  it("starts idle (not loading, no result/error) when active=false", () => {
    const { result } = renderHook(() =>
      useRefinement({ target: { kind: "dashboard", id: "dash-1" }, message: "hi", active: false }),
    );

    expect(result.current).toEqual({ loading: false, result: null, error: null, errorKind: null });
    expect(mockedPostRefinement).not.toHaveBeenCalled();
  });

  it("calls postRefinement with {target, message, conversationId} when active=true", async () => {
    const refinementResult: RefinementResult = {
      patchSet: { edits: [] },
      conversationId: "conv-1",
    };
    mockedPostRefinement.mockResolvedValueOnce(refinementResult);

    renderHook(() =>
      useRefinement({
        target: { kind: "dashboard", id: "dash-1" },
        message: "rename the panel",
        active: true,
        conversationId: "conv-0",
      }),
    );

    await waitFor(() => {
      expect(mockedPostRefinement).toHaveBeenCalledWith({
        target: { kind: "dashboard", id: "dash-1" },
        message: "rename the panel",
        conversationId: "conv-0",
      });
    });
  });

  it("sets loading true while the request is in flight, then result on success", async () => {
    const refinementResult: RefinementResult = {
      patchSet: { edits: [] },
      conversationId: "conv-1",
    };
    let resolveRequest: (value: RefinementResult) => void = () => {};
    mockedPostRefinement.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    const { result } = renderHook(() =>
      useRefinement({ target: { kind: "dashboard", id: "dash-1" }, message: "hi", active: true }),
    );

    await waitFor(() => expect(result.current.loading).toBe(true));

    resolveRequest(refinementResult);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.result).toEqual(refinementResult);
      expect(result.current.error).toBeNull();
    });
  });

  it("sets error + errorKind on a failed request (RefinementRequestError)", async () => {
    mockedPostRefinement.mockRejectedValueOnce(
      new RefinementRequestError("Model output was invalid twice.", "InvalidProposal"),
    );

    const { result } = renderHook(() =>
      useRefinement({ target: { kind: "dashboard", id: "dash-1" }, message: "hi", active: true }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe("Model output was invalid twice.");
      expect(result.current.errorKind).toBe("InvalidProposal");
      expect(result.current.result).toBeNull();
    });
  });

  it("sets a generic connection-failure error for a non-RefinementRequestError rejection", async () => {
    mockedPostRefinement.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useRefinement({ target: { kind: "dashboard", id: "dash-1" }, message: "hi", active: true }),
    );

    await waitFor(() => {
      expect(result.current.error).toBe("Connection failed");
      expect(result.current.errorKind).toBeNull();
    });
  });

  it("fires a new request when message changes while active stays true", async () => {
    mockedPostRefinement.mockResolvedValue({ patchSet: { edits: [] }, conversationId: "conv-1" });

    const { rerender } = renderHook(
      ({ message }) =>
        useRefinement({ target: { kind: "dashboard", id: "dash-1" }, message, active: true }),
      { initialProps: { message: "first" } },
    );

    await waitFor(() => expect(mockedPostRefinement).toHaveBeenCalledTimes(1));

    rerender({ message: "second" });

    await waitFor(() => expect(mockedPostRefinement).toHaveBeenCalledTimes(2));
    expect(mockedPostRefinement.mock.calls[1][0]).toMatchObject({ message: "second" });
  });
});
