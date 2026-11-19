// HEL-1780 D5: the cross-filter `400` path invalidates the capabilities key of the scope that made the request.
import { configureStore } from "@reduxjs/toolkit";
import { AxiosError, type AxiosResponse } from "axios";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import { fetchPublicPanelRows } from "../../dashboards/services/publicDashboardService";
import { getOutputRows } from "../../pipelines/services/outputService";
import { makeOutputPanel } from "../../../test/panelFixtures";
import {
  ensureCapabilitiesLoaded,
  getCapabilitiesEntry,
  panelCapabilitiesKey,
  resetCapabilitiesStoreForTests,
} from "./filterCapabilitiesStore";
import { panelsReducer } from "./panelsSlice";
import { CROSS_FILTER_EQ_REJECTED, fetchPanelPage, fetchPanels } from "./panelThunks";
import type { Dashboard } from "../../dashboards/types/dashboard";
import type { OutputFilterCapabilitiesResponse } from "../../pipelines/types/output";

jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getFilterCapabilities: jest.fn(),
}));

const meta = { createdBy: "u", createdAt: "x", lastUpdated: "x" };
const dash = (id: string, accessRole: "owner" | "viewer"): Dashboard => ({
  id,
  name: id,
  meta,
  appearance: { background: "transparent", gridBackground: "transparent" },
  layout: { lg: [], md: [], sm: [], xs: [] },
  accessRole,
});
const reject400 = () =>
  new AxiosError("bad", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400,
    data: {},
  } as AxiosResponse);

function run(
  store: { dispatch: unknown },
  action: unknown,
): Promise<{ type: string; payload?: unknown }> {
  return (store.dispatch as (a: unknown) => Promise<{ type: string; payload?: unknown }>)(action);
}

function makeStore(role: "owner" | "viewer") {
  const store = configureStore({
    reducer: { panels: panelsReducer, dashboards: dashboardsReducer, auth: authReducer },
  });
  store.dispatch({ type: "dashboards/fetchDashboards/fulfilled", payload: [dash("d1", role)] });
  void run(
    store,
    fetchPanels.fulfilled(
      [makeOutputPanel({ id: "p1", dashboardId: "d1", config: { outputId: "out-1" } })],
      "r",
      "d1",
    ),
  );
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
});

const ARG = {
  panelId: "p1",
  dashboardId: "d1",
  outputId: "out-1",
  page: 0,
  pageSize: 50,
  crossFilterEq: { column: "team", value: "a" },
};
const ready = (): Promise<OutputFilterCapabilitiesResponse> =>
  Promise.resolve({ columns: [{ column: "team", operators: ["eq"] }] });

describe("cross-filter 400 invalidation (HEL-1780 D5)", () => {
  it("panel scope: invalidates the per-panel key, never the Output's", async () => {
    const store = makeStore("viewer");
    const key = panelCapabilitiesKey("d1", "p1");
    ensureCapabilitiesLoaded(key, ready);
    ensureCapabilitiesLoaded("out-1", ready);
    await new Promise((r) => setTimeout(r, 0));
    jest.mocked(fetchPublicPanelRows).mockRejectedValue(reject400());
    const result = await run(store, fetchPanelPage(ARG));
    expect((result.payload as { code?: string }).code).toBe(CROSS_FILTER_EQ_REJECTED);
    expect(getCapabilitiesEntry(key)?.status).toBe("unavailable");
    expect(getCapabilitiesEntry("out-1")?.status).toBe("ready");
  });

  it("output scope: invalidates the Output's key, never a per-panel one", async () => {
    const store = makeStore("owner");
    const key = panelCapabilitiesKey("d1", "p1");
    ensureCapabilitiesLoaded(key, ready);
    ensureCapabilitiesLoaded("out-1", ready);
    await new Promise((r) => setTimeout(r, 0));
    jest.mocked(getOutputRows).mockRejectedValue(reject400());
    await run(store, fetchPanelPage(ARG));
    expect(getCapabilitiesEntry("out-1")?.status).toBe("unavailable");
    expect(getCapabilitiesEntry(key)?.status).toBe("ready");
  });
});
