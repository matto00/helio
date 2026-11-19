// HEL-1780 D5 / task 3.3: in panel read scope the cross-filter decision follows THIS panel's own capabilities (the per-panel
// route, narrowed to the panel's control columns), keyed by (dashboardId, panelId). Two panels bound to ONE Output with
// different controls must each decide for themselves, and the Output route must never be asked.
import { configureStore } from "@reduxjs/toolkit";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { fetchPublicFilterCapabilities } from "../../dashboards/services/publicDashboardService";
import { getFilterCapabilities } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { resetCapabilitiesStoreForTests } from "../state/filterCapabilitiesStore";
import { panelsReducer, setCrossFilter } from "../state/panelsSlice";
import { useCrossFilterServerOps } from "./useCrossFilterServerOps";
import type { Dashboard } from "../../dashboards/types/dashboard";
import type { OutputFilterCapabilitiesResponse } from "../../pipelines/types/output";

jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getFilterCapabilities: jest.fn(),
}));

const perPanel = jest.mocked(fetchPublicFilterCapabilities);
const outputRoute = jest.mocked(getFilterCapabilities);

const output: Pick<Output, "id" | "kind" | "config" | "schema"> = {
  id: "shared-out",
  kind: "table",
  config: {},
  schema: [
    { name: "region", type: "string" },
    { name: "team", type: "string" },
  ],
};
const panelA = makeOutputPanel({
  id: "pa",
  dashboardId: "d1",
  config: {
    outputId: "shared-out",
    controls: [{ id: "c1", kind: "dropdown", column: "team", label: "Team" }],
  },
});
const panelB = makeOutputPanel({
  id: "pb",
  dashboardId: "d1",
  config: {
    outputId: "shared-out",
    controls: [{ id: "c2", kind: "dropdown", column: "region", label: "Region" }],
  },
});

const meta = { createdBy: "u", createdAt: "x", lastUpdated: "x" };
const sharedDashboard: Dashboard = {
  id: "d1",
  name: "d1",
  meta,
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
  accessRole: "viewer",
};

function wrap() {
  const store = configureStore({
    reducer: { panels: panelsReducer, dashboards: dashboardsReducer, auth: authReducer },
  });
  const dispatch = store.dispatch as unknown as (a: unknown) => unknown;
  dispatch({ type: "dashboards/fetchDashboards/fulfilled", payload: [sharedDashboard] });
  dispatch(setCrossFilter({ panelId: "origin", dimension: "team", value: "a", series: "" }));
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, createElement(MemoryRouter, null, children));
  };
}

const caps = (column: string): Promise<OutputFilterCapabilitiesResponse> =>
  Promise.resolve({ columns: [{ column, operators: ["eq"] }] });

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
  perPanel.mockImplementation((_d, panelId) => caps(panelId === "pa" ? "team" : "region"));
});

describe("useCrossFilterServerOps in panel read scope (HEL-1780 D5)", () => {
  it("two panels on one Output each follow their own capabilities, through the per-panel route only", async () => {
    const { result } = renderHook(
      () => ({
        a: useCrossFilterServerOps(panelA, output, {
          kind: "panel",
          dashboardId: "d1",
          panelId: "pa",
        }),
        b: useCrossFilterServerOps(panelB, output, {
          kind: "panel",
          dashboardId: "d1",
          panelId: "pb",
        }),
      }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.a.mode).toBe("server"));
    expect(result.current.a.crossFilterEq).toEqual({ column: "team", value: "a" });
    // B controls `region`, not `team`: the dimension is not among ITS capabilities, so it narrows loaded rows in the browser.
    expect(result.current.b.mode).toBe("client-fallback");
    expect(result.current.b.crossFilterEq).toBeNull();

    // one request per panel, with (dashboardId, panelId) and NO token; the Output route is never asked
    expect(perPanel).toHaveBeenCalledTimes(2);
    expect(perPanel).toHaveBeenCalledWith("d1", "pa");
    expect(perPanel).toHaveBeenCalledWith("d1", "pb");
    expect(outputRoute).not.toHaveBeenCalled();
  });
});
