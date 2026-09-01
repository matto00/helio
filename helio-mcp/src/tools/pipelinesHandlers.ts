/**
 * `create_pipeline`'s actual call-routing logic (HEL-907 task 3.2). `add_pipeline_step`'s own
 * handler (task 3.3's parentStepId addition) already lives in `assertSchemas.ts` -- extended
 * there, not duplicated here. Mirrors `pipelineProposalHandlers.ts`'s
 * design.md D4b split: zod-free, so a test can exercise this without
 * pulling `pipelines.ts`'s zod/`registerTool` surface into the compile
 * graph.
 *
 * `create_pipeline` maps onto `POST /api/pipelines`'s single-call
 * transactional shape (HEL-906): `sourceId` OR an inline source spec,
 * `steps[]` (with `parentStepId`), optional `outputs[]`. design.md decision
 * 2: the backend route requires an EXISTING `sourceDataSourceId` --
 * `additionalProperties: false`, no inline-source arm exists there -- so an
 * inline source spec is resolved here, client-side, into two HTTP calls
 * under the hood (`POST /api/data-sources` or `POST /api/sources`, then
 * `POST /api/pipelines`), presented to the agent as ONE tool call. If the
 * second call fails, the already-created source is orphaned; its id is
 * surfaced in the thrown error so the caller (or a human) can clean it up
 * via `delete_data_source`/`teardown_resources` -- never silently
 * swallowed. `csv` is NOT supported as an inline source here (same
 * constraint `propose_pipeline`/`PipelineProposalService` already document:
 * no bytes channel exists in this call for an uploaded file) -- create the
 * csv source first (`create_csv_data_source`) and pass its id via
 * `source.sourceId`.
 */

import type { HelioApi, StaticColumn } from "../helioApi.js";
import type {
  OutputResponse,
  PipelineProposalOutput,
  PipelineProposalStep,
  PipelineStepResponse,
  PipelineSummaryResponse,
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
        queryParams: config.queryParams as Record<string, string> | undefined,
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

export async function createPipelineHandler(
  api: HelioApi,
  input: {
    name: string;
    source: CreatePipelineSourceInput;
    tag?: string;
    steps?: PipelineProposalStep[];
    outputs?: PipelineProposalOutput[];
  },
): Promise<CreatePipelineResult> {
  const { sourceDataSourceId, createdSourceId } = await resolveSource(
    api,
    input.name,
    input.source,
  );

  let summary: PipelineSummaryResponse;
  try {
    summary = await api.createPipeline({
      name: input.name,
      sourceDataSourceId,
      tag: input.tag,
      steps: input.steps,
      outputs: input.outputs,
    });
  } catch (err) {
    if (createdSourceId) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `create_pipeline: pipeline creation failed after its inline source was already created ` +
          `(orphaned DataSource id: ${createdSourceId} -- clean it up with delete_data_source or ` +
          `teardown_resources if tagged): ${message}`,
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
