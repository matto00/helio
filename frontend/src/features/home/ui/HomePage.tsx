import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import "./HomePage.css";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useNow } from "../../../hooks/useNow";
import { getServerOffsetMs } from "../../dashboards/tabs/serverClock";
import { reopenOnboarding } from "../../onboarding/state/onboardingSlice";
import { useChangedDashboardIds } from "../hooks/useChangedDashboardIds";
import { loadHomeSummary } from "../state/homeSummarySlice";
import type { SummarySentenceInput } from "../utils/buildSummarySentence";
import type { SummaryLoadState } from "./summaryLoadState";
import { DashboardShelf } from "./DashboardShelf";
import { HomeOpeningLine } from "./HomeOpeningLine";
import { NeedsAttention } from "./NeedsAttention";
import { PipelineRunsCard } from "./PipelineRunsCard";
import { UpNext } from "./UpNext";

/** The Home page (`/home`, HEL-1578): the opening line, the dashboard shelf, the 24h pipeline timeline, Needs
 *  attention and Up next. It adds exactly one request of its own (`GET /api/home-summary`) and reuses the dashboards
 *  list the shell already loads. Loading it records no dashboard view. */
export function HomePage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const summary = useAppSelector((state) => state.homeSummary);
  const dashboards = useAppSelector((state) => state.dashboards);
  const changedIds = useChangedDashboardIds();
  // A 60s tick moves the now line and the relative times without a request; the offset keeps it on server time.
  const tick = useNow(60_000);
  const now = tick + getServerOffsetMs();

  const refetch = useCallback(() => {
    void dispatch(loadHomeSummary());
  }, [dispatch]);
  // After a Retry / Run now: the refetch must land, even when another request is in flight right now.
  const refetchAfterRun = useCallback(() => {
    void dispatch(loadHomeSummary({ queueIfBusy: true }));
  }, [dispatch]);

  useEffect(() => {
    if (summary.refetchQueued && !summary.inFlight) refetch();
  }, [summary.refetchQueued, summary.inFlight, refetch]);

  useEffect(() => {
    refetch();
    function onVisible() {
      if (document.visibilityState === "visible") refetch();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refetch]);

  const data = summary.data;
  const loadState: SummaryLoadState =
    data !== null ? "ready" : summary.status === "failed" ? "failed" : "loading";
  const sentenceInput: SummarySentenceInput | null | "unavailable" =
    data === null
      ? summary.status === "failed"
        ? "unavailable"
        : null
      : {
          changedDashboards: dashboards.items.filter((dashboard) => changedIds.has(dashboard.id))
            .length,
          failedRuns: data.attention.filter(
            (item) => item.kind === "failed" && item.resolvedAt === null,
          ).length,
          stuckRuns: data.attention.filter((item) => item.kind === "stuck").length,
          missedRuns: data.attention.filter((item) => item.kind === "missed").length,
        };

  return (
    <section className="home-page" aria-label="Home">
      <HomeOpeningLine now={now} input={sentenceInput} />
      <DashboardShelf
        dashboards={dashboards.items}
        status={dashboards.status}
        changedIds={changedIds}
        now={now}
        onStepByStep={() => {
          dispatch(reopenOnboarding());
          void navigate("/dashboards", { state: { stepByStep: true } });
        }}
      />
      <div className="home-page__grid">
        <PipelineRunsCard
          summary={data}
          status={summary.status}
          error={summary.error}
          now={now}
          onRetry={refetch}
        />
        <div className="home-page__side">
          <NeedsAttention
            items={data?.attention ?? []}
            load={loadState}
            now={now}
            onRefetch={refetchAfterRun}
            onRetryLoad={refetch}
          />
          <UpNext items={data?.upNext ?? []} load={loadState} />
        </div>
      </div>
    </section>
  );
}
