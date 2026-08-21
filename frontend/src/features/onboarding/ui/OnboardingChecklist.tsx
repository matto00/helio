import { LayoutGrid, Shapes, X } from "lucide-react";
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
  firstIncompleteStep,
  type OnboardingStepStatuses,
} from "../state/onboardingSteps";

// D8 — each step's glyph comes from the shared section registry, never
// re-picked, so the lesson binds concept to the same icon the nav uses for
// it. `sections.ts` guarantees these four routes are registered, nav-visible
// entries; `LayoutGrid` is the documented fallback for the (unreachable in
// practice) case a lookup ever misses, narrowed with `isNavSection` rather
// than a non-null assertion.
function navGlyph(pathname: string) {
  const section = sectionForPathname(pathname);
  return section !== undefined && isNavSection(section) ? section.icon : LayoutGrid;
}
const SOURCE_GLYPH = navGlyph("/sources");
const PIPELINE_GLYPH = navGlyph("/pipelines");
const DASHBOARD_GLYPH = navGlyph("/");
// Panels have no nav section of their own (D8) — reuses the glyph the panel
// empty state already carries (`PanelList.tsx`'s `LayoutGrid` icon).
const PANEL_GLYPH = LayoutGrid;

const PIPELINE_STEP_DESCRIPTION = (
  <>
    Shape that source into a <Shapes aria-hidden="true" className="onboarding-checklist__glyph" />{" "}
    type. Types are only ever a pipeline&rsquo;s output — you never create one directly.
  </>
);

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

/** The guided first-run checklist (HEL-554) — a dismissible, four-step
 *  sequence teaching the source -> pipeline -> type -> panel model. Rendered
 *  by `PanelList` whenever `useOnboardingHost()` reports `visible`; every
 *  step's completion is derived from the already-fetched Redux slices, never
 *  from local guesswork. */
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

  const steps: OnboardingStepStatuses = {
    source: deriveCollectionStepStatus(sources.status, sources.items.length),
    pipeline: deriveCollectionStepStatus(pipelines.status, pipelines.items.length),
    dashboard: deriveCollectionStepStatus(dashboards.status, dashboards.items.length),
    panel: derivePanelStepStatus({ selectedDashboardId: dashboards.selectedDashboardId, panels }),
  };
  const emphasized = firstIncompleteStep(steps);
  const allComplete = emphasized === null;

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
              ? "Source, pipeline, type, panel — every dashboard you build follows it."
              : "Helio turns a data source into a dashboard in four steps — each one feeds the next."}
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
          label="Build a pipeline"
          description={PIPELINE_STEP_DESCRIPTION}
          status={steps.pipeline}
          emphasized={emphasized === "pipeline"}
          emphasisVariant={emphasisVariant}
          actionLabel={pipelineAction.cta.label}
          onAction={pipelineAction.cta.onClick}
          collectionError={pipelines.error}
          retrying={retrying.pipeline}
          onRetry={() => retry("pipeline", () => dispatch(fetchPipelines()))}
        />
        <OnboardingStep
          icon={DASHBOARD_GLYPH}
          label="Create a dashboard"
          description="A canvas for your panels."
          status={steps.dashboard}
          emphasized={emphasized === "dashboard"}
          emphasisVariant={emphasisVariant}
          actionLabel={createDashboardAction.cta.label}
          onAction={createDashboardAction.cta.onClick}
          actionDisabled={createDashboardAction.cta.disabled}
          collectionError={dashboards.error}
          createError={createDashboardAction.error}
        />
        <OnboardingStep
          icon={PANEL_GLYPH}
          label="Add a panel"
          description="Bind a panel to that type to see your data."
          status={steps.panel}
          emphasized={emphasized === "panel"}
          emphasisVariant={emphasisVariant}
          actionLabel={panelAction.cta.label}
          onAction={panelAction.cta.onClick}
          actionDisabled={panelAction.cta.disabled}
          collectionError={panels.error}
          retrying={retrying.panel}
          onRetry={() => {
            const dashboardId = dashboards.selectedDashboardId;
            if (dashboardId === null) return;
            retry("panel", () => dispatch(fetchPanels(dashboardId)));
          }}
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
