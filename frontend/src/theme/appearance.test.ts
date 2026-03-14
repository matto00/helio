import {
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
