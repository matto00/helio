// usePipelineDetailPage.analyze.test.tsx -- HEL-1478 characterization (T2, T3, T4).
//
// Committed green on the pre-change base so the render-time-ref fixes (design D1) and the sub-hook
// extractions (D2/D3) can be proven not to have changed observable behaviour:
//  - T2: when the debounced re-analyze effect dispatches `analyzePipeline` (and when it must not).
//  - T3: how many times the host renders for an open plus one edit (guards "no extra render").
//  - T4: a finished run (HTTP path and SSE `onTerminal` path) refreshes every loaded Output's preview.
// Cases already pinned elsewhere are cited, not duplicated: F-105 open-with-persisted-steps and the
// stuck-guard watchdog live in `ui/PipelineDetailPage.test.tsx`.

import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { ReactNode } from "react";

import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import { outputsReducer } from "../state/outputsSlice";
import { OP_TYPES } from "../state/stepNarrowing";
import { usePipelineDetailPage } from "./usePipelineDetailPage";
import {
  analyzePipeline,
  createPipelineStep,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
  runPipeline,
} from "../services/pipelineService";
import { listOutputs, previewOutputs } from "../services/outputService";
import type { Output } from "../types/output";
import type { PipelineStep, PipelineSummary } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  analyzePipeline: jest.fn(),
  createPipelineStep: jest.fn(),
  runPipeline: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
}));
jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: jest.fn(),
  previewOutputs: jest.fn(),
}));

const analyzeMock = jest.mocked(analyzePipeline);
const createStepMock = jest.mocked(createPipelineStep);
const runMock = jest.mocked(runPipeline);

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

function wireStep(id: string, extra: Partial<PipelineStep>): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position: 0,
    type: "rename",
    config: { renames: {} },
    createdAt: "",
    updatedAt: "",
    ...extra,
  } as PipelineStep;
}
const persisted = () => [
  wireStep("s1", { rootId: "root-1" }),
  wireStep("s2", { parentStepId: "s1", position: 0 }),
];

function output(id: string): Output {
  return {
    id,
    pipelineId: "pipe-1",
    nodeStepId: "s2",
    ownerId: "u1",
    name: id,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}

const analyzeResponse = {
  id: "pipe-1",
  name: "Test Pipeline",
  sourceSchemas: [{ rootId: "root-1", sourceSchema: [{ name: "a", type: "string" }] }],
  steps: [],
  costVerdict: { autoRunnable: true, stepCount: 1, reasons: [], canRun: true },
  warnings: [],
};

const baseState = {
  ...pipelinesReducer(undefined, { type: "@@init" }),
  currentPipeline: pipeline,
  currentPipelineStatus: "succeeded" as const,
};

function makeStore(opts: { preloadSteps?: boolean } = {}) {
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
    preloadedState: {
      sources: { items: [], status: "succeeded" as const, error: null },
      pipelines: { ...baseState, steps: opts.preloadSteps ? { "pipe-1": persisted() } : {} },
    } as never,
  });
}

function renderPage(opts: { preloadSteps?: boolean } = {}) {
  const store = makeStore(opts);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
      <Provider store={store}>
        <Routes>
          <Route path="/pipelines/:id" element={<>{children}</>} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
  const renders = { count: 0 };
  const hook = renderHook(
    () => {
      renders.count += 1;
      return usePipelineDetailPage();
    },
    { wrapper },
  );
  return { ...hook, store, renders };
}

/** Flush resolved promises (mock services) and run any timers due within `ms`. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

// Measured on the pre-change base (T3). The first two are right after the open's seed re-render and
// right after the edit's synchronous act; `settled` includes the analyze dispatch's own status renders.
// HEL-1483: +1 from the render that records "this mount's steps fetch fulfilled" (the seed gate), and
// +1 from the render-phase update that keeps this mount's own pipeline when the fetch replaces it.
const RENDERS_AFTER_OPEN = 7;
const RENDERS_AFTER_EDIT = 8;
const RENDERS_SETTLED = 10;

const generateText = OP_TYPES.find((op) => op.id === "generatetext")!;
const completeAiConfig = { inputField: "a", instruction: "Summarize", outputField: "summary" };

describe("usePipelineDetailPage analyze dispatch / render count / run-completion previews (HEL-1478)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest
      .mocked(getPipelineSchedule)
      .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
    jest.mocked(getPipelineSteps).mockResolvedValue(persisted());
    analyzeMock.mockResolvedValue(analyzeResponse as never);
    jest.mocked(listOutputs).mockResolvedValue([output("o1"), output("o2")]);
    jest.mocked(previewOutputs).mockResolvedValue({ outputs: [] } as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // F-105, seeding in the MOUNTING render: the steps are already in Redux at first render, so the
  // seed block runs before the first commit. (The fetch-then-seed variant is pinned by
  // `PipelineDetailPage.test.tsx` "fires analyzePipeline exactly once on open".)
  it("T2 F-105 seed-at-mount: steps already in Redux at first render give exactly one analyze over 1s", async () => {
    const { result } = renderPage({ preloadSteps: true });
    // HEL-1483 (design D2a): a cache entry that pre-dates the mount is never seeded from -- the
    // editor waits for the steps fetch this mount issued, so a revisit can't show pre-edit steps.
    expect(result.current.steps).toHaveLength(0);
    await advance(0);
    expect(result.current.steps).toHaveLength(2);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  // The debounce: nothing before 300ms, exactly one at 300ms, nothing more after.
  it("T2 edit: a config edit dispatches exactly one more analyze, 300ms later (not before)", async () => {
    const { result } = renderPage({ preloadSteps: true });
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    act(() => result.current.handleStepConfigChange("s1", { renames: { a: "b" } }));
    await advance(299);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(analyzeMock).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(analyzeMock).toHaveBeenCalledTimes(2);
  });

  // The guard: an edit while a run is in flight defers; the run settling (here: failing, which
  // clears `sseActive` the ordinary way) releases exactly one dispatch.
  it("T2 defer: an edit during a run is deferred, then dispatched exactly once when the run settles", async () => {
    let rejectRun: (e: Error) => void = () => {};
    runMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectRun = reject;
      }),
    );
    const { result } = renderPage({ preloadSteps: true });
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    act(() => {
      void result.current.handleRunPipeline();
    });
    expect(result.current.sseActive).toBe(true);
    act(() => result.current.handleStepConfigChange("s1", { renames: { a: "b" } }));
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    await act(async () => rejectRun(new Error("boom")));
    await advance(400);
    expect(result.current.sseActive).toBe(false);
    expect(analyzeMock).toHaveBeenCalledTimes(2);
    await advance(2000);
    expect(analyzeMock).toHaveBeenCalledTimes(2);
  });

  // A pending AI draft has no server-side representation: it is excluded from the fingerprint, so
  // adding it dispatches nothing; completing it (create fires, then the id swap) dispatches.
  it("T2 draft: adding a pending AI draft dispatches nothing; completing it dispatches", async () => {
    createStepMock.mockResolvedValue(wireStep("ai-1", { type: "generatetext" } as never));
    const { result } = renderPage({ preloadSteps: true });
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.handleInsertStep(generateText, 2);
    });
    expect(result.current.steps).toHaveLength(3);
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(createStepMock).not.toHaveBeenCalled();
    const draftId = result.current.steps[2]!.id;
    act(() => result.current.handleStepConfigChange(draftId, completeAiConfig));
    expect(createStepMock).toHaveBeenCalledTimes(1);
    await advance(1000);
    // open (1) + the completed draft entering the fingerprint (2) + the temp -> persisted id swap (3)
    expect(analyzeMock).toHaveBeenCalledTimes(3);
  });

  // The creation hook's failure path restores the draft's pending meta (so the draft leaves the
  // fingerprint again). Per phase: completing the draft moves the fingerprint (+1 once the create
  // is in flight, past the debounce); the rejected create restores the meta, moving it back (+1).
  it("T2 L370 create failure: a rejected draft create restores the pending meta (one analyze per phase)", async () => {
    let rejectCreate: (e: Error) => void = () => {};
    createStepMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectCreate = reject;
      }),
    );
    const { result } = renderPage({ preloadSteps: true });
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.handleInsertStep(generateText, 2);
    });
    const draftId = result.current.steps[2]!.id;
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(1); // phase 0: draft excluded
    act(() => result.current.handleStepConfigChange(draftId, completeAiConfig));
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(2); // phase 1: create in flight, draft now in the fingerprint
    await act(async () => rejectCreate(new Error("nope")));
    await advance(1000);
    expect(analyzeMock).toHaveBeenCalledTimes(3); // phase 2: failure restored the pending meta
    await advance(2000);
    expect(analyzeMock).toHaveBeenCalledTimes(3);
  });

  // T3: the host's render count for the open plus one edit. Guards "no extra render" for D1b/D1c.
  it("T3 render count: open (fetch + seed) plus one config edit renders the host a fixed number of times", async () => {
    const { result, renders } = renderPage();
    await advance(1000);
    expect(result.current.steps).toHaveLength(2);
    const afterOpen = renders.count;
    act(() => result.current.handleStepConfigChange("s1", { renames: { a: "b" } }));
    const afterEdit = renders.count;
    await advance(1000);
    expect({ afterOpen, afterEdit, settled: renders.count }).toEqual({
      afterOpen: RENDERS_AFTER_OPEN,
      afterEdit: RENDERS_AFTER_EDIT,
      settled: RENDERS_SETTLED,
    });
  });

  // T4 (HTTP path): the run's own response refreshes the preview of every loaded Output.
  it("T4 run completion (HTTP): a finished run previews every loaded Output", async () => {
    runMock.mockResolvedValue({ rowCount: 0, rows: [], stepRowCounts: {}, sourceRowCount: 0 });
    const { result } = renderPage({ preloadSteps: true });
    await advance(1000);
    expect(result.current.allOutputs.map((o) => o.id)).toEqual(["o1", "o2"]);
    await act(async () => {
      await result.current.handleRunPipeline();
    });
    const previewed = jest.mocked(previewOutputs).mock.calls.map((c) => c[1]);
    expect(previewed.sort()).toEqual(["o1", "o2"]);
  });

  // T4 (SSE path): a run already in flight when the page mounted finishes via the stream's
  // terminal event; `onTerminal` previews every loaded Output (read through `allOutputsRef`).
  it("T4 run completion (SSE onTerminal): a terminal event previews every loaded Output", async () => {
    runMock.mockResolvedValue({ rowCount: 0, rows: [], stepRowCounts: {}, sourceRowCount: 0 });
    const originalFetch = global.fetch;
    const encoder = new TextEncoder();
    let enqueue: (c: Uint8Array) => void = () => undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        enqueue = (c) => ctrl.enqueue(c);
      },
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: stream,
    } as unknown as Response);
    try {
      jest.useRealTimers();
      const { result } = renderPage({ preloadSteps: true });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(result.current.allOutputs).toHaveLength(2);
      await act(async () => {
        void result.current.handleRunPipeline();
        await new Promise((r) => setTimeout(r, 50));
      });
      jest.mocked(previewOutputs).mockClear();
      await act(async () => {
        enqueue(
          encoder.encode(`event: run-status\ndata: ${JSON.stringify({ status: "succeeded" })}\n\n`),
        );
        await new Promise((r) => setTimeout(r, 100));
      });
      const previewed = jest.mocked(previewOutputs).mock.calls.map((c) => c[1]);
      expect(previewed.sort()).toEqual(expect.arrayContaining(["o1", "o2"]));
    } finally {
      global.fetch = originalFetch;
    }
  });
});
