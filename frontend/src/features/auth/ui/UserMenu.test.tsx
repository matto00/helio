import { fireEvent, render, screen } from "@testing-library/react";
import type { User } from "../types/user";
import { UserMenu } from "./UserMenu";

const baseUser: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
  tier: "free",
};

function renderMenu(overrides: Partial<User> = {}) {
  const user: User = { ...baseUser, ...overrides };
  const onLogout = jest.fn();
  const setAccentColor = jest.fn();
  const onNavigateToSettings = jest.fn();
  const utils = render(
    <UserMenu
      currentUser={user}
      accentColor="#f97316"
      setAccentColor={setAccentColor}
      onNavigateToSettings={onNavigateToSettings}
      onLogout={onLogout}
    />,
  );
  return { ...utils, onLogout, setAccentColor, onNavigateToSettings };
}

describe("UserMenu", () => {
  it("trigger click opens popover", () => {
    renderMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("popover panel renders as a portal to document.body (not inside .user-menu)", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    const menu = screen.getByRole("menu");
    const userMenuContainer = document.querySelector(".user-menu");
    // Panel is a direct child of document.body (portal), not nested inside
    // the .user-menu trigger container.
    expect(userMenuContainer).not.toContainElement(menu as HTMLElement);
    expect(document.body).toContainElement(menu as HTMLElement);
  });

  it("Escape key closes popover and returns focus to trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "User menu" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("click on scrim closes popover", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const scrim = document.querySelector(".popover__scrim");
    expect(scrim).toBeInTheDocument();
    fireEvent.click(scrim!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders avatar image when avatarUrl is non-null", () => {
    renderMenu({ avatarUrl: "https://example.com/avatar.png" });
    // Alt is empty (presentational) so the avatar doesn't show literal text
    // when the URL is broken — verify the img by class + src instead.
    const img = document.querySelector("img.user-menu__avatar") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toBe("https://example.com/avatar.png");
  });

  it("renders initials fallback when avatarUrl is null", () => {
    renderMenu({ avatarUrl: null, displayName: "Test User" });
    // The initials span is aria-hidden, so query by class
    const trigger = screen.getByRole("button", { name: "User menu" });
    const initials = trigger.querySelector(".user-menu__initials");
    expect(initials).toBeInTheDocument();
    expect(initials?.textContent).toBe("T");
  });

  it("renders initials fallback when avatarUrl is absent from the payload, not just null — F-086", () => {
    // The real /api/auth/me response is spray-json-serialized: an absent
    // Option field is omitted from the JSON entirely rather than sent as
    // `null` (see project pipeline-only-bindings notes), so `avatarUrl`
    // decodes as `undefined` even though `User` types it as `string | null`.
    // A strict `avatarUrl !== null` check let `undefined` through and
    // rendered a permanently broken `<img src={undefined}>`.
    const { avatarUrl: _omitted, ...userWithoutAvatarUrl } = baseUser;
    render(
      <UserMenu
        currentUser={userWithoutAvatarUrl as User}
        accentColor="#f97316"
        setAccentColor={jest.fn()}
        onNavigateToSettings={jest.fn()}
        onLogout={jest.fn()}
      />,
    );
    const trigger = screen.getByRole("button", { name: "User menu" });
    expect(trigger.querySelector("img.user-menu__avatar")).not.toBeInTheDocument();
    const initials = trigger.querySelector(".user-menu__initials");
    expect(initials).toBeInTheDocument();
    expect(initials?.textContent).toBe("T");
  });

  it("shows display name in popover when displayName is set", () => {
    renderMenu({ displayName: "Test User" });
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("shows email as display name fallback when displayName is null", () => {
    renderMenu({ displayName: null });
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });

  // F-082: the dropdown used to carry its own "Light mode"/"Dark mode" row
  // wired to the same toggleTheme as the always-visible top-bar icon. The
  // top-bar icon (App.tsx, not this component) is the single canonical
  // theme control now, so the popover renders no theme item at all.
  it("does not render a theme-toggle control inside the popover", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(
      screen.queryByRole("menuitem", { name: /light mode|dark mode/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /switch to (light|dark) theme/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onLogout when sign-out is clicked inside popover", () => {
    const { onLogout } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("calls onNavigateToSettings and closes the popover when Settings is clicked", () => {
    const { onNavigateToSettings } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Settings" }));
    expect(onNavigateToSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders accent color picker inside popover", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByText("Accent color")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Accent color presets" })).toBeInTheDocument();
  });

  // F-189
  it("scrim is hidden from the accessibility tree and out of the tab order", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    const scrim = document.querySelector(".popover__scrim");
    expect(scrim).toHaveAttribute("aria-hidden", "true");
    expect(scrim).toHaveAttribute("tabIndex", "-1");
  });

  it("opens with focus on the first item (the first accent swatch) and ArrowDown moves to the next", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    const firstSwatch = screen.getByRole("button", { name: "Orange" });
    expect(firstSwatch).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    const secondSwatch = screen.getByRole("button", { name: "Red" });
    expect(secondSwatch).toHaveFocus();
  });

  it("ArrowUp from the first item wraps focus to the last item in the menu", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByRole("button", { name: "Orange" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toHaveFocus();
  });
});
