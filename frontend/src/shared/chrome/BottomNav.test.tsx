import { screen, within } from "@testing-library/react";

import { renderWithStore } from "../../test/renderWithStore";
import type { User } from "../../features/auth/types/user";
import { BottomNav } from "./BottomNav";
import { navDestinations } from "./navDestinations";

function renderAt(pathname: string, tier?: User["tier"]) {
  return renderWithStore(
    <BottomNav />,
    tier
      ? {
          auth: {
            status: "authenticated",
            currentUser: {
              id: "u-1",
              email: "u@example.com",
              displayName: null,
              avatarUrl: null,
              createdAt: "2026-01-01T00:00:00Z",
              tier,
            },
          },
        }
      : undefined,
    pathname,
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
    for (const label of ["Data Sources", "Data Pipelines", "Connectors", "Assistant"]) {
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

  // HEL-1211: the owner-only Usage entry is rendered for owners and for nobody else.
  it.each(["free", "beta"] as const)("has no Usage tab for a %s-tier user", (tier) => {
    renderAt("/", tier);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("has no Usage tab when signed out", () => {
    renderAt("/");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("appends a Usage tab linking to /admin/usage for an owner", () => {
    renderAt("/", "owner");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      ...navDestinations.map((d) => d.label),
      "Usage",
    ]);
    expect(within(nav).getByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/admin/usage",
    );
  });
});
