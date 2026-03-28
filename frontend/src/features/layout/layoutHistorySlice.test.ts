import type { DashboardLayout } from "../../types/models";
import {
  layoutHistoryReducer,
  pushLayoutSnapshot,
  redoLayout,
  selectCanRedo,
  selectCanUndo,
  selectRedoLayout,
  selectUndoLayout,
  undoLayout,
} from "./layoutHistorySlice";

function makeLayout(tag: string): DashboardLayout {
  return {
    lg: [{ panelId: tag, x: 0, y: 0, w: 2, h: 2 }],
    md: [],
    sm: [],
    xs: [],
  };
}

const layoutA = makeLayout("a");
const layoutB = makeLayout("b");
const layoutC = makeLayout("c");
const dashboardId = "dash-1";

describe("layoutHistorySlice", () => {
  describe("pushLayoutSnapshot", () => {
    it("adds a layout to the past stack", () => {
      const state = layoutHistoryReducer(
        undefined,
        pushLayoutSnapshot({ dashboardId, layout: layoutA }),
      );
      expect(state.byDashboard[dashboardId].past).toHaveLength(1);
      expect(state.byDashboard[dashboardId].past[0]).toEqual(layoutA);
    });

    it("clears the future stack on push", () => {
      let state = layoutHistoryReducer(
        undefined,
        pushLayoutSnapshot({ dashboardId, layout: layoutA }),
      );
      // Manually add something to future to simulate prior undo
      state = {
        ...state,
        byDashboard: {
          [dashboardId]: {
            past: [layoutA],
            future: [layoutB],
          },
        },
      };
      state = layoutHistoryReducer(state, pushLayoutSnapshot({ dashboardId, layout: layoutC }));
      expect(state.byDashboard[dashboardId].future).toHaveLength(0);
    });

    it("bounds the past stack at 50 entries", () => {
      let state = layoutHistoryReducer(undefined, { type: "@@INIT" });
      for (let i = 0; i < 55; i++) {
        state = layoutHistoryReducer(
          state,
          pushLayoutSnapshot({ dashboardId, layout: makeLayout(`step-${i}`) }),
        );
      }
      expect(state.byDashboard[dashboardId].past).toHaveLength(50);
      // The oldest entries should have been discarded
      expect(state.byDashboard[dashboardId].past[0].lg[0].panelId).toBe("step-5");
    });
  });

  describe("undoLayout", () => {
    it("pops from past and pushes currentLayout to future", () => {
      let state = layoutHistoryReducer(
        undefined,
        pushLayoutSnapshot({ dashboardId, layout: layoutA }),
      );
      state = layoutHistoryReducer(state, undoLayout({ dashboardId, currentLayout: layoutB }));
      expect(state.byDashboard[dashboardId].past).toHaveLength(0);
      expect(state.byDashboard[dashboardId].future).toHaveLength(1);
      expect(state.byDashboard[dashboardId].future[0]).toEqual(layoutB);
    });

    it("does nothing when past is empty", () => {
      const state = layoutHistoryReducer(
        undefined,
        undoLayout({ dashboardId, currentLayout: layoutA }),
      );
      expect(state.byDashboard[dashboardId]?.past ?? []).toHaveLength(0);
      expect(state.byDashboard[dashboardId]?.future ?? []).toHaveLength(0);
    });
  });

  describe("redoLayout", () => {
    it("pops from future and pushes currentLayout to past", () => {
      let state = layoutHistoryReducer(
        undefined,
        pushLayoutSnapshot({ dashboardId, layout: layoutA }),
      );
      state = layoutHistoryReducer(state, undoLayout({ dashboardId, currentLayout: layoutB }));
      state = layoutHistoryReducer(state, redoLayout({ dashboardId, currentLayout: layoutA }));
      expect(state.byDashboard[dashboardId].future).toHaveLength(0);
      expect(state.byDashboard[dashboardId].past).toHaveLength(1);
      expect(state.byDashboard[dashboardId].past[0]).toEqual(layoutA);
    });

    it("does nothing when future is empty", () => {
      const before = layoutHistoryReducer(
        undefined,
        pushLayoutSnapshot({ dashboardId, layout: layoutA }),
      );
      const after = layoutHistoryReducer(
        before,
        redoLayout({ dashboardId, currentLayout: layoutB }),
      );
      // Past should be unchanged
      expect(after.byDashboard[dashboardId].past).toHaveLength(1);
      expect(after.byDashboard[dashboardId].future).toHaveLength(0);
    });
  });

  describe("selectors", () => {
    function makeRootState(past: DashboardLayout[], future: DashboardLayout[]) {
      return {
        layoutHistory: {
          byDashboard: { [dashboardId]: { past, future } },
        },
      } as never;
    }

    it("selectCanUndo returns true when past is non-empty", () => {
      expect(selectCanUndo(dashboardId)(makeRootState([layoutA], []))).toBe(true);
    });

    it("selectCanUndo returns false when past is empty", () => {
      expect(selectCanUndo(dashboardId)(makeRootState([], []))).toBe(false);
    });

    it("selectCanUndo returns false for null dashboardId", () => {
      expect(selectCanUndo(null)(makeRootState([layoutA], []))).toBe(false);
    });

    it("selectCanRedo returns true when future is non-empty", () => {
      expect(selectCanRedo(dashboardId)(makeRootState([], [layoutA]))).toBe(true);
    });

    it("selectCanRedo returns false when future is empty", () => {
      expect(selectCanRedo(dashboardId)(makeRootState([], []))).toBe(false);
    });

    it("selectUndoLayout returns the top of the past stack", () => {
      expect(selectUndoLayout(dashboardId)(makeRootState([layoutA, layoutB], []))).toEqual(layoutB);
    });

    it("selectUndoLayout returns undefined when past is empty", () => {
      expect(selectUndoLayout(dashboardId)(makeRootState([], []))).toBeUndefined();
    });

    it("selectRedoLayout returns the top of the future stack", () => {
      expect(selectRedoLayout(dashboardId)(makeRootState([], [layoutA, layoutB]))).toEqual(layoutA);
    });

    it("selectRedoLayout returns undefined when future is empty", () => {
      expect(selectRedoLayout(dashboardId)(makeRootState([], []))).toBeUndefined();
    });
  });
});
