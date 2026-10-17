// HEL-1581 — the kind table. The 23 non-server kinds are evaluated here; the four server kinds are
// listed so `clientEvaluable` can name why they decline.

import { aggregateHandler, groupByHandler, pivotHandler } from "./aggregate";
import { castHandler, dateBucketHandler } from "./cast";
import { joinHandler, lookupHandler, unionHandler } from "./combine";
import { fillNullHandler } from "./fillnull";
import { filterHandler, sortHandler } from "./filterSort";
import { assertHandler, upsertSourceHandler } from "./identity";
import {
  dedupeHandler,
  limitHandler,
  renameHandler,
  selectHandler,
  unpivotHandler,
} from "./rowOps";
import { computeHandler } from "./compute";
import { extractHeadingsHandler, splitTextHandler } from "./splitText";
import { stringOpsHandler } from "./stringOps";
import type { StepHandler } from "./types";
import { windowHandler } from "./window";

// The table mixes handlers of different config types, so the element type is erased; each handler decodes its own config.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = StepHandler<any>;

/** Every kind the client evaluator implements (its kind set is checked against the manifest). */
export const CLIENT_HANDLERS: Readonly<Record<string, AnyHandler>> = {
  rename: renameHandler,
  select: selectHandler,
  limit: limitHandler,
  filter: filterHandler,
  groupby: groupByHandler,
  dedupe: dedupeHandler,
  unpivot: unpivotHandler,
  extractheadings: extractHeadingsHandler,
  splittext: splitTextHandler,
  sort: sortHandler,
  cast: castHandler,
  aggregate: aggregateHandler,
  datebucket: dateBucketHandler,
  fillnull: fillNullHandler,
  pivot: pivotHandler,
  window: windowHandler,
  stringops: stringOpsHandler,
  compute: computeHandler,
  join: joinHandler,
  union: unionHandler,
  lookup: lookupHandler,
  assert: assertHandler,
  upsertsource: upsertSourceHandler,
};

/** Server kinds: always `needsServer` when enabled. */
export const SERVER_KINDS: readonly string[] = ["chunkbytokencount", "convertformat"];
/** AI kinds: `notPreviewed` when enabled (owner ruling F), and so is everything downstream. */
export const AI_KINDS: readonly string[] = ["analyzewithai", "generatetext"];

const hasOwn = Object.prototype.hasOwnProperty;

export function handlerFor(kind: string): AnyHandler | undefined {
  return hasOwn.call(CLIENT_HANDLERS, kind) ? CLIENT_HANDLERS[kind] : undefined;
}
