#!/usr/bin/env node
// Self-test for scripts/check-ci-complete-needs.mjs (HEL-1428). Drives the exported check against
// in-memory ci.yml text and asserts on the REASON text of each failure, never on "non-empty errors"
// alone. Standalone script, not jest (jest is vacuous inside a worktree -- HEL-880).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCiCompleteNeeds } from "./check-ci-complete-needs.mjs";

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`ok   - ${label}`);
  else {
    failures++;
    console.error(`FAIL - ${label}`);
  }
}
function expectError(label, text, fragment) {
  const { errors } = checkCiCompleteNeeds(text);
  assert(
    errors.some((e) => e.includes(fragment)),
    `${label} (expects error containing ${JSON.stringify(fragment)}; got ${JSON.stringify(errors)})`,
  );
}

const JOB = (name) => `  ${name}:\n    runs-on: ubuntu-latest\n`;
const yaml = ({
  pre = "",
  between = "",
  needsLine = "    needs: [a, b]",
  extraGate = "",
  jobsA = JOB("a"),
  jobsB = JOB("b"),
} = {}) =>
  `name: ci\non:\n  push:\n${pre}jobs:\n${jobsA}${between}${jobsB}  ci-complete:\n    runs-on: ubuntu-latest\n${needsLine}\n${extraGate}    steps:\n      - run: true\n`;

// Green baselines.
assert(checkCiCompleteNeeds(yaml()).errors.length === 0, "valid file passes");
assert(
  checkCiCompleteNeeds(yaml({ needsLine: "    needs: [a, b] # note" })).errors.length === 0,
  "trailing comment after ] allowed",
);
assert(
  checkCiCompleteNeeds(yaml({ between: "# col0 comment\n\n  # indented comment\n" })).errors
    .length === 0,
  "column-0 / indented comments between jobs do not end the jobs block",
);
{
  const r = checkCiCompleteNeeds(yaml());
  assert(r.jobs.join() === "a,b,ci-complete" && r.needs.join() === "a,b", "returns jobs and needs");
}

// Error paths.
expectError("missing job", yaml({ needsLine: "    needs: [a]" }), 'job "b" is missing');
expectError(
  "col-0 comment then later job missing from needs",
  yaml({
    between: "# a comment at column 0\n",
    jobsB: JOB("b") + "# another\n" + JOB("c"),
    needsLine: "    needs: [a, b]",
  }),
  'job "c" is missing',
);
expectError(
  "quoted job key",
  yaml({ jobsA: '  "lint":\n    runs-on: x\n' }),
  "unrecognised 2-space line",
);
expectError(
  "flow-mapping job",
  yaml({ jobsA: "  a: {runs-on: x}\n" }),
  "unrecognised 2-space line",
);
expectError(
  "quoted needs entry",
  yaml({ needsLine: '    needs: [a, "b"]' }),
  "invalid `ci-complete.needs` entry",
);
expectError(
  "empty needs entry (trailing comma)",
  yaml({ needsLine: "    needs: [a, b,]" }),
  "invalid `ci-complete.needs` entry",
);
expectError(
  "empty needs entry (double comma)",
  yaml({ needsLine: "    needs: [a,,b]" }),
  "invalid `ci-complete.needs` entry",
);
expectError(
  "needs names undefined job",
  yaml({ needsLine: "    needs: [a, b, zzz]" }),
  '"zzz", which is not a defined job',
);
expectError(
  "block-list needs",
  yaml({ needsLine: "    needs:\n      - a\n      - b" }),
  "not in single-line flow form",
);
expectError("scalar needs", yaml({ needsLine: "    needs: a" }), "not in single-line flow form");
expectError("two needs lines", yaml({ extraGate: "    needs: [a, b]\n" }), "2 `needs:` lines");
expectError("no needs", yaml({ needsLine: "    # needs: [a, b]" }), "no `needs:` key");
expectError("no ci-complete", "jobs:\n  a:\n    runs-on: x\n", "no `ci-complete` job");
expectError("no jobs block", "name: x\n", "no top-level `jobs:` block");
expectError("zero jobs", "jobs:\n", "no jobs found");
expectError(
  "comment listing all jobs above the real needs line cannot stand in",
  yaml({ needsLine: "    # needs: [a, b]\n    needs: [a]" }),
  'job "b" is missing',
);

// Real ci.yml.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const real = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
assert(checkCiCompleteNeeds(real).errors.length === 0, "real ci.yml passes");
const NEEDS_RE = /^( {4}needs:\s*\[)([^\]]*)(\].*)$/m;
const dropped = real.replace(
  NEEDS_RE,
  (_, a, list, c) =>
    a +
    list
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "docker-image")
      .join(", ") +
    c,
);
assert(dropped !== real, "fixture: docker-image removed from real needs line");
expectError(
  "real ci.yml with docker-image dropped from needs",
  dropped,
  'job "docker-image" is missing',
);
// Real file with a comment listing all jobs above the (mutated) real line.
const withComment = dropped.replace(
  /^( {4}needs:)/m,
  "    # needs: [frontend, backend, security, e2e, docker-image]\n$1",
);
expectError(
  "real ci.yml, comment lists all, docker-image dropped from real line",
  withComment,
  'job "docker-image" is missing',
);

if (failures > 0) {
  console.error(`\ncheck-ci-complete-needs selftest: ${failures} failure(s)`);
  process.exit(1);
}
console.log("\ncheck-ci-complete-needs selftest: all passed");
