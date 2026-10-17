import { act, fireEvent, screen } from "@testing-library/react";
import { useLocation } from "react-router-dom";

import { renderWithStore } from "../../../test/renderWithStore";
import { RECENT_HISTORY_STORAGE_KEY } from "../../commandPalette/model/recentHistoryStore";
import { setSelectedDashboardId } from "../state/dashboardsSlice";
import {
  DASHBOARD_CHIP_CAP,
  DashboardChipRow,
  resetDashboardChipOrderForTests,
} from "./DashboardChipRow";

function LocationProbe() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function dashboards(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `d${i + 1}`, name: `Board ${i + 1}` }));
}

function renderRow(count: number, selected: string | null, path = "/") {
  return renderWithStore(
    <>
      <DashboardChipRow />
      <LocationProbe />
    </>,
    {
      dashboards: { items: dashboards(count), selectedDashboardId: selected, status: "succeeded" },
    },
    path,
  );
}

function chipNames(): string[] {
  return screen
    .getAllByRole("button")
    .filter((el) => el.hasAttribute("data-dashboard-id"))
    .map((el) => el.getAttribute("aria-label") ?? "");
}

beforeEach(() => {
  resetDashboardChipOrderForTests();
  window.localStorage.clear();
});

describe("DashboardChipRow", () => {
  it("renders nothing when the user has no dashboards", () => {
    const { container } = renderRow(0, null);
    expect(container.querySelector(".dashboard-chip-row")).toBeNull();
  });

  it("orders recent dashboards first (most recent first), then list order", () => {
    window.localStorage.setItem(
      RECENT_HISTORY_STORAGE_KEY,
      JSON.stringify([
        { kind: "dashboard", id: "d3", visitedAt: 3 },
        { kind: "source", id: "d2", visitedAt: 2 },
        { kind: "dashboard", id: "gone", visitedAt: 1 },
      ]),
    );
    renderRow(4, "d1");
    expect(chipNames()).toEqual(["Board 3", "Board 1", "Board 2", "Board 4"]);
  });

  it("caps at 12 chips and gives a current dashboard outside the cap the last slot", () => {
    renderRow(15, "d14");
    const names = chipNames();
    expect(names).toHaveLength(DASHBOARD_CHIP_CAP);
    expect(names.slice(0, 11)).toEqual(dashboards(11).map((d) => d.name));
    expect(names[11]).toBe("Board 14");
  });

  it("keeps the session order across a tap and a remount, and appends new dashboards", () => {
    window.localStorage.setItem(
      RECENT_HISTORY_STORAGE_KEY,
      JSON.stringify([{ kind: "dashboard", id: "d3", visitedAt: 3 }]),
    );
    const first = renderRow(3, "d1");
    const before = chipNames();
    fireEvent.click(screen.getByRole("button", { name: "Board 2" }));
    expect(chipNames()).toEqual(before);
    first.unmount();
    // A recents change after the first render must not reshuffle the remounted row.
    window.localStorage.setItem(
      RECENT_HISTORY_STORAGE_KEY,
      JSON.stringify([{ kind: "dashboard", id: "d2", visitedAt: 9 }]),
    );
    renderRow(4, "d2");
    expect(chipNames()).toEqual([...before, "Board 4"]);
  });

  it("marks exactly the current dashboard with aria-current and fills it", () => {
    renderRow(3, "d2");
    const current = screen
      .getAllByRole("button")
      .filter((el) => el.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("Board 2");
    expect(current[0]).toHaveClass("dashboard-chip--active");
  });

  it("renders no active chip when no dashboard is selected", () => {
    renderRow(3, null);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(document.querySelector("[aria-current]")).toBeNull();
  });

  it("a single tap selects the dashboard and navigates to /dashboards/<id>", () => {
    const { store } = renderRow(3, "d1", "/home");
    fireEvent.click(screen.getByRole("button", { name: "Board 3" }));
    expect(store.getState().dashboards.selectedDashboardId).toBe("d3");
    expect(screen.getByTestId("path")).toHaveTextContent("/dashboards/d3");
  });

  it("chip A -> sheet B -> chip A switches back in one tap (URL unchanged by the sheet)", () => {
    const { store } = renderRow(3, "d1", "/dashboards/d1");
    // The switcher sheet selects without changing the URL.
    act(() => {
      store.dispatch(setSelectedDashboardId("d2"));
    });
    expect(screen.getByRole("button", { name: "Board 2" })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Board 1" }));
    expect(store.getState().dashboards.selectedDashboardId).toBe("d1");
    expect(screen.getByRole("button", { name: "Board 1" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("path")).toHaveTextContent("/dashboards/d1");
  });

  it("sets the row's own scrollLeft so an off-screen active chip is visible", () => {
    const rects = new Map<string, { left: number; width: number }>();
    const rectSpy = jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const id = this.dataset.dashboardId;
        const r = id ? (rects.get(id) ?? { left: 0, width: 0 }) : { left: 0, width: 375 };
        return {
          left: r.left,
          right: r.left + r.width,
          width: r.width,
          top: 0,
          bottom: 0,
          height: 0,
          x: r.left,
          y: 0,
          toJSON: () => ({}),
        };
      });
    const widthSpy = jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(375);
    try {
      for (let i = 1; i <= 8; i += 1) rects.set(`d${i}`, { left: 12 + (i - 1) * 100, width: 90 });
      renderRow(8, "d8");
      const row = document.querySelector<HTMLElement>(".dashboard-chip-row")!;
      // 12 (padding) + 7 * 100 = 712 left, 802 right; visible 375 wide -> scrollLeft >= 802 - 375 (+ gutter 0 in jsdom).
      expect(row.scrollLeft).toBeGreaterThanOrEqual(802 - 375);
    } finally {
      rectSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });
});
