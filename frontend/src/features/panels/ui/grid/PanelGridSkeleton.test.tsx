import { render } from "@testing-library/react";

import type { DashboardLayout } from "../../../dashboards/types/dashboard";
import { PanelGridSkeleton } from "./PanelGridSkeleton";

jest.mock("./DesktopPanelGridSkeleton", () => ({
  DesktopPanelGridSkeleton: () => <div data-testid="desktop-grid-skeleton" />,
}));

jest.mock("./MobilePanelStackSkeleton", () => ({
  MobilePanelStackSkeleton: () => <div data-testid="mobile-stack-skeleton" />,
}));

const emptyLayout: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

// HEL-528 skeptic-final-1.md CR1 — `width` is now a prop `PanelList` measures
// once and passes to both this component and `PanelGrid` (no more independent
// `useContainerWidth()` call here), so these tests pass it directly instead of
// mocking `react-grid-layout`.
describe("PanelGridSkeleton — desktop/phone branch (mirrors PanelGrid.tsx)", () => {
  it("renders the desktop grid skeleton at desktop widths", () => {
    const { getByTestId, queryByTestId } = render(
      <PanelGridSkeleton layout={emptyLayout} width={1280} />,
    );
    expect(getByTestId("desktop-grid-skeleton")).toBeInTheDocument();
    expect(queryByTestId("mobile-stack-skeleton")).not.toBeInTheDocument();
  });

  it("renders the phone stack skeleton below the sm breakpoint", () => {
    const { getByTestId, queryByTestId } = render(
      <PanelGridSkeleton layout={emptyLayout} width={400} />,
    );
    expect(getByTestId("mobile-stack-skeleton")).toBeInTheDocument();
    expect(queryByTestId("desktop-grid-skeleton")).not.toBeInTheDocument();
  });

  it("carries an accessible loading name on the wrapper", () => {
    const { getByLabelText } = render(<PanelGridSkeleton layout={emptyLayout} width={1280} />);
    expect(getByLabelText("Loading panels")).toBeInTheDocument();
  });
});
