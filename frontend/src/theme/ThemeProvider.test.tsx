import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ThemeProvider, useTheme } from "./ThemeProvider";
import { AccentStorageKey, ThemeStorageKey } from "./theme";

function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div>
      <span>{theme}</span>
      <button type="button" onClick={toggleTheme}>
        Toggle theme
      </button>
    </div>
  );
}

function AccentConsumer() {
  const { accentColor, setAccentColor } = useTheme();

  return (
    <div>
      <span data-testid="accent">{accentColor}</span>
      <button type="button" onClick={() => setAccentColor("#3b82f6")}>
        Set blue
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("--app-accent");
  });

  it("defaults to dark theme when no preference is stored", async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByText("dark")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("restores a stored light theme preference", async () => {
    window.localStorage.setItem(ThemeStorageKey, "light");

    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByText("light")).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
  });

  it("persists theme changes when toggled", async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));

    await waitFor(() => expect(screen.getByText("light")).toBeInTheDocument());
    expect(window.localStorage.getItem(ThemeStorageKey)).toBe("light");
  });

  it("reads accent color from localStorage on mount and applies it to documentElement", async () => {
    window.localStorage.setItem(AccentStorageKey, "#3b82f6");

    render(
      <ThemeProvider>
        <AccentConsumer />
      </ThemeProvider>,
    );

    expect(screen.getByTestId("accent").textContent).toBe("#3b82f6");
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--app-accent")).toBe("#3b82f6"),
    );
  });

  it("persists accent color change to localStorage", async () => {
    render(
      <ThemeProvider>
        <AccentConsumer />
      </ThemeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Set blue" }));
    });

    await waitFor(() => expect(window.localStorage.getItem(AccentStorageKey)).toBe("#3b82f6"));
  });

  it("invokes onAccentChange callback when accent color is set", async () => {
    const onAccentChange = jest.fn();

    render(
      <ThemeProvider onAccentChange={onAccentChange}>
        <AccentConsumer />
      </ThemeProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Set blue" }));
    });

    await waitFor(() => expect(onAccentChange).toHaveBeenCalledWith("#3b82f6"));
  });
});
