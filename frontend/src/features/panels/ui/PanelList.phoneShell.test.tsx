import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { resetDashboardChipOrderForTests } from "../../dashboards/ui/DashboardChipRow";
import { defaultDashboardLayout } from "../../dashboards/state/dashboardLayout";
import { useDashboardMeta } from "../hooks/useDashboardMeta";
import type { DashboardMeta } from "../state/dashboardMeta";
import { PanelList } from "./PanelList";

// HEL-1583 D2/D3 — the phone shell (<= 768px) mounts the chip row and renders no zoom widget; the saved zoom level
// is ignored there and untouched.
jest.mock("./grid/PanelGrid", () => ({ PanelGrid: () => <div data-testid="grid" /> }));
// The hook's own network behaviour is covered by `useDashboardMeta.test.tsx`; here it returns facts.
jest.mock("../hooks/useDashboardMeta", () => ({ useDashboardMeta: jest.fn() }));
const metaMock = jest.mocked(useDashboardMeta);
const unknownMeta: DashboardMeta = {
  panelCount: 1,
  refreshState: "unknown",
  refreshedAt: null,
  refreshIntent: null,
  sources: [],
  moreSources: 0,
};
jest.mock("../services/panelService", () => ({
  createPanel: jest.fn(),
  fetchPanels: jest.fn(),
  updatePanelAppearance: jest.fn(),
}));
jest.mock("../../auth/services/authService", () => ({
  updateUserPreferencesRequest: jest.fn().mockResolvedValue({ accentColor: null, zoomLevels: {} }),
}));

const meta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

const state = {
  dashboards: {
    items: [
      { id: "d1", name: "Ops", meta, layout: defaultDashboardLayout },
      { id: "d2", name: "Sales", meta, layout: defaultDashboardLayout },
    ],
    selectedDashboardId: "d1",
    status: "succeeded" as const,
  },
  panels: {
    items: [
      {
        id: "p1",
        dashboardId: "d1",
        title: "Revenue",
        type: "output" as const,
        config: { outputId: "" },
      },
    ],
    loadedDashboardId: "d1",
    status: "succeeded" as const,
  },
  auth: {
    status: "authenticated" as const,
    currentUser: {
      id: "user-1",
      email: "test@example.com",
      displayName: "Test User",
      avatarUrl: null,
      tier: "free" as const,
      createdAt: "2026-01-01T00:00:00Z",
      preferences: { accentColor: null, zoomLevels: { d1: 0.5 } },
    },
  },
};

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(query)?.[1]);
    return {
      matches: width <= max,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  resetDashboardChipOrderForTests();
  metaMock.mockReturnValue(unknownMeta);
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("PanelList on the phone shell", () => {
  it.each([375, 600, 768])("renders the chip row and no zoom widget at %ipx", (width) => {
    setViewport(width);
    renderWithStore(<PanelList />, state);
    expect(screen.getByRole("group", { name: "Dashboards" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Zoom controls" })).toBeNull();
    expect(document.querySelector(".panel-list__zoom-widget")).toBeNull();
  });

  it("is the first child of .panel-list, outside the zoom container", () => {
    setViewport(375);
    renderWithStore(<PanelList />, state);
    const row = document.querySelector(".dashboard-chip-row")!;
    expect(row.parentElement).toHaveClass("panel-list");
    expect(row.parentElement!.firstElementChild).toBe(row);
    expect(row.closest(".panel-list__zoom-container")).toBeNull();
  });

  it("puts the refreshed line first in .panel-list, directly above the chip row (HEL-1583 D11)", () => {
    metaMock.mockReturnValue({ ...unknownMeta, refreshState: "never" });
    setViewport(375);
    renderWithStore(<PanelList />, state);
    const line = document.querySelector(".dashboard-refresh-line")!;
    const row = document.querySelector(".dashboard-chip-row")!;
    expect(line.parentElement).toHaveClass("panel-list");
    expect(line.parentElement!.firstElementChild).toBe(line);
    expect(line.nextElementSibling).toBe(row);
    expect(line).toHaveTextContent("not refreshed yet");
  });

  it("renders no refreshed line above 768px (the meta row carries it there)", () => {
    metaMock.mockReturnValue({ ...unknownMeta, refreshState: "never" });
    setViewport(769);
    renderWithStore(<PanelList />, state);
    expect(document.querySelector(".dashboard-refresh-line")).toBeNull();
  });

  it("ignores a saved 50% zoom (effective 1.0) without writing or clearing it", () => {
    setViewport(375);
    const { store } = renderWithStore(<PanelList />, state);
    const zoomContainer = document.querySelector<HTMLElement>(".panel-list__zoom-container")!;
    expect(zoomContainer.style.transform).toBe("scale(1)");
    expect(store.getState().auth.currentUser?.preferences?.zoomLevels).toEqual({ d1: 0.5 });
  });

  it("the ctrl+wheel zoom gesture is inert", () => {
    setViewport(375);
    const { store } = renderWithStore(<PanelList />, state);
    const zoomContainer = document.querySelector<HTMLElement>(".panel-list__zoom-container")!;
    fireEvent.wheel(zoomContainer, { deltaY: -100, ctrlKey: true, deltaMode: 0 });
    expect(zoomContainer.style.transform).toBe("scale(1)");
    expect(store.getState().auth.currentUser?.preferences?.zoomLevels).toEqual({ d1: 0.5 });
  });

  it("above 768px keeps the zoom widget, the saved level and no chip row", () => {
    setViewport(769);
    renderWithStore(<PanelList />, state);
    expect(screen.queryByRole("group", { name: "Dashboards" })).toBeNull();
    expect(screen.getByRole("group", { name: "Zoom controls" })).toBeInTheDocument();
    expect(
      document.querySelector<HTMLElement>(".panel-list__zoom-container")!.style.transform,
    ).toBe("scale(0.5)");
  });
});
