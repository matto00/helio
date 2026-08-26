// HEL-440 raw-element guard: asserts the three migrated rename controls
// (PanelCard title, PipelineDetailFooter output name, TypeDetailPanel name)
// render the shared TextField primitive (`ui-input` class), not a bare
// <input>. Prior art: PipelineShareDialog.test.tsx's F-143 assertion shape.
//
// Per design.md's guard-scope decision, this asserts only the element with
// each control's accessible name — not "no raw <input> anywhere" — since
// TypeDetailPanel legitimately renders raw checkbox/text inputs elsewhere
// that no primitive covers.

import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "./renderWithStore";
import { makeMetricPanel } from "./panelFixtures";
import { PanelCard } from "../features/panels/ui/PanelCard";
import { PipelineDetailFooter } from "../features/pipelines/ui/PipelineDetailFooter";
import { TypeDetailPanel } from "../features/dataTypes/ui/TypeDetailPanel";
import { fetchAssertionStatus as fetchAssertionStatusRequest } from "../features/dataTypes/services/dataTypeService";
import { fetchDataTypeRows } from "../features/dataTypes/services/dataTypeService";
import type { DataType } from "../features/dataTypes/types/dataType";

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

jest.mock("../features/dataTypes/services/dataTypeService", () => ({
  fetchAssertionStatus: jest.fn(),
  fetchDataTypeRows: jest.fn(),
}));

const fetchAssertionStatusMock = jest.mocked(fetchAssertionStatusRequest);
const fetchDataTypeRowsMock = jest.mocked(fetchDataTypeRows);

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

const testDataType: DataType = {
  id: "dt-1",
  name: "Documents",
  sourceId: null,
  version: 1,
  fields: [{ name: "body", displayName: "Body", dataType: "string", nullable: false }],
  computedFields: [],
  createdAt: "2026-03-22T00:00:00Z",
  updatedAt: "2026-03-22T00:00:00Z",
};

describe("HEL-440 raw-element guard — migrated rename controls", () => {
  beforeEach(() => {
    fetchAssertionStatusMock.mockReset().mockResolvedValue({
      dataTypeId: "dt-1",
      invalid: false,
      failedRuleCount: 0,
    });
    fetchDataTypeRowsMock.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("PanelCard: the 'Panel title' rename control carries TextField's ui-input class", () => {
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });
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

  it("TypeDetailPanel: the 'Data type name' rename control carries TextField's ui-input class", async () => {
    renderWithStore(<TypeDetailPanel dataType={testDataType} />);

    await waitFor(() => expect(fetchDataTypeRowsMock).toHaveBeenCalledWith("dt-1"));

    const input = screen.getByRole("textbox", { name: "Data type name" });
    expect(input).toHaveClass("ui-input");
  });
});
