// HEL-1483 -- an in-app switch between pipelines (`/pipelines/A` -> `/pipelines/B`, no reload) must
// leave the editor showing exactly B's persisted steps. The router reuses the same component
// instance for a `:id` change, so every per-pipeline piece of page state has to be reset by the
// exported `PipelineDetailPage` itself (it renders exactly what AppRoutes renders for the route).
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

import { ThemeProvider } from "../../../theme/ThemeProvider";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { fetchPipelineById, pipelinesReducer, submitPipelineRun } from "../state/pipelinesSlice";
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
  addPipelineRoot,
  removePipelineRoot,
  runPipeline,
  updatePipelineStep,
} from "../services/pipelineService";
import { httpClient } from "../../../services/httpClient";
import type { PipelineStep, PipelineSummary } from "../types/pipelineStep";
import { installPhoneShell } from "./pipelineDetailPageTestUtils";

jest.mock("../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
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
  listPipelinePermissions: jest.fn(),
  runPipeline: jest.fn(),
  addPipelineRoot: jest.fn(),
  removePipelineRoot: jest.fn(),
  updatePipelineStep: jest.fn(),
  updatePipelineStepEnabled: jest.fn(),
  reorderPipelineSteps: jest.fn(),
  createPipelineStep: jest.fn(),
  duplicatePipelineStep: jest.fn(),
  deletePipelineStep: jest.fn(),
}));
jest.mock("../services/outputService", () => ({
  ...jest.requireActual("../services/outputService"),
  listOutputs: jest.fn().mockResolvedValue([]),
}));

// Capture the header's props (the page's real handleAddRoot / handleRemoveRoot) while still
// rendering the real header, so a test can start a root add/remove on A and let it outlive A's page.
const mockHeader: {
  props: { onAddRoot: (sourceId: string) => void; onRemoveRoot: (rootId: string) => void } | null;
} = { props: null };
jest.mock("./PipelineDetailHeader", () => {
  const actual = jest.requireActual("./PipelineDetailHeader");
  return {
    PipelineDetailHeader: (props: {
      onAddRoot: (sourceId: string) => void;
      onRemoveRoot: (rootId: string) => void;
    }) => {
      mockHeader.props = props;
      return actual.PipelineDetailHeader(props);
    },
  };
});

function pipelineOf(id: string): PipelineSummary {
  return {
    id,
    name: `Pipeline ${id}`,
    roots: [{ id: `root-${id}`, dataSourceId: "src-1", dataSourceName: "Test Source" }],
    lastRunStatus: null,
    lastRunAt: null,
    lastRunRowCount: null,
  };
}

function limitStep(pid: string, stepId: string, count: number, parent?: string): PipelineStep {
  return {
    id: stepId,
    pipelineId: pid,
    position: 0,
    type: "limit",
    config: { count },
    createdAt: "",
    updatedAt: "",
    ...(parent ? { parentStepId: parent } : { rootId: `root-${pid}` }),
  } as PipelineStep;
}

// A: three steps. B: one step.
const A_STEPS = [
  limitStep("A", "a1", 11),
  limitStep("A", "a2", 12, "a1"),
  limitStep("A", "a3", 13, "a2"),
];
const B_STEPS = [limitStep("B", "b1", 21)];

function analyzeOf(id: string, steps: PipelineStep[]) {
  return {
    id,
    name: `Pipeline ${id}`,
    sourceSchemas: [{ rootId: `root-${id}`, sourceSchema: [] }],
    steps: steps.map((s) => ({ stepId: s.id, inputSchema: [], outputSchema: [] })),
    costVerdict: { autoRunnable: true, stepCount: steps.length, reasons: [], canRun: true },
    warnings: [],
  };
}

let navigateTo: (path: string) => void = () => {};
function Nav() {
  const navigate = useNavigate();
  useEffect(() => {
    navigateTo = (path) => navigate(path);
  }, [navigate]);
  return null;
}

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      dashboards: dashboardsReducer,
      layoutHistory: layoutHistoryReducer,
      panels: panelsReducer,
      sources: sourcesReducer,
      sourceSamples: sourceSamplesReducer,
      pipelines: pipelinesReducer,
      outputs: outputsReducer,
      toasts: toastsReducer,
    } as never,
    preloadedState: {
      sources: { items: [], status: "succeeded" as const, error: null },
    } as never,
  });
}

function renderAt(path: string) {
  const store = makeStore();
  render(
    <MemoryRouter initialEntries={[path]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <Nav />
            <Routes>
              <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
              <Route path="/other" element={<div>Elsewhere</div>} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return store;
}

/** Ids `getPipelineById` was called with after the first `since` calls (A's own mount call is
 *  legitimately before the switch, so the no-refetch assertions scope to calls after it). */
const getPipelineByIdIdsSince = (since: number) =>
  jest
    .mocked(getPipelineById)
    .mock.calls.slice(since)
    .map((c) => c[0]);

const stepButtons = () => screen.queryAllByRole("button", { name: /limit/i, expanded: false });

let aSteps: PipelineStep[];
beforeEach(() => {
  aSteps = A_STEPS;
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.mocked(fetchRunHistory).mockResolvedValue([]);
  jest.mocked(getPipelineById).mockImplementation((id: string) => Promise.resolve(pipelineOf(id)));
  jest
    .mocked(getPipelineSteps)
    .mockImplementation((id: string) => Promise.resolve(id === "A" ? aSteps : B_STEPS));
  jest
    .mocked(analyzePipeline)
    .mockImplementation((id: string) =>
      Promise.resolve(analyzeOf(id, id === "A" ? aSteps : B_STEPS) as never),
    );
  jest.mocked(getPipelineSchedule).mockRejectedValue({
    isAxiosError: true,
    response: { status: 404, data: undefined },
  });
  jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
  jest.mocked(updatePipelineStep).mockResolvedValue(undefined as never);
  jest.mocked(httpClient.get).mockResolvedValue({ data: { rows: [], rowCount: 0 } });
});
afterEach(() => {
  jest.clearAllMocks();
});

async function openAThenSwitchToB() {
  const store = renderAt("/pipelines/A");
  await waitFor(() => expect(stepButtons()).toHaveLength(3));
  act(() => navigateTo("/pipelines/B"));
  return store;
}

// HEL-1579: the legacy page tests assert the phone layout (river view, cards, tabs, footer) and layout-independent
// page logic reached through the phone's card DOM; jsdom has no `matchMedia`, so stub the phone shell. The desktop
// step spine has its own tests (`PipelineDetailPage.spine*.test.tsx`).
let restorePhoneShell: () => void = () => {};
beforeEach(() => {
  restorePhoneShell = installPhoneShell();
});
afterEach(() => {
  restorePhoneShell();
});

describe("PipelineDetailPage -- in-app pipeline switch (HEL-1483)", () => {
  it("shows exactly B's persisted steps after A -> B, never A's", async () => {
    await openAThenSwitchToB();
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    // No stale A card survives (A's third step would still be rendered here on base).
    expect(screen.queryByText("Pipeline A")).toBeNull();
  });

  it("A -> B -> A shows A's CURRENT server steps, not a pre-edit cached seed (D2a)", async () => {
    await openAThenSwitchToB();
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    // The server's A changed while we were away: one step fewer.
    aSteps = A_STEPS.slice(0, 2);
    act(() => navigateTo("/pipelines/A"));
    await waitFor(() => expect(screen.getByText("Pipeline A")).toBeInTheDocument());
    await waitFor(() => expect(stepButtons()).toHaveLength(2));
  });

  it("does not issue a request carrying one of A's step ids once B is showing", async () => {
    await openAThenSwitchToB();
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    fireEvent.click(stepButtons()[0]);
    const input = await screen.findByRole("spinbutton", { name: /row limit/i });
    fireEvent.change(input, { target: { value: "99" } });
    await waitFor(() => expect(updatePipelineStep).toHaveBeenCalled());
    const ids = jest.mocked(updatePipelineStep).mock.calls.map((c) => c[0]);
    expect(ids).toEqual(["b1"]);
  });

  it("every analyze request after the switch is for B (AC4)", async () => {
    renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    const before = jest.mocked(analyzePipeline).mock.calls.length;
    act(() => navigateTo("/pipelines/B"));
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    fireEvent.click(stepButtons()[0]);
    fireEvent.change(await screen.findByRole("spinbutton", { name: /row limit/i }), {
      target: { value: "98" },
    });
    // The edit is PATCHed after 400ms, then the debounced re-analyze fires 300ms later.
    await waitFor(() => expect(analyzePipeline).toHaveBeenCalledTimes(before + 2), {
      timeout: 4000,
    });
    const after = jest.mocked(analyzePipeline).mock.calls.slice(before);
    // the open's own analyze plus the debounced re-analyze after the edit
    expect(after.length).toBeGreaterThanOrEqual(2);
    expect(after.map((c) => c[0])).toEqual(after.map(() => "B"));
  });

  it("shows the steps loading skeleton, not 'No steps yet', while B's steps fetch is pending (D2a)", async () => {
    let resolveB: (s: PipelineStep[]) => void = () => {};
    jest.mocked(getPipelineSteps).mockImplementation((id: string) =>
      id === "A"
        ? Promise.resolve(A_STEPS)
        : new Promise<PipelineStep[]>((r) => {
            resolveB = r;
          }),
    );
    renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    act(() => navigateTo("/pipelines/B"));
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    expect(screen.queryByText("No steps yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Add step" })).toBeNull();
    expect(screen.queryByText("0 steps")).toBeNull();
    await act(async () => {
      resolveB(B_STEPS);
    });
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
  });

  it("a genuinely empty pipeline shows 'No steps yet' once its fetch has fulfilled", async () => {
    jest.mocked(getPipelineSteps).mockImplementation(() => Promise.resolve([]));
    renderAt("/pipelines/B");
    expect(await screen.findByText("No steps yet")).toBeInTheDocument();
  });

  it("a rejected steps fetch does not leave the skeleton forever (HEL-1501: shows the steps error with Retry, not the empty editor)", async () => {
    jest.mocked(getPipelineSteps).mockRejectedValue(new Error("boom"));
    renderAt("/pipelines/B");
    expect(await screen.findByText("Couldn't load this pipeline's steps.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("No steps yet")).toBeNull();
  });

  it("drops a pending debounced step save for A when the page switches to B", async () => {
    renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    fireEvent.click(stepButtons()[0]);
    const input = await screen.findByRole("spinbutton", { name: /row limit/i });
    fireEvent.change(input, { target: { value: "77" } });
    // Within the 400ms debounce window: leave A.
    act(() => navigateTo("/pipelines/B"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(updatePipelineStep).not.toHaveBeenCalled();
  });

  it("does not let a late fetchPipelineById(A) overwrite B's page", async () => {
    let resolveA: (p: PipelineSummary) => void = () => {};
    jest.mocked(getPipelineById).mockImplementation((id: string) =>
      id === "A"
        ? new Promise<PipelineSummary>((r) => {
            resolveA = r;
          })
        : Promise.resolve(pipelineOf(id)),
    );
    const store = renderAt("/pipelines/A");
    act(() => navigateTo("/pipelines/B"));
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    await act(async () => {
      resolveA(pipelineOf("A"));
    });
    expect(store.getState().pipelines.currentPipeline?.id).toBe("B");
    expect(screen.getByText("Pipeline B")).toBeInTheDocument();
    expect(store.getState().pipelines.currentPipelineStatus).toBe("succeeded");
    // The page's own (latest) request was for B; A's held request is not re-issued after the switch.
    expect(getPipelineById).toHaveBeenLastCalledWith("B");
  });

  it("A failing to load does not block B's load nor show A's error on B's page (D5a)", async () => {
    jest
      .mocked(getPipelineById)
      .mockImplementation((id: string) =>
        id === "A"
          ? Promise.reject({ isAxiosError: true, response: { status: 404, data: undefined } })
          : Promise.resolve(pipelineOf(id)),
      );
    renderAt("/pipelines/A");
    await screen.findByText("Couldn't load this pipeline");
    act(() => navigateTo("/pipelines/B"));
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load this pipeline")).toBeNull();
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
  });

  it("does not show A's name while B's pipeline is still loading (D5c)", async () => {
    jest
      .mocked(getPipelineById)
      .mockImplementation((id: string) =>
        id === "B" ? new Promise<PipelineSummary>(() => {}) : Promise.resolve(pipelineOf(id)),
      );
    renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    act(() => navigateTo("/pipelines/B"));
    expect(screen.queryByText("Pipeline A")).toBeNull();
    expect(stepButtons()).toHaveLength(0);
    // Let B's mount fetches (steps, analyze, ...) land inside act, not after the test returns.
    await act(async () => {});
    expect(screen.queryByText("Pipeline A")).toBeNull();
  });

  it("A's late run result does not land on B (D5b)", async () => {
    let resolveRun: (v: unknown) => void = () => {};
    jest.mocked(runPipeline).mockImplementation(
      () =>
        new Promise((r) => {
          resolveRun = r;
        }) as never,
    );
    const store = renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = store.dispatch(submitPipelineRun({ pipelineId: "A" }) as never) as never;
    });
    act(() => navigateTo("/pipelines/B"));
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    await act(async () => {
      resolveRun({ rowCount: 1, rows: [{ x: 1 }], stepRowCounts: { a1: 1 }, sourceRowCount: 1 });
      await pending;
    });
    const s = store.getState().pipelines;
    expect(s.runStatus).toBeNull();
    expect(s.runResult).toBeNull();
    expect(s.runStepRowCounts).toEqual({});
  });

  // Skeptic final-gate CR1: A's root add/remove continuation resolves AFTER the switch. Its page is
  // unmounted, so it must issue no refetch of A (`mountedRef` gate in
  // `usePipelineRootAndToggleActions`); B's page converges to B's own data.
  it("B converges to its own pipeline and steps when A's add-root continuation resolves after the switch, with no refetch of A", async () => {
    let resolveAdd: (v: unknown) => void = () => {};
    jest.mocked(addPipelineRoot).mockImplementation(
      () =>
        new Promise((r) => {
          resolveAdd = r;
        }) as never,
    );
    renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    const addRootOnA = mockHeader.props!.onAddRoot;
    act(() => addRootOnA("src-1"));
    const callsAtSwitch = jest.mocked(getPipelineById).mock.calls.length;
    // Hold B's own pipeline response so A's late refetch lands while B's is outstanding.
    let resolveB: (p: PipelineSummary) => void = () => {};
    jest.mocked(getPipelineById).mockImplementation((id: string) =>
      id === "B"
        ? new Promise<PipelineSummary>((r) => {
            resolveB = r;
          })
        : Promise.resolve(pipelineOf(id)),
    );
    act(() => navigateTo("/pipelines/B"));
    await act(async () => {
      resolveAdd({});
    });
    await act(async () => {
      resolveB(pipelineOf("B"));
    });
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    expect(screen.queryByLabelText("Loading pipeline")).toBeNull();
    expect(getPipelineByIdIdsSince(callsAtSwitch)).not.toContain("A");
  });

  it("B converges when A's remove-root continuation resolves after the switch, with no refetch of A", async () => {
    let resolveRemove: (v: unknown) => void = () => {};
    jest.mocked(removePipelineRoot).mockImplementation(
      () =>
        new Promise((r) => {
          resolveRemove = r;
        }) as never,
    );
    renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    const removeRootOnA = mockHeader.props!.onRemoveRoot;
    act(() => removeRootOnA("root-A"));
    const callsAtSwitch = jest.mocked(getPipelineById).mock.calls.length;
    let resolveB: (p: PipelineSummary) => void = () => {};
    jest.mocked(getPipelineById).mockImplementation((id: string) =>
      id === "B"
        ? new Promise<PipelineSummary>((r) => {
            resolveB = r;
          })
        : Promise.resolve(pipelineOf(id)),
    );
    act(() => navigateTo("/pipelines/B"));
    await act(async () => {
      resolveRemove({ removedStepCount: 0, removedOutputCount: 0 });
    });
    await act(async () => {
      resolveB(pipelineOf("B"));
    });
    await waitFor(() => expect(screen.getByText("Pipeline B")).toBeInTheDocument());
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    expect(screen.queryByLabelText("Loading pipeline")).toBeNull();
    expect(getPipelineByIdIdsSince(callsAtSwitch)).not.toContain("A");
  });

  // Evaluator cycle 3 CR1: B fully loaded, then A's root continuation resolves after the switch. A's
  // page is unmounted, so it issues no refetch of A (which would supersede the singleton); B's
  // editor must stay mounted (no page skeleton), so a pending debounced edit on B still lands.
  it.each(["add-root", "remove-root"])(
    "keeps B's editor (and its pending edit) when A's %s continuation resolves after the switch, with no refetch of A",
    async (name) => {
      let resolveRoot: (v: unknown) => void = () => {};
      const held = new Promise((r) => {
        resolveRoot = r;
      });
      jest.mocked(addPipelineRoot).mockImplementation(() => held as never);
      jest.mocked(removePipelineRoot).mockImplementation(() => held as never);
      renderAt("/pipelines/A");
      await waitFor(() => expect(stepButtons()).toHaveLength(3));
      const start =
        name === "add-root"
          ? mockHeader.props!.onAddRoot.bind(null, "src-1")
          : mockHeader.props!.onRemoveRoot.bind(null, "root-A");
      act(() => start());
      const callsAtSwitch = jest.mocked(getPipelineById).mock.calls.length;
      act(() => navigateTo("/pipelines/B"));
      await waitFor(() => expect(stepButtons()).toHaveLength(1));
      fireEvent.click(stepButtons()[0]);
      fireEvent.change(await screen.findByRole("spinbutton", { name: /row limit/i }), {
        target: { value: "55" },
      });
      // Inside the 400ms debounce window: A's continuation resolves (and, unmounted, refetches nothing).
      await act(async () => {
        resolveRoot({ removedStepCount: 0, removedOutputCount: 0 });
      });
      expect(getPipelineByIdIdsSince(callsAtSwitch)).not.toContain("A");
      expect(screen.queryByLabelText("Loading pipeline")).toBeNull();
      await waitFor(() => expect(updatePipelineStep).toHaveBeenCalledWith("b1", { count: 55 }));
      expect(screen.queryByLabelText("Loading pipeline")).toBeNull();
      expect(screen.getByRole("spinbutton", { name: /row limit/i })).toBeInTheDocument();
    },
  );

  // Pins the per-mount `ownPipeline` keep on its own (no root continuation involved): a foreign
  // fetchPipelineById(A) landing on the store while B is loaded and mid-edit must not swap B's editor
  // for the page skeleton, show A, or drop B's pending debounced edit.
  it("keeps B's editor and pending edit when a foreign fetchPipelineById(A) resolves on the store", async () => {
    const store = renderAt("/pipelines/A");
    await waitFor(() => expect(stepButtons()).toHaveLength(3));
    act(() => navigateTo("/pipelines/B"));
    await waitFor(() => expect(stepButtons()).toHaveLength(1));
    fireEvent.click(stepButtons()[0]);
    fireEvent.change(await screen.findByRole("spinbutton", { name: /row limit/i }), {
      target: { value: "66" },
    });
    // Hold B's convergence refetch so the singleton stays on A for the assertions below.
    jest
      .mocked(getPipelineById)
      .mockImplementation((id: string) =>
        id === "B" ? new Promise<PipelineSummary>(() => {}) : Promise.resolve(pipelineOf(id)),
      );
    // Inside the 400ms debounce window: another request for A lands on the shared store.
    await act(async () => {
      await store.dispatch(fetchPipelineById("A") as never);
    });
    expect(store.getState().pipelines.currentPipeline?.id).toBe("A");
    expect(screen.queryByLabelText("Loading pipeline")).toBeNull();
    expect(screen.queryByText("Pipeline A")).toBeNull();
    expect(screen.getByText("Pipeline B")).toBeInTheDocument();
    await waitFor(() => expect(updatePipelineStep).toHaveBeenCalledWith("b1", { count: 66 }));
    expect(screen.queryByLabelText("Loading pipeline")).toBeNull();
    expect(screen.getByRole("spinbutton", { name: /row limit/i })).toBeInTheDocument();
  });
});
