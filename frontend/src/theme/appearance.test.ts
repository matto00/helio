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
    expect(resolvePanelTextColor("light", "#f3f4f6", 0, "#f8fafc")).toBe("#0f172a");
  });

  // Task 3.1 — lock the panel alpha floor (transparency=0 → 0.9) and
  // ceiling (transparency=1 → ~0.18) so the formula doesn't drift silently.
  it("panel surface alpha is 0.9 at transparency=0 and ~0.18 at transparency=1.0", () => {
    // Dark panelSurface base: #0f172a = rgb(15, 23, 42). No background override
    // so the blend returns the base unchanged.
    expect(buildPanelSurface("dark", "transparent", 0)).toBe("rgba(15, 23, 42, 0.9)");
    // 0.9 - 1.0 * 0.72 has a floating-point representation of ~0.18000000000000005;
    // toContain matches the leading "0.18" prefix while tolerating JS float noise.
    expect(buildPanelSurface("dark", "transparent", 1)).toContain("rgba(15, 23, 42, 0.18");
  });

  // Task 3.2 — lock resolveDashboardGridBackground alpha constants for a known
  // background hex so tuned values (0.94 dark / 0.97 light) don't drift silently.
  //
  // Blend math for gridBackground "#16233a" (r=22, g=35, b=58) at tintStrength=0.28:
  //   dark base #121b31  (r=18, g=27, b=49) → blended r=19, g=29, b=52
  //   light base #ffffff (r=255, g=255, b=255) → blended r=190, g=193, b=200
  it("resolveDashboardGridBackground produces locked rgba values for #16233a", () => {
    const appearance = { ...defaultDashboardAppearance, gridBackground: "#16233a" };
    expect(resolveDashboardGridBackground("dark", appearance)).toBe("rgba(19, 29, 52, 0.94)");
    expect(resolveDashboardGridBackground("light", appearance)).toBe("rgba(190, 193, 200, 0.97)");
  });
});

describe("buildAccentTokens", () => {
  it("returns all 9 CSS variable entries for a valid hex color", () => {
    const tokens = buildAccentTokens("#f97316");
    expect(Object.keys(tokens)).toHaveLength(9);
    expect(tokens["--app-accent"]).toBe("#f97316");
    expect(tokens["--app-accent-surface"]).toContain("rgba(");
    expect(tokens["--app-accent-dim"]).toContain("rgba(");
    expect(tokens["--app-accent-mid"]).toContain("rgba(");
    expect(tokens["--app-bg-accent"]).toContain("rgba(");
    expect(tokens["--app-bg-secondary"]).toContain("rgba(");
    expect(tokens["--app-accent-strong"]).toContain("rgba(");
    expect(tokens["--app-border-strong"]).toContain("rgba(");
    expect(tokens["--app-border-subtle"]).toContain("rgba(");
  });

  it("produces correct rgba values for #f97316 (orange)", () => {
    const tokens = buildAccentTokens("#f97316");
    // r=249, g=115, b=22
    expect(tokens["--app-accent-surface"]).toBe("rgba(249, 115, 22, 0.12)");
    expect(tokens["--app-accent-dim"]).toBe("rgba(249, 115, 22, 0.12)");
    expect(tokens["--app-accent-mid"]).toBe("rgba(249, 115, 22, 0.25)");
    expect(tokens["--app-bg-accent"]).toBe("rgba(249, 115, 22, 0.06)");
    expect(tokens["--app-bg-secondary"]).toBe("rgba(249, 115, 22, 0.03)");
    expect(tokens["--app-border-strong"]).toBe("rgba(249, 115, 22, 0.3)");
    expect(tokens["--app-border-subtle"]).toBe("rgba(249, 115, 22, 0.1)");
  });

  it("returns an empty object for an invalid hex", () => {
    expect(buildAccentTokens("not-a-color")).toEqual({});
  });
});
