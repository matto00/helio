import { RefreshCw } from "lucide-react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useNow } from "../../../hooks/useNow";
import { IconButton } from "../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { useSourceSampleAccess } from "../hooks/useSourceSampleAccess";
import { fetchSourceSample, selectSourceSampleEntry } from "../state/sourceSamplesSlice";
import { describeSampleLabel } from "../utils/describeSampleLabel";
import "./SourceSampleLabel.css";

interface SourceSampleLabelProps {
  sourceId: string;
  sourceName: string;
  /** The pipeline page this label is on (HEL-1648): decides whether the source may be sampled (owned, or the
   *  caller's role on this pipeline) and is the scope a refresh is sent with. */
  pipelineId: string;
}

// The age text re-renders on a 30 s tick so "fetched 3 minutes ago" stays honest on a long-open page.
const AGE_TICK_MS = 30_000;

/**
 * HEL-1628 (docs/live-draft-preview.md §4): the sample label and refresh control under a source on the pipeline
 * page. Rules live in `describeSampleLabel`; this component only chooses between loading, unavailable and the
 * described label, and owns the one manual re-fetch (`force`).
 */
export function SourceSampleLabel({ sourceId, sourceName, pipelineId }: SourceSampleLabelProps) {
  const dispatch = useAppDispatch();
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const entry = useAppSelector((state) => selectSourceSampleEntry(state, sourceId));
  const now = useNow(AGE_TICK_MS);
  const access = useSourceSampleAccess(pipelineId, sourceId);

  const loading = entry?.status === "loading";
  // Only idle/loading is still waiting; a failed sources list means ownership is unknown and no capture was sent.
  const waitingForSources = (sourcesStatus === "idle" || sourcesStatus === "loading") && !entry;
  const label = entry?.sample ? describeSampleLabel(entry.sample, now) : null;

  // HEL-1648 (D6b): a viewer's source they do not own has no sample and is never requested -- no label at all.
  if (access === "no") return null;

  let text: string;
  if (label) text = label.text;
  else if (access === "unavailable") text = "Sample unavailable";
  else if (access === "unknown" || waitingForSources || loading) text = "Loading sample…";
  else text = "Sample unavailable";

  // Nothing to refresh until the caller is known to be allowed to sample the source.
  const canRefresh = access === "yes" && !waitingForSources;

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
      {label?.caveat && <span className="source-sample-label__caveat">{label.caveat}</span>}
      {entry?.status === "error" && entry.sample && (
        <span className="source-sample-label__caveat">
          Refresh failed; showing the last sample.
        </span>
      )}
    </div>
  );
}
