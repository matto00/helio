/**
 * Workspace context serializer (HEL-222, retargeted HEL-907 task 3.8 per
 * design.md Decision 6).
 *
 * Produces one compact, agent-readable snapshot of everything an agent needs
 * to reason about before composing a dashboard: data sources (with their
 * `inferredSchema`), pipelines (with their ordered steps, each step's output
 * columns, and their Outputs — kind/schema/placements), and dashboards.
 * types/metrics were dropped entirely (HEL-904 retired the DataType/Metric
 * model) — a pipeline's panel-bindable surface is now its `outputs[]`
 * (`WorkspaceContextOutputSummary`), not an implicit single output DataType.
 *
 * Implementation is a CLIENT-SIDE FAN-OUT over existing endpoints, per the
 * brief's guidance to start simple and only add a backend `/api/context`
 * aggregation if fan-out proves too chatty. Call budget: 2 list calls
 * (sources, dashboards) + 1 pipelines list + 1 analyze per pipeline + 1
 * run-history per pipeline + 1 pipeline-shapes catalog call + 1 (paginated)
 * outputs fetch = 4 + 2N(pipelines) — no longer 5 + N(pipelines) with an
 * unbounded per-DataType row fetch layered on top, since there is no more
 * per-DataType sample-row/column-stats fan-out (design.md Decision 6: the
 * 220k-char overflow, HEL-857, was caused by that DataType/Metric
 * enumeration, which no longer exists in the target model). See README
 * "Context serializer" for the measured cost and the escalation trigger.
 */

import type { HelioApi } from "./helioApi.js";
import type {
  AgentMemoryEntryResponse,
  AgentPreferencesResponse,
  AssertionSummaryResponse,
  ConnectorSummary,
  OutputResponse,
  RowCountContractResponse,
} from "./types.js";

/** Flatten a `RowCountContractResponse` discriminated union to a display string (HEL-400
 *  design.md Decision 5): `"exactly-one"`, `"at-most-param:<paramName>"`, or `"unbounded"`. */
function flattenRowCount(rowCount: RowCountContractResponse): string {
  switch (rowCount.kind) {
    case "exactly-one":
      return "exactly-one";
    case "at-most-param":
      return `at-most-param:${rowCount.paramName}`;
    case "unbounded":
      return "unbounded";
  }
}

// ── Agent context (HEL-521, 420-C) ───────────────────────────────────────
//
// An INDEPENDENT TypeScript implementation of the identical top-N ranking
// `WorkspaceContextService.rankMemoryEntries`/`AgentMemoryTopN` (Scala)
// enforces — no shared runtime between the backend and helio-mcp, so parity
// is achieved by duplicating the rule (same N, independently defined, design.md
// Decision 6) and testing each side separately. This path NEVER calls a write
// endpoint against `/api/agent/memory` — touching a surfaced entry's
// `lastUsedAt` is reserved for the backend NL-authoring grounding path only
// (design.md Decision 4).

/** Surfaced-memory cap — mirrors the backend's `WorkspaceContextService.AgentMemoryTopN`
 *  (same value, independently defined per design.md Decision 6). */
const AGENT_MEMORY_TOP_N = 20;

/** The all-empty `agentContext.preferences` default — used when the preferences fetch fails
 *  (design.md Decision 6's "degrade that one section to empty" contract), mirroring the
 *  backend's `WorkspaceContextAgentSection.empty.preferences`. */
const AGENT_PREFERENCES_EMPTY: AgentPreferencesResponse = { extras: {} };

// ── Assertion trustworthiness (HEL-581 design.md Decisions 3/4) ──────────

/** The zero-valued `lastRunAssertions` default — used when a pipeline has no
 *  `assert` step, has never run, or its run-history fetch itself fails.
 *  Mirrors the backend's own zero-valued `AssertionSummary()` default and
 *  this file's `AGENT_PREFERENCES_EMPTY` precedent for a shared "always
 *  present, empty when there's nothing to report" constant. */
const ZERO_ASSERTION_SUMMARY: AssertionSummaryResponse = {
  passed: 0,
  warnFailed: 0,
  errorFailed: 0,
  failures: [],
};

/** Ranks `entries` most-recently-useful first: entries with a `lastUsedAt` sorted descending by
 *  that timestamp, followed by never-used (`lastUsedAt` absent) entries in their incoming order
 *  (mirrors the backend's `rankMemoryEntries` — "nulls-last"; `listAgentMemory` already returns
 *  newest-`createdAt`-first). Does NOT truncate to `AGENT_MEMORY_TOP_N` itself — callers
 *  `.slice()` separately, so this stays independently unit-testable against an unbounded input. */
export function rankMemoryEntries(entries: AgentMemoryEntryResponse[]): AgentMemoryEntryResponse[] {
  const touched: AgentMemoryEntryResponse[] = [];
  const neverUsed: AgentMemoryEntryResponse[] = [];
  for (const entry of entries) {
    if (entry.lastUsedAt !== undefined) touched.push(entry);
    else neverUsed.push(entry);
  }
  touched.sort((a, b) => Date.parse(b.lastUsedAt as string) - Date.parse(a.lastUsedAt as string));
  return [...touched, ...neverUsed];
}

/** Fetches `agentContext`'s two sources via their OWN separate, independently `.catch`-guarded
 *  calls (design.md Decision 6) — explicitly NOT folded into `buildWorkspaceContext`'s existing
 *  fail-fast `Promise.all([...])`, since a rejection there would fail the WHOLE
 *  `get_workspace_context` call instead of degrading only this section (mirrors the existing
 *  per-pipeline `stepsError` degrade-not-fail precedent, also its own isolated `catch`, not
 *  inside that same `Promise.all`). Never calls `touch` — this is a pure read. */
export async function buildAgentContext(api: HelioApi): Promise<WorkspaceContext["agentContext"]> {
  const [preferences, rawMemory] = await Promise.all([
    api.getAgentPreferences().catch(() => AGENT_PREFERENCES_EMPTY),
    api.listAgentMemory().catch(() => [] as AgentMemoryEntryResponse[]),
  ]);
  return {
    preferences,
    memory: rankMemoryEntries(rawMemory).slice(0, AGENT_MEMORY_TOP_N),
  };
}

// ── Connectors (HEL-828 design.md Decision 5) ────────────────────────────

/** Fetches the caller's Connectors via `GET /api/connectors` (`HelioApi.listConnectorInstances`)
 *  — its OWN separate, independently `.catch`-guarded call, mirroring `buildAgentContext`'s
 *  precedent immediately above (design.md Decision 5's "degrade that one section to empty"
 *  contract): a failed fetch degrades `connectors` to `[]`, never fails the whole
 *  `get_workspace_context`/`buildWorkspaceContext` call. Already the slim, explicitly
 *  allow-listed `id`/`name`/`kind`/`host` projection (`HelioApi.listConnectorInstances`) —
 *  never the full `ConnectorMeta` shape. */
async function buildConnectors(api: HelioApi): Promise<ConnectorSummary[]> {
  try {
    return await api.listConnectorInstances();
  } catch {
    return [];
  }
}

// ── Outputs grouping (HEL-907 design.md Decision 6) ──────────────────────
//
// Pipelines are now summarized by their Outputs (kind, schema, placements),
// not an implicit single output DataType. Grouped from ONE paginated
// `listAllOutputs` fetch (all of the caller's Outputs across every
// pipeline), not a per-pipeline `listOutputsByPipeline` fan-out — keeps the
// call budget flat in pipeline count instead of growing it further.

export interface WorkspaceContextOutputSummary {
  id: string;
  name: string;
  kind: string;
  /** `null` means this Output is root-bound (`nodeStepId` absent on the wire — spray-json omits
   *  `Option = None`) -- see `rootId` below for WHICH root, under multi-root (HEL-913 R12). */
  nodeStepId: string | null;
  /** HEL-913 task 9.9/R12: WHICH root a root-bound Output (`nodeStepId: null`) attaches to.
   *  Mutually exclusive with `nodeStepId` at the DB row level -- exactly one is ever non-null.
   *  Emitting `nodeStepId: null` WITHOUT this field is precisely the null-means-root encoding
   *  R12/R15 ban; see `scripts/check-node-root-encoding.mjs` (Scala) and its TypeScript sibling. */
  rootId: string | null;
  schema: Array<{ name: string; type: string }>;
  placements: Array<{ dashboardId: string; panelId: string }>;
}

/** Fetches every Output the caller owns, across every pipeline, in as few
 *  pages as the `total` requires (`limit=200` per page, mirroring this
 *  file's other list fetches) — bounded to a sane max page count so a
 *  pagination bug elsewhere can never spin this into an unbounded loop. */
async function fetchAllOutputs(api: HelioApi): Promise<OutputResponse[]> {
  const items: OutputResponse[] = [];
  let offset = 0;
  const limit = 200;
  const maxPages = 50; // 10,000 Outputs — far beyond any real workspace
  for (let page = 0; page < maxPages; page++) {
    const result = await api.listAllOutputs(limit, offset);
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
    offset += limit;
  }
  return items;
}

/** Placements for one Output, degrading to `[]` on a failed fetch (mirrors
 *  this file's other "degrade the one section, never fail the whole call"
 *  precedent) rather than failing the whole `get_workspace_context` call
 *  over one Output's placement lookup. */
async function fetchPlacements(
  api: HelioApi,
  outputId: string,
): Promise<Array<{ dashboardId: string; panelId: string }>> {
  try {
    const placements = await api.listOutputPanels(outputId);
    return placements.map((p) => ({ dashboardId: p.dashboardId, panelId: p.panelId }));
  } catch {
    return [];
  }
}

/** Groups `outputs` by `pipelineId` and resolves each one's placements
 *  concurrently, returning a `Map` keyed by pipelineId for O(1) lookup while
 *  building each pipeline's entry below. */
async function buildOutputSummariesByPipeline(
  api: HelioApi,
  outputs: OutputResponse[],
): Promise<Map<string, WorkspaceContextOutputSummary[]>> {
  const byId = await Promise.all(
    outputs.map(async (o) => ({
      pipelineId: o.pipelineId,
      summary: {
        id: o.id,
        name: o.name,
        kind: o.kind,
        nodeStepId: o.nodeStepId ?? null,
        rootId: o.rootId ?? null,
        schema: o.schema.map((f) => ({ name: f.name, type: f.type })),
        placements: await fetchPlacements(api, o.id),
      } satisfies WorkspaceContextOutputSummary,
    })),
  );
  const grouped = new Map<string, WorkspaceContextOutputSummary[]>();
  for (const { pipelineId, summary } of byId) {
    const existing = grouped.get(pipelineId);
    if (existing) existing.push(summary);
    else grouped.set(pipelineId, [summary]);
  }
  return grouped;
}

export interface WorkspaceContextTruncation {
  applied: boolean;
  budgetBytes: number;
  estimatedSizeBytes: number;
  structuralFloorExceedsBudget: boolean;
  paginationTruncatedResources: string[];
}

/** Env-var-overridable default budget (design.md D8/D9 precedent, carried
 *  forward) — same value and same env-var name as before. `200000` (~200K
 *  UTF-16 code units) if unset or unparseable. */
function readDefaultBudgetBytes(): number {
  const raw = process.env["WORKSPACE_CONTEXT_DEFAULT_BUDGET_BYTES"];
  if (raw === undefined) return 200_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : 200_000;
}
export const DEFAULT_BUDGET_BYTES: number = readDefaultBudgetBytes();

const PLACEHOLDER_TRUNCATION: WorkspaceContextTruncation = {
  applied: false,
  budgetBytes: 0,
  estimatedSizeBytes: 0,
  structuralFloorExceedsBudget: false,
  paginationTruncatedResources: [],
};

/** Which of `dataSources`/`dashboards` were truncated by their `limit=200`
 *  fetch (compares each already-fetched page's `items.length` against its
 *  reported `total` — no new request). `[]` when none were truncated.
 *  `pipelines`/`outputs` are not paginated resources on this endpoint
 *  (`listPipelines`/`fetchAllOutputs` fetch every page already). */
export function paginationTruncatedResources(
  sourcesPage: { items: unknown[]; total: number },
  dashboardsPage: { items: unknown[]; total: number },
): string[] {
  const result: string[] = [];
  if (sourcesPage.items.length < sourcesPage.total) result.push("dataSources");
  if (dashboardsPage.items.length < dashboardsPage.total) result.push("dashboards");
  return result;
}

/** The CORE context's serialized size — every field of `context` EXCEPT
 *  `truncation` itself (avoids a field describing a size that includes its
 *  own not-yet-known serialized length). */
function coreSize(context: WorkspaceContext): number {
  const { truncation: _truncation, ...core } = context;
  return JSON.stringify(core).length;
}

/** Measures `context`'s serialized size against `budgetBytes` and reports the
 *  outcome (design.md Decision 6): no tiered shedding — the new,
 *  types/metrics-free shape (schema-only Outputs, no sample rows/column
 *  stats/join hints) is expected to be well under cap without a separate
 *  truncation strategy, verified by the 25-source/43-pipeline fixture test.
 *  `structuralFloorExceedsBudget: true` reports the (expected-never) case
 *  where even this already-slim shape exceeds `budgetBytes` — resources are
 *  never dropped to chase the budget further, mirroring the prior tiered
 *  system's D5 structural-floor contract at its own now-single tier. */
export function applyBudget(
  context: WorkspaceContext,
  budgetBytes: number,
  paginationTruncated: string[],
): WorkspaceContext {
  const size = coreSize(context);
  const exceeds = size > budgetBytes;
  return {
    ...context,
    truncation: {
      applied: false,
      budgetBytes,
      estimatedSizeBytes: size,
      structuralFloorExceedsBudget: exceeds,
      paginationTruncatedResources: paginationTruncated,
    },
  };
}

export interface WorkspaceContext {
  generatedAt: string;
  counts: {
    dataSources: number;
    pipelines: number;
    dashboards: number;
  };
  dataSources: Array<{
    id: string;
    name: string;
    type: string;
    tag: string | null;
    /** HEL-907 design.md Decision 6: the source's own inferred schema
     *  (`name`/`type` pairs only — no nullability/displayName, matching
     *  `Output.schema`'s own slim shape) — replaces the retired per-DataType
     *  `columns`/`sampleRows`/`columnStats`. `[]` when the source has never
     *  had its schema inferred. */
    inferredSchema: Array<{ name: string; type: string }>;
  }>;
  pipelines: Array<{
    id: string;
    name: string;
    /** HEL-913 tasks 7.2b/9.1: replaces the removed `sourceDataSourceId`/`sourceDataSourceName`
     *  scalar pair -- one entry per root, position-ordered, mirroring the backend's
     *  `PipelineRootSummaryResponse[]` exactly. */
    roots: Array<{ id: string; dataSourceId: string; dataSourceName: string }>;
    lastRunStatus: string | null;
    lastRunAt: string | null;
    lastRunRowCount: number | null;
    /** HEL-366: free-form grouping key; `null` when unset. */
    tag: string | null;
    steps: Array<{
      position: number;
      type: string;
      outputColumns: string[];
      validationError: string | null;
    }>;
    /** set when the analyze fan-out for this pipeline failed */
    stepsError?: string;
    /** HEL-581: the pipeline's latest-run assertion trustworthiness summary, sourced from
     *  GET /api/pipelines/:id/run-history's most-recent entry's `assertions` field. ALWAYS
     *  present (never omitted) — zero-valued (`{passed:0,warnFailed:0,errorFailed:0,failures:[]}`)
     *  when the pipeline has no `assert` step, has never run, or the run-history fetch itself
     *  fails. Fetched in its OWN independent try/catch, separate from `steps`/`stepsError`
     *  (design.md Decision 3) — a run-history failure degrades only this field, never blanking
     *  out `steps` or producing a misleading `stepsError`. */
    lastRunAssertions: AssertionSummaryResponse;
    /** HEL-907 design.md Decision 6: this pipeline's Outputs — kind, schema, placements — the
     *  panel-bindable surface, replacing the retired implicit single `outputDataTypeId`/
     *  `outputDataTypeName`. ALWAYS present (`[]`, never omitted) for a pipeline with no Outputs
     *  yet. */
    outputs: WorkspaceContextOutputSummary[];
  }>;
  dashboards: Array<{ id: string; name: string; panelCount: number }>;
  /** Smart pipeline shape catalog (HEL-391/402) — the shape vocabulary a planning agent can pick
   *  from via add_outputs_from_shape, rather than inventing shape ids. `outputRowCount` flattens
   *  `RowCountContract` to a string. */
  pipelineShapes: Array<{
    id: string;
    label: string;
    description: string;
    paramsSchema: Array<{
      name: string;
      label: string;
      dataType: string;
      required: boolean;
      description: string;
    }>;
    outputRowCount: string;
    outputDescription: string;
  }>;
  /** HEL-377: the deterministic byte-budget outcome — see `applyBudget`. ALWAYS present. */
  truncation: WorkspaceContextTruncation;
  /** HEL-521 (420-C): the caller's agent-authoring preferences plus up to 20 of their
   *  most-recently-useful `AgentMemoryEntry` records, ranked by `lastUsedAt` descending
   *  (never-used entries last) — mirrors the backend's `WorkspaceContextResponse.agentContext`.
   *  ALWAYS present (an object, never omitted) — degrades to an empty/all-default `preferences`
   *  object and/or an empty `memory` array when the corresponding fetch fails (see
   *  `buildAgentContext`). Fetching this NEVER touches any memory entry's `lastUsedAt` —
   *  touching is reserved for the backend NL-authoring grounding path only (design.md
   *  Decision 4). */
  agentContext: {
    preferences: AgentPreferencesResponse;
    memory: AgentMemoryEntryResponse[];
  };
  /** HEL-828 design.md Decision 5/6: the caller's Connectors, each carrying only
   *  `id`/`name`/`kind`/`host` — no credential field of any kind, and no
   *  `config`/`defaultHeaders` value. ALWAYS present (an array, never omitted) — degrades to
   *  `[]` when the `GET /api/connectors` fetch fails (see `buildConnectors`), never failing the
   *  whole call. Lets an agent see what it can author a REST source against without a separate
   *  `list_connectors` call. */
  connectors: ConnectorSummary[];
}

/** Distinct panelIds referenced across all four breakpoints of a layout. */
function panelCount(layout: {
  lg: Array<{ panelId: string }>;
  md: Array<{ panelId: string }>;
  sm: Array<{ panelId: string }>;
  xs: Array<{ panelId: string }>;
}): number {
  const ids = new Set<string>();
  for (const bp of [layout.lg, layout.md, layout.sm, layout.xs]) {
    for (const item of bp) ids.add(item.panelId);
  }
  return ids.size;
}

/** `budgetBytes` (HEL-377 design.md D7/D9): defaults to `DEFAULT_BUDGET_BYTES`
 *  (env-var overridable, same convention as the backend's own default) so
 *  existing callers with a single argument are unaffected. `applyBudget` is
 *  the LAST step before returning — a pure in-memory pass over the
 *  already-bounded structure built above (no new fetch). */
export async function buildWorkspaceContext(
  api: HelioApi,
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): Promise<WorkspaceContext> {
  // HEL-521 (420-C) design.md Decision 6: kicked off here (concurrently with the fail-fast
  // Promise.all below) but deliberately NOT a member of that array — buildAgentContext's own
  // two fetches are already independently `.catch`-guarded, so a rejection here can never fail
  // this whole call, only degrade `agentContext`'s corresponding section.
  const agentContextPromise = buildAgentContext(api);
  // HEL-828 design.md Decision 5: same "kicked off concurrently, own independent catch,
  // deliberately NOT a member of the fail-fast Promise.all below" pattern as agentContextPromise
  // immediately above — buildConnectors is already self-`.catch`-guarded, so a rejection here
  // can never fail this whole call, only degrade `connectors` to `[]`.
  const connectorsPromise = buildConnectors(api);
  // HEL-907 design.md Decision 6: same pattern — Outputs are fetched and grouped independently
  // (`fetchAllOutputs`/`buildOutputSummariesByPipeline`), each Output's placement lookup already
  // self-`.catch`-guarded (`fetchPlacements`), so a failure here degrades only the `outputs`
  // field of each affected pipeline, never the whole call.
  const outputsByPipelinePromise = fetchAllOutputs(api).then((outputs) =>
    buildOutputSummariesByPipeline(api, outputs),
  );

  const [sourcesPage, dashboardsPage, pipelineSummaries, pipelineShapes] = await Promise.all([
    api.listDataSources(),
    api.listDashboards(),
    api.listPipelines(),
    api.listPipelineShapes(),
  ]);

  const outputsByPipeline = await outputsByPipelinePromise;

  // Fan out one analyze + one run-history per pipeline for steps/output columns/assertions.
  const pipelines = await Promise.all(
    pipelineSummaries.map(async (summary) => {
      const base = {
        id: summary.id,
        name: summary.name,
        roots: summary.roots,
        lastRunStatus: summary.lastRunStatus,
        lastRunAt: summary.lastRunAt,
        lastRunRowCount: summary.lastRunRowCount,
        tag: summary.tag ?? null,
      };
      // HEL-581 design.md Decision 3: `analyzePipeline` (steps/stepsError) and
      // `getPipelineRunHistory` (lastRunAssertions) are fetched concurrently
      // via Promise.all, but each in its OWN independent try/catch — a
      // run-history-specific failure must never blank out `steps` or produce
      // a misleading `stepsError`, and vice versa.
      const [stepsResult, lastRunAssertions] = await Promise.all([
        (async () => {
          try {
            const analyzed = await api.analyzePipeline(summary.id);
            return {
              steps: analyzed.steps.map((step) => ({
                position: step.position,
                type: step.type,
                outputColumns: step.outputSchema.map((f) => f.name),
                validationError: step.validationError,
              })),
            };
          } catch (err) {
            return { steps: [], stepsError: (err as Error).message };
          }
        })(),
        (async () => {
          try {
            const history = await api.getPipelineRunHistory(summary.id);
            return history[0]?.assertions ?? ZERO_ASSERTION_SUMMARY;
          } catch {
            return ZERO_ASSERTION_SUMMARY;
          }
        })(),
      ]);

      return {
        ...base,
        ...stepsResult,
        lastRunAssertions,
        outputs: outputsByPipeline.get(summary.id) ?? [],
      };
    }),
  );

  const agentContext = await agentContextPromise;
  const connectors = await connectorsPromise;

  const context: WorkspaceContext = {
    generatedAt: new Date().toISOString(),
    counts: {
      dataSources: sourcesPage.total,
      pipelines: pipelineSummaries.length,
      dashboards: dashboardsPage.total,
    },
    dataSources: sourcesPage.items.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      tag: s.tag ?? null,
      inferredSchema: (s.inferredSchema?.fields ?? []).map((f) => ({
        name: f.name,
        type: f.dataType,
      })),
    })),
    pipelines,
    dashboards: dashboardsPage.items.map((d) => ({
      id: d.id,
      name: d.name,
      panelCount: panelCount(d.layout),
    })),
    pipelineShapes: pipelineShapes.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      paramsSchema: s.paramsSchema,
      outputRowCount: flattenRowCount(s.outputContract.rowCount),
      outputDescription: s.outputContract.description,
    })),
    // HEL-377: overwritten unconditionally by `applyBudget` below — see
    // `PLACEHOLDER_TRUNCATION`.
    truncation: PLACEHOLDER_TRUNCATION,
    agentContext,
    connectors,
  };

  return applyBudget(
    context,
    budgetBytes,
    paginationTruncatedResources(sourcesPage, dashboardsPage),
  );
}
