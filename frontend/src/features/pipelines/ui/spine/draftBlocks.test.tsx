// HEL-1733 (design.md D3): which controls a pipeline draft still blocks, one assertion per consumer row, draft and no-draft. Roots stay
// blocked (HEL-1734); Output, shape and aggregate-tail controls are draft entries, waiting only on the page's own Outputs fetch and on
// a not-yet-created (`step-N`) step, which has no row to bind to.

import { useMemo } from "react";
import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { OP_TYPES } from "../../state/stepNarrowing";
import { buildLaneGraph } from "../../state/stepTree";
import type { PipelineRoot } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { MobilePipelineHeader } from "../mobile/MobilePipelineHeader";
import type { PipelinePageState } from "./PipelineSpineLayout";
import { PipelineSpine } from "./PipelineSpine";
import { useSpineStepActions } from "./useSpineStepActions";

jest.mock("../../services/pipelineService", () => ({
  getPipelineStepCatalog: jest.fn().mockResolvedValue({ groups: [], steps: [] }),
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const REASON = "Save or discard your draft first";
const LOADING = "Outputs are still loading";
const FAILED = "Outputs could not be loaded";
const roots: PipelineRoot[] = [{ id: "r1", dataSourceId: "src-1", dataSourceName: "Orders" }];
const limit = OP_TYPES.find((o) => o.id === "limit")!;
const step = (id: string, label: string, parent?: string): Step => ({
  id,
  opType: limit,
  label,
  config: {} as Step["config"],
  enabled: true,
  parentStepId: parent,
  rootId: parent === undefined ? "r1" : undefined,
  position: 0,
});
const SAVED = [step("s1", "First"), step("s2", "Second", "s1")];
const TEMP_LAST = [...SAVED, step("step-1", "Pending AI", "s2")];
const ONLY_TEMP = [step("step-1", "Pending AI")];

interface Block {
  structural?: string | null;
  output?: string | null;
}

function Harness({
  steps,
  block,
  variant = "desktop",
  openShape,
}: {
  steps: Step[];
  block: Block;
  variant?: "desktop" | "phone";
  openShape?: (anchor: string | undefined) => void;
}) {
  const laneGraph = useMemo(() => buildLaneGraph(steps, roots), [steps]);
  const actions = useSpineStepActions({
    laneGraph,
    roots,
    onAddStep: jest.fn(),
    onInsertStep: jest.fn(),
    onAddLaneStep: jest.fn(),
    onAddOutput: jest.fn(),
    onAddRoot: jest.fn(),
    onInstantiateShape: jest.fn(async () => {}),
    onReorderSteps: jest.fn(),
    structuralBlockedReason: block.structural ?? null,
    outputBlockedReason: block.output ?? null,
    canEdit: true,
  });
  const spy = openShape ? { ...actions, openShapePicker: openShape } : actions;
  return (
    <>
      <PipelineSpine
        variant={variant}
        pipelineId="pipe-1"
        actions={spy}
        steps={steps}
        laneGraph={laneGraph}
        roots={roots}
        sourceByRootId={{}}
        outputs={[]}
        selectedStepId={null}
        stepCount={steps.length}
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
        structuralBlockedReason={block.structural ?? null}
        outputBlockedReason={block.output ?? null}
        canEdit
      />
      {actions.dialogs}
    </>
  );
}

const show = (steps: Step[], block: Block, extra: Partial<Parameters<typeof Harness>[0]> = {}) =>
  renderWithStore(<Harness steps={steps} block={block} {...extra} />);
const button = (name: string) => screen.getByRole("button", { name });

describe("PipelineSpine controls in a draft (D3 consumer table)", () => {
  it("Add source is a draft action (HEL-1734): enabled in a draft and with no draft", () => {
    const { unmount } = show(SAVED, { structural: REASON });
    expect(button("Add source")).toBeEnabled();
    expect(button("Add source")).toHaveAccessibleDescription("");
    unmount();
    show(SAVED, {});
    expect(button("Add source")).toBeEnabled();
  });

  it("+ Output is a draft entry (enabled), and waits with the reason while the Outputs are not loaded or failed", () => {
    const a = show(SAVED, { structural: REASON });
    expect(button("New output")).toBeEnabled();
    a.unmount();
    const b = show(SAVED, { structural: REASON, output: LOADING });
    expect(button("New output")).toBeDisabled();
    expect(button("New output")).toHaveAccessibleDescription(LOADING);
    b.unmount();
    show(SAVED, { structural: REASON, output: FAILED });
    expect(button("New output")).toHaveAccessibleDescription(FAILED);
  });

  it("Add Outputs from a shape is enabled in a draft and with no draft, and waits while the Outputs are not loaded", () => {
    const a = show(SAVED, { structural: REASON });
    expect(button("Add Outputs from a shape")).toBeEnabled();
    a.unmount();
    const b = show(SAVED, {});
    expect(button("Add Outputs from a shape")).toBeEnabled();
    b.unmount();
    show(SAVED, { structural: REASON, output: LOADING });
    expect(button("Add Outputs from a shape")).toBeDisabled();
    expect(button("Add Outputs from a shape")).toHaveAccessibleDescription(LOADING);
  });

  it("in a draft the shape anchors on the last REAL trunk step (a step-N is skipped); with no draft on the last step", () => {
    const anchor = jest.fn();
    const a = show(TEMP_LAST, { structural: REASON }, { openShape: anchor });
    fireEvent.click(button("Add Outputs from a shape"));
    expect(anchor).toHaveBeenLastCalledWith("s2");
    a.unmount();
    show(TEMP_LAST, {}, { openShape: anchor });
    fireEvent.click(button("Add Outputs from a shape"));
    expect(anchor).toHaveBeenLastCalledWith("step-1");
  });

  it("in a draft the shape button is disabled, with the reason, when root 0's trunk holds only temp steps", () => {
    show(ONLY_TEMP, { structural: REASON });
    expect(button("Add Outputs from a shape")).toBeDisabled();
    expect(button("Add Outputs from a shape")).toHaveAccessibleDescription(REASON);
  });

  const menuItem = (stepLabel: string, name: RegExp) => {
    fireEvent.click(screen.getByRole("button", { name: `Step actions for ${stepLabel}` }));
    const menu = screen.getByRole("menu", { name: `Step actions for ${stepLabel}` });
    return within(menu).getByRole("menuitem", { name });
  };

  it("step Add output: enabled on a saved step in a draft, disabled on a step-N, enabled on a step-N with no draft", () => {
    const a = show(TEMP_LAST, { structural: REASON });
    expect(menuItem("First", /^Add output/)).toBeEnabled();
    a.unmount();
    const b = show(TEMP_LAST, { structural: REASON });
    expect(menuItem("Pending AI", /^Add output/)).toBeDisabled();
    b.unmount();
    show(TEMP_LAST, {});
    expect(menuItem("Pending AI", /^Add output/)).toBeEnabled();
  });

  it("step Add output waits with the reason while the Outputs are not loaded, on a saved step too", () => {
    show(SAVED, { structural: REASON, output: LOADING });
    const item = menuItem("First", /^Add output/);
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", LOADING);
  });

  it("phone: Add source stays in the header menu blocked in a draft; the phone list has no shape button of its own", () => {
    show(SAVED, { structural: REASON }, { variant: "phone" });
    expect(screen.queryByRole("button", { name: "Add Outputs from a shape" })).toBeNull();
    expect(button("New output")).toBeEnabled();
  });
});

describe("MobilePipelineHeader menu in a draft (D3)", () => {
  function header(over: Partial<Record<string, unknown>>) {
    const laneGraph = buildLaneGraph(over.steps as Step[], roots);
    const page = {
      currentPipeline: { id: "pipe-1" },
      pipelineSchedule: null,
      roots,
      outputName: "",
      pipelineName: "Pipe",
      sourceByRootId: {},
      steps: over.steps,
      laneGraph,
      draftBlockReason: null,
      draftOutputBlockReason: null,
      isDirty: false,
      isOwner: true,
      canEdit: true,
      sseData: {},
      setEditingOutputName: jest.fn(),
      ...over,
    } as unknown as PipelinePageState;
    const actions = {
      openAddRoot: jest.fn(),
      openShapePicker: jest.fn(),
    } as unknown as Parameters<typeof MobilePipelineHeader>[0]["actions"];
    renderWithStore(<MobilePipelineHeader page={page} actions={actions} />);
    fireEvent.click(screen.getByRole("button", { name: "Pipeline actions" }));
    return actions;
  }
  const item = (name: string) => screen.getByRole("menuitem", { name });

  it("Add source is a draft action (HEL-1734); the shape item is enabled and anchors on the last real trunk step", () => {
    const actions = header({ steps: TEMP_LAST, draftBlockReason: REASON });
    expect(item("Add source")).toBeEnabled();
    expect(item("Add Outputs from a shape")).toBeEnabled();
    fireEvent.click(item("Add Outputs from a shape"));
    expect(actions.openShapePicker).toHaveBeenCalledWith("s2");
  });

  it("the shape item waits while the Outputs are not loaded", () => {
    header({ steps: SAVED, draftBlockReason: REASON, draftOutputBlockReason: LOADING });
    expect(item("Add Outputs from a shape")).toBeDisabled();
  });

  it("with no draft nothing is blocked", () => {
    header({ steps: SAVED });
    expect(item("Add source")).toBeEnabled();
    expect(item("Add Outputs from a shape")).toBeEnabled();
  });
});
