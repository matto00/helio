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
});

describe("buildAccentTokens", () => {
  it("returns all 6 CSS variable entries for a valid hex color", () => {
    const tokens = buildAccentTokens("#f97316");
    expect(Object.keys(tokens)).toHaveLength(6);
    expect(tokens["--app-accent"]).toBe("#f97316");
    expect(tokens["--app-accent-surface"]).toContain("rgba(");
    expect(tokens["--app-accent-dim"]).toContain("rgba(");
    expect(tokens["--app-accent-mid"]).toContain("rgba(");
    expect(tokens["--app-bg-accent"]).toContain("rgba(");
    expect(tokens["--app-accent-strong"]).toContain("rgba(");
  });

  it("produces correct rgba values for #f97316 (orange)", () => {
    const tokens = buildAccentTokens("#f97316");
    // r=249, g=115, b=22
    expect(tokens["--app-accent-surface"]).toBe("rgba(249, 115, 22, 0.12)");
    expect(tokens["--app-accent-dim"]).toBe("rgba(249, 115, 22, 0.12)");
    expect(tokens["--app-accent-mid"]).toBe("rgba(249, 115, 22, 0.25)");
    expect(tokens["--app-bg-accent"]).toBe("rgba(249, 115, 22, 0.06)");
  });

  it("returns an empty object for an invalid hex", () => {
    expect(buildAccentTokens("not-a-color")).toEqual({});
  });
});
