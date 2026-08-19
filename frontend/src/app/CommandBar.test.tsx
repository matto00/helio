import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { assistantConversationsReducer } from "../features/assistant/state/assistantConversationsSlice";
import { authReducer } from "../features/auth/state/authSlice";
import { dashboardsReducer } from "../features/dashboards/state/dashboardsSlice";
import { dataTypesReducer } from "../features/dataTypes/state/dataTypesSlice";
import { layoutHistoryReducer } from "../features/layout/state/layoutHistorySlice";
import { metricsReducer } from "../features/metrics/state/metricsSlice";
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
      dataTypes: dataTypesReducer,
      metrics: metricsReducer,
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
