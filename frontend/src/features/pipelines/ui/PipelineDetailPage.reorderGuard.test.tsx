// PipelineDetailPage.reorderGuard.test.tsx — HEL-1007.
//
// THIS TESTS A DEFENSE-IN-DEPTH BRANCH THAT HAS NO LIVE PATH. It does not prove reachability: no UI
// interaction can produce the state below (every Move/drag goes through `reorderLane`, which carries
// `rootId` with a lane's head -- see the exhaustive invariant test in state/stepTree.test.ts). The
// `newOrder` is hand-built and fed straight to `handleReorderSteps` (captured off the step actions' `onReorderSteps`
// argument, which both layouts pass) to pin what the HEL-973 evaluation-1 CR2 guard does if that state ever
// arises: refuse loudly, never send a silently truncated payload.

import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { createElement } from "react";

import { ThemeProvider } from "../../../theme/ThemeProvider";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
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
  reorderPipelineSteps,
} from "../services/pipelineService";
import type { PipelineStep, PipelineSummary } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { installPhoneShell } from "./pipelineDetailPageTestUtils";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  analyzePipeline: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
  reorderPipelineSteps: jest.fn(),
}));

// Capture the page's real `handleReorderSteps` (handed to `useSpineStepActions` by the phone layout, as by the desktop one)
// and the steps the layout renders, while still running the real hook and spine.
const mockCapture: { onReorderSteps: ((o: Step[]) => unknown) | null; steps: Step[] } = {
  onReorderSteps: null,
  steps: [],
};
jest.mock("./spine/useSpineStepActions", () => {
  const actual = jest.requireActual("./spine/useSpineStepActions");
  return {
    useSpineStepActions: (args: { onReorderSteps: (o: Step[]) => unknown }) => {
      mockCapture.onReorderSteps = args.onReorderSteps;
      return actual.useSpineStepActions(args);
    },
  };
});
jest.mock("./spine/PipelineSpine", () => {
  const actual = jest.requireActual("./spine/PipelineSpine");
  return {
    PipelineSpine: (props: { steps: Step[] }) => {
      mockCapture.steps = props.steps;
      return createElement(actual.PipelineSpine, props);
    },
  };
});

const pipeline: PipelineSummary = {
  id: "pipe-1",
  name: "Test Pipeline",
  roots: [
    { id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" },
    { id: "root-2", dataSourceId: "src-2", dataSourceName: "Shipments" },
  ],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

function wire(id: string, extra: Partial<PipelineStep>, type: "rename" | "filter"): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position: 0,
    type,
    config: type === "rename" ? { renames: {} } : { combinator: "AND", conditions: [] },
    createdAt: "",
    updatedAt: "",
    ...extra,
  } as PipelineStep;
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
  });
}

// The page logic under test is layout-independent; this file runs it through the phone layout (HEL-1582). jsdom has
// no `matchMedia`, so stub the phone shell.
let restorePhoneShell: () => void = () => {};
beforeEach(() => {
  restorePhoneShell = installPhoneShell();
});
afterEach(() => {
  restorePhoneShell();
});

describe("handleReorderSteps CR2 guard (DEFENSE-IN-DEPTH branch, no live path)", () => {
  beforeEach(() => {
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest.mocked(getPipelineSchedule).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
    jest.mocked(analyzePipeline).mockResolvedValue({
      id: "pipe-1",
      name: "Test Pipeline",
      sourceSchemas: [],
      steps: [],
      costVerdict: { autoRunnable: true, stepCount: 0, reasons: [], canRun: true },
      callerRole: "owner",
      warnings: [],
    });
    jest
      .mocked(getPipelineSteps)
      .mockResolvedValue([
        wire("a1", { rootId: "root-1" }, "rename"),
        wire("b1", { parentStepId: "a1" }, "filter"),
        wire("x1", { rootId: "root-2" }, "rename"),
      ]);
  });
  afterEach(() => jest.clearAllMocks());

  it("a root that had steps but whose trunk lane comes back empty is refused: error toast naming the root, no PUT, no optimistic state change", async () => {
    const store = makeStore();
    render(
      <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
        <ThemeProvider>
          <Provider store={store}>
            <OverlayProvider>
              <Routes>
                <Route path="/pipelines/:id" element={<PipelineDetailPage />} />
              </Routes>
            </OverlayProvider>
          </Provider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await screen.findAllByRole("button", { name: /^Step \d+:/ });

    const before = mockCapture.steps;
    expect(before.map((s) => s.id)).toEqual(["a1", "b1", "x1"]);
    // Hand-built truncated order: root-1's head loses its `rootId`, orphaning root-1's chain.
    const truncated = before.map((s) => (s.id === "a1" ? { ...s, rootId: undefined } : s));

    await act(async () => {
      await mockCapture.onReorderSteps!(truncated);
    });

    expect(reorderPipelineSteps).not.toHaveBeenCalled();
    const toasts = store.getState().toasts.items;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].variant).toBe("error");
    expect(toasts[0].message).toContain('"Orders" root lost its trunk lane');
    expect(toasts[0].message).not.toContain("root-1");
    // No optimistic `setSteps`: the page's steps are exactly what they were (head keeps its rootId).
    expect(mockCapture.steps.map((s) => [s.id, s.rootId])).toEqual(
      before.map((s) => [s.id, s.rootId]),
    );
  });
});
