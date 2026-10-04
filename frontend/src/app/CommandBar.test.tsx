import { configureStore } from "@reduxjs/toolkit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import { authReducer } from "../features/auth/state/authSlice";
import { dashboardsReducer, fetchDashboards } from "../features/dashboards/state/dashboardsSlice";
import {
  layoutHistoryReducer,
  pushLayoutSnapshot,
} from "../features/layout/state/layoutHistorySlice";
import type { DashboardLayout } from "../features/dashboards/types/dashboard";
import { panelsReducer } from "../features/panels/state/panelsSlice";
import { pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../features/sources/state/sourcesSlice";
import { ThemeProvider } from "../theme/ThemeProvider";
import { CommandBar } from "./CommandBar";

// HEL-746 — the phone-only "New chat" affordance mirrors the desktop
// sidebar's `SidebarItemList` trigger (`onAdd={() => dispatch
// (startNewConversation())}`, `addLabel="New chat"`), but CommandBar has no
// phone-width-reachable equivalent before this change. jsdom evaluates no
// real CSS/media queries, so this only exercises the React-conditional half
// (`pickerId === "chat"` gating + the dispatch) — the phone-width-only CSS
// half is covered by the static source assertion in `App.css.test.ts`.
function makeStore() {
  return configureStore({
    reducer: {
      dashboards: dashboardsReducer,
      auth: authReducer,
      layoutHistory: layoutHistoryReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      panels: panelsReducer,
      assistantConversations: assistantConversationsReducer,
    },
  });
}

function renderCommandBar(initialPath: string, store = makeStore()) {
  return {
    store,
    ...render(
      <Provider store={store}>
        <ThemeProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <CommandBar
              isMobileNavSheetOpen={false}
              onOpenMobileNavSheet={jest.fn()}
              onOpenRefinement={jest.fn()}
              onOpenQuickLauncher={jest.fn()}
              draftAppearance={null}
              setDraftAppearance={jest.fn()}
            />
          </MemoryRouter>
        </ThemeProvider>
      </Provider>,
    ),
  };
}

describe("CommandBar — HEL-746 mobile 'New chat' affordance", () => {
  it('renders the New chat control on /chat (pickerId === "chat")', () => {
    renderCommandBar("/chat");
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  it("does not render the New chat control on a non-chat route (e.g. the dashboard)", () => {
    renderCommandBar("/");
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
  });

  it("does not render the New chat control on another picker route (e.g. /pipelines)", () => {
    renderCommandBar("/pipelines");
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
  });

  it("dispatches startNewConversation() when clicked, mirroring the desktop sidebar trigger", () => {
    const { store } = renderCommandBar("/chat");
    expect(store.getState().assistantConversations.startingNewConversation).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(store.getState().assistantConversations.startingNewConversation).toBe(true);
  });

  it("gives the control a visible title tooltip matching its aria-label (DESIGN.md §5 icon-button convention)", () => {
    renderCommandBar("/chat");
    expect(screen.getByRole("button", { name: "New chat" })).toHaveAttribute("title", "New chat");
  });
});

// HEL-1230 — the toolbar buttons and the keyboard shortcuts share one traversal implementation
// (`applyLayoutUndo`/`applyLayoutRedo`), so both leave identical layout and history state.
describe("CommandBar — HEL-1230 undo/redo buttons", () => {
  const layoutA: DashboardLayout = {
    lg: [{ panelId: "a", x: 0, y: 0, w: 2, h: 2 }],
    md: [],
    sm: [],
    xs: [],
  };
  const layoutB: DashboardLayout = {
    lg: [{ panelId: "b", x: 2, y: 0, w: 2, h: 2 }],
    md: [],
    sm: [],
    xs: [],
  };

  function seededStore(withHistory: boolean) {
    const store = makeStore();
    store.dispatch(
      fetchDashboards.fulfilled(
        [
          {
            id: "d1",
            name: "Dash",
            meta: {
              createdBy: "s",
              createdAt: "2026-03-14T00:00:00Z",
              lastUpdated: "2026-03-14T00:00:00Z",
            },
            appearance: { background: "transparent", gridBackground: "transparent" },
            layout: layoutB,
          },
        ],
        "req",
        undefined,
      ),
    );
    if (withHistory) store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: layoutA }));
    return store;
  }

  it("disables both buttons with empty history", () => {
    renderCommandBar("/", seededStore(false));
    expect(screen.getByRole("button", { name: "Undo layout change" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo layout change" })).toBeDisabled();
  });

  it("button undo/redo end in the same state as the keyboard shortcut path", () => {
    const viaButtons = seededStore(true);
    renderCommandBar("/", viaButtons);
    fireEvent.click(screen.getByRole("button", { name: "Undo layout change" }));
    expect(viaButtons.getState().dashboards.items[0].layout).toEqual(layoutA);
    const afterUndo = viaButtons.getState().layoutHistory;
    fireEvent.click(screen.getByRole("button", { name: "Redo layout change" }));
    expect(viaButtons.getState().dashboards.items[0].layout).toEqual(layoutB);
    const afterRedo = viaButtons.getState().layoutHistory;
    cleanup();

    const viaKeys = seededStore(true);
    renderCommandBar("/", viaKeys);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(viaKeys.getState().layoutHistory).toEqual(afterUndo);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(viaKeys.getState().layoutHistory).toEqual(afterRedo);
    expect(viaKeys.getState().dashboards.items[0].layout).toEqual(layoutB);
  });
});
