import { render } from "@testing-library/react";

import { PanelCardSkeleton } from "./PanelCardSkeleton";

describe("PanelCardSkeleton", () => {
  it("renders the real .panel-grid-card chrome classes with skeleton placeholders inside", () => {
    const { container } = render(<PanelCardSkeleton />);
    const card = container.querySelector(".panel-grid-card");
    expect(card).toBeInTheDocument();
    expect(card?.querySelector(".panel-grid-card__top")).toBeInTheDocument();
    expect(card?.querySelector(".panel-grid-card__footer")).toBeInTheDocument();
    expect(card?.querySelectorAll(".ui-skeleton").length).toBeGreaterThan(0);
  });

  it("is aria-hidden — the loading name lives on the grid wrapper, not per card", () => {
    const { container } = render(<PanelCardSkeleton />);
    expect(container.querySelector(".panel-grid-card")).toHaveAttribute("aria-hidden", "true");
  });
});
