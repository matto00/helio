import { render } from "@testing-library/react";

import { SidebarRowsSkeleton } from "./SidebarRowsSkeleton";

describe("SidebarRowsSkeleton", () => {
  it("renders rows inside the real dashboard-list__items <ul>, with the wrapper's accessible name", () => {
    const { container } = render(<SidebarRowsSkeleton ariaLabel="Loading data sources…" />);
    const list = container.querySelector("ul.dashboard-list__items");
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute("aria-label", "Loading data sources…");
    expect(list?.querySelectorAll("li.dashboard-list__item").length).toBeGreaterThan(0);
  });

  it("defaults to 5 flat rows", () => {
    const { container } = render(<SidebarRowsSkeleton ariaLabel="Loading…" />);
    expect(container.querySelectorAll("li").length).toBe(5);
    expect(container.querySelector(".dashboard-list__button--stacked")).not.toBeInTheDocument();
  });

  it("renders a caller-specified row count", () => {
    const { container } = render(<SidebarRowsSkeleton ariaLabel="Loading…" count={3} />);
    expect(container.querySelectorAll("li").length).toBe(3);
  });

  it("renders the stacked (two-line) row shape for taller sections", () => {
    const { container } = render(<SidebarRowsSkeleton ariaLabel="Loading…" rowShape="stacked" />);
    const rows = container.querySelectorAll(".dashboard-list__button--stacked");
    expect(rows.length).toBeGreaterThan(0);
  });
});
