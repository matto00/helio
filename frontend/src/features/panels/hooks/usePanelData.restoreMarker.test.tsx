// HEL-1783 D3b + skeptic-design-6 CR1-CR3: a card mounting on a shared dashboard's WARM-RESTORED window (a per-panel-scoped
// Output has no run baseline and, after a reload, no metadata at mount) reuses that window, and makes ZERO rows requests across
// its whole first mount -- before and after the scoped metadata resolves -- for a persisted default sort, a persisted column
// filter and a URL control filter. The host below mirrors `PanelCard` + `PanelCardBody`: the same three hooks wired the same way.
import { act, render, waitFor } from "@testing-library/react";
import { StrictMode, useRef, type RefObject } from "react";
import { Provider } from "react-redux";

import { dash, makeTabsStore, tab } from "../../../test/tabsTestStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { storedEntry, storedWindow } from "../../../test/warmFixtures";
import {
  fetchPublicOutputMeta,
  fetchPublicPanelRows,
} from "../../dashboards/services/publicDashboardService";
import {
  clearWarmState,
  getWarmStore,
  setWarmStoreForTests,
} from "../../dashboards/tabs/warm/warmCache";
import { showDashboardPanels } from "../../dashboards/tabs/warm/showDashboardPanels";
import { MemoryWarmStore } from "../../dashboards/tabs/warm/warmStore";
import {
  getOutputById,
  getOutputRows,
  isFilterActive,
  type OutputRowsFilter,
  type OutputRowsFilterOp,
} from "../../pipelines/services/outputService";
import { invalidateOutput, release, resetOutputFreshness, retain } from "../state/outputFreshness";
import { fetchOutputMeta, scopeOutputToPanel, unscopeOutput } from "../state/outputMetaCache";
import { getOutputId } from "../state/panelNarrowing";
import { isReusable } from "../state/panelRowsReuse";
import { clearRestoreMarkers, hasRestoreMarker, markRestored } from "../state/restoreMarkers";
import { resetRunBaselines } from "../services/pipelineRunFanout";
import { useAppSelector } from "../../../hooks/reduxHooks";
import { useOutputMeta } from "./useOutputMeta";
import { usePanelData } from "./usePanelData";
import { usePanelSortFilter } from "./usePanelSortFilter";
import type { Panel, PanelLastQuery } from "../types/panel";
import { settledWindow } from "../../../test/warmFixtures";

jest.mock("../../dashboards/services/publicDashboardService");
jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
}));
jest.mock("../../toasts/hooks/useToast", () => ({ useToast: () => ({ push: jest.fn() }) }));
jest.mock("../services/panelService", () => ({ fetchPanels: jest.fn() }));
jest.mock("../../dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest.fn(),
}));
jest.mock("../../auth/services/authService", () => ({
  patchDashboardTabsRequest: jest.fn().mockResolvedValue(undefined),
}));

const publicRows = jest.mocked(fetchPublicPanelRows);
const publicMeta = jest.mocked(fetchPublicOutputMeta);
const outputRows = jest.mocked(getOutputRows);
const outputById = jest.mocked(getOutputById);

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const CAPTURED = Date.now() - 20 * 60_000;
const TEAM_CONTROL = { id: "c1", kind: "dropdown" as const, column: "team", label: "Team" };
const panel = makeOutputPanel({
  id: "pa1",
  dashboardId: "a",
  config: { outputId: "o1", controls: [TEAM_CONTROL] },
});

const OPS: OutputRowsFilterOp[] = [{ column: "team", op: "eq", value: "red" }];
interface Variant {
  name: string;
  lastQuery: PanelLastQuery;
  config: Record<string, unknown>;
  ops: OutputRowsFilterOp[];
}
const sortAsc = { column: "team", direction: "asc" as const };
const colFilter: OutputRowsFilter = { columns: { team: "red" } };
const VARIANTS: Variant[] = [
  {
    name: "a persisted default columnSort",
    lastQuery: { outputId: "o1", sort: sortAsc, crossFilterEq: null },
    config: { columnSort: { key: "team", direction: "asc" } },
    ops: [],
  },
  {
    name: "persisted columnFilters",
    lastQuery: { outputId: "o1", filter: colFilter, crossFilterEq: null },
    config: { columnFilters: { columns: { team: "red" } } },
    ops: [],
  },
  {
    name: "a URL control filter",
    lastQuery: { outputId: "o1", filter: { ops: OPS }, crossFilterEq: null },
    config: {},
    ops: OPS,
  },
];

let resolveMeta: (config: Record<string, unknown>) => void = () => undefined;

/** `PanelCard` (owns `usePanelData`) rendering `PanelCardBody` (owns `useOutputMeta` + `usePanelSortFilter`): the child's effects
 *  run BEFORE the parent's, which is what lets the child take the mount decision over when the Output metadata is already held. */
function Body({
  panel: livePanel,
  ops,
  mountOwnership,
}: {
  panel: Panel;
  ops: OutputRowsFilterOp[];
  mountOwnership: RefObject<boolean>;
}) {
  const outputId = getOutputId(livePanel);
  const { output } = useOutputMeta(outputId);
  usePanelSortFilter(
    livePanel.id,
    livePanel.dashboardId,
    outputId,
    output,
    ops,
    null,
    mountOwnership,
  );
  return null;
}

function Host({ ops }: { ops: OutputRowsFilterOp[] }) {
  const mountOwnership = useRef(false);
  const livePanel = useAppSelector((s) => s.panels.items.find((p) => p.id === panel.id) ?? panel);
  usePanelData(livePanel, [], null, { mountOwnership });
  return <Body panel={livePanel} ops={ops} mountOwnership={mountOwnership} />;
}

async function restoreViaStoredCopy(window: PanelLastQuery) {
  const harness = makeTabsStore({
    dashboards: [dash("b"), { ...dash("a"), accessRole: "viewer" }],
    tabs: [tab("a", ago(60_000)), tab("b", ago(1_000))],
    activeId: "a",
    selected: "a",
    panels: { items: [], loadedDashboardId: "b" },
    changeSignals: {
      a: { dashboardId: "a", contentUpdatedAt: ago(3_600_000), dataUpdatedAt: null, outputs: [] },
    },
  });
  await getWarmStore().write(
    storedEntry({
      dashboardId: "a",
      contentCapturedAt: CAPTURED,
      lastViewedAt: Date.now() - 30_000,
      panels: [panel],
      rows: { pa1: { ...storedWindow("o1", CAPTURED + 1_000, 0), lastQuery: window } },
      readScope: "panel",
    }),
  );
  await harness.dispatch(showDashboardPanels("a"));
  expect(harness.getState().panels.loadedDashboardId).toBe("a");
  return harness;
}

function mount(
  harness: Awaited<ReturnType<typeof restoreViaStoredCopy>>,
  ops = [] as OutputRowsFilterOp[],
  strict = false,
) {
  const tree = (
    <Provider store={harness.store as never}>
      <Host ops={ops} />
    </Provider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(async () => {
  await clearWarmState();
  resetOutputFreshness();
  resetRunBaselines();
  clearRestoreMarkers();
  unscopeOutput("o1");
  setWarmStoreForTests(new MemoryWarmStore());
  publicRows.mockReset();
  outputRows.mockReset();
  outputById.mockReset();
  publicRows.mockResolvedValue({ items: [{ team: "red" }], total: 1, columns: ["team"] } as never);
  publicMeta.mockReset();
  publicMeta.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveMeta = (config) => resolve({ kind: "table", config, schema: [], ownerId: null });
      }),
  );
});

afterEach(() => {
  // Neither Output route (rows or metadata) is ever reached from a shared dashboard's restored panel.
  expect(outputRows).not.toHaveBeenCalled();
  expect(outputById).not.toHaveBeenCalled();
});

describe("a shared panel restored from a stored copy: ZERO rows requests across the whole first mount (CR2)", () => {
  it.each(VARIANTS)("$name", async ({ lastQuery, config, ops }) => {
    const harness = await restoreViaStoredCopy(lastQuery);
    mount(harness, ops);
    expect(hasRestoreMarker("pa1")).toBe(true);
    await settle();
    expect(hasRestoreMarker("pa1")).toBe(true);
    expect(publicRows).not.toHaveBeenCalled(); // before the scoped metadata resolves
    await act(async () => resolveMeta(config));
    await settle();
    expect(publicMeta).toHaveBeenCalledWith("a", "pa1");
    expect(publicRows).not.toHaveBeenCalled(); // after it resolves
    expect(harness.getState().panels.paginationState.pa1.rows).toEqual([{ a: 1 }]);
  });

  it.each(VARIANTS)("$name, under StrictMode", async ({ lastQuery, config, ops }) => {
    const harness = await restoreViaStoredCopy(lastQuery);
    mount(harness, ops, true);
    await settle();
    expect(publicRows).not.toHaveBeenCalled();
    await act(async () => resolveMeta(config));
    await settle();
    expect(publicRows).not.toHaveBeenCalled();
    expect(hasRestoreMarker("pa1")).toBe(true); // StrictMode's simulated unmount consumed nothing
  });

  it("a persisted default that DIFFERS from the captured window's query makes exactly one per-panel rows request", async () => {
    const harness = await restoreViaStoredCopy({
      outputId: "o1",
      sort: sortAsc,
      crossFilterEq: null,
    });
    mount(harness);
    await settle();
    expect(publicRows).not.toHaveBeenCalled();
    await act(async () => resolveMeta({ columnSort: { key: "team", direction: "desc" } }));
    await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(1));
    await settle();
    expect(publicRows).toHaveBeenCalledTimes(1);
    expect(publicRows.mock.calls[0][5]).toEqual({ column: "team", direction: "desc" });
  });

  it("a stale window (its Output's generation moved before the mount) is re-read, marker or not", async () => {
    const harness = await restoreViaStoredCopy({ outputId: "o1", crossFilterEq: null });
    invalidateOutput("o1");
    mount(harness);
    await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(1));
  });
});

describe("marker lifetime: gone for any later mount (D3b)", () => {
  it("after the first mount reused the window and unmounted, a later mount re-reads (data may have advanced unseen)", async () => {
    const harness = await restoreViaStoredCopy({ outputId: "o1", crossFilterEq: null });
    const first = mount(harness);
    await settle();
    await act(async () => resolveMeta({}));
    expect(publicRows).not.toHaveBeenCalled();
    first.unmount();
    await settle();
    expect(hasRestoreMarker("pa1")).toBe(false);
    mount(harness);
    await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(1));
  });

  it("a restored card whose FIRST mount fetched (its Output's data moved) and is remounted re-reads too", async () => {
    const harness = await restoreViaStoredCopy({ outputId: "o1", crossFilterEq: null });
    invalidateOutput("o1"); // the restored window is stale: the first mount must fetch
    const first = mount(harness);
    await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(1));
    await settle();
    expect(hasRestoreMarker("pa1")).toBe(false);
    first.unmount();
    await settle();
    // Same query, current generation, retained: only a surviving marker could make this mount reuse (and serve stale rows).
    retain("o1");
    mount(harness);
    await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(2));
  });
});

describe("isReusable for a per-panel-scoped Output (D3b)", () => {
  const entry = { ...settledWindow("o1", CAPTURED), generation: 0 };
  const query = { outputId: "o1", crossFilterEq: null };

  beforeEach(() => {
    resetOutputFreshness();
  });

  function retained() {
    // retained for the test's duration
    jest.requireActual("../state/outputFreshness").retain("o1");
  }

  it("needs the restore marker: without it a scoped Output (no metadata, no run baseline) is never reusable", () => {
    scopeOutputToPanel("o1", "a", "pa1");
    retained();
    expect(isReusable(entry, query, "pa1")).toBe(false);
    markRestored("a", ["pa1"]);
    expect(isReusable(entry, query, "pa1")).toBe(true);
    release("o1");
  });

  it("with the marker still requires a settled OK window, the same query, retention and generation", () => {
    scopeOutputToPanel("o1", "a", "pa1");
    retained();
    markRestored("a", ["pa1"]);
    expect(isReusable({ ...entry, isLoadingMore: true }, query, "pa1")).toBe(false);
    expect(isReusable({ ...entry, lastFetchOk: false }, query, "pa1")).toBe(false);
    expect(isReusable(entry, { ...query, sort: sortAsc }, "pa1")).toBe(false);
    expect(isReusable({ ...entry, generation: 7 }, query, "pa1")).toBe(false);
    release("o1");
  });

  it("an UNSCOPED (owner) Output with no run baseline is never reusable, marker or not", () => {
    retained();
    markRestored("a", ["pa1"]);
    expect(isReusable(entry, query, "pa1")).toBe(false);
    release("o1");
  });
});

// Final-gate CR1: after a marker reuse, the rows on screen must correspond to the query the card shows. The card's own
// `activeSort`/`activeFilter` are reseeded from the Output's persisted defaults on every mount, so a window captured under an
// interactive sort/filter (or a default removed since) must be corrected when the card has no terms.
describe("a marker reuse never leaves rows that disagree with the card's query (final-gate CR1)", () => {
  const SERVER_VARIANTS: Array<[string, PanelLastQuery]> = [
    [
      "an interactive column filter on a CONTROL column",
      { outputId: "o1", filter: { columns: { team: "red" } }, crossFilterEq: null },
    ],
    [
      "an interactive sort on a CONTROL column",
      { outputId: "o1", sort: { column: "team", direction: "asc" }, crossFilterEq: null },
    ],
    [
      "a persisted default sort that was REMOVED after the capture",
      { outputId: "o1", sort: { column: "team", direction: "desc" }, crossFilterEq: null },
    ],
  ];

  it.each(SERVER_VARIANTS)(
    "(i) %s: exactly one per-panel rows request, and the window ends unsorted and unfiltered",
    async (_name, lastQuery) => {
      const harness = await restoreViaStoredCopy(lastQuery);
      mount(harness);
      await settle();
      await act(async () => resolveMeta({}));
      await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(1));
      await settle();
      expect(publicRows).toHaveBeenCalledTimes(1);
      const after = harness.getState().panels.paginationState.pa1.lastQuery;
      expect(after?.sort).toBeUndefined();
      expect(isFilterActive(after?.filter)).toBe(false);
    },
  );

  it.each([
    [
      "a sort on a NON-control column",
      {
        outputId: "o1",
        sort: { column: "revenue", direction: "asc" as const },
        crossFilterEq: null,
      },
    ],
    [
      "a column filter on a NON-control column",
      { outputId: "o1", filter: { columns: { revenue: "9" } }, crossFilterEq: null },
    ],
  ] as Array<[string, PanelLastQuery]>)(
    "(ii) %s: no rows request (client-only), and the recorded query is the card's",
    async (_name, lastQuery) => {
      const harness = await restoreViaStoredCopy(lastQuery);
      mount(harness);
      await settle();
      await act(async () => resolveMeta({}));
      await settle();
      expect(publicRows).not.toHaveBeenCalled();
      const after = harness.getState().panels.paginationState.pa1.lastQuery;
      expect(after?.sort).toBeUndefined();
      expect(isFilterActive(after?.filter)).toBe(false);
    },
  );

  it.each(SERVER_VARIANTS)(
    "(iii) memory path, metadata held at mount, %s: exactly one request",
    async (_name, lastQuery) => {
      const harness = await restoreViaStoredCopy(lastQuery);
      const held = fetchOutputMeta("o1"); // the scoped read a previous card of this Output left behind
      resolveMeta({});
      await held;
      retain("o1");
      mount(harness);
      await waitFor(() => expect(publicRows).toHaveBeenCalledTimes(1));
      await settle();
      expect(publicRows).toHaveBeenCalledTimes(1);
      const after = harness.getState().panels.paginationState.pa1.lastQuery;
      expect(after?.sort).toBeUndefined();
      expect(isFilterActive(after?.filter)).toBe(false);
    },
  );
});
