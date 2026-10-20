// Shared fixtures for the desktop step-spine page tests (HEL-1579): a store builder, a router-wrapped
// renderer and wire-shaped step / analyze builders. Each test file keeps its own `jest.mock` for the
// pipeline service (a mock factory must live in the file that mocks), listing the functions it needs.

import { configureStore } from "@reduxjs/toolkit";
import { render } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { OverlayProvider } from "../../../shared/chrome/OverlayProvider";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { layoutHistoryReducer } from "../../layout/state/layoutHistorySlice";
import { panelsReducer } from "../../panels/state/panelsSlice";
import type { DataSource, SourceSample } from "../../sources/types/dataSource";
import { sourcesReducer } from "../../sources/state/sourcesSlice";
import { sourceSamplesReducer } from "../../sources/state/sourceSamplesSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { outputsReducer } from "../state/outputsSlice";
import { pipelinesReducer } from "../state/pipelinesSlice";
import type { Output } from "../types/output";
import type {
  PipelineAnalyzeResponse,
  PipelineRunRecord,
  PipelineStep,
  PipelineStepConfig,
  PipelineSummary,
  SchemaField,
} from "../types/pipelineStep";
import { PipelineDetailPage } from "./PipelineDetailPage";
import { settled } from "./pipelineDetailPageTestUtils";

export const SPINE_PIPELINE: PipelineSummary = {
  id: "pipe-1",
  name: "Revenue rollup",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Sales CSV" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

export const SALES_SOURCE = {
  id: "src-1",
  name: "Sales CSV",
  type: "csv",
  ownerId: "u-1",
} as unknown as DataSource;

export interface SpineStoreOptions {
  pipeline?: PipelineSummary;
  sources?: DataSource[];
  outputs?: Output[];
  runStatus?: "queued" | "running" | "succeeded" | "failed" | null;
  runIsDry?: boolean | null;
  runResult?: Record<string, unknown>[] | null;
  runStepRowCounts?: Record<string, number>;
  runSourceTruncated?: boolean;
  runTruncationNotice?: string | null;
  runHistory?: Record<string, PipelineRunRecord[]>;
  currentUserId?: string;
  updateStatus?: "idle" | "loading" | "succeeded" | "failed";
  updateError?: string | null;
  /** HEL-1631: cached source samples by data source id, as the page's sample store holds them (the draft preview reads them). */
  samples?: Record<string, SourceSample>;
}

export function makeSpineStore(options: SpineStoreOptions = {}) {
  const pipeline = options.pipeline ?? SPINE_PIPELINE;
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
      ...(options.currentUserId !== undefined
        ? {
            auth: {
              currentUser: {
                id: options.currentUserId,
                email: "owner@test.com",
                displayName: null,
                avatarUrl: null,
                createdAt: "",
                tier: "free" as const,
              },
              status: "authenticated" as const,
              submitStatus: "idle" as const,
              mfaChallenge: null,
            },
          }
        : {}),
      sources: {
        items: options.sources ?? [SALES_SOURCE],
        status: "succeeded" as const,
        error: null,
      },
      ...(options.samples !== undefined
        ? {
            sourceSamples: {
              entries: Object.fromEntries(
                Object.entries(options.samples).map(([id, sample]) => [
                  id,
                  { status: "ready" as const, sample, requestedAt: 0 },
                ]),
              ),
              epoch: 0,
            },
          }
        : {}),
      ...(options.outputs !== undefined
        ? {
            outputs: {
              byPipeline: { [pipeline.id]: options.outputs },
              listStatus: { [pipeline.id]: "succeeded" as const },
              listError: {},
              capabilities: {},
              capabilitiesStatus: {},
              previewByKey: {},
              previewStatus: {},
              previewError: {},
              previewRequestToken: {},
              saveStatus: "idle" as const,
              saveError: null,
              allItems: [],
              allStatus: "idle" as const,
              allError: null,
            },
          }
        : {}),
      pipelines: {
        items: [],
        status: "idle" as const,
        error: null,
        createStatus: "idle" as const,
        createError: null,
        runId: null,
        runStatus: options.runStatus ?? null,
        runError: null,
        runIsDry: options.runIsDry ?? null,
        runHistory: options.runHistory ?? {},
        runHistoryStatus: {},
        runHistoryRequestId: {},
        runHistoryOpenId: {},
        runHistoryLoadedOpenId: {},
        currentPipeline: pipeline,
        currentPipelineStatus: "succeeded" as const,
        currentPipelineError: null,
        steps: {},
        stepsStatus: {},
        stepsError: {},
        updateStatus: options.updateStatus ?? "idle",
        updateError: options.updateError ?? null,
        runResult: options.runResult ?? null,
        runStepRowCounts: options.runStepRowCounts ?? {},
        runSourceTruncated: options.runSourceTruncated ?? false,
        runSourceAvailableRowCount: null,
        runTruncationNotice: options.runTruncationNotice ?? null,
        analyzeResult: {},
        analyzeStatus: {},
        analyzeError: {},
        schedule: {},
        scheduleStatus: {},
        scheduleError: {},
        scheduleSaveStatus: "idle" as const,
        scheduleSaveError: null,
      },
    } as never,
  });
}

/** Prints the current location's search into the DOM so a test can read the `?step=` param. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

export function renderSpinePage(
  store = makeSpineStore(),
  entry = "/pipelines/pipe-1",
  strict = false,
) {
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider>
        <Provider store={store}>
          <OverlayProvider>
            <Routes>
              <Route
                path="/pipelines/:id"
                element={
                  <>
                    <PipelineDetailPage />
                    <LocationProbe />
                  </>
                }
              />
              <Route path="/pipelines" element={<div>Pipelines List</div>} />
              <Route path="/sources/:id" element={<div>Source Detail Page</div>} />
            </Routes>
          </OverlayProvider>
        </Provider>
      </ThemeProvider>
    </MemoryRouter>
  );
  return render(strict ? <StrictModeWrapper>{tree}</StrictModeWrapper> : tree);
}

// `StrictMode` lives in a tiny wrapper so the helper above stays declarative.
import { StrictMode, type ReactNode } from "react";
function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

export const renderSpinePageSettled = (store = makeSpineStore(), entry?: string, strict = false) =>
  settled(renderSpinePage(store, entry, strict));

/** A wire-shaped persisted step. */
export function wireStep(
  id: string,
  type: PipelineStep["type"],
  config: PipelineStepConfig,
  extra: Partial<PipelineStep> = {},
): PipelineStep {
  return {
    id,
    pipelineId: "pipe-1",
    position: 0,
    type,
    config,
    enabled: true,
    rootId: "root-1",
    createdAt: "",
    updatedAt: "",
    ...extra,
  } as PipelineStep;
}

/** A trunk of three steps: filter, sort, compute -- the shape the ticket's board shows. */
export function threeSteps(): PipelineStep[] {
  return [
    wireStep("s1", "filter", {
      combinator: "and",
      conditions: [{ field: "duration_s", operator: ">=", value: "180" }],
    }),
    wireStep(
      "s2",
      "sort",
      { sortBy: [{ field: "date", direction: "asc" }] },
      { parentStepId: "s1", position: 0, rootId: undefined },
    ),
    wireStep(
      "s3",
      "compute",
      { column: "duration_min", expression: "duration_s / 60" },
      { parentStepId: "s2", position: 0, rootId: undefined },
    ),
  ];
}

export const SCHEMA: SchemaField[] = [
  { name: "date", type: "string" },
  { name: "status", type: "string" },
  { name: "duration_s", type: "integer" },
];

/** An analyze response carrying input/output schemas for the given step ids. */
export function analyzeFor(
  steps: PipelineStep[],
  overrides: Partial<PipelineAnalyzeResponse> = {},
): PipelineAnalyzeResponse {
  return {
    id: "pipe-1",
    name: "Revenue rollup",
    sourceSchemas: [{ rootId: "root-1", sourceSchema: SCHEMA }],
    steps: steps.map((s, i) => ({
      id: s.id,
      position: i,
      type: s.type,
      config: s.config,
      inputSchema: SCHEMA,
      outputSchema: SCHEMA,
    })) as PipelineAnalyzeResponse["steps"],
    costVerdict: { autoRunnable: true, stepCount: steps.length, reasons: [], canRun: true },
    callerRole: "owner",
    warnings: [],
    ...overrides,
  };
}

export function makeOutput(id: string, name: string, extra: Partial<Output> = {}): Output {
  return {
    id,
    pipelineId: "pipe-1",
    nodeStepId: "s3",
    ownerId: "u-1",
    name,
    kind: "table",
    config: {},
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}
