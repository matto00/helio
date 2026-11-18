// HEL-1392 design.md D3 — one shared, in-memory cache of `GET /api/outputs/:id` results.
//
// Concurrent consumers share one in-flight request; a result is served to a later consumer only
// while its Output is retained (`outputFreshness`) and nothing has invalidated it since. A failed
// fetch is evicted, never cached.

import { getOutputById } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import {
  currentGeneration,
  currentInvalidationSequence,
  isRetained,
  onFreshnessReset,
  registerOutputPipeline,
} from "./outputFreshness";

interface Entry {
  promise: Promise<Output>;
  value?: Output;
  generation: number;
}

const cache = new Map<string, Entry>();
/** HEL-1744: an Output's kind never changes after it is created, so a resolved kind outlives the metadata's freshness (a run's
 *  invalidation drops the held value, not the kind). It lets a panel know it is an insight and skip rows after a run. */
const knownKinds = new Map<string, string>();
onFreshnessReset(() => {
  cache.clear();
  knownKinds.clear();
});

/** The kind this session has resolved for `outputId`, or `undefined` if it never has. */
export function getKnownOutputKind(outputId: string): string | undefined {
  return knownKinds.get(outputId);
}

function isServable(outputId: string, entry: Entry): boolean {
  return entry.generation === currentGeneration(outputId) && isRetained(outputId);
}

/** The held metadata for `outputId`, or `undefined` when none is held or it may be stale. */
export function getOutputMetaCached(outputId: string): Output | undefined {
  const entry = cache.get(outputId);
  return entry?.value !== undefined && isServable(outputId, entry) ? entry.value : undefined;
}

/** Resolves `outputId`'s metadata, sharing one network request among concurrent callers. */
export function fetchOutputMeta(outputId: string): Promise<Output> {
  const existing = cache.get(outputId);
  if (existing && existing.generation === currentGeneration(outputId)) {
    if (existing.value === undefined || isRetained(outputId)) return existing.promise;
  }
  const sequenceAtStart = currentInvalidationSequence();
  const entry: Entry = { generation: currentGeneration(outputId), promise: undefined as never };
  entry.promise = getOutputById(outputId).then(
    (output) => {
      registerOutputPipeline(outputId, output.pipelineId);
      knownKinds.set(outputId, output.kind);
      // An invalidation that landed while this was in flight means the result may predate a write:
      // hand it to the callers that asked, but never serve it to a later mount.
      if (currentInvalidationSequence() !== sequenceAtStart) {
        if (cache.get(outputId) === entry) cache.delete(outputId);
        return output;
      }
      entry.value = output;
      entry.generation = currentGeneration(outputId);
      return output;
    },
    (err: unknown) => {
      if (cache.get(outputId) === entry) cache.delete(outputId);
      throw err;
    },
  );
  cache.set(outputId, entry);
  return entry.promise;
}

/** HEL-1575 D5: the held metadata regardless of retention, for capturing a warm entry. */
export function peekOutputMeta(outputId: string): Output | undefined {
  return cache.get(outputId)?.value;
}

/** HEL-1575 D5 step 3: seeds a restored copy of `outputId`'s metadata. Registers its pipeline (so a
 *  pipeline-level invalidation reaches the Output) and stamps the CURRENT generation: the counters
 *  restart at zero on a page load, so the generation it was fetched under is meaningless now. */
export function seedOutputMeta(outputId: string, meta: Output): void {
  registerOutputPipeline(outputId, meta.pipelineId);
  knownKinds.set(outputId, meta.kind);
  cache.set(outputId, {
    promise: Promise.resolve(meta),
    value: meta,
    generation: currentGeneration(outputId),
  });
}
