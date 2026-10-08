#!/usr/bin/env node
// HEL-1299 D5 static guard for .github/workflows/cache-cleanup-pr.yml (a pull_request_target workflow with a write
// token): it must delete exactly the closed PR's merge ref, take the PR number only from the event via env, and
// never check out or run anything from the PR. Usage: node check-cache-cleanup-pr.mjs [workflowPath]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DELETE_LINE =
  'gh cache delete --all --ref "refs/pull/${PR_NUMBER}/merge" --succeed-on-no-caches -R "$GITHUB_REPOSITORY"';

/** Returns an array of violation strings (empty when the workflow text is acceptable). */
export function check(text) {
  const v = [];
  const lines = text.split("\n").filter((l) => !l.trim().startsWith("#"));
  const code = lines.join("\n");
  const deletes = lines.filter((l) =>
    /\bgh\s+cache\s+delete\b|\bcaches\/|-X\s+DELETE|\bDELETE\b/.test(l),
  );
  if (deletes.length !== 1) v.push(`expected exactly one delete command, found ${deletes.length}`);
  else if (!deletes[0].includes(DELETE_LINE)) v.push(`delete is not exactly: ${DELETE_LINE}`);
  if (/\$\{\{[^}]*\}\}/.test(deletes[0] ?? "")) v.push("delete command interpolates an expression");
  if (/actions\/checkout/.test(code)) v.push("must not check out code");
  if (!/^on:\s*\n\s+pull_request_target:\s*\n\s+types:\s*\[closed\]\s*$/m.test(code))
    v.push("trigger must be pull_request_target types [closed] only");
  const prNumber = [...code.matchAll(/^\s*PR_NUMBER:\s*(.+)$/gm)];
  if (prNumber.length !== 1 || prNumber[0][1].trim() !== "${{ github.event.pull_request.number }}")
    v.push("PR_NUMBER must be set exactly once, from github.event.pull_request.number");
  const exprs = [...code.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1]);
  for (const e of exprs)
    if (!["github.event.pull_request.number", "github.token"].includes(e))
      v.push(`unexpected expression: ${e}`);
  for (const l of lines) {
    if (/^\s*run:/.test(l) && /\$\{\{/.test(l)) v.push("expression inside a run: line");
  }
  if (!/^permissions:\n {2}actions: write\n(?! )/m.test(code))
    v.push("permissions must be exactly actions: write");
  return v;
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? join(here, "..", ".github", "workflows", "cache-cleanup-pr.yml");
  const v = check(readFileSync(path, "utf8"));
  if (v.length) {
    console.error(v.map((x) => `cache-cleanup-pr: ${x}`).join("\n"));
    process.exit(1);
  }
  console.log("cache-cleanup-pr.yml: ok");
}
