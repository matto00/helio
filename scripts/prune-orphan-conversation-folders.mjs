#!/usr/bin/env node
// HEL-1802 - lists (and, only with --delete, removes) the per-user conversation folders under an uploads root
// whose folder name is a well-formed user UUID present in NONE of the given databases.
//
//   node scripts/prune-orphan-conversation-folders.mjs --uploads-root <abs path> \
//        --database-url <url> [--database-url <url> ...] [--delete] [--summary]
//
// Pass EVERY database whose users may still own a folder (a live lane DB included): a folder is an orphan only
// when no given database has that user. The uploads root has no default and the run is a dry run unless --delete
// is given. Deletion addresses each folder by joining root + "assistant-conversations" + the exact UUID: no glob,
// no pattern, no time window, and a symlinked folder is never followed. If any database cannot be read the script
// fails with nothing listed and nothing deleted. A connection string or credential is never printed.
// Credentials: DB_USER / DB_PASSWORD in the environment are passed to psql as PGUSER / PGPASSWORD (a URL's own
// user/password wins), the same mapping the e2e helpers use.

import { lstatSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FAMILY = "assistant-conversations";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Pure core. `queries` are async functions `(ids: string[]) => Set<string>` returning the ids present in one
 * database; fs access is limited to the one family directory and the exact folders it lists.
 */
export async function prune({ uploadsRoot, queries, doDelete }) {
  const dir = join(uploadsRoot, FAMILY);
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
  const candidates = [];
  let skipped = 0;
  for (const e of entries) {
    if (e.isDirectory() && !e.isSymbolicLink() && UUID.test(e.name)) candidates.push(e.name);
    else skipped++;
  }
  const present = new Set();
  const matchedPerDatabase = [];
  if (candidates.length > 0) {
    for (const query of queries) {
      const found = await query(candidates); // a rejection aborts: nothing listed, nothing deleted
      matchedPerDatabase.push(found.size);
      for (const id of found) present.add(id);
    }
  } else {
    for (let i = 0; i < queries.length; i++) matchedPerDatabase.push(0);
  }
  const orphans = candidates.filter((id) => !present.has(id));
  let deleted = 0;
  if (doDelete) {
    for (const id of orphans) {
      const path = join(dir, id);
      if (lstatSync(path).isSymbolicLink()) continue;
      rmSync(path, { recursive: true, force: true });
      deleted++;
    }
  }
  return {
    orphans,
    kept: candidates.length - orphans.length,
    skipped,
    deleted,
    matchedPerDatabase,
  };
}

export function formatSummary(r) {
  return (
    `orphans=${r.orphans.length} kept=${r.kept} skipped=${r.skipped} deleted=${r.deleted}` +
    ` matchedPerDatabase=${r.matchedPerDatabase.join(",")}`
  );
}

export function parseArgs(argv) {
  const out = { uploadsRoot: undefined, databaseUrls: [], doDelete: false, summary: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--uploads-root") out.uploadsRoot = argv[++i];
    else if (a === "--database-url") out.databaseUrls.push(argv[++i]);
    else if (a === "--delete") out.doDelete = true;
    else if (a === "--summary") out.summary = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.uploadsRoot)
    throw new Error("--uploads-root <absolute path> is required (it has no default)");
  if (!isAbsolute(out.uploadsRoot)) throw new Error("--uploads-root must be an absolute path");
  out.uploadsRoot = resolve(out.uploadsRoot);
  if (out.databaseUrls.length === 0 || out.databaseUrls.some((u) => !u)) {
    throw new Error("at least one --database-url is required");
  }
  return out;
}

/** A query against one database via the shared psql helper; the ids are validated UUIDs, so safe to inline. */
function databaseQuery(url) {
  const require = createRequire(import.meta.url);
  const { credentialEnv, psql, scrubSecrets } = require("../e2e/support/db.cjs");
  const bare = url.replace(/^jdbc:/, "");
  // DB_USER/DB_PASSWORD from the process environment only (never backend/.env: the URLs are explicit and may
  // target several databases), mapped exactly as e2e/support/db.cjs does and scrubbed from any error text.
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const secrets = [url, bare, user, password];
  const env = credentialEnv(process.env, user, password);
  return async (ids) => {
    const sql = `SELECT id::text FROM users WHERE id = ANY('{${ids.join(",")}}'::uuid[]);`;
    try {
      return new Set(psql(sql, "prune", { url: bare, env, secrets }));
    } catch (e) {
      throw new Error(scrubSecrets(e?.message ?? "query failed", secrets));
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await prune({
    uploadsRoot: args.uploadsRoot,
    queries: args.databaseUrls.map(databaseQuery),
    doDelete: args.doDelete,
  });
  if (!args.summary)
    for (const id of result.orphans) console.log(join(args.uploadsRoot, FAMILY, id));
  console.log(formatSummary(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(`prune-orphan-conversation-folders: ${String(e?.message ?? e).slice(0, 600)}`);
    process.exitCode = 1;
  });
}
