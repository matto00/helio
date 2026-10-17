import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import * as dataSourceService from "../services/dataSourceService";
import { sourceSamplesReducer } from "../state/sourceSamplesSlice";
import { sourcesReducer } from "../state/sourcesSlice";
import { ownedSource, sample } from "../test/sampleFixtures";
import { useSourceSamples } from "./useSourceSamples";

jest.mock("../services/dataSourceService", () => ({
  fetchSourceSample: jest.fn(),
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));
const fetchMock = jest.mocked(dataSourceService.fetchSourceSample);

function setup(sourcesStatus: "idle" | "succeeded" = "succeeded", owned = ["s1", "s2"]) {
  const store = configureStore({
    reducer: { sources: sourcesReducer, sourceSamples: sourceSamplesReducer },
    preloadedState: {
      sources: {
        items: owned.map((id) => ownedSource(id)),
        status: sourcesStatus,
        error: null,
        errorKind: null,
        selectedSourceId: null,
        addModalOpen: false,
        references: {},
        referencesStatus: "idle" as const,
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, wrapper };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(sample());
});

describe("useSourceSamples", () => {
  it("sends exactly one request per uncached source when the page opens", () => {
    const { wrapper } = setup();
    renderHook(() => useSourceSamples(["s1", "s2"]), { wrapper });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["s1", "s2"]);
  });

  it("sends nothing more on re-render, a new array of the same ids, or a remount", () => {
    const { wrapper } = setup();
    const first = renderHook(({ ids }) => useSourceSamples(ids), {
      wrapper,
      initialProps: { ids: ["s1"] },
    });
    first.rerender({ ids: ["s1"] });
    first.rerender({ ids: ["s1"] });
    first.unmount();
    renderHook(() => useSourceSamples(["s1"]), { wrapper });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for the caller's own sources list", () => {
    const { wrapper } = setup("idle");
    renderHook(() => useSourceSamples(["s1"]), { wrapper });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("spends no request on a source the caller cannot see", () => {
    const { wrapper } = setup("succeeded", ["s1"]);
    renderHook(() => useSourceSamples(["s1", "shared-not-mine"]), { wrapper });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["s1"]);
  });
});
