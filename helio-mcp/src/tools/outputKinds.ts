/**
 * The one list of Output kinds helio-mcp accepts (HEL-1747 D5). Mirrors the kind enum of
 * `schemas/pipelines/create-pipeline-transactional-output-request.schema.json`; a drift test
 * (`insightSurface.test.ts`) pins the two together and fails if a source file re-inlines the list.
 */

import { z } from "zod";

export const OUTPUT_KINDS = [
  "table",
  "metric",
  "chart",
  "collection",
  "timeline",
  "markdown",
  "insight",
] as const;

export type OutputKind = (typeof OUTPUT_KINDS)[number];

export const outputKindSchema = z.enum(OUTPUT_KINDS);

/** `table/metric/...` for tool descriptions, derived so it cannot drift from the tuple. */
export const OUTPUT_KINDS_SLASH_LIST = OUTPUT_KINDS.join("/");
