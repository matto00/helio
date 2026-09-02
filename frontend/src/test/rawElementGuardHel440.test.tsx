// HEL-440 raw-element guard: asserts the migrated rename controls
// (PanelCard title, PipelineDetailFooter output name) render the shared
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
import { PipelineDetailFooter } from "../features/pipelines/ui/PipelineDetailFooter";

jest.mock("../features/panels/hooks/usePanelData", () => ({
  usePanelData: jest.fn(() => ({
    data: null,
    rawRows: null,
    headers: null,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: true,
    chartAggregate: null,
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

const pipelineFooterNoopProps = {
  editingOutputName: true,
  outputName: "My Pipeline",
  pipelineName: "My Pipeline",
  setOutputName: jest.fn(),
  setEditingOutputName: jest.fn(),
  stepCount: 0,
  outputSchema: [],
  sseData: { status: null, rowCount: null, errorLog: null },
  runStatus: null,
  runError: null,
  runIsDry: null,
  runResult: null,
  isDirty: false,
  updateError: null,
  updateStatus: "idle",
  isConfirmingCancel: false,
  handleSave: jest.fn(),
  confirmCancelDiscard: jest.fn(),
  dismissCancelConfirm: jest.fn(),
  handleCancel: jest.fn(),
  openHistory: jest.fn(),
  openPreview: jest.fn(),
  handleDryRun: jest.fn(),
  handleRunPipeline: jest.fn(),
  isOwner: true,
  onOpenShare: jest.fn(),
  lastRunAt: null,
  lastRunRowCount: null,
  lastRunStatus: null,
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

  it("PipelineDetailFooter: the 'Pipeline name' rename control carries TextField's ui-input class", () => {
    renderWithStore(<PipelineDetailFooter {...pipelineFooterNoopProps} />);

    const input = screen.getByRole("textbox", { name: "Pipeline name" });
    expect(input).toHaveClass("ui-input");
  });
});
