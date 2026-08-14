/**
 * Zod schemas and the PATCH body-builders shared by the `update_data_type`/
 * `update_pipeline_step`/`update_panel` tools (`write.ts`). Mirrors
 * `metricSchemas.ts` exactly (design.md D3, revised at design-gate round 1 —
 * see that module's own header comment for the full rationale): split into
 * its own small module, still `write.ts`'s exclusive, local concern, so a
 * unit test can import just this narrow surface without pulling `write.ts`'s
 * full ~20-tool Zod-schema surface into the compile graph (pathologically
 * expensive to type-check under this repo's root `tsconfig.json`/ts-jest
 * combination — see `write.test.ts`).
 */

import { z } from "zod";
import type {
  UpdateDataTypeRequest,
  UpdatePanelRequest,
  UpdatePipelineStepRequest,
} from "../types.js";

/** Mirrors the backend's `DataFieldPayload(name, displayName, dataType, nullable)`
 *  exactly (`backend/.../api/protocols/DataTypeProtocol.scala`). */
export const dataFieldSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  dataType: z.string().min(1),
  nullable: z.boolean(),
});

/** Mirrors the backend's `ComputedFieldPayload(name, displayName, expression, dataType)`
 *  exactly (`backend/.../api/protocols/DataTypeProtocol.scala`). */
export const computedFieldSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().min(1),
  expression: z.string().min(1),
  dataType: z.string().min(1),
});

/** Build `update_data_type`'s PATCH body from the tool's already-Zod-parsed
 *  arguments: a key is included in the body ONLY when the caller actually
 *  supplied that argument (`!== undefined`) — an omitted argument stays
 *  absent from the body (server sees "unchanged"). `fields`/`computedFields`,
 *  when supplied, replace the existing array WHOLESALE server-side (no
 *  per-item merge) — the tool description states this explicitly. */
export function buildUpdateDataTypeBody(args: {
  name?: string;
  fields?: z.infer<typeof dataFieldSchema>[];
  computedFields?: z.infer<typeof computedFieldSchema>[];
}): UpdateDataTypeRequest {
  const body: UpdateDataTypeRequest = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.fields !== undefined) body.fields = args.fields;
  if (args.computedFields !== undefined) body.computedFields = args.computedFields;
  return body;
}

/** Build `update_pipeline_step`'s PATCH body from the tool's already-Zod-
 *  parsed arguments: a key is included in the body ONLY when the caller
 *  actually supplied that argument (`!== undefined`) — an omitted argument
 *  stays absent from the body (server sees "unchanged"). Never constructs a
 *  `type` key (design.md D2) — the backend's `type` field is deliberately not
 *  exposed by this tool at all. */
export function buildUpdatePipelineStepBody(args: {
  config?: Record<string, unknown>;
  position?: number;
}): UpdatePipelineStepRequest {
  const body: UpdatePipelineStepRequest = {};
  if (args.config !== undefined) body.config = args.config;
  if (args.position !== undefined) body.position = args.position;
  return body;
}

/** Build `update_panel`'s PATCH body from the tool's already-Zod-parsed
 *  arguments: a key is included in the body ONLY when the caller actually
 *  supplied that argument (`!== undefined`) — an omitted argument stays
 *  absent from the body (server sees "unchanged"). `config`/`appearance`,
 *  when supplied, are genuine per-field partial merges server-side (absent =
 *  unchanged, explicit `null` = clear) — NOT a wholesale replace like
 *  `buildUpdateDataTypeBody`'s `fields`/`computedFields`. */
export function buildUpdatePanelBody(args: {
  title?: string;
  type?: string;
  config?: Record<string, unknown>;
  appearance?: Record<string, unknown>;
}): UpdatePanelRequest {
  const body: UpdatePanelRequest = {};
  if (args.title !== undefined) body.title = args.title;
  if (args.type !== undefined) body.type = args.type;
  if (args.config !== undefined) body.config = args.config;
  if (args.appearance !== undefined) body.appearance = args.appearance;
  return body;
}
