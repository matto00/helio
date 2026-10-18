import { useAppSelector } from "../../../hooks/reduxHooks";
import { useNow } from "../../../hooks/useNow";
import { selectSourceSampleEntry } from "../state/sourceSamplesSlice";
import { describeSampleLabel, type SampleLabel } from "../utils/describeSampleLabel";
import { useSourceSampleAccess } from "./useSourceSampleAccess";

// The age text re-renders on a 30 s tick so "fetched 3 minutes ago" stays honest on a long-open page.
const AGE_TICK_MS = 30_000;

/** What the sample label under a source shows, decided once so `SourceSampleLabel` and any card that must know the
 *  label's text (HEL-1668: the source card omits its kind meta when the label already names it) agree. */
export function useSourceSampleLabel(sourceId: string, pipelineId: string) {
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const entry = useAppSelector((state) => selectSourceSampleEntry(state, sourceId));
  const now = useNow(AGE_TICK_MS);
  const access = useSourceSampleAccess(pipelineId, sourceId);

  const loading = entry?.status === "loading";
  // Only idle/loading is still waiting; a failed sources list means ownership is unknown and no capture was sent.
  const waitingForSources = (sourcesStatus === "idle" || sourcesStatus === "loading") && !entry;
  const label: SampleLabel | null = entry?.sample ? describeSampleLabel(entry.sample, now) : null;

  let text: string | null;
  // HEL-1648 (D6b): a viewer's source they do not own has no sample and is never requested -- no label at all.
  if (access === "no") text = null;
  else if (label) text = label.text;
  else if (access === "unavailable") text = "Sample unavailable";
  else if (access === "unknown" || waitingForSources || loading) text = "Loading sample…";
  else text = "Sample unavailable";

  return {
    /** The rendered label text; null when no label is rendered at all. */
    text,
    caveat: label?.caveat,
    loading,
    entry,
    // Nothing to refresh until the caller is known to be allowed to sample the source.
    canRefresh: access === "yes" && !waitingForSources,
  };
}
