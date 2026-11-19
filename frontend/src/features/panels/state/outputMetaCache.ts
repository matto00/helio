// HEL-1392 design.md D3 — one shared, in-memory cache of `GET /api/outputs/:id` results.
//
// Concurrent consumers share one in-flight request; a result is served to a later consumer only
// while its Output is retained (`outputFreshness`) and nothing has invalidated it since. A failed
// fetch is evicted, never cached.

import { preloadChartPanel } from "../ui/renderers/chartPanelModule";
import { fetchPublicOutputMeta } from "../../dashboards/services/publicDashboardService";
import { getOutputById } from "../../pipelines/services/outputService";
import type { Output, PublicOutputMeta } from "../../pipelines/types/output";
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
  /** HEL-1773: true when this entry was read through a shared dashboard's per-panel route (a stub with no owner and no
   *  pipeline). An entry is only ever served, shared or captured for the route it came from: a scope change never lets an
   *  owned dashboard render a stub, nor a shared one render an owner's copy. */
  scoped: boolean;
}

const cache = new Map<string, Entry>();

/** HEL-1773 -- THE one seam that decides how an Output's metadata is read. A panel on a dashboard the caller does not
 *  own (a named grantee, editor or viewer) has no business at `GET /api/outputs/:id`: that route is gated only by RLS on
 *  the Output's pipeline, which a dashboard-only grant does not satisfy in production. `fetchPanels` registers each such
 *  panel here (`scopeOutputToPanel`), and every consumer of `fetchOutputMeta` / `useOutputMeta` then reads the same
 *  Output through the dashboard-scoped `.../panels/:panelId/output-meta` route instead. An owner's dashboard clears the
 *  entry (`unscopeOutput`), so an Output the caller owns is never read through the narrower route. */
interface PanelScope {
  dashboardId: string;
  panelId: string;
}
const panelScopes = new Map<string, PanelScope>();

export function scopeOutputToPanel(outputId: string, dashboardId: string, panelId: string): void {
  panelScopes.set(outputId, { dashboardId, panelId });
}

export function unscopeOutput(outputId: string): void {
  panelScopes.delete(outputId);
}

/** The panel scope `outputId` is read through, or `undefined` when it is read through the Output route. */
export function getOutputPanelScope(outputId: string): PanelScope | undefined {
  return panelScopes.get(outputId);
}

/** The per-panel `output-meta` response as the `Output` the renderers take. It carries none of the Output's identity
 *  beyond what the route returns: no pipeline (so no run freshness), no owner (so a table can never persist a column
 *  change through `PATCH /api/outputs/:id`), no name or timestamps. */
function outputFromPublicMeta(outputId: string, meta: PublicOutputMeta): Output {
  return {
    id: outputId,
    pipelineId: "",
    ownerId: "",
    name: "",
    kind: meta.kind,
    config: meta.config,
    schema: meta.schema,
    createdAt: "",
    updatedAt: "",
  };
}
/** HEL-1744: an Output's kind never changes after it is created, so a resolved kind outlives the metadata's freshness (a run's
 *  invalidation drops the held value, not the kind). It lets a panel know it is an insight and skip rows after a run. */
const knownKinds = new Map<string, string>();
onFreshnessReset(() => {
  cache.clear();
  knownKinds.clear();
  panelScopes.clear();
});

/** The kind this session has resolved for `outputId`, or `undefined` if it never has. */
export function getKnownOutputKind(outputId: string): string | undefined {
  return knownKinds.get(outputId);
}

/** Records `outputId`'s kind and, for a chart, starts loading the chart code (HEL-1760): it overlaps the rows fetch instead of
 *  waiting for the chart component to mount. `chartPanelModule` holds no React and no state. */
function noteKind(outputId: string, kind: string): void {
  knownKinds.set(outputId, kind);
  if (kind === "chart") preloadChartPanel();
}

function isServable(outputId: string, entry: Entry): boolean {
  return (
    entry.scoped === panelScopes.has(outputId) &&
    entry.generation === currentGeneration(outputId) &&
    isRetained(outputId)
  );
}

/** The held metadata for `outputId`, or `undefined` when none is held or it may be stale. */
export function getOutputMetaCached(outputId: string): Output | undefined {
  const entry = cache.get(outputId);
  return entry?.value !== undefined && isServable(outputId, entry) ? entry.value : undefined;
}

/** Resolves `outputId`'s metadata, sharing one network request among concurrent callers. */
export function fetchOutputMeta(outputId: string): Promise<Output> {
  const existing = cache.get(outputId);
  if (
    existing &&
    existing.scoped === panelScopes.has(outputId) &&
    existing.generation === currentGeneration(outputId)
  ) {
    if (existing.value === undefined || isRetained(outputId)) return existing.promise;
  }
  const sequenceAtStart = currentInvalidationSequence();
  const scope = panelScopes.get(outputId);
  const entry: Entry = {
    generation: currentGeneration(outputId),
    promise: undefined as never,
    scoped: scope !== undefined,
  };
  const request =
    scope === undefined
      ? getOutputById(outputId)
      : fetchPublicOutputMeta(scope.dashboardId, scope.panelId).then((meta) =>
          outputFromPublicMeta(outputId, meta),
        );
  entry.promise = request.then(
    (output) => {
      // A panel-scoped read has no pipeline to register (its Output is never refreshed from run events).
      if (scope === undefined) registerOutputPipeline(outputId, output.pipelineId);
      noteKind(outputId, output.kind);
      // An invalidation that landed while this was in flight means the result may predate a write:
      // hand it to the callers that asked, but never serve it to a later mount.
      if (currentInvalidationSequence() !== sequenceAtStart) {
        if (cache.get(outputId) === entry) cache.delete(outputId);
        return output;
      }
      // A superseded request (its scope changed while in flight) hands its result to its own callers only.
      if (cache.get(outputId) !== entry) return output;
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
  const entry = cache.get(outputId);
  // A per-panel stub (no owner, no pipeline) is never captured: a warm copy is restored on the owner's own dashboard.
  return entry?.scoped === true ? undefined : entry?.value;
}

/** HEL-1575 D5 step 3: seeds a restored copy of `outputId`'s metadata. Registers its pipeline (so a
 *  pipeline-level invalidation reaches the Output) and stamps the CURRENT generation: the counters
 *  restart at zero on a page load, so the generation it was fetched under is meaningless now. */
export function seedOutputMeta(outputId: string, meta: Output): void {
  registerOutputPipeline(outputId, meta.pipelineId);
  noteKind(outputId, meta.kind);
  cache.set(outputId, {
    promise: Promise.resolve(meta),
    value: meta,
    generation: currentGeneration(outputId),
    scoped: false,
  });
}
