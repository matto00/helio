import { fireEvent, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../test/renderWithStore";
import type { User } from "../../features/auth/types/user";
import { AppRail } from "./AppRail";

function userOfTier(tier: User["tier"]): User {
  return {
    id: "u1",
    email: "u@example.com",
    displayName: "U",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    tier,
  };
}

function renderRail(
  path: string,
  options: { tier?: User["tier"]; sectionHasList?: boolean; listCollapsed?: boolean } = {},
) {
  const onExpandList = jest.fn();
  const utils = renderWithStore(
    <AppRail
      sectionHasList={options.sectionHasList ?? true}
      listCollapsed={options.listCollapsed ?? false}
      onExpandList={onExpandList}
    />,
    { auth: { status: "authenticated", currentUser: userOfTier(options.tier ?? "free") } },
    path,
  );
  return { ...utils, onExpandList };
}

describe("AppRail", () => {
  it("renders Home then the five sections, each a link with an accessible name and a tooltip", () => {
    renderRail("/home");
    const nav = screen.getByRole("navigation", { name: "Main navigation" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Home",
      "Dashboards",
      "Data Sources",
      "Data Pipelines",
      "Connectors",
      "Assistant",
    ]);
    for (const link of links)
      expect(link).toHaveAttribute("title", link.getAttribute("aria-label"));
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
    expect(within(nav).getByRole("link", { name: "Data Pipelines" })).toHaveAttribute(
      "href",
      "/pipelines",
    );
  });

  it("marks exactly one rail item current on a dashboard route, and it is Dashboards, never Home", () => {
    renderRail("/home");
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.getAttribute("aria-label"))).toEqual(["Dashboards"]);
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveClass("app-rail__item--active");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveClass("app-rail__item--active");
  });

  it("treats /dashboards/:id as the Dashboards section", () => {
    renderRail("/dashboards/abc");
    expect(screen.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it.each([
    ["/pipelines/p1", "Data Pipelines"],
    ["/sources", "Data Sources"],
    ["/chat", "Assistant"],
    ["/connectors", "Connectors"],
    ["/settings", "Settings"],
  ])("on %s only %s is current", (path, label) => {
    renderRail(path);
    const current = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.getAttribute("aria-label"))).toEqual([label]);
  });

  it("has no Usage item in the rail, even for an owner", () => {
    renderRail("/home", { tier: "owner" });
    expect(screen.queryByRole("link", { name: "Usage" })).not.toBeInTheDocument();
  });

  it("puts Settings and the avatar menu at the foot", () => {
    renderRail("/home");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getAllByRole("button", { name: "User menu" })).toHaveLength(1);
  });

  it("offers Expand list only while a section's list is collapsed, and calls back", () => {
    const { onExpandList, unmount } = renderRail("/home", { listCollapsed: true });
    const expand = screen.getByRole("button", { name: "Expand list" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(expand);
    expect(onExpandList).toHaveBeenCalledTimes(1);
    unmount();
    renderRail("/home", { listCollapsed: false });
    expect(screen.queryByRole("button", { name: "Expand list" })).not.toBeInTheDocument();
  });

  it("offers no Expand list on a section without a list (Connectors)", () => {
    renderRail("/connectors", { listCollapsed: true, sectionHasList: false });
    expect(screen.queryByRole("button", { name: "Expand list" })).not.toBeInTheDocument();
  });

  it("hosts the sliding indicator and marks exactly the active item for it (HEL-1573)", () => {
    const { container } = renderRail("/pipelines");
    expect(container.querySelectorAll(".app-rail > .motion-indicator")).toHaveLength(1);
    const marked = container.querySelectorAll("[data-indicator-active]");
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(screen.getByRole("link", { name: "Data Pipelines" }));
  });

  it("marks Settings for the indicator on the settings route (HEL-1573)", () => {
    const { container } = renderRail("/settings");
    expect(container.querySelectorAll("[data-indicator-active]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("data-indicator-active");
  });
});
