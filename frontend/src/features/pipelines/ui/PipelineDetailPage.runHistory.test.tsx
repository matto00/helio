// PipelineDetailPage.runHistory.test.tsx — HEL-1354.
//
// The pipeline detail page no longer fetches run history on every open. These tests pin the
// on-demand contract end to end through the real page, hook, slice and modal, mocking only the
// service (`fetchRunHistory`) and awaiting it — never seeding a succeeded status into the store.
// Every revisit scenario shares ONE store across unmount/remount (the app's real session shape), so
// a previous visit's list is genuinely in Redux when the next visit opens.

import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import { ThemeProvider } from "../../../theme/ThemeProvider";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { outputsReducer } from "../state/outputsSlice";
import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { PipelineDetailPage } from "./PipelineDetailPage";
import {
  analyzePipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  runPipeline,
} from "../services/pipelineService";
import { fetchSources } from "../../sources/services/dataSourceService";
import type { PipelineRunRecord, PipelineSummary } from "../types/pipelineStep";

jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  fetchSources: jest.fn(),
}));

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  analyzePipeline: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  runPipeline: jest.fn(),
}));

const fetchRunHistoryMock = jest.mocked(fetchRunHistory);

// Every scenario mounts the full detail page (one or two times, some under StrictMode) against a
// real store; on a CPU-contended full-suite run that outgrows jest's 5 s default, which is a
// harness budget, not a behaviour under test.
jest.setTimeout(30_000);

const NOTICE = "Source truncated: read the first 1000 rows.";

function summary(id: string): PipelineSummary {
  return {
    id,
    name: `Pipeline ${id}`,
    roots: [{ id: `root-${id}`, dataSourceId: "src-1", dataSourceName: "Orders" }],
    lastRunStatus: id === "pipe-t" ? "succeeded" : null,
    lastRunAt: id === "pipe-t" ? "2026-05-01T10:00:00Z" : null,
    lastRunRowCount: id === "pipe-t" ? 1000 : null,
    lastRunTruncated: id === "pipe-t",
  };
}

function run(id: string, rowCount: number, notice?: string): PipelineRunRecord {
  return {
    id,
    pipelineId: "pipe-x",
    status: "succeeded",
    startedAt: "2026-05-01T09:59:00Z",
    completedAt: "2026-05-01T10:00:00Z",
    rowCount,
    errorLog: null,
    triggerSource: "manual",
    assertions: { passed: 0, warnFailed: 0, errorFailed: 0, failures: [] },
    ...(notice
      ? {
          truncation: {
            truncated: true,
            primaryAvailableRowCount: 3303,
            reads: [{ dataSourceName: "Orders", rowsRead: 1000, availableRowCount: 3303 }],
            notice,
          },
        }
      : {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
      toasts: toastsReducer,
    } as never,
  });
}

function renderPage(store: ReturnType<typeof makeStore>, id: string, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[`/pipelines/${id}`]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <nav>
              <Link to="/pipelines/pipe-a">go A</Link>
              <Link to="/pipelines/pipe-b">go B</Link>
            </nav>
            <Routes>
              <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function openRunHistory() {
  fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Run history" }));
}

async function pageReady(id: string) {
  await screen.findByRole("heading", { name: new RegExp(`Pipeline ${id}`) }).catch(() => undefined);
  await waitFor(() => expect(jest.mocked(getPipelineById)).toHaveBeenCalledWith(id));
  await screen.findByRole("button", { name: "Pipeline actions" });
}

describe("PipelineDetailPage — on-demand run history (HEL-1354)", () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  beforeEach(() => {
    jest.mocked(getPipelineById).mockImplementation(async (id: string) => summary(id));
    jest.mocked(getPipelineSteps).mockResolvedValue([]);
    jest.mocked(getPipelineSchedule).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
    jest.mocked(analyzePipeline).mockResolvedValue({
      id: "pipe-x",
      name: "x",
      sourceSchemas: [],
      steps: [],
      costVerdict: { autoRunnable: true, stepCount: 0, reasons: [], canRun: true },
      warnings: [],
    });
    jest.mocked(runPipeline).mockResolvedValue({
      rowCount: 0,
      rows: [],
      stepRowCounts: {},
      sourceRowCount: 0,
    });
    fetchRunHistoryMock.mockReset();
    fetchRunHistoryMock.mockResolvedValue([]);
    jest.mocked(fetchSources).mockResolvedValue([]);
  });
  afterEach(() => jest.clearAllMocks());

  it("a truncated pipeline's open issues exactly one run-history GET and renders the persisted notice", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockResolvedValue([run("r1", 1000, NOTICE)]);
    renderPage(store, "pipe-t");

    expect(await screen.findByRole("alert")).toHaveTextContent("truncated");
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(1);
    expect(fetchRunHistoryMock).toHaveBeenCalledWith("pipe-t");
  });

  it("a StrictMode-wrapped revisit to a truncated pipeline still issues exactly one GET", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockResolvedValue([run("r1", 1000, NOTICE)]);
    const first = renderPage(store, "pipe-t", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("truncated");
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(1);
    first.unmount();

    fetchRunHistoryMock.mockClear();
    jest.mocked(getPipelineById).mockClear();
    renderPage(store, "pipe-t", true);
    expect(await screen.findByRole("alert")).toHaveTextContent("truncated");
    await waitFor(() => expect(jest.mocked(getPipelineById)).toHaveBeenCalled());
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(1);
  });

  it("fetches when the modal is opened and renders the runs", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockResolvedValue([run("r1", 42)]);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    expect(fetchRunHistoryMock).not.toHaveBeenCalled();

    openRunHistory();
    expect(await screen.findByText("42 rows")).toBeInTheDocument();
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Run history (1)")).toBeInTheDocument();
  });

  it("open, leave, return, reopen issues a new GET and does not show the first visit's list before it", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockResolvedValueOnce([run("r1", 42)]);
    const first = renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();
    expect(await screen.findByText("42 rows")).toBeInTheDocument();
    first.unmount();

    const second = deferred<PipelineRunRecord[]>();
    fetchRunHistoryMock.mockReturnValueOnce(second.promise);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();

    // The second visit's request is out and unresolved: loading, never the first visit's list.
    expect(await screen.findByText("Loading run history…")).toBeInTheDocument();
    expect(screen.queryByText("42 rows")).not.toBeInTheDocument();
    expect(screen.queryByText("No runs recorded yet")).not.toBeInTheDocument();
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve([run("r2", 77)]));
    expect(await screen.findByText("77 rows")).toBeInTheDocument();
  });

  it("a response landing after unmount does not make the next visit fresh", async () => {
    const store = makeStore();
    const late = deferred<PipelineRunRecord[]>();
    fetchRunHistoryMock.mockReturnValueOnce(late.promise);
    const first = renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();
    await screen.findByText("Loading run history…");
    first.unmount();
    // The earlier visit's response lands now, into the shared store.
    await act(async () => late.resolve([run("old", 11)]));

    const second = deferred<PipelineRunRecord[]>();
    fetchRunHistoryMock.mockReturnValueOnce(second.promise);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();

    expect(await screen.findByText("Loading run history…")).toBeInTheDocument();
    expect(screen.queryByText("11 rows")).not.toBeInTheDocument();
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve([run("new", 22)]));
    expect(await screen.findByText("22 rows")).toBeInTheDocument();
  });

  it("in-router A -> B -> A then opening the modal issues a second A GET", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockResolvedValueOnce([run("a1", 5)]);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();
    expect(await screen.findByText("5 rows")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("link", { name: "go B" }));
    await waitFor(() => expect(jest.mocked(getPipelineById)).toHaveBeenCalledWith("pipe-b"));
    fireEvent.click(screen.getByRole("link", { name: "go A" }));
    await waitFor(() =>
      expect(jest.mocked(getPipelineById).mock.calls.filter(([i]) => i === "pipe-a")).toHaveLength(
        2,
      ),
    );

    const again = deferred<PipelineRunRecord[]>();
    fetchRunHistoryMock.mockReturnValueOnce(again.promise);
    openRunHistory();
    expect(await screen.findByText("Loading run history…")).toBeInTheDocument();
    expect(screen.queryByText("5 rows")).not.toBeInTheDocument();
    expect(fetchRunHistoryMock.mock.calls.filter(([i]) => i === "pipe-a")).toHaveLength(2);
    await act(async () => again.resolve([run("a2", 6)]));
    expect(await screen.findByText("6 rows")).toBeInTheDocument();
  });

  it("an open modal closes on an in-place switch and never shows A's runs on B", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockResolvedValueOnce([run("a1", 5)]);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();
    expect(await screen.findByText("5 rows")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "go B" }));
    await waitFor(() => expect(jest.mocked(getPipelineById)).toHaveBeenCalledWith("pipe-b"));

    expect(screen.queryByRole("dialog", { name: "Run history" })).not.toBeInTheDocument();
    expect(screen.queryByText("5 rows")).not.toBeInTheDocument();
    // B never fetched: nothing opened its modal.
    expect(fetchRunHistoryMock.mock.calls.filter(([i]) => i === "pipe-b")).toHaveLength(0);
  });

  it("a failed fetch shows the error state, re-dispatches only on Retry (exactly once each)", async () => {
    const store = makeStore();
    fetchRunHistoryMock.mockRejectedValueOnce(new Error("boom"));
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();

    expect(await screen.findByText("Couldn't load run history.")).toBeInTheDocument();
    expect(screen.queryByText("No runs recorded yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/Run history \(/)).not.toBeInTheDocument();
    // Settle: no automatic re-dispatch after the failure.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(1);

    fetchRunHistoryMock.mockResolvedValueOnce([run("r1", 9)]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("9 rows")).toBeInTheDocument();
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state (not 'No runs recorded yet') while the modal's fetch is in flight", async () => {
    const store = makeStore();
    const pending = deferred<PipelineRunRecord[]>();
    fetchRunHistoryMock.mockReturnValueOnce(pending.promise);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();

    expect(await screen.findByText("Loading run history…")).toBeInTheDocument();
    expect(screen.queryByText("No runs recorded yet")).not.toBeInTheDocument();
    await act(async () => pending.resolve([]));
    expect(await screen.findByText("No runs recorded yet")).toBeInTheDocument();
  });

  it("a run finishing while the modal's fetch is in flight still forces a refresh, and the later fetch wins", async () => {
    const store = makeStore();
    const modalFetch = deferred<PipelineRunRecord[]>();
    fetchRunHistoryMock
      .mockReturnValueOnce(modalFetch.promise)
      .mockResolvedValueOnce([run("after-run", 123)]);
    renderPage(store, "pipe-a");
    await pageReady("pipe-a");
    openRunHistory();
    await screen.findByText("Loading run history…");
    expect(fetchRunHistoryMock).toHaveBeenCalledTimes(1);

    // The page starts a run; its post-run refresh is forced, so the in-flight fetch cannot swallow it.
    fireEvent.click(screen.getByRole("button", { name: "Run pipeline" }));
    await waitFor(() => expect(fetchRunHistoryMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("123 rows")).toBeInTheDocument();

    // The earlier (stale) response lands LAST and must not overwrite the newer list.
    await act(async () => modalFetch.resolve([run("stale", 7)]));
    expect(screen.getByText("123 rows")).toBeInTheDocument();
    expect(screen.queryByText("7 rows")).not.toBeInTheDocument();
  });

  it("a StrictMode open issues exactly one data-sources GET (the dev-only double-invoke is deduped)", async () => {
    const store = makeStore();
    renderPage(store, "pipe-a", true);
    await pageReady("pipe-a");
    await waitFor(() => expect(jest.mocked(fetchSources)).toHaveBeenCalled());
    expect(jest.mocked(fetchSources)).toHaveBeenCalledTimes(1);
  });
});
