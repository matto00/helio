import { formatRelativeTime } from "../../../utils/formatRelativeTime";
import type { SourceSample } from "../types/dataSource";

// HEL-1628 (docs/live-draft-preview.md §4): what a source's sample is called on the pipeline page.
//
//   non-static (`live`), exact     "sample · 412 rows · fetched 3 minutes ago"
//   non-static, first 1,000        "sample · first 1,000 of 12,431 rows · fetched 3 minutes ago" + caveat
//   static, over 1,000             "first 1,000 of 12,431 rows" + caveat (no age: the data cannot have moved)
//   static, exact                  "Static · 30 rows"
//
// A truncated live read can have no known total (SQL's `maxRows + 1` probe): N then reads "1,000+".

export interface SampleLabel {
  text: string;
  /** Present when the rows are only a prefix of the source: counts and aggregates describe the sample. */
  caveat?: string;
}

export const SAMPLE_CAVEAT = "Counts and aggregates describe this sample, not the whole source.";

const formatCount = (n: number): string => n.toLocaleString("en-US");

const rowsPhrase = (n: number): string => `${formatCount(n)} ${n === 1 ? "row" : "rows"}`;

export function describeSampleLabel(sample: SourceSample, now: number = Date.now()): SampleLabel {
  if (sample.truncated) {
    const total = sample.sourceRowCount === null ? "1,000+" : formatCount(sample.sourceRowCount);
    const head = `first 1,000 of ${total} rows`;
    return sample.live
      ? {
          text: `sample · ${head} · fetched ${formatRelativeTime(sample.capturedAt, now)}`,
          caveat: SAMPLE_CAVEAT,
        }
      : { text: head, caveat: SAMPLE_CAVEAT };
  }
  const count = sample.sourceRowCount ?? sample.rows.length;
  return sample.live
    ? {
        text: `sample · ${rowsPhrase(count)} · fetched ${formatRelativeTime(sample.capturedAt, now)}`,
      }
    : { text: `Static · ${rowsPhrase(count)}` };
}
