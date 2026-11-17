// HEL-1632 (design.md D6): the part of the live Output column that costs something per edit -- frame to records, the
// renderer and the tiles. It receives its inputs through `useDeferredValue` from `LiveOutputColumn`, so a draft edit commits
// the step count and preview table first and this renders in a deferred pass.

import { memo, useMemo } from "react";

import { keyAggregate, latestYAggregate } from "../../../panels/ui/outputRenderInputs";
import type { OutputHistory } from "../../../panels/history/outputHistoryService";
import {
  frameColumns,
  frameToRecords,
  orderRecords,
  recordColumns,
} from "../../state/liveOutput/frameRecords";
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
  // The records and the column order they render in. The order is carried apart from the records: a record's own key order is
  // not it (a browser lists integer-like keys first), so the renderers' headers come from `columns` (HEL-1705).
  const shown = useMemo(() => {
    if (source.kind === "frame") {
      return {
        records: frameToRecords(source.rows, output.schema),
        columns: frameColumns(source.rows, output.schema),
      };
    }
    if (source.kind === "saved" && saved?.status === "ready") {
      const columns = saved.columns ?? recordColumns(saved.rows, output.schema);
      return { records: orderRecords(saved.rows, output.schema, columns), columns };
    }
    return null;
  }, [source, saved, output.schema]);
  const records = shown?.records ?? null;
  // The second tile: a metric's or an aggregated chart's aggregate, else (HEL-1705) a plain chart's latest y.
  const columns = shown?.columns;
  const aggregate = useMemo(
    () =>
      keyAggregate(output.kind, output.config, records) ??
      latestYAggregate(output.kind, output.config, output.schema, records, columns),
    [output.kind, output.config, output.schema, records, columns],
  );
  // Whether `records` is the Output's complete set (the compare overlay needs it): a client frame is the sample's, a server
  // frame the rows line's, a saved read the first page's. Fails closed.
  const rowsTruncated =
    source.kind === "frame"
      ? sampleTruncated || source.truncated
      : saved?.status === "ready"
        ? saved.truncated
        : true;

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
          history={history}
          rowsTruncated={rowsTruncated}
          columns={columns}
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
