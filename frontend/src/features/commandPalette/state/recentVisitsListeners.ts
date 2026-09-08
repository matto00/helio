/**
 * HEL-519 design.md D2 — dashboards' half of the "two mechanisms, three kinds, no unifying seam"
 * decision (owner ruling; see also `RecentVisitsRouteObserver.tsx` for sources/pipelines, and the
 * in-file comment there for why the two are deliberately kept separate).
 *
 * This is a Redux `startAppListening` registration, mirroring `toastListeners.ts`'s existing
 * precedent (`store.ts:19,60`) — registered once, before the store is finalised.
 */
import type { RootState } from "../../../store/store";
import type { AppStartListening } from "../../../store/listenerMiddleware";
import { recentHistoryStore, type RecentHistoryStore } from "../model/recentHistoryStore";

/**
 * design.md D2 / round-1 CR1 — observes the STATE TRANSITION of
 * `state.dashboards.selectedDashboardId`, not the `setSelectedDashboardId` action. That field is
 * written by SEVEN reducers in `dashboardsSlice.ts` and only one of them is that action; a
 * listener keyed on the action alone misses `fetchDashboards.fulfilled` (the boot/reload/
 * direct-`/` auto-select) and the four `create`/`duplicate`/`import`/`applyProposal` `.fulfilled`
 * handlers — including the palette's OWN "New dashboard" action.
 *
 * PROVES: every one of the seven `selectedDashboardId`-writing reducers records a visit when it
 * transitions the field to a non-null id (task 3.1's "arrives via `fetchDashboards.fulfilled`
 * with no prior selection" guard covers the reducer this design decision exists specifically to
 * catch). CANNOT PROVE: ordering, de-duplication, or capping of the resulting history — that is
 * `recentHistoryStore.test.ts`'s job, exercised against a plain `RecentEntry[]`, not this wiring.
 */
export function registerDashboardVisitListener(
  startListening: AppStartListening,
  store: RecentHistoryStore = recentHistoryStore,
) {
  startListening({
    predicate: (_action, currentState: RootState, previousState: RootState) =>
      currentState.dashboards.selectedDashboardId !== previousState.dashboards.selectedDashboardId,
    effect: (_action, listenerApi) => {
      const state = listenerApi.getState();
      const nextId = state.dashboards.selectedDashboardId;
      // design.md D2 / round-2 CR2 — a transition to `null` is a DESELECTION
      // (`dashboardRemoved`, `deleteDashboard.fulfilled`, or a fetch resolving to no dashboards),
      // never a visit. Recording it would write a `null`-id entry, which `recentHistoryStore`'s
      // read-side shape validation would treat as a malformed blob and discard WHOLESALE on the
      // next read — wiping the user's entire history. This guard is that anti-regression.
      if (nextId === null) return;
      // skeptic-final-1.md CR1 — the dashboard's own name is ALWAYS in hand right here, in the
      // very same state read that found `nextId` (`state.dashboards.items` is the list this
      // dashboard was just selected out of). Passing it lets the palette render this row on ANY
      // route, including `/`, without depending on a later fetch.
      const title = state.dashboards.items.find((dashboard) => dashboard.id === nextId)?.name;
      store.recordVisit("dashboard", nextId, title);
    },
  });
}

/**
 * design.md D4 — prunes a kind's recent entries only once that kind's OWN list collection has
 * genuinely resolved (`status === "succeeded"`). `idle`, `loading`, AND `failed` all retain: a
 * failed or not-yet-attempted fetch is not evidence the resource was deleted, and treating it as
 * such would delete real history on nothing more than a cold load or a flaky request.
 *
 * PROVES: a transition of the named status field to `"succeeded"` prunes exactly the entries
 * whose id is absent from that kind's freshly-loaded `items`. CANNOT PROVE: that `idle`/
 * `loading`/`failed` retain — `recentVisitsListeners.test.ts` asserts that directly with a
 * plain `pruneMissing` call, since a predicate keyed on `=== "succeeded"` structurally never
 * fires for those values in the first place.
 */
function registerPruneListener<K extends "dashboards" | "sources" | "pipelines">(
  startListening: AppStartListening,
  slice: K,
  kind: "dashboard" | "source" | "pipeline",
  getItemIds: (state: RootState) => string[],
  store: RecentHistoryStore,
) {
  startListening({
    predicate: (_action, currentState: RootState, previousState: RootState) =>
      currentState[slice].status === "succeeded" && previousState[slice].status !== "succeeded",
    effect: (_action, listenerApi) => {
      const ids = new Set(getItemIds(listenerApi.getState()));
      store.pruneMissing(kind, ids);
    },
  });
}

/** Registers every recent-visits listener this ticket owns: the dashboards visit listener plus
 * the three (dashboards/sources/pipelines, design.md D4 — dashboards are pruned on the same rule,
 * not exempt) prune listeners. Call once, alongside `addToastListeners`, before the store is
 * finalised. */
export function addRecentVisitsListeners(
  startListening: AppStartListening,
  store: RecentHistoryStore = recentHistoryStore,
) {
  registerDashboardVisitListener(startListening, store);
  registerPruneListener(
    startListening,
    "dashboards",
    "dashboard",
    (state) => state.dashboards.items.map((item) => item.id),
    store,
  );
  registerPruneListener(
    startListening,
    "sources",
    "source",
    (state) => state.sources.items.map((item) => item.id),
    store,
  );
  registerPruneListener(
    startListening,
    "pipelines",
    "pipeline",
    (state) => state.pipelines.items.map((item) => item.id),
    store,
  );
}
