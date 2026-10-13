import { Skeleton } from "../../../shared/ui/Skeleton";
import { PipelineRiverSkeleton } from "./PipelineRiverSkeleton";

/**
 * Initial-load placeholder for `PipelineDetailPage` (HEL-528, design.md D3).
 * Reuses the real header/river/footer wrapper classes so the three bands'
 * geometry (padding, border, background) comes from `PipelineDetailHeader.css`
 * / `PipelineDetailPage.css` rather than being re-guessed here — only the
 * three groups' inner content, the river's step ribbons, and the footer's
 * label/value pairs are `Skeleton` placeholders.
 */
export function PipelineDetailSkeleton() {
  return (
    <>
      <div className="pipeline-detail-header">
        <div className="pipeline-detail-header__group">
          <Skeleton variant="line" width="3em" />
          <Skeleton variant="line" width="9em" />
        </div>
        <div className="pipeline-detail-header__group">
          <Skeleton variant="line" width="3em" />
          <Skeleton variant="line" width="9em" />
        </div>
        <div className="pipeline-detail-header__group">
          <Skeleton variant="line" width="4em" />
          <Skeleton variant="line" width="7em" />
        </div>
      </div>
      <PipelineRiverSkeleton />
      <div className="pipeline-detail-page__footer-region">
        <div className="pipeline-detail-page__footer">
          <div className="pipeline-detail-page__footer-left">
            <Skeleton variant="line" width="6em" />
            <Skeleton variant="line" width="10em" />
          </div>
          <div className="pipeline-detail-page__footer-right">
            <Skeleton variant="line" width="4em" />
            <Skeleton variant="circle" width={28} height={28} />
          </div>
        </div>
      </div>
    </>
  );
}
