// HEL-1634 -- sign-out reset of Redux state. Every test seeds "user A's" data through the real
// store, ends the session with `clearAuth` (the action the logout thunk, the 401 interceptor and a
// failed rehydrate all dispatch), and asserts that nothing of A's is served afterwards.
import { fetchAssistantModels } from "../../features/assistant/state/assistantModelsSlice";
import { fetchConversations } from "../../features/assistant/state/assistantConversationsSlice";
import { fetchAuditEvents } from "../../features/audit/state/auditEventsSlice";
import { fetchConnectors } from "../../features/connectors/state/connectorsSlice";
import { fetchDashboards } from "../../features/dashboards/state/dashboardsSlice";
import { fetchShareTokens } from "../../features/dashboards/state/shareTokensSlice";
import { pushLayoutSnapshot } from "../../features/layout/state/layoutHistorySlice";
import { fetchPanels } from "../../features/panels/state/panelsSlice";
import { previewPatchSet } from "../../features/patchSets/state/patchSetsSlice";
import { fetchOutputs } from "../../features/pipelines/state/outputsSlice";
import { fetchPipelines } from "../../features/pipelines/state/pipelinesSlice";
import { applyCombinedProposal } from "../../features/proposals/state/combinedProposalsSlice";
import { fetchApiTokens, redeemInviteCodeThunk } from "../../features/settings/state/settingsSlice";
import { fetchDatasetSchemaThunk } from "../../features/sources/state/datasetRowsSlice";
import { fetchSources } from "../../features/sources/state/sourcesSlice";
import { pushToast } from "../../features/toasts/state/toastsSlice";
import { clearAuth, setAuth, updateUserPreferences } from "../../features/auth/state/authSlice";
import { store } from "../../store/store";
import { redeemInviteCode } from "../../features/settings/services/settingsService";
import { fetchPanels as fetchPanelsRequest } from "../../features/panels/services/panelService";
import { updateUserPreferencesRequest } from "../../features/auth/services/authService";
import { applyCombinedProposal as applyCombinedProposalRequest } from "../../features/proposals/services/combinedProposalService";

jest.mock("../../features/settings/services/settingsService");
jest.mock("../../features/panels/services/panelService");
jest.mock("../../features/auth/services/authService");
jest.mock("../../features/proposals/services/combinedProposalService");
jest.mock("../../features/dashboards/tabs/dashboardChangesService", () => ({
  fetchDashboardChanges: jest.fn(() =>
    Promise.resolve({ serverNow: new Date().toISOString(), items: [] }),
  ),
}));

/** The slices that reset THEMSELVES on `clearAuth` (design D1 `SELF_RESETTING_SLICES`). */
const SELF_RESETTING = new Set(["auth", "sourceSamples"]);

const initialSnapshot = JSON.parse(JSON.stringify(store.getState())) as Record<string, unknown>;
const USER_A = { id: "user-A", email: "a@example.com", tier: "free" } as never;
const USER_B = { id: "user-B", email: "b@example.com", tier: "free" } as never;
const ID = "req-1";

/** One seed action per per-user slice: after it the slice no longer equals its initial state. */
const SEEDS: Record<string, () => unknown> = {
  assistantConversations: () => fetchConversations.fulfilled([{ id: "conv-A" }] as never, ID),
  assistantModels: () =>
    fetchAssistantModels.fulfilled(
      { models: [], serverDefault: "m", defaultModel: "model-of-A" } as never,
      ID,
    ),
  auditEvents: () =>
    fetchAuditEvents.fulfilled({ items: [{ id: "audit-A" }] as never, total: 1 }, ID),
  connectors: () => fetchConnectors.fulfilled([{ id: "conn-A" }] as never, ID),
  dashboards: () => fetchDashboards.fulfilled([{ id: "dash-A", name: "A's board" }] as never, ID),
  layoutHistory: () => pushLayoutSnapshot({ dashboardId: "dash-A", layout: {} as never }),
  panels: () =>
    fetchPanels.fulfilled([{ id: "panel-A", title: "A's panel" }] as never, ID, "dash-A"),
  patchSets: () => previewPatchSet.fulfilled({ summary: "A's patch" } as never, ID, {} as never),
  pipelines: () => fetchPipelines.fulfilled([{ id: "pipe-A" }] as never, ID),
  outputs: () =>
    fetchOutputs.fulfilled({ pipelineId: "pipe-A", outputs: [{ id: "out-A" }] as never }, ID, {
      pipelineId: "pipe-A",
    }),
  combinedProposals: () => applyCombinedProposal.rejected(null, ID, {} as never, "A's error text"),
  settings: () => fetchApiTokens.fulfilled([{ id: "token-A" }] as never, ID),
  shareTokens: () =>
    fetchShareTokens.fulfilled(
      { dashboardId: "dash-A", items: [{ id: "share-A" }] as never },
      ID,
      "dash-A",
    ),
  sources: () => fetchSources.fulfilled([{ id: "src-A" }] as never, ID),
  datasetRows: () =>
    fetchDatasetSchemaThunk.fulfilled({ sourceId: "src-A", schema: { fields: [] } as never }, ID, {
      sourceId: "src-A",
    } as never),
  toasts: () => pushToast({ message: "Applied. Undo", duration: 0, variant: "success" }),
};

function slice(key: string): unknown {
  return JSON.parse(JSON.stringify((store.getState() as unknown as Record<string, unknown>)[key]));
}

beforeEach(() => {
  store.dispatch(clearAuth());
  store.dispatch(setAuth({ user: USER_A }));
});

describe("clearAuth resets every per-user slice", () => {
  test.each(Object.keys(SEEDS))("%s holds nothing of user A after clearAuth", (key) => {
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_A }));
    store.dispatch(SEEDS[key]() as never);
    expect(slice(key)).not.toEqual(initialSnapshot[key]); // the seed really landed
    store.dispatch(clearAuth());
    expect(slice(key)).toEqual(initialSnapshot[key]);
  });

  test("every root state key except the self-resetting ones equals its initial state", () => {
    for (const seed of Object.values(SEEDS)) store.dispatch(seed() as never);
    store.dispatch(clearAuth());
    const state = store.getState() as unknown as Record<string, unknown>;
    const failures = Object.keys(state)
      .filter((key) => !SELF_RESETTING.has(key))
      .filter((key) => JSON.stringify(state[key]) !== JSON.stringify(initialSnapshot[key]));
    expect(failures).toEqual([]);
  });

  test("the seed table covers every slice that is neither self-resetting nor reset today", () => {
    const resetToday = new Set([
      "dashboardFolders",
      "homeSummary",
      "dashboardTabs",
      "onboarding",
      "scheduledItems",
    ]);
    const missing = Object.keys(store.getState()).filter(
      (key) => !SELF_RESETTING.has(key) && !resetToday.has(key) && !(key in SEEDS),
    );
    expect(missing).toEqual([]);
  });

  test("a sticky action toast (with its Undo closure) is gone after clearAuth", () => {
    store.dispatch(
      pushToast({
        message: "Applied. Undo",
        duration: 0,
        variant: "success",
        action: { label: "Undo", onClick: () => undefined },
      } as never),
    );
    expect(store.getState().toasts.items).toHaveLength(1);
    store.dispatch(clearAuth());
    expect(store.getState().toasts.items).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("a response that lands after sign-out is dropped", () => {
  test("fetchPanels started by A does not populate B's panels", async () => {
    const pending = deferred<never>();
    (fetchPanelsRequest as jest.Mock).mockReturnValueOnce(pending.promise);
    const run = store.dispatch(fetchPanels("dash-A") as never) as unknown as Promise<unknown>;
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_B }));
    pending.resolve([{ id: "panel-A", title: "A's panel" }] as never);
    await run;
    expect(store.getState().panels.items).toEqual([]);
    expect(store.getState().panels.loadedDashboardId ?? null).toBeNull();
  });

  test("auth/updateUserPreferences.fulfilled for A does not change B's preferences", async () => {
    const pending = deferred<never>();
    (updateUserPreferencesRequest as jest.Mock).mockReturnValueOnce(pending.promise);
    const before = JSON.stringify(USER_B);
    const run = store.dispatch(updateUserPreferences({ accentColor: "#ff0000" } as never) as never);
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_B }));
    pending.resolve({ accentColor: "#ff0000" } as never);
    await run;
    expect(JSON.stringify(store.getState().auth.currentUser)).toBe(before);
  });

  test("redeemInviteCodeThunk for A does not replace B's currentUser", async () => {
    const pending = deferred<never>();
    (redeemInviteCode as jest.Mock).mockReturnValueOnce(pending.promise);
    const run = store.dispatch(redeemInviteCodeThunk("CODE") as never);
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_B }));
    pending.resolve({ id: "user-A", email: "a@example.com", tier: "beta" } as never);
    await run;
    expect(store.getState().auth.currentUser?.id).toBe("user-B");
  });

  test("the combined-proposal apply for A does not insert or select A's dashboard for B", async () => {
    const pending = deferred<never>();
    (applyCombinedProposalRequest as jest.Mock).mockReturnValueOnce(pending.promise);
    const run = store.dispatch(applyCombinedProposal({} as never) as never);
    store.dispatch(clearAuth());
    store.dispatch(setAuth({ user: USER_B }));
    pending.resolve({
      dashboard: { dashboard: { id: "dash-A", name: "A's board" } },
    } as never);
    await run;
    expect(store.getState().dashboards.items).toEqual([]);
    expect(store.getState().dashboards.selectedDashboardId ?? null).toBeNull();
  });
});
