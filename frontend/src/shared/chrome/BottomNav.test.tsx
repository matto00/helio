import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { BottomNav } from "./BottomNav";
import { navDestinations } from "./navDestinations";

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <BottomNav />
    </MemoryRouter>,
  );
}

describe("BottomNav", () => {
  it("renders exactly the four navDestinations as tabs, in order", () => {
    renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(navDestinations.map((d) => d.label));
  });

  it("marks the Dashboards tab active on the root route and no other tab active", () => {
    renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Dashboards" })).toHaveClass(
      "bottom-nav__tab--active",
    );
    for (const label of ["Data Sources", "Data Pipelines", "Type Registry"]) {
      expect(within(nav).getByRole("link", { name: label })).not.toHaveClass(
        "bottom-nav__tab--active",
      );
    }
  });

  it("follows the current route — /pipelines marks Data Pipelines active, not Dashboards", () => {
    renderAt("/pipelines");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Data Pipelines" })).toHaveClass(
      "bottom-nav__tab--active",
    );
    expect(within(nav).getByRole("link", { name: "Dashboards" })).not.toHaveClass(
      "bottom-nav__tab--active",
    );
  });

  it("follows the route into a nested detail path (/pipelines/:id) via the non-'end' match", () => {
    renderAt("/pipelines/some-pipeline-id");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Data Pipelines" })).toHaveClass(
      "bottom-nav__tab--active",
    );
  });
});
