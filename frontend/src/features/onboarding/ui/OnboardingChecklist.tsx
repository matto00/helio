import { X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import "./OnboardingChecklist.css";
import { OnboardingStep } from "./OnboardingStep";
import type { CreateActionResult } from "../../dashboards/hooks/useCreateDashboardAction";
import { useCreatePanelAction } from "../../panels/hooks/useCreatePanelAction";
import { fetchPanels } from "../../panels/state/panelsSlice";
import { useCreatePipelineAction } from "../../pipelines/hooks/useCreatePipelineAction";
import { fetchPipelines } from "../../pipelines/state/pipelinesSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { isNavSection, sectionForPathname } from "../../../shared/chrome/sections";
import { IconButton } from "../../../shared/ui/IconButton";
import { dismissOnboarding } from "../state/onboardingSlice";
import {
  deriveCollectionStepStatus,
  derivePanelStepStatus,
  derivePlacementStepStatus,
  firstIncompleteStep,
  type OnboardingStepStatuses,
} from "../state/onboardingSteps";

// D8 — each step's glyph comes from the shared section registry (closes
// HEL-794), never a separate hardcoded icon, so the lesson binds concept to
// the same icon the nav uses for it. `sections.ts` guarantees these routes
// are registered, nav-visible entries; the placement step reuses the
// dashboard glyph (a dashboard is where an Output gets placed) since it has
// no nav section of its own.
function navGlyph(pathname: string) {
  const section = sectionForPathname(pathname);
  if (section === undefined || !isNavSection(section)) {
    throw new Error(`onboarding: no registered nav section for ${pathname}`);
  }
  return section.icon;
}
const SOURCE_GLYPH = navGlyph("/sources");
const PIPELINE_GLYPH = navGlyph("/pipelines");
const PLACEMENT_GLYPH = navGlyph("/");

interface OnboardingChecklistProps {
  /** The SAME `useCreateDashboardAction()` instance `PanelList` calls for
   *  its own header/empty-state CTA — sharing one instance is load-bearing
   *  (round-4 skeptic finding): the hook holds `error`/`isPending` in local
   *  `useState`, so a second, independent instance here would report a
   *  failed create nowhere the user can see it. */
  createDashboardAction: CreateActionResult;
  /** Primary in the placement superseding an empty state, Secondary above a
   *  populated/skeleton grid (design.md D6) — computed by `PanelList` off
   *  the same value it uses to suppress the two `EmptyState`s (task 2.13). */
  emphasisVariant: "primary" | "secondary";
}

/** The guided first-run checklist (HEL-554), collapsed to HEL-909's 3-step
 *  model: connect a source, shape it into outputs, place them on a
 *  dashboard. Rendered by `PanelList` whenever `useOnboardingHost()` reports
 *  `visible`; every step's completion is derived from the already-fetched
 *  Redux slices, never from local guesswork. */
export function OnboardingChecklist({
  createDashboardAction,
  emphasisVariant,
}: OnboardingChecklistProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const dashboards = useAppSelector((state) => state.dashboards);
  const panels = useAppSelector((state) => state.panels);
  const pipelineAction = useCreatePipelineAction();
  const panelAction = useCreatePanelAction();

  // HEL-539 pattern (mirrors `PanelList`'s own `isRetryingPanels`) — a local
  // in-flight flag per retryable collection, since `status` itself flips
  // straight to "loading" on retry (swapping the failed branch out) before
  // that re-render actually commits.
  const [retrying, setRetrying] = useState({
    source: false,
    pipeline: false,
    panel: false,
  });

  const dashboardStatus = deriveCollectionStepStatus(dashboards.status, dashboards.items.length);
  const panelStatus = derivePanelStepStatus({
    selectedDashboardId: dashboards.selectedDashboardId,
    panels,
  });
  // "Shape it into outputs" (step 2) has an unmet precondition when no
  // source exists yet — nothing to shape (ADDED requirement, "An unmet
  // precondition leaves a step unavailable").
  const pipelineActionDisabled = sources.items.length === 0;
  const steps: OnboardingStepStatuses = {
    source: deriveCollectionStepStatus(sources.status, sources.items.length),
    pipeline: deriveCollectionStepStatus(pipelines.status, pipelines.items.length),
    placement: derivePlacementStepStatus(dashboardStatus, panelStatus),
  };
  const emphasized = firstIncompleteStep(steps);
  const allComplete = emphasized === null;
  // Step 3's own action/copy depend on whether a dashboard exists yet: with
  // none, the action creates one (there is nothing to place an Output onto
  // yet); once one exists, the action opens the Output picker (task 1.5's
  // `useCreatePanelAction`, never the retired `PanelCreationModal`).
  const dashboardReady = dashboardStatus === "complete";

  function retry(key: keyof typeof retrying, action: () => Promise<unknown>) {
    setRetrying((current) => ({ ...current, [key]: true }));
    void action().finally(() => setRetrying((current) => ({ ...current, [key]: false })));
  }

  return (
    <section className="onboarding-checklist" aria-label="Getting started">
      <div className="onboarding-checklist__header">
        <div className="onboarding-checklist__intro">
          <h2 className="onboarding-checklist__title">
            {allComplete ? "That's the whole chain" : "Build your first dashboard"}
          </h2>
          <p className="onboarding-checklist__lede">
            {allComplete
              ? "Source, outputs, dashboard — every dashboard you build follows it. Find everything else in Dashboards, Pipelines, Sources, Connectors, and the Assistant."
              : "Helio turns a data source into a dashboard in three steps — each one feeds the next."}
          </p>
        </div>
        <IconButton
          icon={<X />}
          variant="ghost"
          aria-label="Dismiss getting-started checklist"
          onClick={() => dispatch(dismissOnboarding())}
        />
      </div>
      <ul className="onboarding-checklist__steps">
        <OnboardingStep
          icon={SOURCE_GLYPH}
          label="Connect a data source"
          description="A CSV, a database, or an API."
          status={steps.source}
          emphasized={emphasized === "source"}
          emphasisVariant={emphasisVariant}
          actionLabel="Go to Data Sources"
          onAction={() => navigate("/sources")}
          collectionError={sources.error}
          retrying={retrying.source}
          onRetry={() => retry("source", () => dispatch(fetchSources()))}
        />
        <OnboardingStep
          icon={PIPELINE_GLYPH}
          label="Shape it into outputs"
          description="Turn that source into the Outputs your dashboards will show."
          status={steps.pipeline}
          emphasized={emphasized === "pipeline"}
          emphasisVariant={emphasisVariant}
          actionLabel={pipelineAction.cta.label}
          onAction={pipelineAction.cta.onClick}
          actionDisabled={pipelineActionDisabled}
          collectionError={pipelines.error}
          retrying={retrying.pipeline}
          onRetry={() => retry("pipeline", () => dispatch(fetchPipelines()))}
        />
        <OnboardingStep
          icon={PLACEMENT_GLYPH}
          label="Place them on a dashboard"
          description="Pick an Output and drop it onto a dashboard to see your data."
          status={steps.placement}
          emphasized={emphasized === "placement"}
          emphasisVariant={emphasisVariant}
          actionLabel={dashboardReady ? panelAction.cta.label : createDashboardAction.cta.label}
          onAction={dashboardReady ? panelAction.cta.onClick : createDashboardAction.cta.onClick}
          actionDisabled={
            dashboardReady ? panelAction.cta.disabled : createDashboardAction.cta.disabled
          }
          collectionError={dashboardReady ? panels.error : dashboards.error}
          createError={dashboardReady ? null : createDashboardAction.error}
          retrying={retrying.panel}
          onRetry={
            dashboardReady
              ? () => {
                  const dashboardId = dashboards.selectedDashboardId;
                  if (dashboardId === null) return;
                  retry("panel", () => dispatch(fetchPanels(dashboardId)));
                }
              : undefined
          }
        />
      </ul>
      {allComplete ? (
        <button
          type="button"
          className={`onboarding-checklist__done onboarding-checklist__done--${emphasisVariant}`}
          onClick={() => dispatch(dismissOnboarding())}
        >
          Done
        </button>
      ) : null}
    </section>
  );
}
