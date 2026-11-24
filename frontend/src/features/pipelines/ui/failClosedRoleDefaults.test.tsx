// HEL-1839: every pipeline-page component that takes the caller's role as an optional prop must treat an OMITTED
// prop as "may not edit / run / own" (a future caller that forgets it shows no edit control). Each test renders one
// component WITHOUT its role prop and asserts that component's own read-only signal. Each is red when only that
// component's default is flipped back (the mutation transcripts are committed beside this change).
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { renderWithStore } from "../../../test/renderWithStore";
import * as historyService from "../../panels/history/outputHistoryService";
import { OP_TYPES } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import type { Output } from "../types/output";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { OutputEditorFooter } from "./outputEditor/OutputEditorFooter";
import { OutputEditorSheet } from "./outputEditor/OutputEditorSheet";
import { OutputSheetPreviewCard } from "./outputEditor/OutputSheetPreviewCard";
import { useOutputKindState } from "./outputEditor/useOutputKindState";
import { OutputHistoryModal } from "./outputHistory/OutputHistoryModal";
import { RunHistoryList, RunHistoryModal } from "./RunHistoryModal";
import { PipelineSpine } from "./spine/PipelineSpine";
import { PipelineSpineHeader, type SpineHeaderProps } from "./spine/PipelineSpineHeader";
import { SpineOutputs } from "./spine/SpineOutputs";
import { SpineSourceCard } from "./spine/SpineSourceCard";
import { SpineStatusStrip } from "./spine/SpineStatusStrip";
import { useSpineStepActions } from "./spine/useSpineStepActions";
import { StepCardFocused } from "./StepCardFocused";

jest.mock("../services/pipelineService", () => ({
  getPipelineStepCatalog: jest.fn().mockResolvedValue({ groups: [], steps: [] }),
  fetchStepPreview: jest.fn(),
  updatePipelineStep: jest.fn(),
}));
// The Output sheet reads its panel placements; nothing here may reach the network.
jest.mock("../../../services/httpClient", () => ({
  httpClient: {
    get: jest.fn((url: string) =>
      Promise.resolve({
        data: url.endsWith("/panels")
          ? []
          : { columns: [], capabilities: {}, rows: [], rowCount: 0, stepRowCounts: {} },
      }),
    ),
    post: jest.fn(() => Promise.resolve({ data: { outputs: [] } })),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock("../../panels/history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchHistoryPointRows: jest.fn(),
}));
jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  fetchSources: jest.fn(() => Promise.reject(new Error("unmocked"))),
  fetchSourceSample: jest.fn().mockResolvedValue(null),
  fetchSourceReferences: jest.fn().mockResolvedValue([]),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const op = (id: string) => OP_TYPES.find((o) => o.id === id)!;
const ROOTS: PipelineRoot[] = [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" }];
const TWO_ROOTS: PipelineRoot[] = [
  ...ROOTS,
  { id: "root-2", dataSourceId: "src-2", dataSourceName: "Shipments" },
];
const stepOf = (id: string, opId: string, config: Record<string, unknown>): Step => ({
  id,
  opType: op(opId),
  label: "A step",
  config: config as unknown as Step["config"],
  enabled: true,
  rootId: "root-1",
  position: 0,
});
const outputOf = (over: Partial<Output> = {}): Output =>
  ({
    id: "o1",
    pipelineId: "p",
    nodeStepId: "s1",
    ownerId: "u",
    name: "Revenue",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Output;

describe("fail-closed role defaults (HEL-1839): a component not told the role offers no edit or run control", () => {
  it("RunHistoryList (canRun) shows the viewer empty copy", () => {
    render(<RunHistoryList runs={[]} view="fresh" onRetry={jest.fn()} />);
    expect(screen.getByText("No runs yet.")).toBeVisible();
    expect(screen.queryByText(/Run or dry-run/)).toBeNull();
  });

  it("RunHistoryModal (canRun forwarded) shows the viewer empty copy", () => {
    render(<RunHistoryModal runs={[]} view="fresh" onRetry={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText("No runs yet.")).toBeVisible();
    expect(screen.queryByText(/Run or dry-run/)).toBeNull();
  });

  it("OutputHistoryModal (readOnly) shows the viewer empty copy", async () => {
    jest.mocked(historyService.fetchOutputHistory).mockResolvedValue({
      current: null,
      baseline: null,
      delta: null,
      pct: null,
      availableFrom: null,
      sparkline: [],
      points: [],
    } as never);
    renderWithStore(<OutputHistoryModal output={outputOf()} onClose={jest.fn()} />);
    expect(await screen.findByText("No history recorded yet.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Run the pipeline/);
  });

  it("OutputSheetPreviewCard (readOnly) shows the viewer never-run copy", () => {
    const { result } = renderHook(() => useOutputKindState({}, [], "table"));
    render(
      <OutputSheetPreviewCard
        kind="table"
        kindState={result.current}
        rows={undefined}
        neverMaterialized
      />,
    );
    expect(screen.getByText(/This Output has no rows yet/)).toBeVisible();
    expect(screen.queryByText(/Run the pipeline to populate it/)).toBeNull();
  });

  it("SpineStatusStrip (canRun) offers no Run to update", () => {
    render(
      <SpineStatusStrip
        costVerdict={{
          autoRunnable: false,
          stepCount: 1,
          reasons: [{ code: "ai-step", detail: "uses AI", stepId: "s1" }],
          canRun: true,
        }}
        onRunToUpdate={jest.fn()}
        truncationNotice={null}
      />,
    );
    expect(screen.getByRole("status")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run to update" })).toBeNull();
  });

  it("useSpineStepActions (canEdit) offers no row menu item", () => {
    const steps = [stepOf("s1", "limit", { count: 1 })];
    const laneGraph = buildLaneGraph(steps, ROOTS);
    const { result } = renderHook(() =>
      useSpineStepActions({
        laneGraph,
        roots: ROOTS,
        onAddStep: jest.fn(),
        onInsertStep: jest.fn(),
        onAddLaneStep: jest.fn(),
        onAddOutput: jest.fn(),
        onAddRoot: jest.fn(),
        onInstantiateShape: jest.fn(async () => {}),
        onReorderSteps: jest.fn(),
      }),
    );
    const lane = laneGraph.lanes[0]!;
    expect(result.current.menuItemsFor(steps[0]!, lane, 0)).toEqual([]);
  });

  it("PipelineSpineHeader (canEdit) shows the name as text, with no rename or schedule entry", () => {
    const props = {
      pipelineName: "My pipe",
      outputName: "My pipe",
      setOutputName: jest.fn(),
      editingName: false,
      setEditingName: jest.fn(),
      isDirty: false,
      updateError: null,
      updateStatus: "idle",
      isConfirmingCancel: false,
      onSave: jest.fn(),
      onCancel: jest.fn(),
      onConfirmDiscard: jest.fn(),
      onDismissConfirm: jest.fn(),
      run: {
        sseStatus: null,
        sseRowCount: null,
        sseErrorLog: null,
        runStatus: null,
        runError: null,
        runIsDry: null,
        runRowCount: null,
      },
      lastRunAt: null,
      lastRunRowCount: null,
      lastRunStatus: null,
      lastRunTruncated: null,
      schedule: null,
      onEditSchedule: jest.fn(),
      onToggleScheduleEnabled: jest.fn(),
      onOpenHistory: jest.fn(),
      isOwner: true,
      onOpenShare: jest.fn(),
      onEditOnlySource: jest.fn(),
      onDryRun: jest.fn(),
      onRun: jest.fn(),
      runRole: "owner",
      draft: { hasDraft: false, saving: false, onDiscard: jest.fn(), onSaveAndRun: jest.fn() },
    } as unknown as SpineHeaderProps;
    render(
      <MemoryRouter>
        <PipelineSpineHeader {...props} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Edit pipeline name" })).toBeNull();
    expect(screen.getByText("My pipe")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /actions/i }));
    expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /schedule/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Edit source" })).toBeNull();
  });

  it("PipelineSpine (canEdit) offers no Add source and tells the viewer copy", () => {
    function Spine() {
      const steps = [stepOf("s1", "limit", { count: 1 })];
      const laneGraph = buildLaneGraph(steps, TWO_ROOTS);
      const actions = useSpineStepActions({
        laneGraph,
        roots: TWO_ROOTS,
        onAddStep: jest.fn(),
        onInsertStep: jest.fn(),
        onAddLaneStep: jest.fn(),
        onAddOutput: jest.fn(),
        onAddRoot: jest.fn(),
        onInstantiateShape: jest.fn(async () => {}),
        onReorderSteps: jest.fn(),
      });
      return (
        <PipelineSpine
          variant="desktop"
          pipelineId="pipe-1"
          actions={actions}
          steps={steps}
          laneGraph={laneGraph}
          roots={TWO_ROOTS}
          sourceByRootId={{}}
          outputs={[]}
          selectedStepId={null}
          stepCount={1}
          rowCountFor={() => null}
          countsPartial={false}
          getAnalyzeValidationError={() => undefined}
          getAnalyzeWarnings={() => []}
          stepSaveErrors={{}}
          creatingStepIds={new Set<string>()}
          onSelectStep={jest.fn()}
          onEditSource={jest.fn()}
          onRemoveRoot={jest.fn()}
          onAddOutput={jest.fn()}
          onOpenOutput={jest.fn()}
          onOpenOutputHistory={jest.fn()}
        />
      );
    }
    renderWithStore(<Spine />);
    expect(screen.queryByRole("button", { name: "Add source" })).toBeNull();
    expect(screen.getByText("No steps use this source yet.")).toBeVisible();
  });

  it("SpineSourceCard (readOnly) has no source actions menu or Edit source name button", () => {
    renderWithStore(
      <SpineSourceCard
        variant="phone"
        root={ROOTS[0]!}
        pipelineId="pipe-1"
        source={{ id: "src-1", name: "Orders", type: "csv", ownerId: "u" } as never}
        ordinal={null}
        canRemove
        onEditSource={jest.fn()}
        onRemoveRoot={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Source actions for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit source/ })).toBeNull();
  });

  it("SpineOutputs (readOnly) offers no New output", () => {
    const steps = [stepOf("s1", "limit", { count: 1 })];
    render(
      <SpineOutputs
        outputs={[outputOf()]}
        steps={steps}
        laneGraph={buildLaneGraph(steps, ROOTS)}
        onOpenOutput={jest.fn()}
        onOpenHistory={jest.fn()}
        onAddOutput={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Open Revenue output" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "New output" })).toBeNull();
  });

  it("OutputEditorFooter (readOnly) offers Close only", () => {
    render(
      <OutputEditorFooter
        isCreate={false}
        confirmingDelete={false}
        onDeleteClick={jest.fn()}
        placements={null}
        saving={false}
        onClose={jest.fn()}
        canAddTailWithAggregate
        onAddTailWithAggregate={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeVisible();
    for (const name of ["Save", "Delete", "Cancel", "Add as tail with aggregate"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("OutputEditorSheet (readOnly) shows no Save or Delete and a disabled name field", () => {
    renderWithStore(
      <OutputEditorSheet open onClose={jest.fn()} pipelineId="p" output={outputOf()} steps={[]} />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByLabelText("Name")).toBeDisabled();
  });

  it("StepCardFocused (readOnly) has no step actions and a disabled configuration", () => {
    renderWithStore(
      <StepCardFocused
        step={{ ...stepOf("persisted-1", "limit", { count: 5 }), label: "Limit rows" }}
        stepNumber={1}
        onRemove={jest.fn()}
        analyzeColumns={[]}
        analyzeSchema={[]}
        onConfigChange={jest.fn()}
        onToggleEnabled={jest.fn()}
        onDuplicate={jest.fn()}
        isDuplicating={false}
      />,
    );
    for (const name of ["Remove step", "Duplicate step", "Disable step"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });

  it("StepCardFocused (isOwner) disables the owner-only existing-dataset target; readOnly={false} so only isOwner decides", () => {
    renderWithStore(
      <StepCardFocused
        step={{
          ...stepOf("persisted-2", "upsertsource", { mode: "append" }),
          label: "Write to dataset",
        }}
        stepNumber={1}
        readOnly={false}
        onRemove={jest.fn()}
        analyzeColumns={[]}
        analyzeSchema={[]}
        onConfigChange={jest.fn()}
        onToggleEnabled={jest.fn()}
        onDuplicate={jest.fn()}
        isDuplicating={false}
      />,
    );
    expect(screen.getByLabelText("Use existing dataset")).toBeDisabled();
    expect(screen.getByLabelText("Create new source")).toBeEnabled();
  });
});
