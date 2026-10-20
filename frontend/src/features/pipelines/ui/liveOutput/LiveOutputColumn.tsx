// LiveOutputColumn -- HEL-1632 (design.md D3/D6/D7): the pipeline page's live Output render. One Output, drawn with the
// shared panel renderers from the rows of its node in the client walk (the draft's while a draft exists), with a marker,
// a caption, two summary tiles and the one-time last-run baseline. It writes nothing and reads nothing per edit.

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Select } from "../../../../shared/ui/Select";
import type { usePipelineDraftPresentation } from "../../hooks/usePipelineDraftPresentation";
import { useIdleCoalesced } from "../../hooks/useIdleCoalesced";
import { useLiveOutputBaseline } from "../../hooks/useLiveOutputBaseline";
import { useLiveSampleState } from "../../hooks/useLiveSampleState";
import { clearSavedOutputRows, useSavedOutputRows } from "../../hooks/useSavedOutputRows";
import { liveOutputSource, type LiveMarker } from "../../state/liveOutput/liveOutputSource";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { LiveOutputBody } from "./LiveOutputBody";
import "./LiveOutputColumn.css";

const MARKER_TEXT: Record<Exclude<LiveMarker, "none">, string> = {
  live: "live",
  updating: "updating",
  stale: "stale",
  saved: "saved",
};

function Marker({ marker }: { marker: LiveMarker }) {
  if (marker === "none") return null;
  return (
    <span
      className={`live-output__marker live-output__marker--${marker}`}
      role="status"
      aria-label={`Output is ${MARKER_TEXT[marker]}`}
    >
      {marker === "live" && <span className="live-output__live-dot" aria-hidden="true" />}
      {MARKER_TEXT[marker]}
    </span>
  );
}

/** `column`: the desktop track; `disclosure`: the collapsible section under the preview on a narrow desktop; `phone`:
 *  full width in the Preview tab. */
export type LiveOutputLayout = "column" | "disclosure" | "phone";

interface LiveOutputColumnProps {
  page: PipelinePageState;
  presentation: ReturnType<typeof usePipelineDraftPresentation>;
  selectedStepId: string | null;
  layout?: LiveOutputLayout;
  /** `disclosure` only: whether the body is open. */
  expanded?: boolean;
  onToggle?: () => void;
}

export function LiveOutputColumn(props: LiveOutputColumnProps) {
  const { page, presentation, selectedStepId, layout, expanded, onToggle } = props;
  const fresh = useMemo(
    () => ({ page, presentation, selectedStepId }),
    [page, presentation, selectedStepId],
  );
  // Per-edit changes (the page state, the walk's frames) reach the column at an idle moment, so the column's own render
  // (its hooks, source resolution, the chart) never sits between one edit and the next one's handler. A change of the
  // selected step shows at once.
  const coalesced = useIdleCoalesced(fresh);
  const shown = coalesced.selectedStepId === selectedStepId ? coalesced : fresh;
  return (
    <LiveOutputColumnView
      page={shown.page}
      presentation={shown.presentation}
      selectedStepId={shown.selectedStepId}
      layout={layout}
      expanded={expanded}
      onToggle={onToggle}
    />
  );
}

function LiveOutputColumnView({
  page,
  presentation,
  selectedStepId,
  layout = "column",
  expanded = true,
  onToggle,
}: {
  page: PipelinePageState;
  presentation: ReturnType<typeof usePipelineDraftPresentation>;
  selectedStepId: string | null;
  layout?: LiveOutputLayout;
  /** `disclosure` only: whether the body is open. */
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const outputs = page.allOutputs;
  // The explicit pick holds only for the step it was made on: selecting a step that carries another Output follows it.
  const [pick, setPick] = useState<{ id: string; forStep: string | null } | null>(null);
  const picked =
    pick !== null && pick.forStep === selectedStepId
      ? outputs.find((o) => o.id === pick.id)
      : undefined;
  const output =
    picked ??
    (selectedStepId === null ? undefined : outputs.find((o) => o.nodeStepId === selectedStepId)) ??
    outputs[0];

  const { frames, hasDraft } = presentation;
  const sample = useLiveSampleState(page.roots, page.id ?? "");
  const source = useMemo(
    () =>
      output === undefined
        ? null
        : liveOutputSource({
            output,
            hasDraft,
            sample,
            baseFrame:
              output.nodeStepId === undefined
                ? null
                : (frames.baseRows?.get(output.nodeStepId) ?? null),
            rootFrame:
              output.rootId === undefined ? null : (frames.rootRows.get(output.rootId) ?? null),
            view:
              output.nodeStepId === undefined ? undefined : frames.views?.get(output.nodeStepId),
          }),
    [output, hasDraft, sample, frames],
  );

  const saved = useSavedOutputRows(output?.id ?? null, source?.kind === "saved");
  const history = useLiveOutputBaseline(output?.id ?? null, output?.config ?? null, {
    status: page.runStatus,
    isDry: page.runIsDry === true,
  });

  // A real run settling makes the saved rows (and the baseline, refreshed by the hook) the new run's.
  const settled =
    page.runIsDry !== true && (page.runStatus === "succeeded" || page.runStatus === "failed");
  useEffect(() => {
    if (settled) clearSavedOutputRows();
  }, [settled, page.runStatus]);

  // One value for the memoised body, so it re-renders only when what it draws changes. (This view itself is re-rendered only
  // at an idle moment per edit: `LiveOutputColumn` coalesces its inputs.)
  const model = useMemo(
    () => ({ output, source, saved, history, sampleTruncated: frames.sampleTruncated }),
    [output, source, saved, history, frames.sampleTruncated],
  );

  const collapsible = layout === "disclosure";
  const open = !collapsible || expanded;
  const eyebrow = collapsible ? (
    <button
      type="button"
      className="live-output__toggle eyebrow"
      aria-expanded={expanded}
      onClick={onToggle}
    >
      {expanded ? (
        <ChevronDown size={14} aria-hidden="true" />
      ) : (
        <ChevronRight size={14} aria-hidden="true" />
      )}
      Output
    </button>
  ) : (
    <span className="live-output__eyebrow eyebrow">Output</span>
  );

  if (output === undefined || source === null) {
    return (
      <section className={`live-output live-output--${layout}`} aria-label="Live Output">
        <header className="live-output__header">{eyebrow}</header>
        {open && <p className="live-output__hint">No Output yet. Add one from the spine.</p>}
      </section>
    );
  }

  return (
    <section className={`live-output live-output--${layout}`} aria-label="Live Output">
      <header className="live-output__header">
        {eyebrow}
        <Marker marker={model.source?.kind === "loading" ? "none" : markerOf(model.source)} />
      </header>
      {!open ? null : outputs.length >= 2 ? (
        <Select
          className="live-output__select"
          ariaLabel="Displayed Output"
          value={output.id}
          options={outputs.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(id) => setPick({ id, forStep: selectedStepId })}
        />
      ) : (
        <p className="live-output__name">{output.name}</p>
      )}
      {open && model.output !== undefined && model.source !== null && (
        <LiveOutputBody
          output={model.output}
          source={model.source}
          saved={model.saved}
          history={model.history}
          sampleTruncated={model.sampleTruncated}
        />
      )}
      {open && model.source !== null && model.source.kind !== "loading" && (
        <>
          <p className="live-output__caption">{model.source.caption}</p>
          {model.source.note !== null && <p className="live-output__note">{model.source.note}</p>}
        </>
      )}
    </section>
  );
}

function markerOf(source: ReturnType<typeof liveOutputSource> | null): LiveMarker {
  return source === null || source.kind === "loading" ? "none" : source.marker;
}
