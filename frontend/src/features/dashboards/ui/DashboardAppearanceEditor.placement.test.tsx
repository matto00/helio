import { act, fireEvent, screen, waitFor } from "@testing-library/react";

import { getDashboardBgContrastRatio } from "../../../theme/appearance";
import { renderWithStore } from "../../../test/renderWithStore";
import { updateDashboardAppearance as updateDashboardAppearanceRequest } from "../services/dashboardService";
import type { Dashboard } from "../types/dashboard";
import { DashboardAppearanceEditor } from "./DashboardAppearanceEditor";

jest.mock("../../../theme/appearance", () => {
  const actual = jest.requireActual<typeof import("../../../theme/appearance")>(
    "../../../theme/appearance",
  );
  return { ...actual, getDashboardBgContrastRatio: jest.fn() };
});
jest.mock("../services/dashboardService", () => ({
  fetchDashboards: jest.fn(),
  createDashboard: jest.fn(),
  updateDashboardAppearance: jest.fn(),
  updateDashboardLayout: jest.fn().mockResolvedValue({}),
  duplicateDashboard: jest.fn(),
  exportDashboard: jest.fn(),
  importDashboard: jest.fn(),
}));

const contrastRatioMock = jest.mocked(getDashboardBgContrastRatio);
const updateMock = jest.mocked(updateDashboardAppearanceRequest);

const dashboard: Dashboard = {
  id: "d1",
  name: "Test Dashboard",
  meta: {
    createdBy: "system",
    createdAt: "2026-01-01T00:00:00Z",
    lastUpdated: "2026-01-01T00:00:00Z",
  },
  appearance: { background: "#1a2035", gridBackground: "#1c2e4a" },
  layout: { lg: [], md: [], sm: [], xs: [] },
};

// HEL-1756: the editor measures itself once mounted and fits the viewport. jsdom has no layout, so the geometry the
// placement reads (trigger rect, form height and width, window size) is mocked; the real proof is the HEL-1756 e2e.
const realRect = HTMLElement.prototype.getBoundingClientRect;
const originalInnerHeight = window.innerHeight;
const originalInnerWidth = window.innerWidth;

interface Layout {
  trigger: { top: number; bottom: number; left: number; right: number };
  /** Natural height by content state. */
  heights: { plain: number; warning: number; error: number };
  panelWidth: number;
  innerHeight: number;
  innerWidth: number;
}

function mockLayout(layout: Layout, onMeasure?: (visibility: string) => void) {
  window.innerHeight = layout.innerHeight;
  window.innerWidth = layout.innerWidth;
  jest.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains("dashboard-appearance-editor__panel")) return 0;
    onMeasure?.(this.style.visibility);
    if (this.querySelector(".inline-error")) return layout.heights.error;
    if (this.querySelector(".dashboard-appearance-editor__contrast-warning"))
      return layout.heights.warning;
    return layout.heights.plain;
  });
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.getAttribute("aria-label") === "Customize dashboard appearance") {
      const { top, bottom, left, right } = layout.trigger;
      return { top, bottom, left, right, width: right - left, height: bottom - top } as DOMRect;
    }
    if (this.classList.contains("dashboard-appearance-editor__panel")) {
      const left = layout.innerWidth - (parseFloat(this.style.right) || 0) - layout.panelWidth;
      return {
        top: 0,
        bottom: 0,
        left,
        right: left + layout.panelWidth,
        width: layout.panelWidth,
        height: 0,
      } as DOMRect;
    }
    return realRect.call(this);
  });
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe = jest.fn();
  disconnect = jest.fn();
}

const flat = (h: number) => ({ plain: h, warning: h, error: h });
const base: Layout = {
  trigger: { top: 4, bottom: 28, left: 1000, right: 1024 },
  heights: flat(288),
  panelWidth: 360,
  innerHeight: 900,
  innerWidth: 1280,
};

const form = () => document.querySelector<HTMLElement>("form.dashboard-appearance-editor__panel")!;

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Customize dashboard appearance" }));
}

beforeEach(() => {
  contrastRatioMock.mockReturnValue(null);
  updateMock.mockReset().mockResolvedValue(dashboard);
  FakeResizeObserver.instances = [];
});

afterEach(() => {
  jest.restoreAllMocks();
  window.innerHeight = originalInnerHeight;
  window.innerWidth = originalInnerWidth;
  // @ts-expect-error -- restoring the jsdom default (no ResizeObserver)
  delete window.ResizeObserver;
});

describe("DashboardAppearanceEditor viewport fit (HEL-1756)", () => {
  it("opens below the trigger when it fits", () => {
    mockLayout(base);
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    expect(form().style.top).toBe("36px");
    expect(form().style.bottom).toBe("");
    expect(form().style.maxHeight).toBe("288px");
  });

  it("flips above the trigger when it does not fit below and above has more room", () => {
    mockLayout({
      ...base,
      innerHeight: 400,
      trigger: { top: 331, bottom: 355, left: 1000, right: 1024 },
    });
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    // above room 331 - 16 = 315 beats below room 400 - 363 - 8 = 29.
    expect(form().style.bottom).toBe("77px");
    expect(form().style.top).toBe("");
    expect(form().style.maxHeight).toBe("288px");
  });

  it("caps its height to the roomier side when neither side holds it", () => {
    mockLayout({
      ...base,
      innerHeight: 200,
      trigger: { top: 60, bottom: 84, left: 1000, right: 1024 },
    });
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    // below room 200 - 92 - 8 = 100 beats above room 60 - 16 = 44: stays below, capped.
    expect(form().style.top).toBe("92px");
    expect(form().style.maxHeight).toBe("100px");
  });

  it("keeps an 8px margin from the left edge when the trigger is near it", () => {
    mockLayout({
      ...base,
      innerWidth: 390,
      trigger: { top: 4, bottom: 28, left: 70, right: 100 },
    });
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    // right edge at 100 would put a 360px panel at -260; clamped to left = 8 => right = 390 - 360 - 8 = 22.
    expect(form().style.right).toBe("22px");
  });

  it("without layout (jsdom) keeps the preferred side, uncapped", () => {
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    expect(form().style.maxHeight).toBe("");
    expect(form().style.bottom).toBe("");
  });

  it("is visibility: hidden when first measured, and visible once placed", () => {
    const seen: string[] = [];
    mockLayout(base, (v) => seen.push(v));
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    expect(seen[0]).toBe("hidden");
    expect(form().style.visibility).toBe("");
  });

  it("moves focus to the selected preset only once placed (a hidden element cannot take focus)", () => {
    mockLayout(base);
    const seen: { label: string | null; visibility: string }[] = [];
    const realFocus = HTMLElement.prototype.focus;
    jest.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      const f = this.closest<HTMLElement>("form.dashboard-appearance-editor__panel");
      if (f) seen.push({ label: this.getAttribute("aria-label"), visibility: f.style.visibility });
      realFocus.call(this);
    });
    // The dashboard's saved appearance equals the "Twilight" preset, which is therefore the selected one.
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x.visibility !== "hidden")).toBe(true);
    expect(seen[0].label).toBe("Twilight");
    expect(form().contains(document.activeElement)).toBe(true);
  });

  it("stays open while focus moves between its own controls", () => {
    mockLayout(base);
    renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
    open();
    act(() => screen.getByLabelText("Dashboard background color").focus());
    act(() => screen.getByLabelText("Dashboard grid background color").focus());
    act(() => screen.getByRole("button", { name: "Save dashboard style" }).focus());
    expect(form()).toBeInTheDocument();
  });

  describe("re-fit when its content grows", () => {
    beforeEach(() => {
      window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
    });

    const grow: Layout = { ...base, heights: { plain: 288, warning: 340, error: 360 } };

    it("the contrast warning appearing re-fits the form (observed inner wrapper, no window resize)", () => {
      mockLayout(grow);
      const resizeSpy = jest.fn();
      window.addEventListener("resize", resizeSpy);
      renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
      open();
      expect(form().style.maxHeight).toBe("288px");
      const observer = FakeResizeObserver.instances.at(-1)!;
      expect(observer.observe).toHaveBeenCalledWith(form().firstElementChild);

      contrastRatioMock.mockReturnValue(2);
      fireEvent.click(screen.getByRole("button", { name: "Forest" }));
      expect(screen.getByRole("alert")).toBeInTheDocument();
      act(() => observer.callback());
      expect(form().style.maxHeight).toBe("340px");
      expect(resizeSpy).not.toHaveBeenCalled();
      window.removeEventListener("resize", resizeSpy);
    });

    it("a save error appearing re-fits the form", async () => {
      mockLayout(grow);
      updateMock.mockReset().mockRejectedValue(new Error("boom"));
      renderWithStore(<DashboardAppearanceEditor dashboard={dashboard} />);
      open();
      const observer = FakeResizeObserver.instances.at(-1)!;
      fireEvent.click(screen.getByRole("button", { name: "Save dashboard style" }));
      await waitFor(() =>
        expect(screen.getByText("Failed to save dashboard appearance.")).toBeInTheDocument(),
      );
      act(() => observer.callback());
      expect(form().style.maxHeight).toBe("360px");
    });
  });
});
