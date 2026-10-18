import { Skeleton } from "../../../shared/ui/Skeleton";
import { PipelineRiverSkeleton } from "./PipelineRiverSkeleton";

/**
 * Initial-load placeholder for `PipelineDetailPage` (HEL-528, design.md D3; HEL-1582 retired the
 * header/footer bands of the river layout it used to mimic). One header band (the name and the status
 * line) over the shared steps placeholder, in the same wrapper classes the steps placeholder already
 * uses; the band's geometry lives in `PipelineDetailPage.css`.
 */
export function PipelineDetailSkeleton() {
  return (
    <>
      <div className="pipeline-detail-page__skeleton-header">
        <Skeleton variant="line" width="12em" />
        <Skeleton variant="line" width="7em" />
      </div>
      <PipelineRiverSkeleton />
    </>
  );
}
