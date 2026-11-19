// HEL-1773 D5: the panel detail modal for a dashboard grantee. A viewer has no edit mode (no Edit button, the "E" key does
// nothing, `initialMode="edit"` is ignored); an editor edits title and appearance but sees the Output binding as a read-only
// line, with none of the Output-route sections (binding, controls editor).
import { fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";

import { DashboardAccessProvider } from "../../../dashboards/state/dashboardAccessContext";
import type { DashboardAccessRole } from "../../../dashboards/types/dashboard";
import {
  getOutputById,
  getOutputRows,
  listOutputPanels,
} from "../../../pipelines/services/outputService";
import { makeOutputPanel, makeTextPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("../../../pipelines/services/outputService");
jest.mock("../../services/panelService", () => ({ fetchPanels: jest.fn() }));

const textPanel = makeTextPanel({
  id: "p1",
  dashboardId: "d1",
  title: "Note",
  config: { content: "hi" },
});
const outputPanel = makeOutputPanel({
  id: "p2",
  dashboardId: "d1",
  title: "Table",
  config: { outputId: "o1" },
});

function renderModal(role: DashboardAccessRole, ui: ReactElement) {
  HTMLDialogElement.prototype.showModal = jest.fn(function () {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function () {
    this.removeAttribute("open");
  });
  return renderWithStore(<DashboardAccessProvider role={role}>{ui}</DashboardAccessProvider>);
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getOutputById).mockResolvedValue({
    id: "o1",
    pipelineId: "pl",
    ownerId: "u",
    name: "o",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
  });
  jest
    .mocked(getOutputRows)
    .mockResolvedValue({ items: [], total: 0, offset: 0, limit: 50, materialized: true });
});

describe("PanelDetailModal by role", () => {
  it("a viewer has no Edit button and the E key does not enter edit mode", () => {
    renderModal("viewer", <PanelDetailModal panel={textPanel} onClose={jest.fn()} />);
    expect(screen.queryByRole("button", { name: "Edit panel" })).toBeNull();
    fireEvent.keyDown(document, { key: "e" });
    fireEvent.keyDown(document, { key: "E" });
    expect(screen.queryByLabelText("Panel title")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save panel settings" })).toBeNull();
  });

  it("a viewer opened with initialMode edit still starts in view mode", () => {
    renderModal(
      "viewer",
      <PanelDetailModal panel={textPanel} onClose={jest.fn()} initialMode="edit" />,
    );
    expect(screen.queryByLabelText("Panel title")).toBeNull();
  });

  it("an editor still enters edit mode with the E key", () => {
    renderModal("editor", <PanelDetailModal panel={textPanel} onClose={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Edit panel" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "e" });
    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();
  });

  it("an editor's edit mode on an Output panel shows a read-only binding and reads no Output route", () => {
    renderModal(
      "editor",
      <PanelDetailModal panel={outputPanel} onClose={jest.fn()} initialMode="edit" />,
    );
    expect(screen.getByText("Bound to an Output")).toBeInTheDocument();
    expect(screen.getByLabelText("Panel title")).toBeInTheDocument();
    expect(screen.queryByText(/Used on/)).toBeNull();
    expect(listOutputPanels).not.toHaveBeenCalled();
  });
});
