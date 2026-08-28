import { fireEvent, screen, waitFor } from "@testing-library/react";

import { getDashboardBgContrastRatio } from "../../../theme/appearance";
import { DASHBOARD_APPEARANCE_PRESETS } from "../../../theme/theme";
import { renderWithStore } from "../../../test/renderWithStore";
import { updateDashboardAppearance as updateDashboardAppearanceRequest } from "../services/dashboardService";
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
const updateDashboardAppearanceMock = jest.mocked(updateDashboardAppearanceRequest);

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

  // HEL-718: the trigger migrated from a hand-rolled `cmd-btn cmd-btn--icon`
  // button onto the shared IconButton primitive, which now forwards `ref` to
  // the underlying <button> for usePortalPopover's getBoundingClientRect()
  // positioning — verifies both the tooltip pairing and that the popover
  // still opens (i.e. the ref forwarding actually works end to end).
  it("the trigger has a visible title tooltip and opens the popover on click", () => {
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);

    const trigger = screen.getByRole("button", { name: "Customize dashboard appearance" });
    expect(trigger).toHaveAttribute("title", "Customize dashboard appearance");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Dashboard background color")).toBeInTheDocument();
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

  it("does not show the contrast warning when the dashboard background is transparent", () => {
    // getDashboardBgContrastRatio returns null for transparent backgrounds —
    // simulated here via the mock (default beforeEach sets null).
    renderWithStore(<DashboardAppearanceEditor dashboard={transparentDashboard} />);
    openEditor();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the preset group with at least 6 preset buttons", () => {
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    const group = screen.getByRole("group", { name: "Dashboard appearance presets" });
    const buttons = group.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThanOrEqual(6);
  });

  it("reverts an unsaved preset pick when the popover is dismissed without saving", () => {
    renderWithStore(<DashboardAppearanceEditor dashboard={solidDashboard} />);
    openEditor();

    const preset = DASHBOARD_APPEARANCE_PRESETS[2];
    fireEvent.click(screen.getByRole("button", { name: preset.label }));
    expect(screen.getByLabelText("Dashboard background color")).toHaveValue(preset.background);

    // Dismiss without saving (Escape — usePortalPopover's document-level
    // keydown handler closes it) rather than clicking "Save dashboard style".
    fireEvent.keyDown(document, { key: "Escape" });

    // Reopen: the draft must have reverted to the dashboard's actually-saved
    // appearance, not the abandoned preset pick.
    openEditor();
    expect(screen.getByLabelText("Dashboard background color")).toHaveValue(
      solidDashboard.appearance.background,
    );
    expect(screen.getByLabelText("Dashboard grid background color")).toHaveValue(
      solidDashboard.appearance.gridBackground,
    );
    expect(screen.getByRole("button", { name: preset.label })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("offers a Default preset that resets appearance back to transparent and persists it on save", async () => {
    const presetDashboard: Dashboard = {
      ...solidDashboard,
      appearance: {
        background: DASHBOARD_APPEARANCE_PRESETS[0].background,
        gridBackground: DASHBOARD_APPEARANCE_PRESETS[0].gridBackground,
      },
    };
    renderWithStore(<DashboardAppearanceEditor dashboard={presetDashboard} />);
    openEditor();

    const defaultPreset = screen.getByRole("button", { name: "Default" });
    // Default renders first, ahead of the 12 color presets.
    expect(
      screen.getByRole("group", { name: "Dashboard appearance presets" }).firstElementChild,
    ).toBe(defaultPreset);

    fireEvent.click(defaultPreset);
    expect(defaultPreset).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Save dashboard style" }));

    await waitFor(() =>
      expect(updateDashboardAppearanceMock).toHaveBeenCalledWith(presetDashboard.id, {
        background: "transparent",
        gridBackground: "transparent",
      }),
    );
  });
});
