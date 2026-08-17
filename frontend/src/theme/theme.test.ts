import {
  AccentStorageKey,
  DASHBOARD_APPEARANCE_PRESETS,
  DefaultAccentColorByTheme,
  getInitialAccentColor,
} from "./theme";

describe("DASHBOARD_APPEARANCE_PRESETS", () => {
  const hexPattern = /^#[0-9a-f]{6}$/i;

  it("provides at least 6 presets", () => {
    expect(DASHBOARD_APPEARANCE_PRESETS.length).toBeGreaterThanOrEqual(6);
  });

  it("every preset has a non-empty label", () => {
    for (const preset of DASHBOARD_APPEARANCE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("every preset background is a valid 6-digit hex color", () => {
    for (const preset of DASHBOARD_APPEARANCE_PRESETS) {
      expect(preset.background).toMatch(hexPattern);
    }
  });

  it("every preset gridBackground is a valid 6-digit hex color", () => {
    for (const preset of DASHBOARD_APPEARANCE_PRESETS) {
      expect(preset.gridBackground).toMatch(hexPattern);
    }
  });

  it("all preset labels are unique", () => {
    const labels = DASHBOARD_APPEARANCE_PRESETS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("getInitialAccentColor", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns the dark-theme default orange when localStorage is empty (dark)", () => {
    expect(getInitialAccentColor("dark")).toBe(DefaultAccentColorByTheme.dark);
  });

  it("returns the light-theme default orange when localStorage is empty (light)", () => {
    expect(getInitialAccentColor("light")).toBe(DefaultAccentColorByTheme.light);
  });

  it("returns the stored value when one is present in localStorage, regardless of theme", () => {
    window.localStorage.setItem(AccentStorageKey, "#3b82f6");
    expect(getInitialAccentColor("dark")).toBe("#3b82f6");
    expect(getInitialAccentColor("light")).toBe("#3b82f6");
  });
});
