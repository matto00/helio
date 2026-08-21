import { render } from "@testing-library/react";

import type { DashboardLayout } from "../../dashboards/types/dashboard";
import { MobilePanelStackSkeleton } from "./MobilePanelStackSkeleton";
import { FALLBACK_STUB_COUNT } from "./panelGridSkeletonStubs";

const emptyLayout: DashboardLayout = { lg: [], md: [], sm: [], xs: [] };

describe("MobilePanelStackSkeleton (design.md D10)", () => {
  it("renders stack-shaped placeholders, not an empty region, when the saved xs layout is empty", () => {
    const { container } = render(<MobilePanelStackSkeleton layout={emptyLayout} />);
    const stack = container.querySelector(".mobile-panel-stack");
    expect(stack).toBeInTheDocument();
    expect(stack?.querySelectorAll(".mobile-panel-stack__item").length).toBe(FALLBACK_STUB_COUNT);
  });

  it("matches the card count to the saved xs layout when it is populated", () => {
    const layout: DashboardLayout = {
      ...emptyLayout,
      xs: [
        { panelId: "p1", x: 0, y: 0, w: 2, h: 4 },
        { panelId: "p2", x: 0, y: 4, w: 2, h: 4 },
      ],
    };
    const { container } = render(<MobilePanelStackSkeleton layout={layout} />);
    expect(container.querySelectorAll(".mobile-panel-stack__item").length).toBe(2);
  });

  it("applies a single documented neutral height to every placeholder card", () => {
    const { container } = render(<MobilePanelStackSkeleton layout={emptyLayout} />);
    const items = container.querySelectorAll<HTMLElement>(".mobile-panel-stack__item");
    const heights = new Set(
      Array.from(items).map((el) => el.style.getPropertyValue("--mobile-panel-height")),
    );
    expect(heights.size).toBe(1);
    expect(heights.has("")).toBe(false);
  });
});
