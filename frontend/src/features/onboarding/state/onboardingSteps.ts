/** A step's completion state (design.md D10). `indeterminate` covers an
 *  unresolved collection (`idle`/`loading`) — never a bare unchecked box.
 *  `failed` is reported separately from `incomplete`: rendering a failed
 *  fetch as "not done" asserts, as fact, something the surface never
 *  actually observed. */
export type OnboardingStepStatus = "complete" | "incomplete" | "indeterminate" | "failed";

type FetchStatus = "idle" | "loading" | "succeeded" | "failed";

/** The shared 4-state derivation for a plain "does at least one item exist"
 *  collection (data sources, pipelines, dashboards). A `failed` fetch is
 *  reported `failed`, never falls through to `incomplete`; an unresolved
 *  fetch (`idle` or `loading`) is `indeterminate`. */
export function deriveCollectionStepStatus(
  status: FetchStatus,
  itemCount: number,
): OnboardingStepStatus {
  if (status === "failed") return "failed";
  if (status === "succeeded") return itemCount > 0 ? "complete" : "incomplete";
  return "indeterminate";
}

interface PanelStepInput {
  selectedDashboardId: string | null;
  panels: {
    status: FetchStatus;
    loadedDashboardId: string | null;
    items: Array<{ dashboardId: string }>;
  };
}

/** The panel step's own derivation — deliberately NOT
 *  `deriveCollectionStepStatus` (task 1.11). `panels.status === "idle"` is
 *  re-entrant: HEL-548's `staleDashboardId` mechanism means `idle` also
 *  represents the terminal post-delete state (the dashboard's last panel was
 *  just deleted, no refetch scheduled), not only the pre-dispatch frame — so
 *  it is never read as a loading signal here. Only panels belonging to the
 *  CURRENTLY SELECTED dashboard count: `items` can briefly hold the previous
 *  dashboard's rows mid-switch (the same reason `PanelList` itself checks
 *  `items[0].dashboardId`). */
export function derivePanelStepStatus({
  selectedDashboardId,
  panels,
}: PanelStepInput): OnboardingStepStatus {
  if (selectedDashboardId === null) return "incomplete";
  const hasPanelForSelectedDashboard = panels.items.some(
    (panel) => panel.dashboardId === selectedDashboardId,
  );
  if (hasPanelForSelectedDashboard) return "complete";
  // Only trust `status` as a signal for THIS dashboard's own in-flight fetch
  // — `loadedDashboardId` is set synchronously at `fetchPanels.pending` and
  // left alone on `.rejected`, so it correctly identifies which dashboard a
  // "loading"/"failed" status is actually about.
  if (panels.loadedDashboardId === selectedDashboardId) {
    if (panels.status === "failed") return "failed";
    if (panels.status === "loading") return "indeterminate";
  }
  return "incomplete";
}

/** HEL-909's 3-step model: connect a source, shape it into outputs, place
 *  them on a dashboard. The third step ("placement") folds the old
 *  dashboard-exists and panel-exists checks into one status (see
 *  `derivePlacementStepStatus`) — a dashboard is a means to placing an
 *  Output, not a step of its own any more. */
export interface OnboardingStepStatuses {
  source: OnboardingStepStatus;
  pipeline: OnboardingStepStatus;
  placement: OnboardingStepStatus;
}

/** The third step's status: while no dashboard exists yet, this step
 *  reports the dashboard collection's own status (there's nothing to place
 *  an Output onto); once a dashboard exists, it reports the panel step's
 *  status instead. Keeps `derivePanelStepStatus`/`deriveCollectionStepStatus`
 *  as the two single-purpose derivations and composes them here rather than
 *  duplicating either one's logic. */
export function derivePlacementStepStatus(
  dashboardStatus: OnboardingStepStatus,
  panelStatus: OnboardingStepStatus,
): OnboardingStepStatus {
  return dashboardStatus === "complete" ? panelStatus : dashboardStatus;
}

export function allOnboardingStepsComplete(steps: OnboardingStepStatuses): boolean {
  return (
    steps.source === "complete" && steps.pipeline === "complete" && steps.placement === "complete"
  );
}

/** The first step that is not `complete` — the checklist's own emphasis
 *  target (design.md D6, task 2.11): stays on step 1 while a later
 *  collection is still resolving, rather than jumping ahead. `null` once
 *  every step is complete (the completed-chain state has no emphasized
 *  action left to highlight). */
export function firstIncompleteStep(
  steps: OnboardingStepStatuses,
): keyof OnboardingStepStatuses | null {
  const order: Array<keyof OnboardingStepStatuses> = ["source", "pipeline", "placement"];
  return order.find((step) => steps[step] !== "complete") ?? null;
}
