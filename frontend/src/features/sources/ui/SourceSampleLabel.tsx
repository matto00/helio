import { RefreshCw } from "lucide-react";

import { useAppDispatch } from "../../../hooks/reduxHooks";
import { IconButton } from "../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { useSourceSampleLabel } from "../hooks/useSourceSampleLabel";
import { fetchSourceSample } from "../state/sourceSamplesSlice";
import "./SourceSampleLabel.css";

interface SourceSampleLabelProps {
  sourceId: string;
  sourceName: string;
  /** The pipeline page this label is on (HEL-1648): decides whether the source may be sampled (owned, or the
   *  caller's role on this pipeline) and is the scope a refresh is sent with. */
  pipelineId: string;
}

/**
 * HEL-1628 (docs/live-draft-preview.md §4): the sample label and refresh control under a source on the pipeline
 * page. Rules live in `describeSampleLabel`; this component only chooses between loading, unavailable and the
 * described label, and owns the one manual re-fetch (`force`).
 */
export function SourceSampleLabel({ sourceId, sourceName, pipelineId }: SourceSampleLabelProps) {
  const dispatch = useAppDispatch();
  const { text, caveat, loading, entry, canRefresh } = useSourceSampleLabel(sourceId, pipelineId);

  if (text === null) return null;

  return (
    <div className="source-sample-label" aria-busy={loading}>
      <span className="source-sample-label__line">
        <span className="source-sample-label__text">{text}</span>
        {canRefresh && (
          <IconButton
            size="xs"
            aria-label={`Refresh sample of ${sourceName}`}
            title="Refresh sample"
            icon={<RefreshCw size={ICON_SIZE.sm} />}
            disabled={loading}
            onClick={() => void dispatch(fetchSourceSample({ sourceId, pipelineId, force: true }))}
          />
        )}
      </span>
      {caveat && <span className="source-sample-label__caveat">{caveat}</span>}
      {entry?.status === "error" && entry.sample && (
        <span className="source-sample-label__caveat">
          Refresh failed; showing the last sample.
        </span>
      )}
    </div>
  );
}
