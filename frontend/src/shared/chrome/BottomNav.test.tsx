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
    renderAt("/home");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    // No visible label (HEL-774 dropped it) — the accessible name IS the
    // entire identifying information a screen-reader user gets, so it must
    // equal the full destination label, not a shortened form.
    // HEL-1574: Home leads (owner ruling 2026-10-13: the phone has no rail).
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Home",
      ...navDestinations.map((d) => d.label),
    ]);
    for (const destination of navDestinations) {
      expect(within(nav).getByRole("link", { name: destination.label })).toBeInTheDocument();
    }
  });

  it("marks the Dashboards tab active on the root route and no other tab active", () => {
    renderAt("/home");

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
    renderAt("/home", tier);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("has no Usage tab when signed out", () => {
    renderAt("/home");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("appends a Usage tab linking to /admin/usage for an owner", () => {
    renderAt("/home", "owner");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Home",
      ...navDestinations.map((d) => d.label),
      "Usage",
    ]);
    expect(within(nav).getByRole("link", { name: "Usage" })).toHaveAttribute(
      "href",
      "/admin/usage",
    );
  });

  it("never marks Home active: on '/home' only the Dashboards tab is (HEL-1574)", () => {
    renderAt("/home");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const home = within(nav).getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/home");
    expect(home).not.toHaveClass("bottom-nav__tab--active");
    expect(home).not.toHaveAttribute("aria-current");
    const active = within(nav)
      .getAllByRole("link")
      .filter((link) => link.classList.contains("bottom-nav__tab--active"));
    expect(active.map((link) => link.getAttribute("aria-label"))).toEqual(["Dashboards"]);
  });

  it("shows six tabs for a non-owner and seven for an owner, Home first", () => {
    const nonOwner = renderAt("/", "free");
    expect(
      within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole("link"),
    ).toHaveLength(6);
    nonOwner.unmount();
    renderAt("/", "owner");
    const links = within(screen.getByRole("navigation", { name: "Primary" })).getAllByRole("link");
    expect(links).toHaveLength(7);
    expect(links[0]).toHaveAttribute("aria-label", "Home");
  });
});
