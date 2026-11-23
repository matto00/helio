// HEL-1640 — test support: every distinct string cell the HEL-1581 parity corpus feeds to a timestamp
// reader. One selector, used both to harvest the strings into `chart-timestamp-parsing.json` and by the
// coverage guard that keeps the fixture from drifting behind the corpus.
//
// Selected vectors (string cells of `inputRows`, every column of the vector):
//   (i)   cast.json vectors whose config casts some column to `timestamp` or `date`
//   (ii)  every datebucket.json vector
//   (iii) compute.json vectors whose expression calls a date/time function
//   (iv)  window.json vectors with a `days` frame
// Deliberately excluded: pipelines.json walk vectors (their strings are the same step configs' inputs,
// already represented in the step files) and secondary-frame rows (a join/union/lookup key is a
// string match, not a timestamp read).

import { readCorpusFile } from "./corpus";

interface Vector {
  config?: Record<string, unknown>;
  inputRows?: Array<Record<string, unknown>>;
}
interface VectorFile {
  vectors: Vector[];
}

const DATE_FUNCTION = /\b(add_days|date_trunc|seconds_between)\s*\(/;

function readsTimestamps(file: string, v: Vector): boolean {
  const config = v.config ?? {};
  switch (file) {
    case "cast.json": {
      const casts = config.casts;
      return (
        typeof casts === "object" &&
        casts !== null &&
        Object.values(casts).some((t) => t === "timestamp" || t === "date")
      );
    }
    case "datebucket.json":
      return true;
    case "compute.json":
      return typeof config.expression === "string" && DATE_FUNCTION.test(config.expression);
    case "window.json":
      return config.frameUnit === "days";
    default:
      return false;
  }
}

/** The distinct strings, in first-seen order. */
export function corpusTimestampStrings(): string[] {
  const seen = new Set<string>();
  for (const file of ["cast.json", "datebucket.json", "compute.json", "window.json"]) {
    for (const v of readCorpusFile<VectorFile>(file).vectors) {
      if (!readsTimestamps(file, v)) continue;
      for (const row of v.inputRows ?? []) {
        for (const cell of Object.values(row)) if (typeof cell === "string") seen.add(cell);
      }
    }
  }
  return [...seen];
}
