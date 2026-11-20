// HEL-1661 (design.md D4/D5): a viewer with a client-only draft keeps the Discard control, never Save & run or Dry run.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { PipelineSpineHeader, type SpineHeaderProps } from "./PipelineSpineHeader";

function props(over: Partial<SpineHeaderProps>): SpineHeaderProps {
  return {
    pipelineName: "p",
    outputName: "p",
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
      runResult: null,
    },
    lastRunAt: null,
    lastRunRowCount: null,
    lastRunStatus: null,
    lastRunTruncated: null,
    schedule: null,
    onEditSchedule: jest.fn(),
    onToggleScheduleEnabled: jest.fn(),
    onOpenHistory: jest.fn(),
    isOwner: false,
    onOpenShare: jest.fn(),
    onEditOnlySource: null,
    onDryRun: jest.fn(),
    onRun: jest.fn(),
    runRole: "viewer",
    draft: { hasDraft: true, saving: false, onDiscard: jest.fn(), onSaveAndRun: jest.fn() },
    ...over,
  } as SpineHeaderProps;
}

const renderHeader = (p: SpineHeaderProps) =>
  render(
    <MemoryRouter>
      <PipelineSpineHeader {...p} />
    </MemoryRouter>,
  );

describe("PipelineSpineHeader for a viewer with a draft", () => {
  it("keeps Discard, drops Save & run, and says View only", () => {
    const p = props({});
    renderHeader(p);
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(p.draft.onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Save and run" })).toBeNull();
    expect(screen.getByText("View only")).toBeVisible();
  });

  it("an editor with a draft still has Save & run and no indicator", () => {
    renderHeader(props({ runRole: "editor" }));
    expect(screen.getByRole("button", { name: "Save and run" })).toBeVisible();
    expect(screen.queryByText("View only")).toBeNull();
  });

  it("the pending slot is sized for the pair the draft state shows (Discard + Save & run, or Dry run + Run)", () => {
    const { container } = renderHeader(props({ runRole: "pending" }));
    const slot = container.querySelector('[data-run-slot="pending"]');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute("data-run-pair", "draft");
    expect(screen.queryByRole("button", { name: "Save and run" })).toBeNull();
    document.body.innerHTML = "";
    const again = renderHeader(
      props({ runRole: "pending", draft: { ...props({}).draft, hasDraft: false } }),
    );
    expect(again.container.querySelector('[data-run-slot="pending"]')).toHaveAttribute(
      "data-run-pair",
      "run",
    );
  });
});
