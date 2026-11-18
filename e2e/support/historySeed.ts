import { psql as runPsql } from "./db.cjs";

// HEL-1275 — the one thing the public API cannot do: move a stored history point back in time, so a
// real "7 days ago" baseline exists without waiting a week. Everything else in the proof is a real
// run through the real API; only `captured_at` of rows this test's own runs created is shifted.
//
// Fails LOUDLY (throws) if psql or the DB settings are missing — never skips, so a green spec
// always means the backdating really happened. Targets rows ONLY by the `output_id` the test
// created, records the exact row ids it touched, and asserts the affected-row count.

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function psql(sql: string): string[] {
  return runPsql(sql, "historySeed");
}

/** Shifts `captured_at` of every history row of `outputId` back by `interval` (e.g.
 *  "7 days 1 hour") and returns the exact ids it changed. `SET LOCAL app.current_user_id` makes
 *  the FORCE RLS policy pass for a non-superuser connection too. Throws unless exactly
 *  `expectedRows` rows changed. */
export function backdateHistory(
  outputId: string,
  userId: string,
  interval: string,
  expectedRows: number,
): string[] {
  if (!SAFE_ID.test(outputId) || !SAFE_ID.test(userId) || !/^[0-9a-z ]+$/.test(interval)) {
    throw new Error("historySeed: refusing an unsafe identifier or interval");
  }
  const ids = psql(
    `BEGIN;
SET LOCAL app.current_user_id = '${userId}';
UPDATE output_snapshot_history SET captured_at = captured_at - interval '${interval}'
  WHERE output_id = '${outputId}' RETURNING id;
COMMIT;`,
  ).filter((l) => UUID.test(l));
  if (ids.length !== expectedRows) {
    throw new Error(
      `historySeed: expected to backdate ${expectedRows} row(s) for output ${outputId}, changed ${ids.length}`,
    );
  }
  return ids;
}

/** Reads the history row count for an output (same RLS session setting). */
export function historyRowCount(outputId: string, userId: string): number {
  if (!SAFE_ID.test(outputId) || !SAFE_ID.test(userId)) throw new Error("historySeed: unsafe id");
  const lines = psql(
    `BEGIN;
SET LOCAL app.current_user_id = '${userId}';
SELECT count(*) FROM output_snapshot_history WHERE output_id = '${outputId}';
COMMIT;`,
  );
  return Number(lines[lines.length - 1]);
}

/** HEL-1277 — payload history needs a beta/owner pipeline owner (free caps payload runs at 0), and
 *  the public API cannot change a tier. Sets the tier of EXACTLY the one user whose id the spec
 *  just registered: selected by that id alone (never an email, name or pattern), the freshly
 *  registered account only (the seeded `matt@helio.dev` dev account is refused in SQL), and throws
 *  unless exactly one row changed. Returns the updated id for the spec's teardown log. */
export function setUserTierForTest(userId: string, tier: "beta" | "owner"): string {
  if (!UUID.test(userId)) throw new Error("historySeed: refusing a non-UUID user id");
  if (tier !== "beta" && tier !== "owner") throw new Error("historySeed: refusing an unknown tier");
  const ids = psql(
    `UPDATE users SET tier = '${tier}' WHERE id = '${userId}' AND email <> 'matt@helio.dev' RETURNING id;`,
  ).filter((l) => UUID.test(l));
  if (ids.length !== 1 || ids[0].toLowerCase() !== userId.toLowerCase()) {
    throw new Error(
      `historySeed: expected to update exactly user ${userId}, changed ${ids.length} row(s)`,
    );
  }
  return ids[0];
}
