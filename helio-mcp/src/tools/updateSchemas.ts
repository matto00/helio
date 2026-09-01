/**
 * Zod schemas and the PATCH body-builders shared by the `update_pipeline_step`/
 * `update_panel` tools (`write.ts`). Split into its own small module, still
 * `write.ts`'s exclusive, local concern, so a unit test can import just this
 * narrow surface without pulling `write.ts`'s full ~20-tool Zod-schema
 * surface into the compile graph (pathologically expensive to type-check
 * under this repo's root `tsconfig.json`/ts-jest combination — see
 * `write.test.ts`). HEL-907 task 3.9 removes `dataFieldSchema`/
 * `computedFieldSchema`/`buildUpdateDataTypeBody` outright along with the
 * retired `update_data_type` tool (the DataType model was retired by
 * HEL-904; the tool has had no backend route to call since).
 */

import { z } from "zod";
import type { UpdatePanelRequest, UpdatePipelineStepRequest } from "../types.js";

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
