import type { RootState } from "../../../store/store";
import { initialDashboardTabsState } from "./dashboardTabsSlice";
import {
  selectTabHasChanged,
  tabAccessibleName,
  TAB_CHANGED_SUFFIX,
} from "./dashboardTabsSelectors";
import type { DashboardChange } from "./tabTypes";

function stateWith(
  tab: { lastViewedAt: string | null; ownWriteAt: string | null },
  signal: Partial<DashboardChange> | undefined,
  activeId: string | null = "other",
): RootState {
  return {
    dashboardTabs: {
      ...initialDashboardTabsState,
      tabs: [
        { id: "d1", ...tab },
        { id: "other", lastViewedAt: null, ownWriteAt: null },
      ],
      activeId,
      changeSignals: signal
        ? {
            d1: {
              dashboardId: "d1",
              contentUpdatedAt: null,
              dataUpdatedAt: null,
              outputs: [],
              ...signal,
            },
          }
        : {},
    },
  } as unknown as RootState;
}

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:01:00.000Z";
const T2 = "2026-01-01T00:02:00.000Z";

describe("selectTabHasChanged (design D7 dot rule)", () => {
  it("marks an inactive tab whose content changed after the last view", () => {
    expect(
      selectTabHasChanged(
        stateWith({ lastViewedAt: T0, ownWriteAt: null }, { contentUpdatedAt: T1 }),
        "d1",
      ),
    ).toBe(true);
  });

  it("marks an inactive tab with new pipeline data after the last view", () => {
    expect(
      selectTabHasChanged(
        stateWith({ lastViewedAt: T0, ownWriteAt: null }, { dataUpdatedAt: T1 }),
        "d1",
      ),
    ).toBe(true);
  });

  it("does not mark when nothing is newer than the last view", () => {
    expect(
      selectTabHasChanged(
        stateWith(
          { lastViewedAt: T1, ownWriteAt: null },
          { contentUpdatedAt: T0, dataUpdatedAt: T0 },
        ),
        "d1",
      ),
    ).toBe(false);
  });

  it("own edits do not mark: content at or before ownWriteAt is the user's own", () => {
    expect(
      selectTabHasChanged(
        stateWith({ lastViewedAt: T0, ownWriteAt: T1 }, { contentUpdatedAt: T1 }),
        "d1",
      ),
    ).toBe(false);
  });

  it("own edits never hide new DATA: a run after the last view still marks", () => {
    expect(
      selectTabHasChanged(
        stateWith(
          { lastViewedAt: T0, ownWriteAt: T2 },
          { contentUpdatedAt: T1, dataUpdatedAt: T1 },
        ),
        "d1",
      ),
    ).toBe(true);
  });

  it("a collaborator's edit after the own write still marks", () => {
    expect(
      selectTabHasChanged(
        stateWith({ lastViewedAt: T0, ownWriteAt: T1 }, { contentUpdatedAt: T2 }),
        "d1",
      ),
    ).toBe(true);
  });

  it("the active tab is never marked (activation clears the dot)", () => {
    expect(
      selectTabHasChanged(
        stateWith({ lastViewedAt: T0, ownWriteAt: null }, { contentUpdatedAt: T2 }, "d1"),
        "d1",
      ),
    ).toBe(false);
  });

  it("a never-viewed tab and a tab without signals are never marked", () => {
    expect(
      selectTabHasChanged(
        stateWith({ lastViewedAt: null, ownWriteAt: null }, { contentUpdatedAt: T2 }),
        "d1",
      ),
    ).toBe(false);
    expect(
      selectTabHasChanged(stateWith({ lastViewedAt: T0, ownWriteAt: null }, undefined), "d1"),
    ).toBe(false);
  });

  it("adds the accessible-name suffix only for a changed tab", () => {
    expect(tabAccessibleName("Sales", true)).toBe(`Sales${TAB_CHANGED_SUFFIX}`);
    expect(tabAccessibleName("Sales", false)).toBe("Sales");
  });
});
