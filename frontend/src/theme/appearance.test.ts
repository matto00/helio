import {
  buildAccentTokens,
  buildPanelSurface,
  defaultDashboardAppearance,
  resolveDashboardBackground,
  resolveDashboardGridBackground,
  resolvePanelTextColor,
} from "./appearance";

describe("appearance resolution", () => {
  it("resolves dashboard overrides differently per theme", () => {
    const appearance = {
      ...defaultDashboardAppearance,
      background: "#101826",
      gridBackground: "#16233a",
    };

    expect(resolveDashboardBackground("dark", appearance)).not.toBe(
      resolveDashboardBackground("light", appearance),
    );
    expect(resolveDashboardGridBackground("dark", appearance)).not.toBe(
      resolveDashboardGridBackground("light", appearance),
    );
  });

  it("keeps panel surfaces theme-aware under the same override", () => {
    expect(buildPanelSurface("dark", "#1d2a44", 0.08)).not.toBe(
      buildPanelSurface("light", "#1d2a44", 0.08),
    );
  });

  it("falls back to a readable text color when a custom color has poor contrast", () => {
    expect(resolvePanelTextColor("light", "#f3f4f6", 0, "#f8fafc")).toBe("#181511");
  });

  // Lock the panel alpha floor (transparency=0 → fully opaque) and ceiling
  // (transparency=1 → ~0.15) so the formula doesn't drift silently. Opacity at
  // rest is a design invariant: panels must not tint through when the
  // dashboard background changes.
  it("panel surface is opaque at transparency=0 and ~0.15 at transparency=1.0", () => {
    // Dark panelSurface base: #1a1816 = rgb(26, 24, 22). No background override
    // so the blend returns the base unchanged.
    expect(buildPanelSurface("dark", "transparent", 0)).toBe("rgba(26, 24, 22, 1)");
    // 1 - 1.0 * 0.85 may carry JS float noise; match the leading prefix.
    expect(buildPanelSurface("dark", "transparent", 1)).toContain("rgba(26, 24, 22, 0.15");
  });

  // Lock resolveDashboardGridBackground to fully opaque output — the grid
  // override must read identically regardless of what sits behind it.
  //
  // Blend math for gridBackground "#16233a" (r=22, g=35, b=58) at tintStrength=0.62:
  //   dark base #191715  (r=25, g=23, b=21)    → blended r=23, g=30, b=44
  //   light base #fdfcfa (r=253, g=252, b=250) → blended r=110, g=117, b=131
  it("resolveDashboardGridBackground produces opaque rgba values for #16233a", () => {
    const appearance = { ...defaultDashboardAppearance, gridBackground: "#16233a" };
    expect(resolveDashboardGridBackground("dark", appearance)).toBe("rgba(23, 30, 44, 1)");
    expect(resolveDashboardGridBackground("light", appearance)).toBe("rgba(110, 117, 131, 1)");
  });
});

describe("buildAccentTokens", () => {
  it("returns only the accent and its readable ink — derived tokens live in CSS", () => {
    const tokens = buildAccentTokens("#f97316");
    expect(Object.keys(tokens)).toHaveLength(2);
    expect(tokens["--app-accent"]).toBe("#f97316");
    expect(tokens["--app-accent-ink"]).toBe("#181511");
  });

  it("never rewrites neutral structure tokens (borders/backgrounds)", () => {
    const tokens = buildAccentTokens("#3b82f6");
    expect(tokens["--app-border-strong"]).toBeUndefined();
    expect(tokens["--app-border-subtle"]).toBeUndefined();
    expect(tokens["--app-bg-accent"]).toBeUndefined();
  });

  it("picks a light ink for dark accents and a dark ink for bright accents", () => {
    // Deep blue → light ink
    expect(buildAccentTokens("#1d4ed8")["--app-accent-ink"]).toBe("#fdfcfa");
    // Bright yellow → dark ink
    expect(buildAccentTokens("#eab308")["--app-accent-ink"]).toBe("#181511");
  });

  it("returns an empty object for an invalid hex", () => {
    expect(buildAccentTokens("not-a-color")).toEqual({});
  });
});
