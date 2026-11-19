// HEL-1773 D6: on a dashboard the caller does not own, panel rows and Output metadata are read ONLY through the per-panel
// routes. The seams: `fetchPanelPage` (rows) and `outputMetaCache.fetchOutputMeta` (metadata, registered by `fetchPanels`).
import { configureStore } from "@reduxjs/toolkit";

import { authReducer } from "../../auth/state/authSlice";
import { dashboardsReducer } from "../../dashboards/state/dashboardsSlice";
import {
  fetchPublicOutputMeta,
  fetchPublicPanelRows,
} from "../../dashboards/services/publicDashboardService";
import { getOutputById } from "../../pipelines/services/outputService";
import { getOutputRows } from "../../pipelines/services/outputService";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { fetchOutputMeta, getOutputPanelScope } from "./outputMetaCache";
import { panelsReducer } from "./panelsSlice";
import { fetchPanelPage, fetchPanels } from "./panelThunks";
import { fetchPanels as fetchPanelsRequest } from "../services/panelService";
import type { Dashboard } from "../../dashboards/types/dashboard";

jest.mock("../../dashboards/services/publicDashboardService");
// The pure filter helpers stay real: the per-panel branch composes its (control-column) filter with them.
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
}));
jest.mock("../services/panelService", () => ({
  ...jest.requireActual("../services/panelService"),
  fetchPanels: jest.fn(),
}));

const publicRows = jest.mocked(fetchPublicPanelRows);
const publicMeta = jest.mocked(fetchPublicOutputMeta);
const outputRows = jest.mocked(getOutputRows);
const outputById = jest.mocked(getOutputById);
const panelsRequest = jest.mocked(fetchPanelsRequest);

const meta = {
  createdBy: "u",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};
function dash(id: string, extra: Partial<Dashboard>): Dashboard {
  return {
    id,
    name: id,
    meta,
    appearance: { background: "transparent", gridBackground: "transparent" },
    layout: { lg: [], md: [], sm: [], xs: [] },
    ...extra,
  };
}

/** The store without the other slices `RootState` names: thunks and actions are typed against the real state, so the test
 *  drives it through an untyped dispatch. */
function run(store: { dispatch: unknown }, action: unknown): Promise<unknown> {
  return (store.dispatch as (a: unknown) => Promise<unknown>)(action);
}

function makeStore(dashboards: Dashboard[]) {
  const store = configureStore({
    reducer: { panels: panelsReducer, dashboards: dashboardsReducer, auth: authReducer },
  });
  store.dispatch({ type: "dashboards/fetchDashboards/fulfilled", payload: dashboards });
  return store;
}

const sharedPanel = makeOutputPanel({
  id: "p-shared",
  dashboardId: "shared",
  config: { outputId: "out-s" },
});
const ownPanel = makeOutputPanel({
  id: "p-own",
  dashboardId: "own",
  config: { outputId: "out-o" },
});

beforeEach(() => {
  jest.resetAllMocks();
  publicRows.mockResolvedValue({ items: [{ a: 1 }], total: 1, offset: 0, limit: 50 });
  publicMeta.mockResolvedValue({ kind: "table", config: {}, schema: [], ownerId: null });
  outputRows.mockResolvedValue({
    items: [{ a: 1 }],
    total: 1,
    offset: 0,
    limit: 50,
    materialized: true,
  });
});

describe("fetchPanelPage on a dashboard the caller does not own", () => {
  it("reads the per-panel rows route (no token, no sort or filter) and never the Output route", async () => {
    const store = makeStore([dash("shared", { accessRole: "viewer" })]);
    void run(store, fetchPanels.fulfilled([sharedPanel], "r", "shared"));
    await run(
      store,
      fetchPanelPage({
        panelId: "p-shared",
        dashboardId: "shared",
        outputId: "out-s",
        page: 0,
        pageSize: 200,
        sort: { column: "a", direction: "asc" },
      }),
    );
    // HEL-1780 D4: `a` is not one of the panel's own control columns, so the sort is not sent (the table orders loaded rows).
    expect(publicRows).toHaveBeenCalledWith(
      "shared",
      "p-shared",
      undefined,
      0,
      200,
      undefined,
      undefined,
    );
    expect(outputRows).not.toHaveBeenCalled();
    expect(store.getState().panels.paginationState["p-shared"]?.rows).toEqual([{ a: 1 }]);
  });

  it("reads the Output route for a dashboard the caller owns", async () => {
    const store = makeStore([dash("own", { accessRole: "owner" })]);
    void run(store, fetchPanels.fulfilled([ownPanel], "r", "own"));
    await run(
      store,
      fetchPanelPage({
        panelId: "p-own",
        dashboardId: "own",
        outputId: "out-o",
        page: 0,
        pageSize: 200,
      }),
    );
    expect(outputRows).toHaveBeenCalledTimes(1);
    expect(publicRows).not.toHaveBeenCalled();
  });

  it("an editor's dashboard is non-owned too", async () => {
    const store = makeStore([dash("shared", { accessRole: "editor" })]);
    void run(store, fetchPanels.fulfilled([sharedPanel], "r", "shared"));
    await run(
      store,
      fetchPanelPage({
        panelId: "p-shared",
        dashboardId: "shared",
        outputId: "out-s",
        page: 0,
        pageSize: 200,
      }),
    );
    expect(publicRows).toHaveBeenCalledTimes(1);
    expect(outputRows).not.toHaveBeenCalled();
  });
});

describe("fetchPanelPage is fail-closed (HEL-1780 D1)", () => {
  it("a panel whose dashboard is absent from the store reads the per-panel route, never the Output route", async () => {
    const store = makeStore([]);
    await run(
      store,
      fetchPanelPage({
        panelId: "p-ghost",
        dashboardId: "ghost",
        outputId: "out-g",
        page: 0,
        pageSize: 200,
      }),
    );
    expect(publicRows).toHaveBeenCalledWith(
      "ghost",
      "p-ghost",
      undefined,
      0,
      200,
      undefined,
      undefined,
    );
    expect(outputRows).not.toHaveBeenCalled();
  });

  it("the role of the PANEL's dashboard decides, not the selected one", async () => {
    const store = makeStore([
      dash("shared", { accessRole: "viewer" }),
      dash("own", { accessRole: "owner" }),
    ]);
    store.dispatch({ type: "dashboards/setSelectedDashboardId", payload: "own" });
    await run(
      store,
      fetchPanelPage({
        panelId: "p-shared",
        dashboardId: "shared",
        outputId: "out-s",
        page: 0,
        pageSize: 200,
      }),
    );
    expect(publicRows).toHaveBeenCalledTimes(1);
    expect(outputRows).not.toHaveBeenCalled();
  });

  it("sends only the panel's own control-column sort and filter, and never quick", async () => {
    const store = makeStore([dash("shared", { accessRole: "viewer" })]);
    const controlled = makeOutputPanel({
      id: "p-shared",
      dashboardId: "shared",
      config: {
        outputId: "out-s",
        controls: [{ id: "c1", kind: "dropdown", column: "region", label: "Region" }],
      },
    });
    void run(store, fetchPanels.fulfilled([controlled], "r", "shared"));
    await run(
      store,
      fetchPanelPage({
        panelId: "p-shared",
        dashboardId: "shared",
        outputId: "out-s",
        page: 0,
        pageSize: 200,
        sort: { column: "region", direction: "desc" },
        filter: {
          quick: "x",
          columns: { region: "w", amount: "5" },
          ops: [{ column: "region", op: "eq", value: "West" }],
        },
        crossFilterEq: { column: "amount", value: "5" },
      }),
    );
    expect(publicRows).toHaveBeenCalledWith(
      "shared",
      "p-shared",
      undefined,
      0,
      200,
      { column: "region", direction: "desc" },
      { columns: { region: "w" }, ops: [{ column: "region", op: "eq", value: "West" }] },
    );
  });
});

describe("fetchPanels registers how each Output's metadata is read", () => {
  it("a non-owned dashboard scopes its Outputs to the panel; fetchOutputMeta then uses output-meta", async () => {
    const store = makeStore([dash("shared", { accessRole: "viewer" })]);
    panelsRequest.mockResolvedValue([sharedPanel]);
    await run(store, fetchPanels("shared"));
    expect(getOutputPanelScope("out-s")).toEqual({ dashboardId: "shared", panelId: "p-shared" });

    const output = await fetchOutputMeta("out-s");
    expect(publicMeta).toHaveBeenCalledWith("shared", "p-shared");
    expect(outputById).not.toHaveBeenCalled();
    // No owner and no pipeline: a table cannot persist, and no run refresh can start.
    expect(output).toMatchObject({ id: "out-s", kind: "table", ownerId: "", pipelineId: "" });
  });

  it("an owned dashboard clears the scope and reads the Output route", async () => {
    const store = makeStore([dash("own", { accessRole: "owner" })]);
    panelsRequest.mockResolvedValue([ownPanel]);
    outputById.mockResolvedValue({
      id: "out-o",
      pipelineId: "pl",
      ownerId: "me",
      name: "o",
      kind: "table",
      config: {},
      schema: [],
      createdAt: "",
      updatedAt: "",
    });
    await run(store, fetchPanels("own"));
    expect(getOutputPanelScope("out-o")).toBeUndefined();
    await fetchOutputMeta("out-o");
    expect(outputById).toHaveBeenCalledWith("out-o");
    expect(publicMeta).not.toHaveBeenCalled();
  });
});
