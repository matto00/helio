import { fireEvent, screen } from "@testing-library/react";

import { getDashboardBgContrastRatio } from "../../../theme/appearance";
import { DASHBOARD_APPEARANCE_PRESETS } from "../../../theme/theme";
import { renderWithStore } from "../../../test/renderWithStore";
import type { Dashboard } from "../types/dashboard";
import { DashboardAppearanceEditor } from "./DashboardAppearanceEditor";

// Mock getDashboardBgContrastRatio so each test can control the contrast
// scenario independently of the blending math.
jest.mock("../../../theme/appearance", () => {
  const actual = jest.requireActual<typeof import("../../../theme/appearance")>(
    "../../../theme/appearance",
  );
  return { ...actual, getDashboardBgContrastRatio: jest.fn() };
});

jest.mock("../services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  createDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn().mockResolvedValue({}),
  updateDashboardLayout: jest.fn().mockResolvedValue({}),
  duplicateDashboard: jest.fn(),
  exportDashboard: jest.fn(),
  importDashboard: jest.fn(),
}));

const contrastRatioMock = jest.mocked(getDashboardBgContrastRatio);

const baseMeta = {
  createdBy: "system",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};

const solidDashboard: Dashboard = {
  id: "d1",
  name: "Test Dashboard",
  meta: baseMeta,
  appearance: { background: "#1a2035", gridBackground: "#1c2e4a" },
  layout: { lg: [], md: [], sm: [], xs: [] },
};

const transparentDashboard: Dashboard = {
  ...solidDashboard,
  appearance: { background: "transparent", gridBackground: "transparent" },
};

function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Customize dashboard appearance" }));
}

describe("DashboardAppearanceEditor", () => {
  beforeEach(() => {
    // Default: no contrast warning (good contrast or transparent)
    contrastRatioMock.mockReturnValue(null);
  });

  // ── 3.2a: Preset strip — clicking a preset applies its bg + gridBg values ────
  it("clicking a preset applies its background and gridBackground to the color pickers", () => {
    const preset = DASHBOARD_APPEARANCE_PRESETS[0];
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    fireEvent.click(screen.getByRole("button", { name: preset.label }));

    expect(screen.getByLabelText("Dashboard background color")).toHaveValue(preset.background);
    expect(screen.getByLabelText("Dashboard grid background color")).toHaveValue(
      preset.gridBackground,
    );
  });

  it("clicking a preset marks it as selected (aria-pressed=true)", () => {
    const preset = DASHBOARD_APPEARANCE_PRESETS[1];
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    const presetButton = screen.getByRole("button", { name: preset.label });
    expect(presetButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(presetButton);
    expect(presetButton).toHaveAttribute("aria-pressed", "true");
  });

  // ── 3.2b: Contrast warning — shown for known low-contrast input ───────────────
  it("shows the contrast warning when getDashboardBgContrastRatio returns a value below 4.5", () => {
    contrastRatioMock.mockReturnValue(2.1);
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent(/low contrast/i);
  });

  it("does not show the contrast warning when getDashboardBgContrastRatio returns a value >= 4.5", () => {
    contrastRatioMock.mockReturnValue(7.3);
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── 3.2c: No contrast warning when background is transparent ──────────────────
  it("does not show the contrast warning when the dashboard background is transparent", () => {
    // getDashboardBgContrastRatio returns null for transparent backgrounds —
    // simulated here via the mock (default beforeEach sets null).
    renderWithStore(<DashboardAppearanceEditor dashboard={transparentDashboard} />);
    openEditor();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // ── Preset strip presence ─────────────────────────────────────────────────────
  it("renders the preset group with at least 6 preset buttons", () => {
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    const group = screen.getByRole("group", { name: "Dashboard appearance presets" });
    const buttons = group.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(6);
  });
});
