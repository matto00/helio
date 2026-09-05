/**
 * `create_pipeline`'s actual call-routing logic (HEL-907 task 3.2, HEL-913 task 9.1/9.2
 * widened to multi-root). `add_pipeline_step`'s own handler (task 3.3's parentStepId addition)
 * already lives in `assertSchemas.ts` -- extended there, not duplicated here. Mirrors
 * `pipelineProposalHandlers.ts`'s design.md D4b split: zod-free, so a test can exercise this
 * without pulling `pipelines.ts`'s zod/`registerTool` surface into the compile graph.
 *
 * `create_pipeline` maps onto `POST /api/pipelines`'s single-call
 * transactional shape (HEL-906/HEL-913): `roots[]` (each an existing `sourceId` OR an inline
 * source spec, R6 "one shape, not two" with `add_root`'s own body), `steps[]` (with
 * `parentStepId`/`rootClientId`), optional `outputs[]` (with `nodeStepClientId`/`rootClientId`).
 * design.md decision 2 (unchanged by the multi-root widening): the backend route requires an
 * EXISTING `sourceId` per root -- `additionalProperties: false`, no inline-source arm exists
 * there -- so an inline source spec is resolved here, client-side, into two HTTP calls under
 * the hood (`POST /api/data-sources` or `POST /api/sources`, then `POST /api/pipelines`),
 * presented to the agent as ONE tool call, per root, in order. If a LATER root's resolution or
 * the final `POST /api/pipelines` call fails, EVERY inline source already created by earlier
 * roots in THIS call is reported as orphaned (plural now, not singular) -- never silently
 * swallowed, never under-reported. `csv` is NOT supported as an inline source here (same
 * constraint `propose_pipeline`/`PipelineProposalService` already document: no bytes channel
 * exists in this call for an uploaded file) -- create the csv source first
 * (`create_csv_data_source`) and pass its id via `sourceId`.
 */

import type { HelioApi, StaticColumn } from "../helioApi.js";
import type {
  OutputResponse,
  PipelineProposalOutput,
  PipelineProposalStep,
  PipelineStepResponse,
  PipelineSummaryResponse,
  PipelineRootSummaryResponse,
  QueryParamsInput,
  RemovePipelineRootResponse,
} from "../types.js";

export interface CreatePipelineResult extends PipelineSummaryResponse {
  /** Populated only when `outputs` was non-empty on the request -- `POST /api/pipelines`'s own
   *  response never reports the Outputs it just created (it returns a bare `PipelineSummaryResponse`),
   *  so this is a follow-up `GET /api/pipelines/:id/outputs` read, attached here purely for the
   *  caller's convenience. */
  outputs?: OutputResponse[];
}

export interface CreatePipelineSourceInput {
  /** Existing-source branch -- id of a caller-owned DataSource to reuse as-is. */
  sourceId?: string;
  /** Inline-source branch -- the new source's kind. `csv` is deliberately NOT accepted here (see
   *  this module's own docstring). */
  type?: "rest_api" | "sql" | "static";
  /** Inline-source branch -- the new source's display name; falls back to the pipeline's own
   *  `name` when omitted. */
  name?: string;
  /** Inline-source branch -- the per-`type` config payload: rest_api -> {connectorId, endpoint?,
   *  method?, queryParams?, headers?, body?, bodyContentType?, rootSelector?}; sql -> {dialect,
   *  host, port, database, user, password, query}; static -> {columns, rows}. */
  config?: Record<string, unknown>;
}

/** Resolves `source` into a real `DataSourceId` -- either the caller-owned id already given, or
 *  a freshly-created one for the inline branch. Returns the resolved id plus (only for the
 *  inline branch) the id of the source THIS CALL created, so the caller can report it as orphaned
 *  if the subsequent `POST /api/pipelines` call fails. */
async function resolveSource(
  api: HelioApi,
  pipelineName: string,
  source: CreatePipelineSourceInput,
): Promise<{ sourceDataSourceId: string; createdSourceId?: string }> {
  if (source.sourceId) return { sourceDataSourceId: source.sourceId };

  const name = source.name?.trim() || pipelineName;
  const config = source.config ?? {};

  switch (source.type) {
    case "static": {
      const ds = await api.createDataSource({
        name,
        columns: (config.columns as StaticColumn[] | undefined) ?? [],
        rows: (config.rows as unknown[][] | undefined) ?? [],
      });
      return { sourceDataSourceId: ds.id, createdSourceId: ds.id };
    }
    case "rest_api": {
      const result = await api.createRestDataSource({
        name,
        connectorId: config.connectorId as string,
        endpoint: config.endpoint as string | undefined,
        method: config.method as string | undefined,
        queryParams: config.queryParams as QueryParamsInput | undefined,
        headers: config.headers as Record<string, string> | undefined,
        body: config.body as string | undefined,
        bodyContentType: config.bodyContentType as string | undefined,
        rootSelector: config.rootSelector as string | undefined,
      });
      return { sourceDataSourceId: result.source.id, createdSourceId: result.source.id };
    }
    case "sql": {
      const result = await api.createSqlDataSource({
        name,
        dialect: config.dialect as string,
        host: config.host as string,
        port: config.port as number,
        database: config.database as string,
        user: config.user as string,
        password: config.password as string,
        query: config.query as string,
      });
      return { sourceDataSourceId: result.source.id, createdSourceId: result.source.id };
    }
    default:
      throw new Error(
        "create_pipeline: source must set either sourceId (an existing DataSource) or an inline " +
          "type of rest_api|sql|static (csv is not supported inline -- call create_csv_data_source " +
          `first and pass its id via source.sourceId); got type='${String(source.type)}'`,
      );
  }
}

/** One `roots[]` element on `create_pipeline`'s input -- `CreatePipelineSourceInput` plus the
 *  OPTIONAL request-scoped `clientId` a `steps[]`/`outputs[]` entry names via `rootClientId`
 *  (unnecessary with exactly one root). */
export type CreatePipelineRootInput = CreatePipelineSourceInput & { clientId?: string };

function orphanedSourcesMessage(createdSourceIds: string[]): string {
  return createdSourceIds.length === 1
    ? `orphaned DataSource id: ${createdSourceIds[0]}`
    : `orphaned DataSource ids: ${createdSourceIds.join(", ")}`;
}

/** Resolves EVERY `roots[]` entry, IN ORDER, sequentially (never parallel -- a later root's
 *  resolution failure must know exactly which earlier roots already created a real,
 *  now-orphaned DataSource, which parallel resolution would make racy to track). If root N's
 *  OWN resolution throws, every EARLIER root's already-created inline source (1..N-1) is
 *  reported as orphaned in the re-thrown error's message -- never silently dropped just
 *  because the failure happened mid-list rather than on the final `createPipeline` call. */
async function resolveRoots(
  api: HelioApi,
  pipelineName: string,
  roots: CreatePipelineRootInput[],
): Promise<{ resolved: { sourceId: string; clientId?: string }[]; createdSourceIds: string[] }> {
  const resolved: { sourceId: string; clientId?: string }[] = [];
  const createdSourceIds: string[] = [];
  for (const root of roots) {
    let sourceDataSourceId: string;
    let createdSourceId: string | undefined;
    try {
      ({ sourceDataSourceId, createdSourceId } = await resolveSource(api, pipelineName, root));
    } catch (err) {
      if (createdSourceIds.length > 0) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `create_pipeline: a root's source resolution failed after ${createdSourceIds.length} ` +
            `EARLIER root's inline source(s) were already created (${orphanedSourcesMessage(createdSourceIds)} ` +
            `-- clean them up with delete_data_source or teardown_resources if tagged): ${message}`,
        );
      }
      throw err;
    }
    resolved.push({ sourceId: sourceDataSourceId, clientId: root.clientId });
    if (createdSourceId) createdSourceIds.push(createdSourceId);
  }
  return { resolved, createdSourceIds };
}

export async function createPipelineHandler(
  api: HelioApi,
  input: {
    name: string;
    roots: CreatePipelineRootInput[];
    tag?: string;
    steps?: PipelineProposalStep[];
    outputs?: PipelineProposalOutput[];
  },
): Promise<CreatePipelineResult> {
  const { resolved, createdSourceIds } = await resolveRoots(api, input.name, input.roots);

  let summary: PipelineSummaryResponse;
  try {
    summary = await api.createPipeline({
      name: input.name,
      roots: resolved.map((r) => ({ sourceId: r.sourceId, clientId: r.clientId })),
      tag: input.tag,
      steps: input.steps,
      outputs: input.outputs,
    });
  } catch (err) {
    if (createdSourceIds.length > 0) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `create_pipeline: pipeline creation failed after ${createdSourceIds.length} inline ` +
          `source(s) were already created (${orphanedSourcesMessage(createdSourceIds)} -- clean ` +
          `them up with delete_data_source or teardown_resources if tagged): ${message}`,
      );
    }
    throw err;
  }

  if (input.outputs && input.outputs.length > 0) {
    const created = await api.listOutputsByPipeline(summary.id);
    return { ...summary, outputs: created.items };
  }
  return summary;
}

/** `add_outputs_from_shape(pipelineId, stepId?, shapeId, params, outputName, outputKind?)`
 *  (HEL-907 task 3.4) -- replaces the retired `create_pipeline_from_shape`: expands a shape's
 *  `params` into an ordered list of step create-payloads (`POST /api/pipeline-shapes/:id/expand`,
 *  pure, no persistence), THEN, only once expand succeeds, chains each expanded step onto the
 *  EXISTING pipeline via `parentStepId` -- the first expanded step branches off `stepId` (absent
 *  means the pipeline's raw source, i.e. a NEW trunk-adjacent branch), each subsequent expanded
 *  step branches off the one before it -- and finally creates ONE Output on the shape's terminal
 *  (last-added) step, `kind` defaulting to `"table"` when omitted (matches every shape's
 *  row-count-contract-driven, not chart-specific, default shape). If `expand` fails (unknown
 *  shapeId / invalid params), NOTHING is added -- same fail-fast contract the retired tool had.
 *  If a step-add fails partway through a multi-step shape, steps already added in THIS call are
 *  NOT rolled back (no transactional composition exists at this layer) -- same pre-existing
 *  tradeoff the retired tool always had, not a new one. */
export async function addOutputsFromShapeHandler(
  api: HelioApi,
  input: {
    pipelineId: string;
    stepId?: string;
    shapeId: string;
    params: Record<string, unknown>;
    outputName: string;
    outputKind?: string;
  },
): Promise<{ steps: PipelineStepResponse[]; output: OutputResponse }> {
  const expansions = await api.expandPipelineShape(input.shapeId, input.params);

  const steps: PipelineStepResponse[] = [];
  let parentStepId = input.stepId;
  for (const expansion of expansions) {
    const step = await api.addPipelineStep(input.pipelineId, {
      type: expansion.kind,
      config: expansion.config,
      parentStepId,
    });
    steps.push(step);
    parentStepId = step.id;
  }

  const output = await api.createOutput(input.pipelineId, {
    nodeStepId: parentStepId,
    kind: input.outputKind ?? "table",
    name: input.outputName,
  });

  return { steps, output };
}

/** `add_root(pipelineId, source)` (HEL-913 task 9.1) -- appends a new root to an EXISTING
 *  pipeline (`POST /api/pipelines/:id/roots`). `source` is the SAME `CreatePipelineSourceInput`
 *  shape `create_pipeline` uses -- reuses `resolveSource` so an inline source spec resolves
 *  through the identical two-call-under-one-tool-call pattern, orphan reporting included. */
export async function addPipelineRootHandler(
  api: HelioApi,
  input: { pipelineId: string; source: CreatePipelineSourceInput },
): Promise<PipelineRootSummaryResponse> {
  const { sourceDataSourceId, createdSourceId } = await resolveSource(
    api,
    input.pipelineId,
    input.source,
  );

  try {
    return await api.addPipelineRoot(input.pipelineId, { sourceId: sourceDataSourceId });
  } catch (err) {
    if (createdSourceId) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `add_root: root creation failed after its inline source was already created ` +
          `(orphaned DataSource id: ${createdSourceId} -- clean it up with delete_data_source or ` +
          `teardown_resources if tagged): ${message}`,
      );
    }
    throw err;
  }
}

/** `remove_root(pipelineId, rootId)` (HEL-913 task 9.1) -- `DELETE /api/pipelines/:id/roots/:rootId`.
 *  Refuses to remove the pipeline's LAST root, and refuses when a surviving lane still
 *  references a node that would be deleted (both surface as a thrown `HelioApiError` naming
 *  the problem -- see `guarded`'s error formatting in `pipelines.ts`). On success, reports the
 *  step/Output counts removed. */
export function removePipelineRootHandler(
  api: HelioApi,
  input: { pipelineId: string; rootId: string },
): Promise<RemovePipelineRootResponse> {
  return api.removePipelineRoot(input.pipelineId, input.rootId);
}
