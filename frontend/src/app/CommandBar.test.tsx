import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
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
import { fetchPipelines, pipelinesReducer } from "../features/pipelines/state/pipelinesSlice";
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
    renderCommandBar("/dashboards");
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

// HEL-1576: the layout undo/redo buttons moved to the dashboard meta row's edit mode
// (`dashboardMeta/DashboardMetaRow.test.tsx`); the command bar keeps only the keyboard shortcuts, which still
// share the one traversal implementation (`applyLayoutUndo`/`applyLayoutRedo`) with those buttons.
describe("CommandBar — layout undo/redo shortcuts (HEL-1230, buttons moved by HEL-1576)", () => {
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

  function seededStore() {
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
    store.dispatch(pushLayoutSnapshot({ dashboardId: "d1", layout: layoutA }));
    return store;
  }

  it("renders no undo or redo button", () => {
    renderCommandBar("/dashboards", seededStore());
    expect(screen.queryByRole("button", { name: "Undo layout change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Redo layout change" })).not.toBeInTheDocument();
  });

  it("the keyboard shortcuts still undo and redo", () => {
    const store = seededStore();
    renderCommandBar("/dashboards", store);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(store.getState().dashboards.items[0].layout).toEqual(layoutA);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(store.getState().dashboards.items[0].layout).toEqual(layoutB);
  });
});

// HEL-1579 (design.md D3, owner ruling `header-owns-name`): the pipeline detail page header carries
// the pipeline's name, so the rail shell's breadcrumb shows only the section label there.
describe("CommandBar — HEL-1579 pipeline detail breadcrumb", () => {
  const pipeline = {
    id: "pipe-1",
    name: "Revenue rollup",
    roots: [],
    lastRunStatus: null,
    lastRunAt: null,
    lastRunRowCount: null,
  };

  function storeWithPipeline() {
    const store = makeStore();
    store.dispatch(fetchPipelines.fulfilled([pipeline], "req-1", undefined));
    return store;
  }

  it("shows only the section label on /pipelines/:id (no item name in the visible breadcrumb)", () => {
    const store = storeWithPipeline();
    renderCommandBar("/pipelines/pipe-1", store);
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveTextContent("Data Pipelines");
    expect(breadcrumb).not.toHaveTextContent("Revenue rollup");
  });
});
