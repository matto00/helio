// usePipelineDetailPage.identity.test.tsx — HEL-1465 characterization (F-146).
//
// Pins callback/getter identity stability of `usePipelineDetailPage`'s analyze, step-structure and
// step-mutation clusters across (a) an unrelated state change (`outputName`) and (b) a step config
// edit (`steps` changes). `StepCard` is `React.memo`'d, so a handler that changes identity on either
// would re-render every untouched card. Committed green on the pre-split base so the sub-hook
// extraction can be proven not to have changed any identity.

import { act, renderHook, waitFor } from "@testing-library/react";
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
import { usePipelineDetailPage } from "./usePipelineDetailPage";
import {
  analyzePipeline,
  fetchRunHistory,
  getPipelineById,
  getPipelineSchedule,
  getPipelineStepCatalog,
  getPipelineSteps,
} from "../services/pipelineService";
import type { PipelineStep, PipelineSummary } from "../types/pipelineStep";

jest.mock("../services/pipelineService", () => ({
  fetchPipelines: jest.fn(),
  fetchRunHistory: jest.fn(),
  getPipelineById: jest.fn(),
  getPipelineSteps: jest.fn(),
  analyzePipeline: jest.fn(),
  getPipelineSchedule: jest.fn(),
  getPipelineStepCatalog: jest.fn(),
  getPipelineShapeCatalog: jest.fn(),
}));

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

function renderPage() {
  const store = makeStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={["/pipelines/pipe-1"]}>
      <Provider store={store}>
        <Routes>
          <Route path="/pipelines/:id" element={<>{children}</>} />
        </Routes>
      </Provider>
    </MemoryRouter>
  );
  return renderHook(() => usePipelineDetailPage(), { wrapper });
}

type Page = ReturnType<typeof usePipelineDetailPage>;

// Handlers/getters from the analyze-lookup, step-structure and step-mutation clusters that depend
// on neither `steps` nor `outputName` on the base.
const STEP_INDEPENDENT_KEYS = [
  "getAnalyzeOutputSchema",
  "hasOwnAnalyzeEntry",
  "getAnalyzeValidationError",
  "getAnalyzeWarnings",
  "handleAddStep",
  "handleAddLaneStep",
  "handleInsertStep",
  "handleAddOutputViaAggregateTail",
  "handleInstantiateShape",
  "handleStepConfigChange",
  "handleRemoveStep",
  "handleReorderSteps",
  "handleToggleStepEnabled",
  "handleDuplicateStep",
  "handleAddRoot",
  "handleRemoveRoot",
] as const satisfies readonly (keyof Page)[];

// `getAnalyzeColumns`/`getAnalyzeSchema` legitimately change identity when `steps` changes on the
// base (via `getDraftFallbackSchema`'s `[steps, ...]` deps), so they are only pinned for outputName.
const OUTPUT_NAME_ONLY_KEYS = ["getAnalyzeColumns", "getAnalyzeSchema"] as const;

function snapshot(page: Page, keys: readonly (keyof Page)[]) {
  return keys.map((k) => [k, page[k]] as const);
}

describe("usePipelineDetailPage identity stability (F-146)", () => {
  beforeEach(() => {
    jest.mocked(getPipelineById).mockResolvedValue(pipeline);
    jest.mocked(fetchRunHistory).mockResolvedValue([]);
    jest
      .mocked(getPipelineSchedule)
      .mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    jest.mocked(getPipelineStepCatalog).mockResolvedValue({ groups: [], steps: [] });
    jest.mocked(analyzePipeline).mockResolvedValue({
      id: "pipe-1",
      name: "Test Pipeline",
      sourceSchemas: [{ rootId: "root-1", sourceSchema: [{ name: "a", type: "string" }] }],
      steps: [
        {
          id: "s1",
          inputSchema: [{ name: "a", type: "string" }],
          outputSchema: [{ name: "a", type: "string" }],
        },
      ],
      costVerdict: { autoRunnable: true, stepCount: 1, reasons: [], canRun: true },
      warnings: [{ stepId: "s1", code: "field-not-in-input-schema", message: "w" }],
    } as never);
    jest
      .mocked(getPipelineSteps)
      .mockResolvedValue([
        wireStep("s1", { rootId: "root-1" }),
        wireStep("s2", { parentStepId: "s1" }),
      ]);
  });
  afterEach(() => jest.clearAllMocks());

  async function loaded() {
    const hook = renderPage();
    await waitFor(() => expect(hook.result.current.steps).toHaveLength(2));
    await waitFor(() => expect(hook.result.current.getAnalyzeWarnings("s1")).toHaveLength(1));
    // let the mount-time fetches settle so the baseline render is quiescent
    await act(async () => {});
    return hook;
  }

  it("keeps every cluster handler/getter identity across an unrelated outputName change", async () => {
    const { result } = await loaded();
    const before = snapshot(result.current, [...STEP_INDEPENDENT_KEYS, ...OUTPUT_NAME_ONLY_KEYS]);
    act(() => result.current.setOutputName("Renamed"));
    expect(result.current.outputName).toBe("Renamed");
    for (const [key, fn] of before) {
      expect([key, result.current[key] === fn]).toEqual([key, true]);
    }
  });

  it("keeps the step-mutation / structure handlers stable when a step's config is edited", async () => {
    const { result } = await loaded();
    const before = snapshot(result.current, STEP_INDEPENDENT_KEYS);
    const stepsBefore = result.current.steps;
    act(() => result.current.handleStepConfigChange("s1", { renames: { a: "b" } }));
    expect(result.current.steps).not.toBe(stepsBefore);
    for (const [key, fn] of before) {
      expect([key, result.current[key] === fn]).toEqual([key, true]);
    }
  });
});
