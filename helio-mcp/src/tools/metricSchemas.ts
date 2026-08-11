/**
 * Zod schemas and the PATCH body-builder shared by the `create_metric`/
 * `update_metric` tools (`write.ts`). Split into its own small module —
 * still `write.ts`'s exclusive, local concern (design.md Decision 2 calls
 * for a "small, local body-builder in write.ts, not a shared helper"; this
 * file has exactly one consumer) — rather than inlined directly in
 * `write.ts`, so a unit test can import just this narrow surface without
 * pulling `write.ts`'s full ~20-tool Zod-schema surface into the compile
 * graph (that full-file compile is pathologically expensive under this
 * repo's root `tsconfig.json`/ts-jest combination — see `write.test.ts`).
 */

import { z } from "zod";
import type { MetricFormat, UpdateMetricRequest } from "../types.js";

/** Allow-list for `MetricDefinition.aggregation` — mirrors
 *  `MetricAggregation.values` (`backend/.../domain/model.scala`) exactly, a
 *  hardcoded literal mirror (same approach `mcp-pipeline-shape-tools` already
 *  takes for its own enums, design.md Decision 3). Client-side rejection here
 *  saves an HTTP round trip for an obviously-invalid value; the server
 *  remains the source of truth regardless. */
export const metricAggregationSchema = z.enum([
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "countDistinct",
]);

export const metricFormatSchema = z.object({
  unit: z.string().optional(),
  decimals: z.number().int().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
});

/** Build `update_metric`'s PATCH body from the tool's already-Zod-parsed
 *  arguments, implementing the absent-vs-null convention `UpdateMetricRequest`
 *  requires (design.md Decision 2): a key is included in the body ONLY when
 *  the caller actually supplied that argument (`!== undefined`) — an omitted
 *  argument stays absent from the body (server sees "unchanged"), while an
 *  explicit `null` on `description`/`format` is forwarded as `null` (server
 *  sees "clear"). */
export function buildUpdateMetricBody(args: {
  name?: string;
  description?: string | null;
  measureField?: string;
  aggregation?: string;
  allowedDimensions?: string[];
  format?: MetricFormat | null;
  deprecated?: boolean;
}): UpdateMetricRequest {
  const body: UpdateMetricRequest = {};
  if (args.name !== undefined) body.name = args.name;
  if (args.description !== undefined) body.description = args.description;
  if (args.measureField !== undefined) body.measureField = args.measureField;
  if (args.aggregation !== undefined) body.aggregation = args.aggregation;
  if (args.allowedDimensions !== undefined) body.allowedDimensions = args.allowedDimensions;
  if (args.format !== undefined) body.format = args.format;
  if (args.deprecated !== undefined) body.deprecated = args.deprecated;
  return body;
}
