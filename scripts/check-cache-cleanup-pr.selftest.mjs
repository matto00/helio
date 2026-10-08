#!/usr/bin/env node
// HEL-1299 selftest for scripts/check-cache-cleanup-pr.mjs: the real workflow passes and each mutated copy fails.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check, DELETE_LINE } from "./check-cache-cleanup-pr.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const real = readFileSync(join(here, "..", ".github", "workflows", "cache-cleanup-pr.yml"), "utf8");
let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  process.stdout.write(`${cond ? "ok  " : "FAIL"} ${name}${cond ? "" : ` -- ${detail}`}\n`);
};
ok("real workflow passes", check(real).length === 0, check(real).join("; "));

const mutations = {
  "prefix delete (no exact ref)": (t) =>
    t.replace(
      DELETE_LINE,
      'gh cache delete --all --ref "refs/pull/${PR_NUMBER}/" -R "$GITHUB_REPOSITORY"',
    ),
  "delete all caches": (t) =>
    t.replace(DELETE_LINE, 'gh cache delete --all -R "$GITHUB_REPOSITORY"'),
  "inline expression in command": (t) =>
    t.replace(
      DELETE_LINE,
      DELETE_LINE.replace("${PR_NUMBER}", "${{ github.event.pull_request.number }}"),
    ),
  "PR title via env": (t) =>
    t.replace(
      "PR_NUMBER: ${{ github.event.pull_request.number }}",
      "PR_NUMBER: ${{ github.event.pull_request.title }}",
    ),
  "checkout added": (t) =>
    t.replace("    steps:\n", "    steps:\n      - uses: actions/checkout@v7\n"),
  "second delete": (t) => `${t}\n      - run: gh cache delete 123\n`,
  "wrong trigger": (t) => t.replace("pull_request_target:", "pull_request:"),
  "extra permission": (t) =>
    t.replace("  actions: write\n", "  actions: write\n  contents: write\n"),
};
for (const [name, mutate] of Object.entries(mutations)) {
  const mutated = mutate(real);
  ok(
    `mutation rejected: ${name}`,
    mutated !== real && check(mutated).length > 0,
    "mutation not applied or not detected",
  );
}
if (failed) {
  process.stdout.write(`${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write("all cache-cleanup-pr checks passed\n");
