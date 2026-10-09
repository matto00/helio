// HEL-1392 design.md D1 — which Output data a remounting panel card may still trust.
//
// Two things decide that: (1) whether anything the client observed has changed the Output since the
// data was fetched (a monotonically increasing per-Output `generation`, bumped by Output/pipeline
// writes and successful runs), and (2) whether the Output has been on screen recently (a refcount
// plus a grace window), so a desktop <-> phone swap — which unmounts the old tree and mounts the new
// one in the same commit — never loses the Output, however long the user had been reading before it.
// Module-level (not Redux) so services and the SSE fan-out can invalidate without an import cycle;
// this file must stay import-free.

/** How long an Output stays trusted after its last card left the screen. */
export const REMOUNT_GRACE_MS = 30_000;

interface Retention {
  count: number;
  releasedAt: number | null;
}

let globalGeneration = 0;
let invalidationSequence = 0;
const outputGeneration = new Map<string, number>();
const pipelineGeneration = new Map<string, number>();
const pipelineOfOutput = new Map<string, string>();
const retention = new Map<string, Retention>();
const resetHooks = new Set<() => void>();

/** The generation data fetched for `outputId` right now would carry. */
export function currentGeneration(outputId: string): number {
  const pipelineId = pipelineOfOutput.get(outputId);
  return (
    globalGeneration +
    (outputGeneration.get(outputId) ?? 0) +
    (pipelineId ? (pipelineGeneration.get(pipelineId) ?? 0) : 0)
  );
}

/** Remembers which pipeline an Output belongs to (learned from its metadata) so a pipeline-level
 *  invalidation reaches it. */
export function registerOutputPipeline(outputId: string, pipelineId: string): void {
  pipelineOfOutput.set(outputId, pipelineId);
}

export function pipelineIdOfOutput(outputId: string): string | undefined {
  return pipelineOfOutput.get(outputId);
}

export function invalidateOutput(outputId: string): void {
  invalidationSequence += 1;
  outputGeneration.set(outputId, (outputGeneration.get(outputId) ?? 0) + 1);
}

export function invalidatePipeline(pipelineId: string): void {
  invalidationSequence += 1;
  pipelineGeneration.set(pipelineId, (pipelineGeneration.get(pipelineId) ?? 0) + 1);
}

/** For writes that carry no usable pipeline/Output id, and for logout / user change. */
export function invalidateAll(): void {
  invalidationSequence += 1;
  globalGeneration += 1;
}

/** Bumped by every invalidation of any scope; a request that sees it change while in flight knows
 *  its result may predate a write. */
export function currentInvalidationSequence(): number {
  return invalidationSequence;
}

export function retain(outputId: string): void {
  const entry = retention.get(outputId);
  if (entry) {
    entry.count += 1;
    entry.releasedAt = null;
  } else {
    retention.set(outputId, { count: 1, releasedAt: null });
  }
}

export function release(outputId: string): void {
  const entry = retention.get(outputId);
  if (!entry || entry.count === 0) return;
  entry.count -= 1;
  if (entry.count === 0) entry.releasedAt = Date.now();
}

/** True while a card is mounted for `outputId`, or one left within `REMOUNT_GRACE_MS`. */
export function isRetained(outputId: string): boolean {
  const entry = retention.get(outputId);
  if (!entry) return false;
  if (entry.count > 0) return true;
  return entry.releasedAt !== null && Date.now() - entry.releasedAt < REMOUNT_GRACE_MS;
}

/** Lets a sibling cache clear itself when the freshness state is reset. */
export function onFreshnessReset(hook: () => void): void {
  resetHooks.add(hook);
}

/** Test helper (also used on logout): forgets every generation and retention record. */
export function resetOutputFreshness(): void {
  globalGeneration = 0;
  invalidationSequence = 0;
  outputGeneration.clear();
  pipelineGeneration.clear();
  pipelineOfOutput.clear();
  retention.clear();
  for (const hook of resetHooks) hook();
}
