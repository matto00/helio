// HEL-1802 — the delete-then-remove step of the e2e throwaway-user cleanup. The user-delete transaction
// (userCleanupCore.buildUserDeleteSql) runs first; only after psql returns (the transaction committed — psql
// throws on an aborted one) are the deleted users' conversation folders removed from the uploads root the backend
// uses. A stored-object drain removes the files too when a backend is running, but a lane database is often
// dropped before any tick, so this is what makes the cleanup deterministic.
//
// It logs one line of numbers only: never a path, an id or an environment value, so a root mismatch shows
// as `removed 0` without leaking anything.

const { lstatSync, rmSync } = require("node:fs");
const { homedir } = require("node:os");
const {
  buildUserDeleteSql,
  conversationFolderPaths,
  resolveUploadsRoot,
} = require("./userCleanupCore.cjs");

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** Deletes `records`' users, then their conversation folders. Returns `{removed, total}`. Every dependency is
 *  injectable (the selftest passes fakes); the defaults are the real psql, `backend/.env`, process env, fs. */
function deleteUsersAndFolders(records, deps = {}) {
  const db = deps.psql ? null : require("./db.cjs");
  const psql = deps.psql ?? ((sql, label) => db.psql(sql, label));
  const sql = buildUserDeleteSql(records);
  const label = deps.label ?? "userCleanup";
  psql(sql, label);

  const dotEnv = deps.dotEnv ?? (db ?? require("./db.cjs")).readBackendEnv();
  const root = resolveUploadsRoot(
    deps.processEnv ?? process.env,
    dotEnv,
    deps.homedir ?? homedir(),
  );
  const isSymlink = deps.isSymlink ?? ((p) => lstatOrNull(p)?.isSymbolicLink() === true);
  const remove = deps.remove ?? ((p) => rmSync(p, { recursive: true, force: true }));
  const log = deps.log ?? ((m) => console.log(m));

  const paths = conversationFolderPaths(records, root);
  let removed = 0;
  for (const path of paths) {
    if (isSymlink(path)) continue; // never follow a link out of the uploads tree
    const existed = lstatOrNull(path) !== null;
    remove(path);
    if (existed) removed++;
  }
  log(`${label}: removed ${removed} of ${paths.length} conversation folders`);
  return { removed, total: paths.length };
}

module.exports = { deleteUsersAndFolders };
