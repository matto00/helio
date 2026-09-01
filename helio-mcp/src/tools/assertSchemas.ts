/**
 * Zod schema for the `assert` pipeline step's `config` (HEL-581, design.md
 * Decision 1/2) — validated inside `add_pipeline_step`'s HANDLER when
 * `type === "assert"`, NOT registered as part of that tool's `inputSchema`
 * (which stays the existing flat raw shape; see `write.ts`. An earlier draft
 * tried moving this onto `inputSchema` via `z.object({...}).superRefine(...)`
 * and found, at the design gate's second round, that a zod v3 `ZodEffects`
 * wrapper has no `.shape`, silently collapsing the SDK's `tools/list`
 * JSON-schema generation for the whole tool — see design.md for the full
 * story). Split into its own small module — still `write.ts`'s exclusive,
 * local concern — so a unit test can import just this narrow surface without
 * pulling `write.ts`'s full ~20-tool Zod-schema surface into the compile
 * graph (pathologically expensive to type-check under this repo's root
 * `tsconfig.json`/ts-jest combination — see `write.test.ts`, `metricSchemas.ts`,
 * `updateSchemas.ts`, `pipelineProposalHandlers.ts` for the established
 * precedent this mirrors).
 *
 * Each variant mirrors HEL-454's `AssertRule`/`AssertStep.scala` exactly
 * (verified against the backend source, not re-derived): `notNull`/`unique`
 * require `field` and reject any `params` key (`.strict()` — an explicitly
 * malformed shape, not merely an omitted one, is rejected for the same
 * reason this whole schema exists); `range` requires `field` and accepts
 * optional `params.min`/`params.max`; `rowCountMin`/`rowCountMax`
 * intentionally have NO `field` (dataset-level, HEL-454 design.md Decision 4)
 * and require `params.count`; `regex` requires `field` and `params.pattern`.
 * `severity` (`warn`|`error`) is required on every variant.
 */

import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import type { PipelineStepResponse } from "../types.js";

const severitySchema = z.enum(["warn", "error"]);

export const assertRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("notNull"),
    field: z.string().min(1),
    params: z.object({}).strict(),
    severity: severitySchema,
  }),
  z.object({
    kind: z.literal("unique"),
    field: z.string().min(1),
    params: z.object({}).strict(),
    severity: severitySchema,
  }),
  z.object({
    kind: z.literal("range"),
    field: z.string().min(1),
    params: z.object({ min: z.number().optional(), max: z.number().optional() }),
    severity: severitySchema,
  }),
  z.object({
    kind: z.literal("rowCountMin"),
    params: z.object({ count: z.number() }),
    severity: severitySchema,
  }),
  z.object({
    kind: z.literal("rowCountMax"),
    params: z.object({ count: z.number() }),
    severity: severitySchema,
  }),
  z.object({
    kind: z.literal("regex"),
    field: z.string().min(1),
    params: z.object({ pattern: z.string() }),
    severity: severitySchema,
  }),
]);

/** Wraps `assertRuleSchema` into the `assert` step's whole `config` shape
 *  (`{rules: [...]}`) — mirrors the backend's `AssertConfig(rules:
 *  Vector[AssertRule])` wire shape. */
export const assertConfigSchema = z.object({ rules: z.array(assertRuleSchema) });

/** Formats a `ZodError` from a rejected `assertConfigSchema.safeParse(...)`
 *  into one human-readable line, `path: message` per issue. */
function formatAssertConfigError(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return `Invalid assert step config: ${details}`;
}

/** `add_pipeline_step`'s full call-routing logic (HEL-581 design.md
 *  Decision 1) — extracted out of `write.ts` (mirrors
 *  `pipelineProposalHandlers.ts`'s own precedent) so a test can exercise the
 *  real validate-then-call behavior, including "no API call on an invalid
 *  assert config", without pulling `write.ts`'s heavy Zod-schema surface
 *  into the compile graph. `add_pipeline_step`'s registered `inputSchema`
 *  stays the existing flat raw shape, UNCHANGED (design.md Decision 1) —
 *  this handler is the ONLY place `config` is validated against
 *  `assertConfigSchema`, and only when `type === "assert"`; every other
 *  `type` passes `config` through to the backend exactly as before. Throws
 *  when validation fails, BEFORE calling `api.addPipelineStep` —
 *  `write.ts`'s existing `guarded()` wrapper formats the thrown error into
 *  the same `{content, isError: true}` shape it already uses for every
 *  other tool's failure. */
export async function addPipelineStepHandler(
  api: HelioApi,
  input: {
    pipelineId: string;
    type: string;
    config: Record<string, unknown>;
    /** HEL-907 task 3.3 -- splices the new step in directly after this EXISTING step id (an
     *  alternative to `position` that can express a NEW tail branching off any existing node);
     *  absent extends the trunk, unchanged from before. */
    parentStepId?: string;
    position?: number;
    enabled?: boolean;
  },
): Promise<PipelineStepResponse> {
  if (input.type === "assert") {
    const parsed = assertConfigSchema.safeParse(input.config);
    if (!parsed.success) {
      throw new Error(formatAssertConfigError(parsed.error));
    }
  }
  return api.addPipelineStep(input.pipelineId, {
    type: input.type,
    config: input.config,
    parentStepId: input.parentStepId,
    position: input.position,
    enabled: input.enabled,
  });
}
