import { RefreshCw } from "lucide-react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useNow } from "../../../hooks/useNow";
import { IconButton } from "../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { fetchSourceSample, selectSourceSampleEntry } from "../state/sourceSamplesSlice";
import { describeSampleLabel } from "../utils/describeSampleLabel";
import "./SourceSampleLabel.css";

interface SourceSampleLabelProps {
  sourceId: string;
  sourceName: string;
  /** Whether the source is in the caller's own list. A source that is not has no readable sample. */
  resolvable: boolean;
}

// The age text re-renders on a 30 s tick so "fetched 3 minutes ago" stays honest on a long-open page.
const AGE_TICK_MS = 30_000;

/**
 * HEL-1628 (docs/live-draft-preview.md §4): the sample label and refresh control under a source on the pipeline
 * page. Rules live in `describeSampleLabel`; this component only chooses between loading, unavailable and the
 * described label, and owns the one manual re-fetch (`force`).
 */
export function SourceSampleLabel({ sourceId, sourceName, resolvable }: SourceSampleLabelProps) {
  const dispatch = useAppDispatch();
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const entry = useAppSelector((state) => selectSourceSampleEntry(state, sourceId));
  const now = useNow(AGE_TICK_MS);

  const loading = entry?.status === "loading";
  // Only idle/loading is still waiting; a failed sources list means ownership is unknown and no capture was sent.
  const waitingForSources = (sourcesStatus === "idle" || sourcesStatus === "loading") && !entry;
  const label = entry?.sample ? describeSampleLabel(entry.sample, now) : null;

  let text: string;
  if (label) text = label.text;
  else if (waitingForSources || loading) text = "Loading sample…";
  else text = "Sample unavailable";

  // A source the caller does not own cannot be sampled (and is never requested): no refresh to offer.
  const canRefresh = resolvable && sourcesStatus === "succeeded";

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
            onClick={() => void dispatch(fetchSourceSample({ sourceId, force: true }))}
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
