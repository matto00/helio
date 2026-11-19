import { useCallback, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";

import { useAppSelector } from "../../../hooks/reduxHooks";
import { useCanUseOutputRoutes } from "../../dashboards/state/dashboardAccessContext";
import type { Output, PublicOutputMeta } from "../../pipelines/types/output";
import type { HistorySource } from "../history/useOutputHistory";
import { InsightNotRenderedState } from "../ui/InsightNotRenderedState";
import { InlineError } from "../../../shared/chrome/InlineError";
import { PanelBodySkeleton } from "../ui/PanelBodySkeleton";
import { CitationChip, type CitationSource } from "./CitationChip";
import { clearInsightChrome, setInsightChrome } from "./insightChromeStore";
import { InsightMarkdown } from "./InsightMarkdown";
import { deriveInsightState, type InsightNote } from "./insightState";
import { useInsight, type InsightSource } from "./useInsight";
import { usePipelineOwnership } from "./usePipelineOwnership";
import "./InsightPanel.css";

interface InsightPanelBodyProps {
  panelId: string;
  outputId: string;
  output: Output | PublicOutputMeta;
  /** Set only by the public viewer: the dashboard and share token the public read authorizes with. */
  historySource?: HistorySource;
  /** A refresh the user started is pending. Nothing sets it until HEL-1743 (L4) adds a refresh that calls the server. */
  refreshPending?: boolean;
}

const NOTES: Record<Exclude<InsightNote, "none">, string> = {
  failed: "The last update failed. Showing the previous insight.",
  unchanged: "Unchanged since the last update.",
  quota: "Not updated: the insight quota for this plan is reached.",
  notUpdated: "Not updated since the last render.",
};

/** HEL-1744 D7 -- the panel body of an `insight` Output: the stored render as sanitized markdown with citation chips, and
 *  exactly one state (see `insightState.ts`). It never shows cost, model or token values (the service drops them), never
 *  asks the server to render, and never reads the Output's rows. */
export function InsightPanelBody(props: InsightPanelBodyProps) {
  // HEL-1773: an insight read is `GET /api/outputs/:id/insight` (an Output route); a dashboard grantee gets a neutral
  // state until it is served through the per-panel route for them. The public viewer (a `historySource`) is unaffected.
  const canUseOutputRoutes = useCanUseOutputRoutes();
  if (!canUseOutputRoutes && props.historySource === undefined) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">Not available on shared dashboards yet</span>
      </div>
    );
  }
  return <InsightPanelBodyContent {...props} />;
}

function InsightPanelBodyContent({
  panelId,
  outputId,
  output,
  historySource,
  refreshPending = false,
}: InsightPanelBodyProps) {
  const isPublic = historySource !== undefined;
  const pipelineId = "pipelineId" in output ? output.pipelineId : null;
  const source = useMemo<InsightSource>(
    () =>
      historySource
        ? {
            variant: "public",
            dashboardId: historySource.dashboardId,
            panelId,
            token: historySource.token,
          }
        : { variant: "authenticated", outputId, pipelineId },
    [historySource, panelId, outputId, pipelineId],
  );
  const { data, loading, error, refetch } = useInsight(source);
  const tier = useAppSelector((state) => state.auth?.currentUser?.tier);
  // The signed-in user (and so their tier) is not loaded yet: what to show for a free-tier owner is not known.
  const authPending = useAppSelector((state) => state.auth?.status === "loading");
  // Ownership only changes what is shown for a free-tier user with no render (the upsell) and for a quota/budget skip, so it
  // is looked up (one cached read per pipeline) only then.
  const attempt = data?.lastAttempt?.status;
  const ownershipMatters =
    (data !== null && data.render === null && tier === "free") ||
    attempt === "skipped_quota" ||
    attempt === "skipped_budget";
  const isPipelineOwner = usePipelineOwnership(isPublic ? null : pipelineId, ownershipMatters);

  // Tell the card chrome the render time (its footer) and how to refresh (its refresh action).
  const owner = useRef(Symbol("insight-panel"));
  const renderedAt = data?.render?.renderedAt ?? null;
  useEffect(() => {
    if (isPublic) return;
    const token = owner.current;
    setInsightChrome(outputId, token, { renderedAt, refetch });
    return () => clearInsightChrome(outputId, token);
  }, [isPublic, outputId, renderedAt, refetch]);

  const chipSource = useMemo<CitationSource>(
    () =>
      historySource
        ? { variant: "public", dashboardId: historySource.dashboardId, token: historySource.token }
        : { variant: "authenticated" },
    [historySource],
  );
  const render = data?.render ?? null;
  const renderCitation = useCallback(
    (id: string) => {
      const index = render?.citations.findIndex((c) => c.id === id) ?? -1;
      if (!render || index < 0) return null;
      return (
        <CitationChip
          citation={render.citations[index]}
          ordinal={index + 1}
          insightPanelId={panelId}
          source={chipSource}
        />
      );
    },
    [render, panelId, chipSource],
  );

  // A free-tier user with no render sees the upsell only if they own the pipeline: hold the skeleton until that is known, so
  // "Not yet rendered" never flashes first.
  if (
    (loading && data === null) ||
    ((isPipelineOwner === undefined || authPending) && render === null)
  ) {
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <PanelBodySkeleton />
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel-content panel-content--state panel-content--error" role="alert">
        <InlineError
          error="Could not load this insight"
          variant="banner"
          kind="error"
          onRetry={refetch}
          announced={false}
        />
      </div>
    );
  }

  const state = deriveInsightState({
    render,
    lastAttempt: data?.lastAttempt ?? null,
    isPipelineOwner: isPipelineOwner === true,
    tier,
    variant: isPublic ? "public" : "authenticated",
    refreshPending,
  });

  if (state.kind === "upsell") {
    return (
      <div className="panel-content panel-content--state" data-testid="insight-upsell">
        <span className="panel-content__state-label">Insights render on the beta plan.</span>
        <p className="panel-content__state-detail">
          <Link to="/settings#beta-access" className="insight-panel__link">
            Request Beta access
          </Link>
        </p>
      </div>
    );
  }
  if (state.kind === "notRendered") return <InsightNotRenderedState />;
  if (state.kind === "failed") {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">The last update failed</span>
        <p className="panel-content__state-detail">No insight has been rendered yet.</p>
      </div>
    );
  }
  if (state.kind === "rendering" && !render) {
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Updating…</span>
      </div>
    );
  }

  return (
    <div className="insight-panel">
      {render && (
        <InsightMarkdown
          markdown={render.markdown}
          citations={render.citations.map((c) => c.id)}
          renderCitation={renderCitation}
        />
      )}
      {state.kind === "rendering" && (
        <p className="insight-panel__note" role="status">
          Updating…
        </p>
      )}
      {state.kind === "rendered" && state.note !== "none" && (
        <p
          className={`insight-panel__note${state.note === "failed" ? " insight-panel__note--error" : ""}`}
          role="status"
        >
          {NOTES[state.note]}
        </p>
      )}
    </div>
  );
}
