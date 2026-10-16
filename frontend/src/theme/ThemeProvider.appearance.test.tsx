import { act, render, screen } from "@testing-library/react";

import { AppearanceStorageKey, DEFAULT_APPEARANCE, type AppearancePrefs } from "./appearancePrefs";
import { ThemeProvider, useDensity, useReducedMotion, useTheme } from "./ThemeProvider";
import type { PreferredAppearance } from "./useAppearanceState";

const root = document.documentElement;

function Probe() {
  const t = useTheme();
  return (
    <div>
      <span data-testid="state">
        {t.typeStyle}|{t.density}|{String(t.motion)}|{t.effectiveMotion}
      </span>
      <button onClick={() => t.setTypeStyle("serif")}>serif</button>
      <button onClick={() => t.setDensity("compact")}>compact</button>
      <button onClick={() => t.setMotion("off")}>off</button>
      <button onClick={() => t.setMotion(null)}>system</button>
    </div>
  );
}

function renderProvider(
  props: { preferredAppearance?: PreferredAppearance; onAppearanceChange?: jest.Mock } = {},
) {
  const view = render(
    <ThemeProvider {...props}>
      <Probe />
    </ThemeProvider>,
  );
  return {
    ...view,
    rerenderWith: (next: { preferredAppearance?: PreferredAppearance }) =>
      view.rerender(
        <ThemeProvider onAppearanceChange={props.onAppearanceChange} {...next}>
          <Probe />
        </ThemeProvider>,
      ),
  };
}

const state = () => screen.getByTestId("state").textContent;
const cached = () => JSON.parse(window.localStorage.getItem(AppearanceStorageKey) ?? "null");
const mono: AppearancePrefs = { typeStyle: "mono", density: "compact", motion: "subtle" };

describe("ThemeProvider appearance (HEL-1572)", () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.localStorage.clear();
    delete root.dataset.typeStyle;
    delete root.dataset.density;
    delete root.dataset.motion;
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("defaults to sans / comfortable / no data-motion", () => {
    renderProvider();
    expect(state()).toBe("sans|comfortable|null|full");
    expect(root.dataset.typeStyle).toBe("sans");
    expect(root.dataset.density).toBe("comfortable");
    expect(root.hasAttribute("data-motion")).toBe(false);
  });

  it("adopts the cached appearance on first render (what the pre-paint script applied)", () => {
    window.localStorage.setItem(AppearanceStorageKey, JSON.stringify(mono));
    renderProvider();
    expect(state()).toBe("mono|compact|subtle|subtle");
    expect(root.dataset).toMatchObject({ typeStyle: "mono", density: "compact", motion: "subtle" });
  });

  it("applies a server value before paint and syncs the cache; an unknown (undefined) value leaves the cache alone", () => {
    window.localStorage.setItem(AppearanceStorageKey, JSON.stringify(mono));
    const { rerenderWith } = renderProvider({ preferredAppearance: undefined });
    expect(state()).toBe("mono|compact|subtle|subtle");
    rerenderWith({
      preferredAppearance: { typeStyle: "serif", density: "comfortable", motion: null },
    });
    expect(state()).toBe("serif|comfortable|null|full");
    expect(root.dataset.typeStyle).toBe("serif");
    expect(root.hasAttribute("data-motion")).toBe(false);
    expect(cached()).toEqual({ typeStyle: "serif", density: "comfortable", motion: null });
  });

  it("setters apply immediately (no reload), write the cache and report the patch", () => {
    const onAppearanceChange = jest.fn();
    renderProvider({ preferredAppearance: DEFAULT_APPEARANCE, onAppearanceChange });
    act(() => screen.getByText("serif").click());
    expect(root.dataset.typeStyle).toBe("serif");
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ typeStyle: "serif" });
    act(() => screen.getByText("compact").click());
    expect(root.dataset.density).toBe("compact");
    act(() => screen.getByText("off").click());
    expect(root.dataset.motion).toBe("off");
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ motion: "off" });
    expect(cached()).toEqual({ typeStyle: "serif", density: "compact", motion: "off" });
    act(() => screen.getByText("system").click());
    expect(root.hasAttribute("data-motion")).toBe(false);
    expect(onAppearanceChange).toHaveBeenLastCalledWith({ motion: null });
  });

  it("with no saved motion, the effective level follows the OS (reduce = off)", () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
    renderProvider({ preferredAppearance: DEFAULT_APPEARANCE });
    expect(state()).toBe("sans|comfortable|null|off");
  });

  it("an explicit saved Full beats an OS reduce setting", () => {
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
    renderProvider({ preferredAppearance: { ...DEFAULT_APPEARANCE, motion: "full" } });
    expect(state()).toBe("sans|comfortable|full|full");
  });

  it("sign-out (null) resets the root to defaults and clears the cache", () => {
    window.localStorage.setItem(AppearanceStorageKey, JSON.stringify(mono));
    const { rerenderWith } = renderProvider({ preferredAppearance: mono });
    expect(root.dataset.typeStyle).toBe("mono");
    rerenderWith({ preferredAppearance: null });
    expect(state()).toBe("sans|comfortable|null|full");
    expect(root.dataset.typeStyle).toBe("sans");
    expect(root.hasAttribute("data-motion")).toBe(false);
    expect(window.localStorage.getItem(AppearanceStorageKey)).toBeNull();
  });

  it("useDensity falls back to comfortable outside a ThemeProvider", () => {
    function Bare() {
      return <span data-testid="d">{useDensity()}</span>;
    }
    render(<Bare />);
    expect(screen.getByTestId("d").textContent).toBe("comfortable");
  });

  it("useReducedMotion is true for saved Off or OS reduce with no choice, false for an explicit Full", () => {
    function Flag() {
      return <span data-testid="r">{String(useReducedMotion())}</span>;
    }
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }) as unknown as typeof window.matchMedia;
    const noChoice = render(
      <ThemeProvider preferredAppearance={DEFAULT_APPEARANCE}>
        <Flag />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("r").textContent).toBe("true");
    noChoice.unmount();
    render(
      <ThemeProvider preferredAppearance={{ ...DEFAULT_APPEARANCE, motion: "full" }}>
        <Flag />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("r").textContent).toBe("false");
  });
});
