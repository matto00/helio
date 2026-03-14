import { screen } from "@testing-library/react";

import { renderWithStore } from "../test/renderWithStore";
import { PanelList } from "./PanelList";

describe("PanelList", () => {
  it("renders the panels heading and empty-state message when no panels exist", () => {
    renderWithStore(<PanelList />, {
      dashboards: {
        items: [],
      },
      panels: {
        items: [],
      },
    });

    expect(screen.getByRole("heading", { name: "Panels" })).toBeInTheDocument();
    expect(screen.getByText("No panels yet.")).toBeInTheDocument();
  });
});
