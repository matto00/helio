import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";

import { assistantConversationsReducer } from "../../features/assistant/state/assistantConversationsSlice";
import { authReducer } from "../../features/auth/state/authSlice";
import { dataTypesReducer } from "../../features/dataTypes/state/dataTypesSlice";
import { metricsReducer } from "../../features/metrics/state/metricsSlice";
import { pipelinesReducer } from "../../features/pipelines/state/pipelinesSlice";
import { sourcesReducer } from "../../features/sources/state/sourcesSlice";
import { SidebarBody } from "./SidebarBody";
import { PICKER_EMPTY_STATE } from "./pickerEmptyState";
import type { PickerId } from "./sections";

// HEL-773 design.md D11/task 5.8 — locks the shared empty-state copy table
// (`pickerEmptyState.tsx`) against `SidebarBody`'s ACTUAL rendered copy for
// the sidebar-owned sections, so the phone sheet's empty branch and the
// desktop sidebar's empty branch cannot silently drift apart. Every slice
// below is pre-seeded `status: "succeeded"` with zero items — the TRUE
// empty state, not a loading skeleton or an unmocked fetch's error state.
// `dashboards` is deliberately excluded: its sidebar copy lives in
// `DashboardList`, the zero-dashboard surface HEL-554 is concurrently
// rewriting, so a lock pinned to it here would be a scheduled breakage
// (design.md D11) — the phone sheet's own dashboards copy is verified
// directly in `MobileNavSheet.test.tsx` instead.
const SIDEBAR_OWNED_PICKER_ROUTES: Record<Exclude<PickerId, "dashboards" | "other">, string> = {
  sources: "/sources",
  pipelines: "/pipelines",
  registry: "/registry",
  metrics: "/metrics",
  chat: "/chat",
};

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      dataTypes: dataTypesReducer,
      sources: sourcesReducer,
      pipelines: pipelinesReducer,
      metrics: metricsReducer,
      assistantConversations: assistantConversationsReducer,
    } as never,
    preloadedState: {
      auth: { status: "idle", currentUser: null },
      dataTypes: { items: [], status: "succeeded", error: null, selectedTypeId: null },
      sources: {
        items: [],
        status: "succeeded",
        error: null,
        errorKind: null,
        selectedSourceId: null,
        addModalOpen: false,
      },
      pipelines: { items: [], status: "succeeded", error: null, createModalOpen: false },
      metrics: {
        items: [],
        status: "succeeded",
        error: null,
        createStatus: "idle",
        createError: null,
        updateStatus: "idle",
        updateError: null,
        deleteStatus: "idle",
        deleteError: null,
        currentMetric: null,
        createMetricModalOpen: false,
      },
      assistantConversations: {
        items: [],
        status: "succeeded",
        error: null,
        selectedConversationId: null,
        activeConversation: { data: null, status: "idle", error: null },
        startingNewConversation: false,
      },
    } as never,
  });
}

function renderSidebarAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={makeStore()}>
        <SidebarBody />
      </Provider>
    </MemoryRouter>,
  );
}

describe("pickerEmptyState — locked against the desktop sidebar's rendered copy (HEL-773 design.md D11/task 5.8)", () => {
  it.each(Object.entries(SIDEBAR_OWNED_PICKER_ROUTES) as [PickerId, string][])(
    "%s: table copy matches SidebarBody's rendered empty-state title and description",
    (pickerId, path) => {
      renderSidebarAt(path);

      const entry = PICKER_EMPTY_STATE[pickerId];
      expect(screen.getByText(entry.title)).toBeInTheDocument();
      // Registry's description can be empty in principle for other sections,
      // but every sidebar-owned entry here does carry one — `getByText` on
      // an empty string would match too broadly, so guard it explicitly.
      expect(entry.description.length).toBeGreaterThan(0);
      expect(screen.getByText(entry.description)).toBeInTheDocument();
    },
  );

  it("covers every PickerId member, including the unreachable other", () => {
    const allPickerIds: PickerId[] = [
      "dashboards",
      "sources",
      "pipelines",
      "registry",
      "metrics",
      "chat",
      "other",
    ];
    for (const pickerId of allPickerIds) {
      expect(PICKER_EMPTY_STATE[pickerId]).toBeDefined();
      expect(PICKER_EMPTY_STATE[pickerId].title.length).toBeGreaterThan(0);
    }
  });
});
