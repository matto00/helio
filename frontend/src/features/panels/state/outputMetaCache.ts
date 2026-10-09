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
onFreshnessReset(() => cache.clear());

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
