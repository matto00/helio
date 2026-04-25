import { fireEvent, render, screen } from "@testing-library/react";
import type { User } from "../types/models";
import { UserMenu } from "./UserMenu";

const baseUser: User = {
  id: "user-1",
  email: "test@example.com",
  displayName: "Test User",
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00Z",
};

function renderMenu(overrides: Partial<User> = {}) {
  const user: User = { ...baseUser, ...overrides };
  const toggleTheme = jest.fn();
  const onLogout = jest.fn();
  const utils = render(
    <UserMenu currentUser={user} theme="dark" toggleTheme={toggleTheme} onLogout={onLogout} />,
  );
  return { ...utils, toggleTheme, onLogout };
}

describe("UserMenu", () => {
  it("trigger click opens popover", () => {
    renderMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("Escape key closes popover and returns focus to trigger", () => {
    renderMenu();
    const trigger = screen.getByRole("button", { name: "User menu" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("click-outside closes popover", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders avatar image when avatarUrl is non-null", () => {
    renderMenu({ avatarUrl: "https://example.com/avatar.png" });
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    expect(screen.getByRole("img", { name: "User avatar" })).toBeInTheDocument();
  });

  it("renders initials fallback when avatarUrl is null", () => {
    renderMenu({ avatarUrl: null, displayName: "Test User" });
    // The initials span is aria-hidden, so query by class
    const trigger = screen.getByRole("button", { name: "User menu" });
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

  it("calls toggleTheme when theme toggle is clicked inside popover", () => {
    const { toggleTheme } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Switch to light theme" }));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("calls onLogout when sign-out is clicked inside popover", () => {
    const { onLogout } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "User menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
