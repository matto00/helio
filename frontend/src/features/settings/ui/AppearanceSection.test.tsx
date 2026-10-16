import { fireEvent, render, screen, within } from "@testing-library/react";

import { AppearanceSection } from "./AppearanceSection";
import { ThemeProvider } from "../../../theme/ThemeProvider";
import type { PreferredAppearance } from "../../../theme/useAppearanceState";
import type { AppearancePreferencesPatch } from "../../auth/types/user";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.localStorage.clear();
});

function renderSection(
  preferredAppearance: PreferredAppearance = {
    typeStyle: "sans",
    density: "comfortable",
    motion: null,
  },
) {
  const onAppearanceChange = jest.fn<void, [AppearancePreferencesPatch]>();
  render(
    <ThemeProvider
      preferredAppearance={preferredAppearance}
      onAppearanceChange={onAppearanceChange}
    >
      <AppearanceSection />
    </ThemeProvider>,
  );
  return { onAppearanceChange };
}

const checked = (group: HTMLElement) =>
  within(group)
    .getAllByRole("radio")
    .filter((el) => el.getAttribute("aria-checked") === "true")
    .map((el) => el.textContent);

describe("AppearanceSection (HEL-1572)", () => {
  it("shows the intro line and the rows in order: Accent, Mode, Type style, Density, Motion, Theme", () => {
    renderSection();
    expect(
      screen.getByText("Make Helio yours. Changes apply instantly and follow you across devices."),
    ).toBeInTheDocument();
    const labels = [...document.querySelectorAll(".appearance__label")].map((el) => el.textContent);
    expect(labels).toEqual(["Accent", "Mode", "Type style", "Density", "Motion", "Theme"]);
  });

  it("exposes exactly one checked option per group, defaults selected", () => {
    renderSection();
    expect(checked(screen.getByRole("radiogroup", { name: "Type style" }))).toHaveLength(1);
    expect(checked(screen.getByRole("radiogroup", { name: "Density" }))).toEqual(["Comfortable"]);
    expect(checked(screen.getByRole("radiogroup", { name: "Motion" }))).toEqual(["Full"]);
    expect(
      within(screen.getByRole("radiogroup", { name: "Type style" })).getByRole("radio", {
        checked: true,
      }),
    ).toHaveAttribute("data-type-style-option", "sans");
  });

  it("selecting a type style applies immediately and reports the patch", () => {
    const { onAppearanceChange } = renderSection();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Type style" })).getByRole("radio", {
        name: /Serif headings/,
      }),
    );
    expect(document.documentElement.dataset.typeStyle).toBe("serif");
    expect(onAppearanceChange).toHaveBeenCalledWith({ typeStyle: "serif" });
  });

  it("density and motion selections apply and report", () => {
    const { onAppearanceChange } = renderSection();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(onAppearanceChange).toHaveBeenCalledWith({ density: "compact" });
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(onAppearanceChange).toHaveBeenCalledWith({ motion: "off" });
  });

  it("arrow keys move the checked option within a group", () => {
    renderSection();
    const full = screen.getByRole("radio", { name: "Full" });
    fireEvent.keyDown(full, { key: "ArrowRight" });
    expect(document.documentElement.dataset.motion).toBe("subtle");
    expect(checked(screen.getByRole("radiogroup", { name: "Motion" }))).toEqual(["Subtle"]);
  });

  it("shows the EFFECTIVE motion when nothing is saved and the OS asks for reduced motion", () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
    renderSection();
    expect(checked(screen.getByRole("radiogroup", { name: "Motion" }))).toEqual(["Off"]);
    expect(screen.queryByRole("button", { name: "Use system setting" })).not.toBeInTheDocument();
    expect(screen.getByText(/Defaults to your system's reduce-motion setting/)).toBeInTheDocument();
  });

  it('"Use system setting" appears once a choice is saved and clears it', () => {
    const { onAppearanceChange } = renderSection({
      typeStyle: "sans",
      density: "comfortable",
      motion: "full",
    });
    fireEvent.click(screen.getByRole("button", { name: "Use system setting" }));
    expect(onAppearanceChange).toHaveBeenCalledWith({ motion: null });
    expect(document.documentElement.hasAttribute("data-motion")).toBe(false);
    expect(screen.queryByRole("button", { name: "Use system setting" })).not.toBeInTheDocument();
  });

  it('the Theme row is inert and marked "Later"', () => {
    renderSection();
    const row = screen.getByTestId("theme-later-row");
    expect(within(row).getByText("Later")).toBeInTheDocument();
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(within(row).queryAllByRole("radio")).toHaveLength(0);
  });

  it("each type card previews its own face through an inline --font-heading, whatever style is active", () => {
    renderSection({ typeStyle: "mono", density: "comfortable", motion: null });
    const group = screen.getByRole("radiogroup", { name: "Type style" });
    const face = (name: RegExp) =>
      within(group).getByRole("radio", { name }).style.getPropertyValue("--font-heading");
    expect(face(/Sans \+ mono/)).toBe("var(--font-face-sans)");
    expect(face(/^Markets.*Mono$/)).toBe("var(--font-face-mono)");
    expect(face(/Serif headings/)).toBe("var(--font-face-serif)");
    expect(checked(group)[0]).toMatch(/Mono$/);
  });

  it("keeps the light/dark toggle and the accent swatches in Appearance", () => {
    renderSection();
    expect(
      screen.getByRole("button", { name: /Switch to (light|dark) theme/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Orange" })).toBeInTheDocument();
  });
});
