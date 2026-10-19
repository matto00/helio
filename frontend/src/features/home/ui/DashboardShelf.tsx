import { Link } from "react-router-dom";

import type { Dashboard } from "../../dashboards/types/dashboard";
import { FirstRunDropZone } from "../../onboarding/ui/FirstRunDropZone";
import { Skeleton } from "../../../shared/ui/Skeleton";
import { relativeShelfTime } from "../utils/relativeShelfTime";
import { shelfOrder } from "../utils/shelfOrder";
import { LayoutThumbnail } from "./LayoutThumbnail";

interface DashboardShelfProps {
  dashboards: readonly Dashboard[];
  status: "idle" | "loading" | "succeeded" | "failed";
  changedIds: ReadonlySet<string>;
  now: number;
  onStepByStep: () => void;
}

/** Up to four dashboard cards: the changed ones first, then the most recently updated. Zero dashboards renders the
 *  existing first-run drop zone (HEL-1209) unchanged, so a new user keeps its one-step build. */
export function DashboardShelf({
  dashboards,
  status,
  changedIds,
  now,
  onStepByStep,
}: DashboardShelfProps) {
  const settled = status === "succeeded" || status === "failed";
  const empty = status === "succeeded" && dashboards.length === 0;
  const cards = shelfOrder(dashboards, changedIds);

  return (
    <section className="home-section" aria-labelledby="home-shelf-heading">
      <div className="home-section__head">
        <h2 id="home-shelf-heading" className="eyebrow home-section__title">
          Dashboards
        </h2>
        {dashboards.length > 0 ? (
          <Link to="/dashboards" className="home-section__link">
            All {dashboards.length} <span aria-hidden="true">→</span>
          </Link>
        ) : (
          // Reserves the link's line so the heading is the same height before the list arrives (HEL-1665). It holds the
          // link's own glyphs (hidden), so a fallback font's arrow metrics match the real link's.
          <span className="home-section__link-slot" aria-hidden="true">
            All 0 <span aria-hidden="true">→</span>
          </span>
        )}
      </div>
      {empty ? (
        <FirstRunDropZone onStepByStep={onStepByStep} />
      ) : !settled && dashboards.length === 0 ? (
        <div className="home-shelf" role="status" aria-label="Loading dashboards">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="home-card home-card--skeleton">
              <Skeleton variant="block" className="home-thumb-skeleton" />
              <span className="home-card__foot" aria-hidden="true">
                <span className="home-card__name home-card__name--skeleton">
                  &nbsp;
                  <Skeleton variant="line" width="60%" />
                </span>
                <span className="home-card__time mono">&nbsp;</span>
              </span>
            </div>
          ))}
        </div>
      ) : status === "failed" && dashboards.length === 0 ? (
        <p className="home-note" role="alert">
          Couldn&apos;t load your dashboards. Reload the page to try again.
        </p>
      ) : (
        <ul className="home-shelf">
          {cards.map((dashboard) => {
            const changed = changedIds.has(dashboard.id);
            return (
              <li key={dashboard.id} className="home-shelf__item">
                <Link to={`/dashboards/${dashboard.id}`} className="home-card">
                  <LayoutThumbnail layout={dashboard.layout} />
                  <span className="home-card__foot">
                    <span className="home-card__name">{dashboard.name}</span>
                    <time className="home-card__time mono" dateTime={dashboard.meta.lastUpdated}>
                      {relativeShelfTime(dashboard.meta.lastUpdated, now)}
                    </time>
                    {changed ? (
                      <>
                        <span className="home-card__dot" aria-hidden="true" />
                        <span className="sr-only">, changed since your last visit</span>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
