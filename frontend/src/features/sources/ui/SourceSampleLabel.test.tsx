import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import * as dataSourceService from "../services/dataSourceService";
import { fetchSourceSample, sourceSamplesReducer } from "../state/sourceSamplesSlice";
import { sourcesReducer } from "../state/sourcesSlice";
import { pipelinesReducer } from "../../pipelines/state/pipelinesSlice";
import type { PipelineCallerRole } from "../../pipelines/types/pipelineStep";
import { ownedSource, sample } from "../test/sampleFixtures";
import { SourceSampleLabel } from "./SourceSampleLabel";

jest.mock("../services/dataSourceService", () => ({
  fetchSourceSample: jest.fn(),
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));
const fetchMock = jest.mocked(dataSourceService.fetchSourceSample);

interface StoreOptions {
  /** The source ids the caller owns (default: s1). */
  owned?: string[];
  /** The `callerRole` of the analyze result for pipeline P1; `undefined` = analyze has not answered. */
  callerRole?: PipelineCallerRole;
  analyzeStatus?: "loading" | "succeeded" | "failed";
  /** The pipeline the analyze state is keyed by (default P1). */
  analyzePipelineId?: string;
}

function makeStore(
  sourcesStatus: "idle" | "succeeded" | "failed" = "succeeded",
  options: StoreOptions = {},
) {
  const pipelines = pipelinesReducer(undefined, { type: "init" });
  const pid = options.analyzePipelineId ?? "P1";
  return configureStore({
    reducer: {
      sources: sourcesReducer,
      sourceSamples: sourceSamplesReducer,
      pipelines: pipelinesReducer,
    },
    preloadedState: {
      pipelines: {
        ...pipelines,
        analyzeResult: options.callerRole
          ? { [pid]: { callerRole: options.callerRole } as never }
          : {},
        analyzeStatus: options.analyzeStatus ? { [pid]: options.analyzeStatus } : {},
      },
      sources: {
        items: (options.owned ?? ["s1"]).map((id) => ownedSource(id)),
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
}

function renderLabel(store = makeStore(), props: { sourceId?: string; pipelineId?: string } = {}) {
  return render(
    <Provider store={store}>
      <SourceSampleLabel
        sourceId={props.sourceId ?? "s1"}
        sourceName="Orders"
        pipelineId={props.pipelineId ?? "P1"}
      />
    </Provider>,
  );
}

async function capture(store: ReturnType<typeof makeStore>, s = sample()) {
  fetchMock.mockResolvedValueOnce(s);
  await act(async () => {
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
  });
}

beforeEach(() => fetchMock.mockReset());

describe("SourceSampleLabel", () => {
  it("shows Loading sample… while the sources list is still loading", () => {
    renderLabel(makeStore("idle"));
    expect(screen.getByText("Loading sample…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows Loading sample… (no refresh) for a source the caller does not own while analyze has not answered", () => {
    renderLabel(makeStore("succeeded", { owned: [] }));
    expect(screen.getByText("Loading sample…")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows Sample unavailable (no refresh) for a source not owned when analyze was rejected", () => {
    renderLabel(makeStore("succeeded", { owned: [], analyzeStatus: "failed" }));
    expect(screen.getByText("Sample unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders no label at all for a viewer's source they do not own", () => {
    const { container } = renderLabel(makeStore("succeeded", { owned: [], callerRole: "viewer" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("still labels a viewer's OWN source", () => {
    renderLabel(makeStore("succeeded", { callerRole: "viewer" }));
    expect(screen.getByRole("button", { name: "Refresh sample of Orders" })).toBeInTheDocument();
  });

  it("an editor's non-owned source is labelled and its refresh is scoped to the current page's pipeline", async () => {
    const store = makeStore("succeeded", { owned: [], callerRole: "editor" });
    fetchMock.mockResolvedValueOnce(sample({ sourceRowCount: 7 }));
    await act(async () => {
      await store.dispatch(fetchSourceSample({ sourceId: "s1", pipelineId: "P1" }));
    });
    renderLabel(store);
    expect(screen.getByText("Static · 7 rows")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(sample({ sourceRowCount: 8 }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh sample of Orders" }));
    expect(await screen.findByText("Static · 8 rows")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("s1", "P1");
  });

  it("an entry captured on P1 and refreshed on P2's page is scoped to P2, not the stored P1", async () => {
    const store = makeStore("succeeded", {
      owned: [],
      callerRole: "editor",
      analyzePipelineId: "P2",
    });
    fetchMock.mockResolvedValueOnce(sample({ sourceRowCount: 7 }));
    await act(async () => {
      await store.dispatch(fetchSourceSample({ sourceId: "s1", pipelineId: "P1" }));
    });
    renderLabel(store, { pipelineId: "P2" });
    fetchMock.mockResolvedValueOnce(sample({ sourceRowCount: 9 }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh sample of Orders" }));
    expect(await screen.findByText("Static · 9 rows")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith("s1", "P2");
  });

  it("static exact sample: Static · N rows", async () => {
    const store = makeStore();
    await capture(store, sample({ sourceRowCount: 30, rows: new Array(30).fill({}) }));
    renderLabel(store);
    expect(screen.getByText("Static · 30 rows")).toBeInTheDocument();
  });

  it("static source over the cap: first 1,000 of N rows with the caveat", async () => {
    const store = makeStore();
    await capture(store, sample({ truncated: true, sourceRowCount: 12431 }));
    renderLabel(store);
    expect(screen.getByText("first 1,000 of 12,431 rows")).toBeInTheDocument();
    expect(screen.getByText(/Counts and aggregates describe this sample/)).toBeInTheDocument();
  });

  it("non-static exact sample: sample · N rows · fetched <age>, no caveat", async () => {
    const store = makeStore();
    const now = new Date().toISOString();
    await capture(store, sample({ live: true, sourceRowCount: 412, capturedAt: now }));
    renderLabel(store);
    expect(screen.getByText(/^sample · 412 rows · fetched /)).toBeInTheDocument();
    expect(screen.queryByText(/Counts and aggregates/)).toBeNull();
  });

  it("non-static prefix sample: sample · first 1,000 of N rows · fetched <age> with the caveat", async () => {
    const store = makeStore();
    await capture(
      store,
      sample({
        live: true,
        truncated: true,
        sourceRowCount: 12431,
        capturedAt: new Date().toISOString(),
      }),
    );
    renderLabel(store);
    expect(screen.getByText(/^sample · first 1,000 of 12,431 rows · fetched /)).toBeInTheDocument();
    expect(screen.getByText(/Counts and aggregates describe this sample/)).toBeInTheDocument();
  });

  it("refresh sends exactly one new request and is disabled while it loads", async () => {
    const store = makeStore();
    await capture(store);
    renderLabel(store);
    let resolve: (s: ReturnType<typeof sample>) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const button = screen.getByRole("button", { name: "Refresh sample of Orders" });
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(button).toBeDisabled();
    await act(async () => resolve(sample({ sourceRowCount: 5 })));
    expect(screen.getByText("Static · 5 rows")).toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("a failed first capture reads Sample unavailable and the refresh recovers", async () => {
    const store = makeStore();
    fetchMock.mockRejectedValueOnce(new Error("nope"));
    await act(async () => {
      await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    });
    renderLabel(store);
    expect(screen.getByText("Sample unavailable")).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(sample({ sourceRowCount: 2 }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh sample of Orders" }));
    expect(await screen.findByText("Static · 2 rows")).toBeInTheDocument();
  });

  it("reads Sample unavailable (not Loading) when the sources list failed", () => {
    renderLabel(makeStore("failed"));
    expect(screen.getByText("Sample unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Loading sample…")).toBeNull();
  });
});
