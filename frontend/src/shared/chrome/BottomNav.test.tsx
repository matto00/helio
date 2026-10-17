import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../test/renderWithStore";
import type { User } from "../../features/auth/types/user";
import { BottomNav } from "./BottomNav";

function renderAt(pathname: string, tier: User["tier"] = "free") {
  return renderWithStore(
    <BottomNav />,
    {
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
    },
    pathname,
  );
}

function tabs() {
  const nav = screen.getByRole("navigation", { name: "Primary" });
  return Array.from(nav.querySelectorAll<HTMLElement>("a, button"));
}

function currentTabs() {
  return tabs()
    .filter((tab) => tab.hasAttribute("aria-current"))
    .map((tab) => tab.getAttribute("aria-label"));
}

describe("BottomNav (HEL-1583: Home, Dashboards, Data, Pipelines, Me)", () => {
  it("renders exactly five tabs, in order, each exposing its label as its accessible name", () => {
    renderAt("/dashboards");
    expect(tabs().map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Home",
      "Dashboards",
      "Data",
      "Pipelines",
      "Me",
    ]);
    for (const name of ["Home", "Dashboards", "Data", "Pipelines"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Me" })).toBeInTheDocument();
  });

  it("has no Connectors, Assistant or Usage tab, for any tier", () => {
    renderAt("/dashboards", "owner");
    for (const name of ["Connectors", "Assistant", "Usage", "Data Sources", "Data Pipelines"]) {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    }
    expect(tabs()).toHaveLength(5);
  });

  it("points the route tabs at the shared destination paths", () => {
    renderAt("/dashboards");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveAttribute("href", "/dashboards");
    expect(screen.getByRole("link", { name: "Data" })).toHaveAttribute("href", "/sources");
    expect(screen.getByRole("link", { name: "Pipelines" })).toHaveAttribute("href", "/pipelines");
  });

  // Exactly one tab is current on every route that belongs to a tab, and none on routes that belong to none.
  it.each([
    ["/home", "Home"],
    ["/dashboards", "Dashboards"],
    ["/dashboards/x", "Dashboards"],
    ["/sources", "Data"],
    ["/sources/x", "Data"],
    ["/connectors", "Data"],
    ["/pipelines", "Pipelines"],
    ["/pipelines/x", "Pipelines"],
    ["/settings", "Me"],
    ["/admin/usage", "Me"],
  ])("marks exactly one tab current on %s: %s", (path, expected) => {
    renderAt(path);
    expect(currentTabs()).toEqual([expected]);
  });

  it("marks no tab current on /chat or a review route", () => {
    const { unmount } = renderAt("/chat");
    expect(currentTabs()).toEqual([]);
    unmount();
    renderAt("/proposals/review");
    expect(currentTabs()).toEqual([]);
  });

  it("gives route tabs aria-current=page and the active class, and Me aria-current=true (never page)", () => {
    const { unmount } = renderAt("/pipelines");
    const pipelines = screen.getByRole("link", { name: "Pipelines" });
    expect(pipelines).toHaveAttribute("aria-current", "page");
    expect(pipelines).toHaveClass("bottom-nav__tab--active");
    unmount();
    renderAt("/settings");
    const me = screen.getByRole("button", { name: "Me" });
    expect(me).toHaveAttribute("aria-current", "true");
    expect(me).toHaveClass("bottom-nav__tab--active");
  });

  it("renders every tab's label in the DOM, hidden from assistive tech, so a collapsed label adds nothing to the name", () => {
    renderAt("/dashboards");
    for (const tab of tabs()) {
      const label = tab.querySelector(".bottom-nav__label");
      expect(label).not.toBeNull();
      expect(label).toHaveAttribute("aria-hidden", "true");
      expect(label?.textContent).toBe(tab.getAttribute("aria-label"));
    }
  });

  it("makes Me a menu button that opens the user menu with Settings, Getting started, Sign out", () => {
    renderAt("/dashboards", "free");
    const me = screen.getByRole("button", { name: "Me" });
    expect(me).toHaveAttribute("aria-haspopup", "menu");
    expect(me).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(me);
    expect(me).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label"));
    expect(items).toEqual(["Settings", "Getting started", "Sign out"]);
  });

  it("lists Usage in the Me menu for an owner only", () => {
    renderAt("/dashboards", "owner");
    fireEvent.click(screen.getByRole("button", { name: "Me" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Settings",
      "Usage",
      "Getting started",
      "Sign out",
    ]);
  });

  it("portals the Me menu out of the nav, so it never sits inside the nav's backdrop-filter stacking context", () => {
    renderAt("/dashboards");
    fireEvent.click(screen.getByRole("button", { name: "Me" }));
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("navigation", { name: "Primary" }).contains(menu)).toBe(false);
  });

  it("renders no Me tab when signed out", () => {
    renderWithStore(<BottomNav />, undefined, "/dashboards");
    expect(screen.queryByRole("button", { name: "Me" })).not.toBeInTheDocument();
  });
});
