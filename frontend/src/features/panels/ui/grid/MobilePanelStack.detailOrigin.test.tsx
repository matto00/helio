// HEL-1584 D8 (phone): tapping a card opens the detail modal growing out of that card's rectangle.
import { fireEvent, render, screen } from "@testing-library/react";

import { makeOutputPanel } from "../../../../test/panelFixtures";
import { ThemeProvider } from "../../../../theme/ThemeProvider";
import { MobilePanelStack } from "./MobilePanelStack";

const origins: Array<DOMRectReadOnly | null | undefined> = [];
jest.mock("../detailModal/PanelDetailModal", () => ({
  PanelDetailModal: ({ expandFrom }: { expandFrom?: DOMRectReadOnly | null }) => {
    origins.push(expandFrom);
    return require("react").createElement("div", { "data-testid": "detail-modal" });
  },
}));
jest.mock("../PanelCardBody", () => ({ PanelCardBody: () => null }));
jest.mock("../../hooks/usePanelData", () => ({
  usePanelData: () => ({ data: null, rawRows: null, headers: null, isLoading: false, error: null }),
}));
jest.mock("../../hooks/useOutputRetention", () => ({ useOutputRetention: jest.fn() }));
jest.mock("../../provenance/ProvenanceTrigger", () => ({ ProvenanceTrigger: () => null }));

const panel = makeOutputPanel({ id: "p1", dashboardId: "d1", title: "Tapped" });
const layout = { lg: [], md: [], sm: [], xs: [{ panelId: "p1", x: 0, y: 0, w: 2, h: 4 }] };

it("passes the tapped card's rectangle to the detail modal", () => {
  origins.length = 0;
  render(
    <ThemeProvider>
      <MobilePanelStack panels={[panel]} layout={layout} containerWidth={375} />
    </ThemeProvider>,
  );
  const card = screen.getByRole("heading", { name: "Tapped" }).closest("article") as HTMLElement;
  const rect = { left: 4, top: 8, width: 300, height: 120, right: 304, bottom: 128 };
  card.getBoundingClientRect = () => rect as DOMRect;
  fireEvent.click(card);
  expect(screen.getByTestId("detail-modal")).toBeInTheDocument();
  expect(origins[origins.length - 1]).toEqual(rect);
});
