import { Workflow } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { useIsPhoneShell } from "../../../app/shell/useIsPhoneShell";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import type { HomeSummary } from "../types/homeSummary";
import { RunDisclosureList } from "./RunDisclosureList";
import { RunTimeline, TimelineLegend } from "./RunTimeline";

interface PipelineRunsCardProps {
  summary: HomeSummary | null;
  status: "idle" | "loading" | "succeeded" | "failed";
  error: string | null;
  now: number;
  onRetry: () => void;
}

/** The "Pipeline runs, last 24h" card: loading skeletons of the final layout, a retryable error, the designed
 *  empty state, then the timeline (rows of marks) or, on a coarse pointer or the phone shell, the disclosure list. */
export function PipelineRunsCard({ summary, status, error, now, onRetry }: PipelineRunsCardProps) {
  const navigate = useNavigate();
  const coarse = useCoarsePointer();
  const phone = useIsPhoneShell();
  const more = summary === null ? 0 : summary.pipelinesWithActivity - summary.pipelines.length;

  return (
    <section className="home-card-panel home-runs" aria-labelledby="home-runs-heading">
      <div className="home-section__head">
        <h2 id="home-runs-heading" className="eyebrow home-section__title">
          Pipeline runs · last 24h
        </h2>
        {summary !== null && summary.pipelines.length > 0 ? <TimelineLegend /> : null}
      </div>
      {summary === null && status !== "failed" ? (
        <div role="status" aria-label="Loading pipeline runs" className="home-runs__skeleton">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} variant="line" height="20px" />
          ))}
        </div>
      ) : summary === null ? (
        <div className="home-note" role="alert">
          <p>{error ?? "Failed to load pipeline activity."}</p>
          <button type="button" className="home-btn home-btn--secondary" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : summary.pipelines.length === 0 ? (
        <EmptyState
          variant="sidebar"
          icon={<Workflow />}
          title="No pipeline runs yet"
          description="When a pipeline runs or is scheduled, it shows up here."
          cta={{ label: "Go to Data Pipelines", onClick: () => navigate("/pipelines") }}
        />
      ) : (
        <>
          {coarse || phone ? (
            <RunDisclosureList summary={summary} />
          ) : (
            <RunTimeline summary={summary} now={now} />
          )}
          {more > 0 ? (
            <Link to="/pipelines" className="home-section__link home-runs__more">
              +{more} more
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}
