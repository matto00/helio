import { render } from "@testing-library/react";

import { Responsive } from "react-grid-layout";
import { getBreakpointFromWidth } from "react-grid-layout/core";
import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { DesktopPanelGridSkeleton } from "./DesktopPanelGridSkeleton";
import { FALLBACK_STUB_COUNT } from "./panelGridSkeletonStubs";

jest.mock("react-grid-layout", () => {
  const React = require("react");
  return {
    Responsive: jest.fn(
      ({
        children,
        layouts,
        dragConfig,
        resizeConfig,
      }: {
        children?: import("react").ReactNode;
        layouts: unknown;
        dragConfig?: { enabled?: boolean };
        resizeConfig?: { enabled?: boolean };
      }) =>
        React.createElement(
          "div",
          {
            "data-testid": "mock-responsive",
            "data-layouts": JSON.stringify(layouts),
            "data-drag-enabled": String(dragConfig?.enabled),
            "data-resize-enabled": String(resizeConfig?.enabled),
          },
          children,
        ),
    ),
  };
});

jest.mock("react-grid-layout/core", () => ({
  getBreakpointFromWidth: jest.fn(),
}));

const MockResponsive = jest.mocked(Responsive);
const mockGetBreakpointFromWidth = jest.mocked(getBreakpointFromWidth);

const emptyLayout: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

describe("DesktopPanelGridSkeleton (design.md D10)", () => {
  beforeEach(() => {
    MockResponsive.mockClear();
    mockGetBreakpointFromWidth.mockReset();
  });

  it("renders a non-zero, default-geometry set of PanelCardSkeletons when the active breakpoint's saved layout is empty", () => {
    mockGetBreakpointFromWidth.mockReturnValue("lg");
    const { container } = render(<DesktopPanelGridSkeleton layout={emptyLayout} width={1440} />);

    expect(container.querySelectorAll(".panel-grid-card").length).toBe(FALLBACK_STUB_COUNT);
  });

  it("disables drag/resize — a static placeholder", () => {
    mockGetBreakpointFromWidth.mockReturnValue("lg");
    const { getByTestId } = render(<DesktopPanelGridSkeleton layout={emptyLayout} width={1440} />);

    expect(getByTestId("mock-responsive")).toHaveAttribute("data-drag-enabled", "false");
    expect(getByTestId("mock-responsive")).toHaveAttribute("data-resize-enabled", "false");
  });

  it("renders one card per saved entry when the active breakpoint's saved layout is populated", () => {
    mockGetBreakpointFromWidth.mockReturnValue("lg");
    const layout: DashboardLayout = {
      ...emptyLayout,
      lg: [
        { panelId: "p1", x: 0, y: 0, w: 4, h: 5 },
        { panelId: "p2", x: 4, y: 0, w: 4, h: 5 },
      ],
    };
    const { container } = render(<DesktopPanelGridSkeleton layout={layout} width={1440} />);

    expect(container.querySelectorAll(".panel-grid-card").length).toBe(2);
  });
});
