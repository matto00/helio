#!/usr/bin/env node
// HEL-1301 self-test for e2e/support/userCleanupCore.cjs: the cleanup can only ever target the ids
// a run recorded. Pure: no DB, no browser. `HEL1301_CORE_PATH` points the test at a mutated copy of
// the core (used by the mutation proof in the change's measurements.md); unset = the real module.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const corePath = process.env.HEL1301_CORE_PATH
  ? resolve(process.env.HEL1301_CORE_PATH)
  : join(here, "userCleanupCore.cjs");
const imported = await import(pathToFileURL(corePath).href);
const core = imported.default ?? imported;
const dbPath = process.env.HEL1301_DB_PATH
  ? resolve(process.env.HEL1301_DB_PATH)
  : join(here, "db.cjs");
const dbImported = await import(pathToFileURL(dbPath).href);
const db = dbImported.default ?? dbImported;
const { buildUserDeleteSql, readRegistryDir, SYSTEM_USER_ID, BLOCKING_OWNED_TABLES } = core;

let passed = 0;
let failed = 0;
function record(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}
function refuses(name, records, messagePart) {
  try {
    buildUserDeleteSql(records);
    record(name, false, "expected a throw, got SQL");
  } catch (e) {
    const msg = String(e && e.message);
    record(name, msg.includes(messagePart), `threw "${msg}", expected it to name "${messagePart}"`);
  }
}

const A = { id: "11111111-1111-4111-8111-111111111111", email: "hel1301-a-1-2@example.test" };
const B = { id: "22222222-2222-4222-8222-222222222222", email: "hel1301-b-3-4@example.com" };

// --- refusals -------------------------------------------------------------------------------
refuses("empty input refused", [], "empty record set");
refuses("non-UUID id refused", [{ id: "not-a-uuid", email: A.email }], "non-UUID id");
refuses("SQL-shaped id refused", [{ id: `${A.id}' OR '1'='1`, email: A.email }], "non-UUID id");
refuses("system user id refused", [{ id: SYSTEM_USER_ID, email: A.email }], "system user");
refuses("duplicate id refused", [A, { id: A.id, email: B.email }], "duplicate recorded id");
refuses("duplicate email refused", [A, { id: B.id, email: A.email }], "duplicate recorded email");
refuses("quote in email refused", [{ id: A.id, email: "a'b@example.test" }], "plain address");
refuses("backslash in email refused", [{ id: A.id, email: "a\\b@example.test" }], "plain address");
refuses("whitespace in email refused", [{ id: A.id, email: "a b@example.test" }], "plain address");
refuses(
  "control char in email refused",
  [{ id: A.id, email: "a\nb@example.test" }],
  "plain address",
);
refuses("owner account refused", [{ id: A.id, email: "matt@helio.dev" }], "owner account");
refuses(
  "real-domain account refused",
  [{ id: A.id, email: "someone@gmail.com" }],
  "throwaway domains",
);
refuses(
  "lookalike domain refused",
  [{ id: A.id, email: "x@example.test.evil.io" }],
  "throwaway domains",
);

// --- the SQL contains only the recorded literals, and no pattern predicate -------------------
const sql = buildUserDeleteSql([A, B]);
record("SQL carries both recorded ids", sql.includes(A.id) && sql.includes(B.id));
record("SQL carries both recorded emails", sql.includes(A.email) && sql.includes(B.email));
const uuidsInSql = sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
const allowedUuids = new Set([A.id, B.id, SYSTEM_USER_ID]);
record(
  "SQL has no UUID other than the recorded ids and the system-user exclusion",
  uuidsInSql.every((u) => allowedUuids.has(u)),
  uuidsInSql.join(","),
);
const noQuotedEmails = (sql.match(/'[^'\s]+@[^']*'/g) ?? []).filter(
  (s) => ![`'${A.email}'`, `'${B.email}'`, "'matt@helio.dev'"].includes(s),
);
record(
  "SQL has no email literal other than the recorded ones and the owner exclusion",
  noQuotedEmails.length === 0,
  noQuotedEmails.join(","),
);
for (const banned of [
  /\bLIKE\b/i,
  /\bILIKE\b/i,
  /\bSIMILAR\b/i,
  /~/,
  /\bnow\s*\(/i,
  /\binterval\b/i,
  /\bcurrent_(date|timestamp)\b/i,
]) {
  record(`SQL has no ${banned} predicate`, !banned.test(sql));
}
record(
  "SQL repeats the e2e-domain refusal",
  /split_part\(u\.email, '@', 2\) IN \('example\.test', 'example\.com'\)/.test(sql),
);
record("SQL repeats the owner-account exclusion", sql.includes("u.email <> 'matt@helio.dev'"));
record("SQL repeats the system-user exclusion", sql.includes(`u.id <> '${SYSTEM_USER_ID}'`));
record(
  "guard matches on exact id AND exact email",
  /JOIN hel1301_doomed d ON u\.id = d\.id AND u\.email = d\.email/.test(sql),
);
record("SQL asserts the matched count equals the recorded count", /IF matched <> 2 THEN/.test(sql));
record("SQL asserts the deleted count equals the recorded count", /IF removed <> 2 THEN/.test(sql));
record("SQL locks the doomed rows FOR UPDATE", /FOR UPDATE;/.test(sql));
record("SQL sets a lock_timeout", /SET LOCAL lock_timeout/.test(sql));
record("SQL is one transaction", sql.startsWith("BEGIN;") && sql.trimEnd().endsWith("COMMIT;"));
record(
  "user delete selects by id only",
  /DELETE FROM users WHERE id IN \(SELECT id FROM hel1301_doomed\);/.test(sql),
);
const everyDelete = sql.match(/DELETE FROM \w+ WHERE [^;]*;/g) ?? [];
record(
  "every DELETE is scoped to the doomed set",
  everyDelete.length === BLOCKING_OWNED_TABLES.length + 1 &&
    everyDelete.every((d) => d.includes("IN (SELECT id FROM hel1301_doomed)")),
  everyDelete.join(" | "),
);

// --- a run reads only its own registry directory ----------------------------------------------
const root = mkdtempSync(join(tmpdir(), "hel1301-selftest-"));
try {
  const runDir = join(root, "run-current");
  const siblingDir = join(root, "run-sibling");
  mkdirSync(runDir);
  mkdirSync(siblingDir);
  const SIBLING = { id: "33333333-3333-4333-8333-333333333333", email: "sibling@example.test" };
  writeFileSync(join(runDir, "1.jsonl"), `${JSON.stringify(A)}\n`);
  writeFileSync(join(runDir, "2.jsonl"), `${JSON.stringify(B)}\n`);
  writeFileSync(join(siblingDir, "9.jsonl"), `${JSON.stringify(SIBLING)}\n`);
  const recs = readRegistryDir(runDir);
  const built = buildUserDeleteSql(recs);
  record("registry read returns both of this run's records", recs.length === 2);
  record(
    "a sibling run directory's id never reaches the SQL",
    !built.includes(SIBLING.id) && !built.includes(SIBLING.email),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

// --- a failed DB call never leaks the connection URL, user or password ---------------------------
const SENTINEL_USER = "hel1301sentineluser";
const SENTINEL_PASSWORD = "hel1301sentinelpassword";
const SENTINEL_URL = `postgresql://${SENTINEL_USER}:${SENTINEL_PASSWORD}@127.0.0.1:1/hel1301sentineldb`;
const scrubbed = db.scrubSecrets(
  `could not connect to ${SENTINEL_URL} as ${SENTINEL_USER} with ${SENTINEL_PASSWORD}`,
  [SENTINEL_URL, SENTINEL_USER, SENTINEL_PASSWORD],
);
record(
  "scrubSecrets removes the URL, user and password",
  ![SENTINEL_URL, SENTINEL_USER, SENTINEL_PASSWORD].some((x) => scrubbed.includes(x)),
  scrubbed,
);
let thrown = "";
try {
  db.psql("SELECT 1;", "selftest", {
    url: SENTINEL_URL,
    env: {
      ...process.env,
      PGUSER: SENTINEL_USER,
      PGPASSWORD: SENTINEL_PASSWORD,
      PGCONNECT_TIMEOUT: "3",
    },
    secrets: [SENTINEL_URL, SENTINEL_USER, SENTINEL_PASSWORD],
  });
} catch (e) {
  thrown = String(e && e.message);
}
record("a forced psql failure throws", thrown.startsWith("selftest: psql failed"), thrown);
record(
  "the thrown message carries no URL, user or password",
  ![SENTINEL_URL, SENTINEL_USER, SENTINEL_PASSWORD, "sentineldb"].some((x) => thrown.includes(x)),
  thrown,
);

// --- HEL-1802: conversation folder removal after the delete commits ---------------------------
const { resolveUploadsRoot, conversationFolderPaths } = core;
const runPath = process.env.HEL1802_RUN_PATH
  ? resolve(process.env.HEL1802_RUN_PATH)
  : join(here, "userCleanupRun.cjs");
const runImported = await import(pathToFileURL(runPath).href).catch(() => ({}));
const runMod = runImported.default ?? runImported;
const HOME = "/home/someone";
record(
  "root: home default when nothing is set",
  resolveUploadsRoot?.({}, {}, HOME) === "/home/someone/.helio/uploads",
);
record(
  "root: .env-only HELIO_UPLOADS_ROOT is honoured",
  resolveUploadsRoot?.({}, { HELIO_UPLOADS_ROOT: "/data/env-root" }, HOME) === "/data/env-root",
);
record(
  "root: process env overrides .env",
  resolveUploadsRoot?.(
    { HELIO_UPLOADS_ROOT: "/data/proc" },
    { HELIO_UPLOADS_ROOT: "/data/env-root" },
    HOME,
  ) === "/data/proc",
);
record(
  "root: HELIO_UPLOADS_DIR is the fallback when ROOT is unset in both",
  resolveUploadsRoot?.({}, { HELIO_UPLOADS_DIR: "/data/legacy" }, HOME) === "/data/legacy",
);
record(
  "root: ROOT in .env beats DIR in process env (per-key merge, ROOT first)",
  resolveUploadsRoot?.(
    { HELIO_UPLOADS_DIR: "/data/legacy" },
    { HELIO_UPLOADS_ROOT: "/data/env-root" },
    HOME,
  ) === "/data/env-root",
);
record(
  "root: result is absolute and normalized",
  resolveUploadsRoot?.({ HELIO_UPLOADS_ROOT: "/data/a/../b/" }, {}, HOME) === "/data/b",
);
record(
  "folder paths: exactly assistant-conversations/<id> per validated record",
  JSON.stringify(conversationFolderPaths?.([A, B], "/r")) ===
    JSON.stringify([`/r/assistant-conversations/${A.id}`, `/r/assistant-conversations/${B.id}`]),
);
{
  let threw = false;
  try {
    conversationFolderPaths?.([{ id: "../x", email: A.email }], "/r");
  } catch {
    threw = true;
  }
  record("folder paths: an unvalidated id never reaches a path", conversationFolderPaths && threw);
}

const del = runMod.deleteUsersAndFolders;
function fakeRun(psqlImpl, opts = {}) {
  const calls = [];
  const removed = [];
  const logs = [];
  const result = (() => {
    try {
      return del([A, B], {
        psql: (sql) => {
          calls.push("psql");
          return psqlImpl(sql);
        },
        dotEnv: opts.dotEnv ?? {},
        processEnv: opts.processEnv ?? { HELIO_UPLOADS_ROOT: "/uploads-root" },
        homedir: HOME,
        isSymlink: opts.isSymlink ?? (() => false),
        remove: (p) => {
          calls.push("rm");
          removed.push(p);
        },
        log: (m) => logs.push(m),
      });
    } catch (e) {
      return { threw: String(e && e.message) };
    }
  })();
  return { calls, removed, logs, result };
}
{
  const ok = fakeRun(() => []);
  record(
    "run: psql commits before any folder is removed",
    ok.calls.join(",") === "psql,rm,rm",
    ok.calls.join(","),
  );
  record(
    "run: removes exactly the built folders under the resolved root",
    JSON.stringify(ok.removed) ===
      JSON.stringify([
        `/uploads-root/assistant-conversations/${A.id}`,
        `/uploads-root/assistant-conversations/${B.id}`,
      ]),
    ok.removed.join(","),
  );
  record(
    "run: logs one numbers-only line",
    ok.logs.length === 1 &&
      /removed \d+ of \d+ conversation folders/.test(ok.logs[0]) &&
      !ok.logs[0].includes("/") &&
      !ok.logs[0].includes(A.id),
    ok.logs.join("|"),
  );
  const bad = fakeRun(() => {
    throw new Error("aborted");
  });
  record(
    "run: a failed delete removes no folder",
    bad.removed.length === 0 && bad.result.threw === "aborted",
    JSON.stringify(bad),
  );
  const link = fakeRun(() => [], { isSymlink: (p) => p.endsWith(A.id) });
  record(
    "run: a symlinked folder is skipped, not followed",
    link.removed.length === 1 && link.removed[0].endsWith(B.id),
    link.removed.join(","),
  );
  const envOnly = fakeRun(() => [], {
    processEnv: {},
    dotEnv: { HELIO_UPLOADS_ROOT: "/from-dotenv" },
  });
  record(
    "run: the .env uploads root is used when the process env has none",
    envOnly.removed[0] === `/from-dotenv/assistant-conversations/${A.id}`,
    envOnly.removed.join(","),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
