// HEL-440 raw-element guard: asserts the migrated rename controls
// (PanelCard title, the pipeline page header's pipeline name) render the shared
// TextField primitive (`ui-input` class), not a bare <input>. Prior art:
// PipelineShareDialog.test.tsx's F-143 assertion shape.
//
// Per design.md's guard-scope decision, this asserts only the element with
// each control's accessible name — not "no raw <input> anywhere".
//
// TypeDetailPanel's rename-control coverage was retired outright by HEL-909:
// the DataType/type-registry surface it belonged to no longer exists (Axis A
// deletion) — not a case needing a rewrite onto a different fixture.

import { screen } from "@testing-library/react";

import { renderWithStore } from "./renderWithStore";
import { makeOutputPanel } from "./panelFixtures";
import { PanelCard } from "../features/panels/ui/PanelCard";
import { PipelineSpineHeader } from "../features/pipelines/ui/spine/PipelineSpineHeader";

// HEL-1600 -- stands in for GET /api/outputs/:id, GET /api/outputs/:id/assertion-status, which this test reaches but does not exercise
// (the network guard fails an unmocked request); rejects (a plain Error) in place of the AxiosError network failure.
jest.mock("../features/pipelines/services/outputService", () => ({
  ...jest.requireActual("../features/pipelines/services/outputService"),
  getOutputById: jest.fn(() =>
    Promise.reject(new Error("getOutputById: unmocked request stubbed (HEL-1600)")),
  ),
  getAssertionStatus: jest.fn(() =>
    Promise.reject(new Error("getAssertionStatus: unmocked request stubbed (HEL-1600)")),
  ),
}));

jest.mock("../features/panels/hooks/usePanelData", () => ({
  usePanelData: jest.fn(() => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: true,
    refresh: jest.fn(),
  })),
}));

jest.mock("../features/panels/hooks/usePanelPolling", () => ({
  usePanelPolling: jest.fn(),
}));

const panelCardNoopProps = {
  theme: "dark" as const,
  isDragging: false,
  dashboardId: "d1",
  isEditingTitle: true,
  editingTitle: "My Panel",
  editingTitleError: null,
  isConfirmingDelete: false,
  onMouseDown: jest.fn(),
  onCardClick: jest.fn(),
  onStartEdit: jest.fn(),
  onTitleChange: jest.fn(),
  onTitleKeyDown: jest.fn(),
  onTitleBlur: jest.fn(),
  onRequestDelete: jest.fn(),
  onCancelDelete: jest.fn(),
  onDetail: jest.fn(),
};

const pipelineHeaderNoopProps = {
  pipelineName: "My Pipeline",
  outputName: "My Pipeline",
  setOutputName: jest.fn(),
  editingName: true,
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
  isOwner: true,
  onOpenShare: jest.fn(),
  onEditOnlySource: null,
  onDryRun: jest.fn(),
  draft: { hasDraft: false, saving: false, onDiscard: jest.fn(), onSaveAndRun: jest.fn() },
  onRun: jest.fn(),
};

describe("HEL-440 raw-element guard — migrated rename controls", () => {
  it("PanelCard: the 'Panel title' rename control carries TextField's ui-input class", () => {
    const panel = makeOutputPanel();
    renderWithStore(<PanelCard panel={panel} {...panelCardNoopProps} />, {
      panels: { items: [] },
    });

    const input = screen.getByRole("textbox", { name: "Panel title" });
    expect(input).toHaveClass("ui-input");
  });

  it("PipelineSpineHeader: the 'Pipeline name' rename control carries TextField's ui-input class", () => {
    renderWithStore(<PipelineSpineHeader {...pipelineHeaderNoopProps} />);

    const input = screen.getByRole("textbox", { name: "Pipeline name" });
    expect(input).toHaveClass("ui-input");
  });
});
