#!/usr/bin/env node
// HEL-1299 D4: delete superseded `refs/heads/main` Actions cache entries of an explicit allowlist of families,
// keeping the newest KEEP of each. Anything else (other refs, unknown families, npm / setup-sbt entries) is never
// selected. Deletion is by cache id, every deletion is logged as `key ref size_in_bytes`.
//
// Usage: node scripts/cache-janitor.mjs [--dry-run] [--repo owner/name]
// Needs `gh` authenticated with `actions: write` (GH_TOKEN in the workflow). --dry-run makes only GET requests.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MAIN_REF = "refs/heads/main";

/** The allowlist. `keep` counts the newest entries retained per family. */
export const FAMILIES = [
  { name: "backend-compile", re: /^backend-compile-v3-Linux-/, keep: 2 },
  {
    name: "codeql-javascript",
    re: /^codeql-overlay-base-database-\d+-[0-9a-f]+-javascript-/,
    keep: 2,
  },
  { name: "codeql-python", re: /^codeql-overlay-base-database-\d+-[0-9a-f]+-python-/, keep: 2 },
  { name: "codeql-actions", re: /^codeql-overlay-base-database-\d+-[0-9a-f]+-actions-/, keep: 2 },
  // Content-keyed on build.sbt: superseded the moment build.sbt changes on main.
  { name: "sbt-deps", re: /^sbt-[0-9a-f]{64}$/, keep: 1 },
];

/** Pure: the cache entries to delete from a listing (array of {id,key,ref,size_in_bytes,created_at}). */
export function selectDeletions(caches) {
  const doomed = [];
  for (const fam of FAMILIES) {
    const members = caches
      .filter((c) => c.ref === MAIN_REF && fam.re.test(c.key))
      .sort((a, b) =>
        a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id,
      );
    doomed.push(...members.slice(fam.keep));
  }
  return doomed;
}

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

function listCaches(repo) {
  const pages = JSON.parse(
    gh(["api", "--paginate", "--slurp", `repos/${repo}/actions/caches?per_page=100`]),
  );
  return pages.flatMap((p) => p.actions_caches ?? []);
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const ri = argv.indexOf("--repo");
  const repo = ri >= 0 ? argv[ri + 1] : process.env.GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo))
    throw new Error("need --repo owner/name or GITHUB_REPOSITORY");
  const caches = listCaches(repo);
  const doomed = selectDeletions(caches);
  let bytes = 0;
  for (const c of doomed) {
    bytes += c.size_in_bytes;
    console.log(
      `${dryRun ? "would-delete" : "delete"} id=${c.id} ${c.key} ${c.ref} ${c.size_in_bytes}`,
    );
    if (!dryRun) gh(["api", "-X", "DELETE", `repos/${repo}/actions/caches/${c.id}`]);
  }
  console.log(
    `${dryRun ? "dry-run: would delete" : "deleted"} ${doomed.length} of ${caches.length} entries, ${bytes} bytes`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
