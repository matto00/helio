import { Link } from "react-router-dom";

import type { HomeUpNextItem } from "../types/homeSummary";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { formatClock } from "../utils/timelineScale";
import type { SummaryLoadState } from "./summaryLoadState";

/** The soonest scheduled fires: mono local time and pipeline name, each linking to the pipeline. */
export function UpNext({ items, load }: { items: HomeUpNextItem[]; load: SummaryLoadState }) {
  return (
    <section className="home-card-panel home-upnext" aria-labelledby="home-upnext-heading">
      <h2 id="home-upnext-heading" className="eyebrow home-section__title">
        Up next
      </h2>
      {load === "loading" ? (
        <div role="status" aria-label="Loading up next" className="home-skeleton-rows">
          <Skeleton variant="line" />
          <Skeleton variant="line" width="80%" />
        </div>
      ) : load === "failed" ? (
        <p className="home-note">Not available right now.</p>
      ) : items.length === 0 ? (
        <p className="home-note">
          Nothing is scheduled. <Link to="/pipelines">Schedule a pipeline</Link> to see it here.
        </p>
      ) : (
        <ul className="home-upnext__list">
          {items.map((item) => (
            <li key={`${item.pipelineId}:${item.at}`}>
              <Link to={`/pipelines/${item.pipelineId}`} className="home-upnext__row">
                <span className="home-upnext__time mono">{formatClock(Date.parse(item.at))}</span>
                <span className="home-upnext__name mono">{item.pipelineName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
