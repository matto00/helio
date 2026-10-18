// HEL-1668 D6: spine copy. The source card names its kind once, the Output card reads "from ...", and the last-run line
// keeps its relative time when the row count is long.
import { configureStore } from "@reduxjs/toolkit";
import { act, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";

import * as dataSourceService from "../../../sources/services/dataSourceService";
import { fetchSourceSample, sourceSamplesReducer } from "../../../sources/state/sourceSamplesSlice";
import { sourcesReducer } from "../../../sources/state/sourcesSlice";
import { ownedSource, sample } from "../../../sources/test/sampleFixtures";
import { pipelinesReducer } from "../../state/pipelinesSlice";
import { SpineSourceCard } from "./SpineSourceCard";
import { SpineLastRunMeta } from "./SpineRunStatus";

jest.mock("../../../sources/services/dataSourceService", () => ({
  fetchSourceSample: jest.fn(),
  fetchSources: jest.fn(),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));
const fetchMock = jest.mocked(dataSourceService.fetchSourceSample);

function makeStore() {
  return configureStore({
    reducer: {
      sources: sourcesReducer,
      sourceSamples: sourceSamplesReducer,
      pipelines: pipelinesReducer,
    },
    preloadedState: {
      sources: {
        items: [ownedSource("s1")],
        status: "succeeded" as const,
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

function renderCard(store: ReturnType<typeof makeStore>) {
  return render(
    <Provider store={store}>
      <SpineSourceCard
        root={{ id: "r1", dataSourceId: "s1", dataSourceName: "Orders" } as never}
        pipelineId="P1"
        source={ownedSource("s1")}
        ordinal={null}
        canRemove
        onEditSource={() => {}}
        onRemoveRoot={() => {}}
      />
    </Provider>,
  );
}

const card = () => document.querySelector(".spine-source-card") as HTMLElement;
const staticCount = () => (card().textContent ?? "").match(/Static/g)?.length ?? 0;

async function capture(store: ReturnType<typeof makeStore>, s = sample()) {
  fetchMock.mockResolvedValueOnce(s);
  await act(async () => {
    await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
  });
}

beforeEach(() => fetchMock.mockReset());

describe("source card names its kind once (HEL-1668)", () => {
  it("loaded static sample: 'Static' once (the label), no meta line", async () => {
    const store = makeStore();
    await capture(store, sample({ sourceRowCount: 30 }));
    renderCard(store);
    expect(within(card()).getByText("Static · 30 rows")).toBeInTheDocument();
    expect(staticCount()).toBe(1);
    expect(card().querySelector(".spine-card__meta")).toBeNull();
  });

  it("truncated static sample: 'Static' once, on the meta line", async () => {
    const store = makeStore();
    await capture(store, sample({ truncated: true, sourceRowCount: 12431 }));
    renderCard(store);
    expect(within(card()).getByText("first 1,000 of 12,431 rows")).toBeInTheDocument();
    expect(staticCount()).toBe(1);
    expect(card().querySelector(".spine-card__meta")).toHaveTextContent("Static");
  });

  it("loading: 'Static' once, on the meta line", async () => {
    const store = makeStore();
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => {
      void store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    });
    renderCard(store);
    expect(card()).toHaveTextContent("Loading sample…");
    expect(staticCount()).toBe(1);
  });

  it("unavailable: 'Static' once, on the meta line", async () => {
    const store = makeStore();
    fetchMock.mockRejectedValueOnce(new Error("nope"));
    await act(async () => {
      await store.dispatch(fetchSourceSample({ sourceId: "s1" }));
    });
    renderCard(store);
    expect(card()).toHaveTextContent("Sample unavailable");
    expect(staticCount()).toBe(1);
  });
});

describe("last-run meta (HEL-1668)", () => {
  it("renders the row count and the relative time as sibling spans, the title unchanged", () => {
    render(
      <SpineLastRunMeta
        lastRunAt={new Date(Date.now() - 180_000).toISOString()}
        lastRunRowCount={12345678}
        lastRunTruncated={null}
      />,
    );
    const meta = screen.getByLabelText("Last run metadata");
    const count = meta.querySelector(".spine-header__meta-count");
    const time = meta.querySelector(".spine-header__meta-time");
    expect(count).toHaveTextContent("12,345,678 rows written ·");
    expect(time).toHaveTextContent("3 minutes ago");
    expect(meta).toHaveAttribute("title", "12,345,678 rows written · 3 minutes ago");
    expect(meta).toHaveTextContent("12,345,678 rows written · 3 minutes ago");
  });

  it("without a row count there is only the time", () => {
    render(
      <SpineLastRunMeta
        lastRunAt={new Date(Date.now() - 180_000).toISOString()}
        lastRunRowCount={null}
        lastRunTruncated={null}
      />,
    );
    const meta = screen.getByLabelText("Last run metadata");
    expect(meta.querySelector(".spine-header__meta-count")).toBeNull();
    expect(meta).toHaveTextContent(/^3 minutes ago$/);
  });
});
