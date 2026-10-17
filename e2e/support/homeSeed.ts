import { randomUUID } from "node:crypto";
import { psql as runPsql } from "./db.cjs";

// HEL-1578 — the public API cannot create a run row at an arbitrary past time or status, which the Home
// timeline needs (a failed run 3h ago, a few successes). Inserts rows for the one pipeline the spec
// just created, by that pipeline's id alone, with ids generated here; fails loudly (never skips).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SeedRun {
  status: "succeeded" | "failed";
  /** Hours before now the run started. */
  hoursAgo: number;
  errorLog?: string;
}

/** Inserts the runs for `pipelineId` (owned by `userId`) and returns the exact run ids written. */
export function seedPipelineRuns(pipelineId: string, userId: string, runs: SeedRun[]): string[] {
  if (!UUID.test(pipelineId) || !UUID.test(userId)) throw new Error("homeSeed: unsafe id");
  const ids: string[] = runs.map(() => randomUUID());
  const values = runs.map((run, index) => {
    const error = run.errorLog === undefined ? "NULL" : `'${run.errorLog.replace(/'/g, "''")}'`;
    const rowCount = run.status === "succeeded" ? "3" : "NULL";
    return `('${ids[index]}', '${pipelineId}', '${run.status}', now() - interval '${run.hoursAgo} hours', now() - interval '${run.hoursAgo} hours' + interval '20 seconds', ${rowCount}, ${error}, 'manual')`;
  });
  const out = runPsql(
    `BEGIN;
SET LOCAL app.current_user_id = '${userId}';
INSERT INTO pipeline_runs (id, pipeline_id, status, started_at, completed_at, row_count, error_log, trigger_source)
VALUES ${values.join(",\n")} RETURNING id;
COMMIT;`,
    "homeSeed",
  ).filter((line) => ids.includes(line));
  if (out.length !== runs.length) {
    throw new Error(`homeSeed: expected ${runs.length} run(s) written, got ${out.length}`);
  }
  return ids;
}
