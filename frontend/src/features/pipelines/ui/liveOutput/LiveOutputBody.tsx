// HEL-1632 (design.md D6): the part of the live Output column that costs something per edit -- frame to records, the
// renderer and the tiles. It receives its inputs through `useDeferredValue` from `LiveOutputColumn`, so a draft edit commits
// the step count and preview table first and this renders in a deferred pass.

import { memo, useMemo } from "react";

import { keyAggregate } from "../../../panels/ui/outputRenderInputs";
import type { OutputHistory } from "../../../panels/history/outputHistoryService";
import { frameToRecords, orderRecords } from "../../state/liveOutput/frameRecords";
import type { LiveOutputSource } from "../../state/liveOutput/liveOutputSource";
import type { Output } from "../../types/output";
import type { SavedRowsState } from "../../hooks/useSavedOutputRows";
import { LiveOutputRender } from "./LiveOutputRender";

export interface LiveOutputBodyProps {
  output: Output;
  source: LiveOutputSource;
  saved: SavedRowsState | null;
  history: OutputHistory | null;
  sampleTruncated: boolean;
}

/** "+7 vs last run" -- shown only with a baseline point and counts over the same rows (never over a truncated sample). */
export function rowsDeltaText(
  rowsOut: number,
  history: OutputHistory | null,
  sampleTruncated: boolean,
): string | null {
  const last = history?.current?.rowCount;
  if (last === undefined || sampleTruncated) return null;
  const diff = rowsOut - last;
  if (diff === 0) return "same as last run";
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString()} vs last run`;
}

function LiveOutputBodyImpl({
  output,
  source,
  saved,
  history,
  sampleTruncated,
}: LiveOutputBodyProps) {
  const records = useMemo(() => {
    if (source.kind === "frame") return frameToRecords(source.rows, output.schema);
    if (source.kind === "saved" && saved?.status === "ready") {
      return orderRecords(saved.rows, output.schema);
    }
    return null;
  }, [source, saved, output.schema]);
  const aggregate = useMemo(
    () => keyAggregate(output.kind, output.config, records),
    [output.kind, output.config, records],
  );

  if (source.kind === "loading" || (source.kind === "saved" && saved?.status === "loading")) {
    return <p className="live-output__hint">Loading the Output&hellip;</p>;
  }
  if (records === null) {
    return <p className="live-output__hint">No saved data yet. Save &amp; run to populate it.</p>;
  }

  const delta =
    source.kind === "frame" ? rowsDeltaText(records.length, history, sampleTruncated) : null;
  const fromSample = source.kind === "frame" && sampleTruncated;
  return (
    <>
      <div className="live-output__card">
        <LiveOutputRender
          kind={output.kind}
          config={output.config}
          schema={output.schema}
          records={records}
        />
      </div>
      <div className="live-output__tiles">
        <div className="live-output__tile">
          <span className="live-output__tile-label eyebrow">Rows out</span>
          <span className="live-output__tile-value">{records.length.toLocaleString()}</span>
          {delta !== null && <span className="live-output__tile-note">{delta}</span>}
          {fromSample && <span className="live-output__tile-note">sample</span>}
        </div>
        {aggregate !== null && (
          <div className="live-output__tile">
            <span className="live-output__tile-label eyebrow">{aggregate.label}</span>
            <span className="live-output__tile-value">
              {Number.isInteger(aggregate.value)
                ? aggregate.value.toLocaleString()
                : aggregate.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>
    </>
  );
}

export const LiveOutputBody = memo(LiveOutputBodyImpl);
