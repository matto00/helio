// HEL-1584 D8: the detail modal grows out of the card it was opened from, so the grid captures that card's rectangle on
// both open paths (a click on the card, and the card menu's Customize) and hands it to the modal.
import { act, fireEvent, screen } from "@testing-library/react";

import { makeOutputPanel } from "../../../../test/panelFixtures";
import { renderWithStore } from "../../../../test/renderWithStore";
import type { Panel } from "../../types/panel";
import { PanelGrid } from "./PanelGrid";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: ({ children }: { children?: import("react").ReactNode }) =>
      React.createElement("div", null, children),
  };
});
jest.mock("react-grid-layout/core", () => ({
  ...jest.requireActual("react-grid-layout/core"),
  noCompactor: {},
  createScaledStrategy: jest.fn((scale: number) => ({ __scale: scale })),
}));
const modalProps: Array<{ panelId: string; expandFrom: DOMRectReadOnly | null | undefined }> = [];
jest.mock("../detailModal/PanelDetailModal", () => ({
  PanelDetailModal: ({
    panel,
    expandFrom,
  }: {
    panel: Panel;
    expandFrom?: DOMRectReadOnly | null;
  }) => {
    modalProps.push({ panelId: panel.id, expandFrom });
    return require("react").createElement("div", { "data-testid": "detail-modal" });
  },
}));
jest.mock("../PanelCard", () => ({
  getPanelCardStyle: () => ({}),
  PanelCard: ({
    panel,
    onCardClick,
    onDetail,
  }: {
    panel: { id: string };
    onCardClick: (id: string, e: unknown) => void;
    onDetail: (id: string) => void;
  }) => {
    const React = require("react");
    return React.createElement(
      "article",
      {
        "data-testid": `card-${panel.id}`,
        "data-panel-id": panel.id,
        onClick: (e: unknown) => onCardClick(panel.id, e),
      },
      React.createElement("button", {
        "data-testid": `customize-${panel.id}`,
        onClick: (e: { stopPropagation(): void }) => {
          e.stopPropagation();
          onDetail(panel.id);
        },
      }),
    );
  },
}));
jest.mock("../../services/panelService", () => ({
  fetchPanels: jest.fn(),
  createPanel: jest.fn(),
  updatePanelsBatch: jest.fn().mockResolvedValue({ panels: [] }),
}));
jest.mock("../../../dashboards/services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  updateDashboardLayout: jest.fn(),
}));

const panel = makeOutputPanel({ id: "p1", dashboardId: "d1", title: "P1" });
const layout = { lg: [{ panelId: "p1", x: 0, y: 0, w: 4, h: 4 }], md: [], sm: [], xs: [] };
const rect = (left: number) =>
  ({ left, top: 5, width: 100, height: 50, right: left + 100, bottom: 55 }) as DOMRectReadOnly;

function setup() {
  modalProps.length = 0;
  renderWithStore(<PanelGrid dashboardId="d1" layout={layout} panels={[panel]} width={1600} />, {
    dashboards: { items: [{ id: "d1", name: "D", layout }] },
    panels: { items: [panel], status: "succeeded" },
  });
  return screen.getByTestId("card-p1");
}
const lastOrigin = () => modalProps[modalProps.length - 1]?.expandFrom;

describe("DesktopPanelGrid detail-modal origin (HEL-1584 D8)", () => {
  it("a click on the card passes that card's rectangle to the modal", () => {
    const card = setup();
    card.getBoundingClientRect = () => rect(11);
    fireEvent.click(card);
    expect(screen.getByTestId("detail-modal")).toBeInTheDocument();
    expect(lastOrigin()).toEqual(rect(11));
  });

  it("Customize (no click event on the card) finds the card by data-panel-id", () => {
    const card = setup();
    card.getBoundingClientRect = () => rect(22);
    act(() => {
      fireEvent.click(screen.getByTestId("customize-p1"));
    });
    expect(screen.getByTestId("detail-modal")).toBeInTheDocument();
    expect(lastOrigin()).toEqual(rect(22));
  });
});
