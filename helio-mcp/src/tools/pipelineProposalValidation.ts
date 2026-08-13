/**
 * `propose_pipeline`'s read-only warning computation (HEL-385 design.md D4),
 * split into its own small module for the same reason `proposalValidation.ts`
 * documents for `propose_dashboard` (HEL-549) and `metricSchemas.ts`
 * documents for `write.ts` (HEL-541): a unit test can import just this
 * narrow, zod-free surface without pulling `pipelineProposal.ts`'s
 * `server.registerTool(...)` calls — combined with the imported
 * `boundPipelineStepSchema`'s full Zod object type — into the compile graph,
 * which is TS2589 ("Type instantiation is excessively deep and possibly
 * infinite") under this repo's root `tsconfig.json`/ts-jest configuration.
 *
 * These checks mirror the backend's own apply-time guardrails (HEL-383
 * design.md D1/D2) so an agent sees the problem before an apply-time 400 —
 * they are advisory/pre-flight only, never load-bearing: `apply_pipeline_
 * proposal` never consults this module and may be called directly without
 * `propose_pipeline` ever having run (design.md D6).
 */

import type { PipelineProposalSource } from "../types.js";

/** Read-only validation of a proposal's `source` branch, plus (given an
 *  already-fetched set of the caller's data source ids) a `sourceId`
 *  existence check. Pure — no I/O; the caller (`proposePipelineHandler`)
 *  owns the `api.listDataSources()` fetch and the `Set` construction. Checks
 *  run in this order (task 4.1):
 *  (a) both `sourceId` and `type` set — mutually exclusive branches, warn;
 *  (b) neither set — no source at all, warn;
 *  (c) `type` set but `name` blank/absent — inline branch needs a name, warn;
 *  (d) `type` set but the matching `config` absent — inline branch needs a
 *      config, warn;
 *  (e) `sourceId` set but not found among the caller's data sources, warn. */
export function computePipelineProposalWarnings(
  source: PipelineProposalSource,
  sourceIds: Set<string>,
): string[] {
  const warnings: string[] = [];

  const hasSourceId = source.sourceId !== undefined && source.sourceId !== "";
  const hasType = source.type !== undefined;

  if (hasSourceId && hasType) {
    warnings.push(
      "source: both sourceId and type are set — these are mutually exclusive branches (existing " +
        "source vs. inline new source); the apply path will reject this",
    );
  } else if (!hasSourceId && !hasType) {
    warnings.push(
      "source: neither sourceId nor type is set — supply an existing sourceId or an inline " +
        "type/name/config",
    );
  }

  if (hasType) {
    if (!source.name || source.name.trim().length === 0) {
      warnings.push(`source: type '${source.type}' is set but name is blank/absent`);
    }
    if (source.config === undefined) {
      warnings.push(`source: type '${source.type}' is set but its matching config is absent`);
    }
  }

  if (hasSourceId && source.sourceId !== undefined && !sourceIds.has(source.sourceId)) {
    warnings.push(`source: sourceId ${source.sourceId} not found among your data sources`);
  }

  return warnings;
}
