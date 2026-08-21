import { Skeleton } from "../../../shared/ui/Skeleton";

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
      <div className="pipeline-detail-page__river">
        {/* skeptic-final-1.md non-blocking note — `--skeleton` adds a small gap
         * between the three ribbon placeholders. The real river's `gap: 0` is
         * fine for actual step ribbons (each carries its own
         * `.pipeline-detail-page__step-section` border), but these placeholders
         * have no border of their own, so zero gap fused them into one
         * undifferentiated block instead of reading as three steps. */}
        <div className="pipeline-detail-page__river-inner pipeline-detail-page__river-inner--skeleton">
          <Skeleton variant="block" className="pipeline-detail-page__ribbon" />
          <Skeleton variant="block" className="pipeline-detail-page__ribbon" />
          <Skeleton variant="block" className="pipeline-detail-page__ribbon" />
        </div>
      </div>
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
