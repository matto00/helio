import { render } from "@testing-library/react";

import { Skeleton } from "./Skeleton";
import { PageContentSkeleton } from "./PageContentSkeleton";
import { PanelSuspenseFallback } from "./SuspenseFallback";
import { PanelBodySkeleton } from "../../features/panels/ui/PanelBodySkeleton";
import { PanelCardSkeleton } from "../../features/panels/ui/PanelCardSkeleton";
import { SidebarRowsSkeleton } from "../chrome/SidebarRowsSkeleton";

// HEL-528 design.md/spec: "Skeletons are decorative; the loading
// announcement lives on the wrapper" — every rendered `Skeleton` is
// `aria-hidden`, and every composed skeleton surface exposes exactly one
// accessible loading name on its own wrapper (never per-placeholder) and
// never carries `role="alert"` (a loading region must never be announced as
// an error).
describe("Skeleton composition — accessibility (design.md/spec 6.6)", () => {
  it("every Skeleton instance is aria-hidden regardless of variant", () => {
    const variants = ["block", "line", "circle"] as const;
    for (const variant of variants) {
      const { container } = render(<Skeleton variant={variant} />);
      expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("SidebarRowsSkeleton exposes exactly one accessible loading name, no role=alert", () => {
    const { container, getByLabelText } = render(
      <SidebarRowsSkeleton ariaLabel="Loading data sources…" />,
    );
    expect(getByLabelText("Loading data sources…")).toBeInTheDocument();
    expect(container.querySelectorAll("[aria-label]").length).toBe(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("PanelCardSkeleton carries no accessible name of its own (the grid wrapper owns it)", () => {
    const { container } = render(<PanelCardSkeleton />);
    // The card itself is aria-hidden — only the grid's own wrapper (rendered
    // by PanelGridSkeleton, not this component) carries the loading name.
    expect(container.querySelector(".panel-grid-card")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("PanelBodySkeleton carries no role=alert (the caller's wrapper owns the loading name)", () => {
    const { container } = render(<PanelBodySkeleton />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("PanelSuspenseFallback exposes exactly one accessible loading name, no role=alert", () => {
    const { container, getByLabelText } = render(<PanelSuspenseFallback />);
    expect(getByLabelText("Loading data")).toBeInTheDocument();
    expect(container.querySelectorAll("[aria-label]").length).toBe(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("PageContentSkeleton exposes exactly one accessible loading name, no role=alert", () => {
    const { container, getByLabelText } = render(<PageContentSkeleton />);
    expect(getByLabelText("Loading")).toBeInTheDocument();
    expect(container.querySelectorAll("[aria-label]").length).toBe(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
