// HEL-1802 — the delete-then-remove step of the e2e throwaway-user cleanup. The user-delete transaction
// (userCleanupCore.buildUserDeleteSql) runs first; only after psql returns (the transaction committed — psql
// throws on an aborted one) are the deleted users' conversation folders removed from the uploads root the backend
// uses. A stored-object drain removes the files too when a backend is running, but a lane database is often
// dropped before any tick, so this is what makes the cleanup deterministic.
//
// It logs one line of numbers only: never a path, an id or an environment value, so a root mismatch shows
// as `removed 0` without leaking anything.

const { existsSync, lstatSync, rmSync } = require("node:fs");
const { homedir } = require("node:os");
const {
  buildUserDeleteSql,
  conversationFolderPaths,
  readRegistryDir,
  resolveUploadsRoot,
} = require("./userCleanupCore.cjs");

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Deletes `records`' users, then their conversation folders. Returns `{removed, failed, total}`. Every
 *  dependency is injectable (the selftest passes fakes); the defaults are the real psql, `backend/.env`, process
 *  env, fs. A psql failure throws before any folder work (the delete did not commit). Once psql returns, nothing
 *  escapes: a root-resolution failure counts every folder as failed, and each folder is attempted and caught
 *  individually, so the caller can still clear its registry. */
function deleteUsersAndFolders(records, deps = {}) {
  const db = deps.psql ? null : require("./db.cjs");
  const psql = deps.psql ?? ((sql, label) => db.psql(sql, label));
  const sql = buildUserDeleteSql(records);
  const label = deps.label ?? "userCleanup";
  psql(sql, label);

  // The delete has committed. Everything below is counted, never thrown.
  const log = deps.log ?? ((m) => console.log(m));
  let paths = [];
  let removed = 0;
  let failed = 0;
  try {
    const dotEnv = deps.dotEnv ?? (db ?? require("./db.cjs")).readBackendEnv();
    const root = resolveUploadsRoot(
      deps.processEnv ?? process.env,
      dotEnv,
      deps.homedir ?? homedir(),
    );
    paths = conversationFolderPaths(records, root);
  } catch {
    paths = null;
  }
  if (paths === null) {
    failed = records.length;
    log(`${label}: removed 0 of ${records.length} conversation folders, ${failed} failed`);
    return { removed: 0, failed, total: records.length };
  }
  const isSymlink = deps.isSymlink ?? ((p) => lstatOrNull(p)?.isSymbolicLink() === true);
  const remove = deps.remove ?? ((p) => rmSync(p, { recursive: true, force: true }));
  for (const path of paths) {
    try {
      if (isSymlink(path)) continue; // never follow a link out of the uploads tree
      const existed = lstatOrNull(path) !== null;
      remove(path);
      if (existed) removed++;
    } catch {
      failed++;
    }
  }
  log(`${label}: removed ${removed} of ${paths.length} conversation folders, ${failed} failed`);
  return { removed, failed, total: paths.length };
}

/** The registry teardown: deletes the run's recorded users and folders, then removes the registry directory
 *  as soon as the delete has committed, even when folders failed (a left directory would name users that no
 *  longer exist and the next run's exact-match check would refuse it). A failed folder removal then throws a
 *  count-only error. A psql failure propagates and the directory is kept. Returns the record count; a missing
 *  directory returns 0. */
function deleteRegistryRun(dir, deps = {}) {
  if (!dir || !existsSync(dir)) return 0;
  const records = readRegistryDir(dir);
  let failed = 0;
  let total = 0;
  if (records.length > 0) {
    ({ failed, total } = deleteUsersAndFolders(records, deps));
  }
  rmSync(dir, { recursive: true, force: true });
  if (failed > 0) {
    throw new Error(
      `userCleanup: ${failed} of ${total} conversation folders could not be removed (the users were deleted; ` +
        "run scripts/prune-orphan-conversation-folders.mjs to find leftovers)",
    );
  }
  return records.length;
}

module.exports = { deleteUsersAndFolders, deleteRegistryRun };
