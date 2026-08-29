/**
 * Mutual-exclusion validation for `create_csv_data_source`'s `content`/
 * `sourceUrl` inputs (HEL-862 design.md Decision 5/9) — split into its own
 * small module, `write.ts`'s exclusive consumer, so a unit test can import
 * just this narrow surface without pulling `write.ts`'s full ~20-tool
 * Zod-schema surface into the compile graph (see `updateSchemas.ts`'s
 * identical rationale, and `write.test.ts`).
 */

/** Enforces exactly one of `content`/`sourceUrl` is present, BEFORE any HTTP
 *  call — the backend has no state in which both are present (a single
 *  request is either multipart or JSON), so this is the only place both
 *  arguments genuinely coexist. Throws (never returns) on zero-or-both,
 *  naming both arguments so a caller can reach a correct conclusion without
 *  guessing which one it needs to drop. */
export function assertExactlyOneCsvInput(
  content: string | undefined,
  sourceUrl: string | undefined,
): void {
  if (content !== undefined && sourceUrl !== undefined)
    throw new Error(
      "create_csv_data_source: provide exactly one of `content` or `sourceUrl`, not both.",
    );
  if (content === undefined && sourceUrl === undefined)
    throw new Error("create_csv_data_source: provide exactly one of `content` or `sourceUrl`.");
}
