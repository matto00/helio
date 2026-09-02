import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { httpClient } from "../../../services/httpClient";
import { outputsReducer } from "../state/outputsSlice";
import { useOutputPreview, useUnsavedStepPreview } from "./usePipelinePreviewCache";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockedHttpClient = jest.mocked(httpClient);

function buildStore() {
  return configureStore({ reducer: { outputs: outputsReducer } });
}

function wrapper(store: ReturnType<typeof buildStore>) {
  return function StoreWrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("usePipelinePreviewCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("useOutputPreview refresh() populates the cache for that outputId", async () => {
    mockedHttpClient.post.mockResolvedValueOnce({
      data: {
        outputs: [
          {
            outputId: "out-1",
            preview: {
              rows: [],
              rowCount: 3,
              stepRowCounts: {},
              sourceRowCount: 3,
              blocked: false,
              sourceTruncated: false,
              truncatedReads: [],
            },
          },
        ],
      },
    });
    const store = buildStore();
    const { result } = renderHook(() => useOutputPreview("p-1", "out-1"), {
      wrapper: wrapper(store),
    });

    expect(result.current.result).toBeUndefined();
    await act(async () => {
      await result.current.refresh();
    });

    const { result: after } = renderHook(() => useOutputPreview("p-1", "out-1"), {
      wrapper: wrapper(store),
    });
    expect(after.current.result?.rowCount).toBe(3);
  });

  it("useUnsavedStepPreview reads from the step:<id> cache key, independent of any saved Output", async () => {
    mockedHttpClient.get.mockResolvedValueOnce({
      data: {
        rows: [],
        rowCount: 5,
        stepRowCounts: {},
        sourceRowCount: 5,
        blocked: false,
        sourceTruncated: false,
        truncatedReads: [],
      },
    });
    const store = buildStore();
    const { result } = renderHook(() => useUnsavedStepPreview("p-1", "step-1"), {
      wrapper: wrapper(store),
    });
    await act(async () => {
      await result.current.refresh();
    });

    const { result: after } = renderHook(() => useUnsavedStepPreview("p-1", "step-1"), {
      wrapper: wrapper(store),
    });
    expect(after.current.result?.rowCount).toBe(5);
  });
});
