import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";

import * as dataSourceService from "../services/dataSourceService";
import { fetchSourceSample, sourceSamplesReducer } from "../state/sourceSamplesSlice";
import { sourcesReducer } from "../state/sourcesSlice";
import { ownedSource, sample } from "../test/sampleFixtures";
import { SourceSampleLabel } from "./SourceSampleLabel";

jest.mock("../services/dataSourceService", () => ({
  fetchSourceSample: jest.fn(),
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));
const fetchMock = jest.mocked(dataSourceService.fetchSourceSample);

function makeStore(sourcesStatus: "idle" | "succeeded" | "failed" = "succeeded") {
  return configureStore({
    reducer: { sources: sourcesReducer, sourceSamples: sourceSamplesReducer },
    preloadedState: {
      sources: {
        items: [ownedSource("s1")],
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

function renderLabel(store = makeStore(), props: { resolvable?: boolean } = {}) {
  return render(
    <Provider store={store}>
      <SourceSampleLabel sourceId="s1" sourceName="Orders" resolvable={props.resolvable ?? true} />
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

  it("shows Sample unavailable for a source the caller cannot see, without a refresh control", () => {
    renderLabel(makeStore(), { resolvable: false });
    expect(screen.getByText("Sample unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
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
