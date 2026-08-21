import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { Provider } from "react-redux";

import { createDashboard as createDashboardRequest } from "../services/dashboardService";
import { dashboardsReducer } from "../state/dashboardsSlice";
import { useCreateDashboardAction } from "./useCreateDashboardAction";

jest.mock("../services/dashboardService", () => ({
  createDashboard: jest.fn(),
}));

const createDashboardMock = jest.mocked(createDashboardRequest);

function makeStore() {
  return configureStore({ reducer: { dashboards: dashboardsReducer } });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-03-14T00:00:00Z",
  lastUpdated: "2026-03-14T00:00:00Z",
};

describe("useCreateDashboardAction", () => {
  beforeEach(() => {
    createDashboardMock.mockReset();
  });

  it("reports no failure and not pending before invocation", () => {
    const store = makeStore();
    const { result } = renderHook(() => useCreateDashboardAction(), { wrapper: wrapper(store) });

    expect(result.current.error).toBeNull();
    expect(result.current.isPending).toBe(false);
    expect(result.current.cta.label).toBe("New dashboard");
  });

  // HEL-548 D5/4.3/4.7 — this hook encodes PanelList's OWN immediate
  // quick-create ("Untitled dashboard"), a DIFFERENT flow from
  // DashboardList's named-create form.
  it("invoking the descriptor's onClick dispatches the quick-create thunk with the fixed 'Untitled dashboard' name", async () => {
    createDashboardMock.mockResolvedValue({
      id: "dashboard-new",
      name: "Untitled dashboard",
      meta: defaultMeta,
      appearance: { background: "transparent", gridBackground: "transparent" },
      layout: { lg: [], md: [], sm: [], xs: [] },
    });
    const store = makeStore();
    const { result } = renderHook(() => useCreateDashboardAction(), { wrapper: wrapper(store) });

    act(() => result.current.cta.onClick());

    await waitFor(() => expect(createDashboardMock).toHaveBeenCalledWith("Untitled dashboard"));
  });

  // HEL-548 D5/workspace-create-actions — a create action that owns a
  // failure surfaces it through the hook's own state rather than
  // discarding it, carrying the rejection's own (D6) message.
  it("a rejected create surfaces the specific error through the hook's returned state", async () => {
    createDashboardMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: "Workspace dashboard limit reached." } },
    });
    const store = makeStore();
    const { result } = renderHook(() => useCreateDashboardAction(), { wrapper: wrapper(store) });

    act(() => result.current.cta.onClick());

    await waitFor(() => expect(result.current.error).toBe("Workspace dashboard limit reached."));
    expect(result.current.isPending).toBe(false);
  });
});
