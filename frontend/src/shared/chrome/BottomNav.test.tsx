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
  it("renders exactly the navDestinations as icon-only tabs, in order, each exposing its full label as its accessible name (HEL-774)", () => {
    renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    // No visible label (HEL-774 dropped it) — the accessible name IS the
    // entire identifying information a screen-reader user gets, so it must
    // equal the full destination label, not a shortened form.
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(
      navDestinations.map((d) => d.label),
    );
    for (const destination of navDestinations) {
      expect(within(nav).getByRole("link", { name: destination.label })).toBeInTheDocument();
    }
  });

  it("marks the Dashboards tab active on the root route and no other tab active", () => {
    renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Dashboards" })).toHaveClass(
      "bottom-nav__tab--active",
    );
    for (const label of ["Data Sources", "Data Pipelines", "Data Types", "Metrics", "Assistant"]) {
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
