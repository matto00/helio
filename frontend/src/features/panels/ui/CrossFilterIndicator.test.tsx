import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { CrossFilterIndicator } from "./CrossFilterIndicator";

// HEL-588 tasks.md 6.7 — renders, clears, and announces via the live region.
describe("CrossFilterIndicator", () => {
  it("renders nothing while no cross-filter is active", () => {
    const { container } = renderWithStore(<CrossFilterIndicator />, {
      panels: { items: [], crossFilter: null },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the active filter's dimension and value inside a role=status live region", () => {
    renderWithStore(<CrossFilterIndicator />, {
      panels: {
        items: [],
        crossFilter: { panelId: "panel-1", dimension: "quarter", value: "Q1", series: "" },
      },
    });

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("Filtered by quarter = Q1");
  });

  it("the clear-all control dispatches clearCrossFilter", () => {
    const { store } = renderWithStore(<CrossFilterIndicator />, {
      panels: {
        items: [],
        crossFilter: { panelId: "panel-1", dimension: "quarter", value: "Q1", series: "" },
      },
    });

    screen.getByRole("button", { name: "Clear cross-filter" }).click();

    expect(store.getState().panels.crossFilter).toBeNull();
  });
});
