import { Skeleton } from "../../../shared/ui/Skeleton";

/**
 * The step-river loading placeholder shared by the page-level `PipelineDetailSkeleton` and the
 * Steps tab's "Loading steps" state (HEL-1501). Pass `ariaLabel` when it stands alone and must
 * announce itself; the page-level skeleton sits inside `PageStatus`'s loading region and omits it.
 */
export function PipelineRiverSkeleton({ ariaLabel }: { ariaLabel?: string }) {
  return (
    <div
      className="pipeline-detail-page__river"
      {...(ariaLabel ? { role: "status", "aria-label": ariaLabel } : {})}
    >
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
  );
}
