import { Modal } from "../../../shared/ui/Modal";
import { PreviewTable } from "../../panels/ui/PreviewTable";

interface PipelinePreviewModalProps {
  rows: Record<string, unknown>[] | null;
  rowCount: number | null;
  isDry: boolean | null;
  onClose: () => void;
}

export function PipelinePreviewModal({
  rows,
  rowCount,
  isDry,
  onClose,
}: PipelinePreviewModalProps) {
  const hasRun = rows !== null;
  const displayCount = rowCount ?? rows?.length ?? 0;
  const subtitle = !hasRun
    ? "Run the pipeline to see its output."
    : `${isDry ? "Dry run" : "Last run"} — ${displayCount.toLocaleString()} row${
        displayCount === 1 ? "" : "s"
      }`;

  return (
    <Modal
      open
      title="Pipeline output preview"
      description={subtitle}
      size="lg"
      ariaLabel="Pipeline output preview"
      onClose={onClose}
    >
      {!hasRun ? (
        <p className="preview-table__empty">
          No output yet — click <strong>Run pipeline</strong> or <strong>Dry run</strong> to
          populate this view.
        </p>
      ) : (
        <PreviewTable rows={rows} emptyText="Pipeline returned no rows." />
      )}
    </Modal>
  );
}
