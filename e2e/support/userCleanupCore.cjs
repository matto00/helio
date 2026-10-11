// HEL-1301 — the pure, DB-free core of the e2e throwaway-user cleanup. It builds the one
// transaction that deletes EXACTLY the users a run recorded, and refuses everything else. It has no
// connection, no filesystem writes and no clock, so it is unit-testable (userCleanup.selftest.mjs)
// and cannot be pointed at anything but the ids and emails it is handed.
//
// Selection is by exact id only. The recorded email is a second equality check (never a selector).
// There is no LIKE/ILIKE/regex/name/time-window predicate anywhere in the SQL this emits.

// CommonJS for the same reason as db.cjs (loads from Playwright's TS and from plain node).
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
/** The seeded owner/dev account literal `setUserTierForTest` already refuses. */
const OWNER_EMAIL = "matt@helio.dev";
const E2E_EMAIL_DOMAINS = ["example.test", "example.com"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Plain address characters only: nothing that could break out of a SQL string literal.
const PLAIN_EMAIL_LOCAL = /^[A-Za-z0-9._+-]+$/;

/** Tables whose rows reference `users` with ON DELETE NO ACTION/RESTRICT, as `[table, ownerColumn]`,
 *  in dependency order (children before parents). Every other `users` FK cascades. A newly added
 *  NO ACTION FK makes the final user delete fail loudly rather than leave residue silently. */
const BLOCKING_OWNED_TABLES = [
  ["alert_events", "owner_id"],
  ["alert_rules", "owner_id"],
  ["panels", "owner_id"],
  ["outputs", "owner_id"],
  ["dashboards", "owner_id"],
  ["pipelines", "owner_id"],
  ["connectors", "owner_id"],
  ["patch_set_applications", "owner_id"],
  ["authoring_conversations", "owner_id"],
  ["assistant_conversations", "owner_id"],
  ["assistant_daily_usage", "user_id"],
  ["pipeline_run_rate_window", "user_id"],
  ["invite_codes", "user_id"],
];

/** Validates and normalizes recorded `{id, email}` pairs; throws before anything is built. */
function validateRecords(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("userCleanup: refusing an empty record set");
  }
  const ids = new Set();
  const emails = new Set();
  return records.map((r, i) => {
    if (r === null || typeof r !== "object")
      throw new Error(`userCleanup: record ${i} is not an object`);
    const { id, email } = r;
    if (typeof id !== "string" || !UUID.test(id)) {
      throw new Error(`userCleanup: record ${i} has a non-UUID id`);
    }
    if (id === SYSTEM_USER_ID) throw new Error("userCleanup: refusing the system user id");
    if (typeof email !== "string" || email.length === 0 || email.length > 254) {
      throw new Error(`userCleanup: record ${i} has no usable email`);
    }
    const at = email.indexOf("@");
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (at < 1 || !PLAIN_EMAIL_LOCAL.test(local) || !/^[a-z0-9.-]+$/.test(domain)) {
      throw new Error(`userCleanup: record ${i} email is not a plain address`);
    }
    if (email.toLowerCase() === OWNER_EMAIL)
      throw new Error("userCleanup: refusing the owner account");
    if (!E2E_EMAIL_DOMAINS.includes(domain)) {
      throw new Error(`userCleanup: record ${i} email is outside the e2e throwaway domains`);
    }
    if (ids.has(id)) throw new Error(`userCleanup: duplicate recorded id at record ${i}`);
    if (emails.has(email)) throw new Error(`userCleanup: duplicate recorded email at record ${i}`);
    ids.add(id);
    emails.add(email);
    return { id, email };
  });
}

/** The single deletion transaction for the recorded users. Throws (no SQL) on any bad input. */
function buildUserDeleteSql(records) {
  const rows = validateRecords(records);
  const n = rows.length;
  const values = rows.map((r) => `('${r.id}', '${r.email}')`).join(",\n  ");
  const domains = E2E_EMAIL_DOMAINS.map((d) => `'${d}'`).join(", ");
  const childDeletes = BLOCKING_OWNED_TABLES.map(
    ([table, col]) => `DELETE FROM ${table} WHERE ${col} IN (SELECT id FROM hel1301_doomed);`,
  ).join("\n");
  return `BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TEMP TABLE hel1301_doomed (id uuid PRIMARY KEY, email text NOT NULL) ON COMMIT DROP;
INSERT INTO hel1301_doomed (id, email) VALUES
  ${values};
DO $guard$
DECLARE matched integer;
BEGIN
  SELECT count(*) INTO matched
    FROM users u JOIN hel1301_doomed d ON u.id = d.id AND u.email = d.email
   WHERE u.id <> '${SYSTEM_USER_ID}'
     AND u.email <> '${OWNER_EMAIL}'
     AND split_part(u.email, '@', 2) IN (${domains});
  IF matched <> ${n} THEN
    RAISE EXCEPTION 'userCleanup: % of ${n} recorded users match their exact id and email; nothing deleted', matched;
  END IF;
  PERFORM id FROM users WHERE id IN (SELECT id FROM hel1301_doomed) FOR UPDATE;
END
$guard$;
${childDeletes}
DO $del$
DECLARE removed integer;
BEGIN
  DELETE FROM users WHERE id IN (SELECT id FROM hel1301_doomed);
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed <> ${n} THEN
    RAISE EXCEPTION 'userCleanup: deleted % users, expected ${n}; rolled back', removed;
  END IF;
END
$del$;
COMMIT;
`;
}

/** Reads ONLY `*.jsonl` files directly inside `dir` (one run's registry); never a sibling run dir. */
function readRegistryDir(dir) {
  const records = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()) {
    for (const line of readFileSync(join(dir, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      records.push(JSON.parse(line));
    }
  }
  return records;
}

module.exports = {
  SYSTEM_USER_ID,
  OWNER_EMAIL,
  E2E_EMAIL_DOMAINS,
  BLOCKING_OWNED_TABLES,
  validateRecords,
  buildUserDeleteSql,
  readRegistryDir,
};
