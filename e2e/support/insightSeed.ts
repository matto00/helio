import { psql as runPsql } from "./db.cjs";

// HEL-1744 -- the one thing the public API cannot do before HEL-1743 (L4) merges: write a stored insight render, because
// no render trigger exists yet. This test-only helper inserts ONE `output_insights` row for ONE insight Output the spec
// just created, over the e2e DB connection (support/db.cjs), like historySeed.ts. It is not a production path: nothing
// in the app calls it, and the app itself gained no way to render.
//
// It validates every id against a strict pattern, sets `app.current_user_id` so the FORCE RLS insert policy passes for
// a non-superuser connection, and throws unless exactly one row was written. The row carries distinctive model, token
// and cost values on purpose: the spec then proves none of them reaches any insight surface.

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_FIELD = /^[A-Za-z0-9 .,-]+$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const QUOTE_TAG = "hel1744md";

export const SEEDED_MODEL = "e2e-model-secret-7f3a";
export const SEEDED_INPUT_TOKENS = 987654;
export const SEEDED_OUTPUT_TOKENS = 876543;
export const SEEDED_COST_MICROS = 4242421;

export interface SeedCitation {
  id: string;
  outputId: string;
  field: string;
  number: number;
}

export interface SeedInsightRender {
  insightOutputId: string;
  pipelineId: string;
  userId: string;
  markdown: string;
  citations: SeedCitation[];
  /** ISO instant (UTC, `Z`) the render is dated; defaults to now. */
  createdAt?: string;
  status?: "ok" | "failed" | "skipped_quota" | "skipped_unchanged" | "skipped_budget";
}

/** Inserts one render row for `insightOutputId` and returns its id. Throws unless exactly one row was written. */
export function seedInsightRender(seed: SeedInsightRender): string {
  const {
    insightOutputId,
    pipelineId,
    userId,
    markdown,
    citations,
    createdAt,
    status = "ok",
  } = seed;
  for (const id of [insightOutputId, pipelineId, userId, ...citations.map((c) => c.outputId)]) {
    if (!SAFE_ID.test(id)) throw new Error("insightSeed: refusing an unsafe identifier");
  }
  // The markdown is dollar-quoted: any text is safe except the quote tag itself and a NUL.
  if (markdown.includes(`$${QUOTE_TAG}$`) || markdown.includes("\0")) {
    throw new Error("insightSeed: refusing unsafe markdown");
  }
  if (createdAt !== undefined && !ISO.test(createdAt)) {
    throw new Error("insightSeed: refusing a malformed createdAt");
  }
  for (const c of citations) {
    if (!SAFE_ID.test(c.id) || !SAFE_FIELD.test(c.field) || !Number.isFinite(c.number)) {
      throw new Error("insightSeed: refusing an unsafe citation");
    }
  }
  const citationJson = JSON.stringify(
    citations.map((c) => ({
      id: c.id,
      outputId: c.outputId,
      field: c.field,
      number: c.number,
      isPct: false,
    })),
  );
  const lines = runPsql(
    `BEGIN;
SET LOCAL app.current_user_id = '${userId}';
INSERT INTO output_insights
  (output_id, pipeline_id, trigger, status, markdown, citations, model,
   input_tokens, output_tokens, cost_micros, created_at)
VALUES
  ('${insightOutputId}', '${pipelineId}', 'on_run', '${status}', $${QUOTE_TAG}$${markdown}$${QUOTE_TAG}$,
   '${citationJson.replaceAll("'", "''")}'::jsonb, '${SEEDED_MODEL}',
   ${SEEDED_INPUT_TOKENS}, ${SEEDED_OUTPUT_TOKENS}, ${SEEDED_COST_MICROS},
   ${createdAt === undefined ? "now()" : `'${createdAt}'::timestamptz`})
RETURNING id;
COMMIT;`,
    "insightSeed",
  ).filter((l) => UUID.test(l));
  if (lines.length !== 1) {
    throw new Error(`insightSeed: expected exactly one inserted row, got ${lines.length}`);
  }
  return lines[0];
}
