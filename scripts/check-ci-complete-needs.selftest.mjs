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
  between = "",
  needsLine = "    needs: [a, b]",
  jobsA = JOB("a"),
  jobsB = JOB("b"),
} = {}) =>
  `name: ci\non:\n  push:\njobs:\n${jobsA}${between}${jobsB}  ci-complete:\n    runs-on: ubuntu-latest\n${needsLine}\n    steps:\n      - run: true\n`;

// Green baselines.
assert(checkCiCompleteNeeds(yaml()).errors.length === 0, "valid file passes");
assert(
  checkCiCompleteNeeds(yaml({ needsLine: "    needs: [a, b] # note" })).errors.length === 0,
  "trailing comment allowed",
);
assert(
  checkCiCompleteNeeds(yaml({ needsLine: "    needs:\n      - a\n      - b" })).errors.length === 0,
  "block-list needs is parsed (the parser accepts any list form)",
);
assert(
  checkCiCompleteNeeds(yaml({ between: "# col0 comment\n\n  # indented comment\n" })).errors
    .length === 0,
  "comments between jobs are ignored",
);
{
  const r = checkCiCompleteNeeds(yaml());
  assert(r.jobs.join() === "a,b,ci-complete" && r.needs.join() === "a,b", "returns jobs and needs");
}

// Error paths.
expectError("missing job", yaml({ needsLine: "    needs: [a]" }), 'job "b" is missing');
expectError(
  "col-0 comment then later job missing from needs",
  yaml({ between: "# a comment at column 0\n", jobsB: JOB("b") + "# another\n" + JOB("c") }),
  'job "c" is missing',
);
expectError(
  "quoted needs entry that is not a bare id",
  yaml({ needsLine: '    needs: [a, "b c"]' }),
  "invalid `ci-complete.needs` entry",
);
expectError(
  "empty needs entry",
  yaml({ needsLine: '    needs: [a, b, ""]' }),
  "invalid `ci-complete.needs` entry",
);
expectError(
  "non-string needs entry",
  yaml({ needsLine: "    needs: [a, b, 1]" }),
  "invalid `ci-complete.needs` entry",
);
expectError(
  "needs names undefined job",
  yaml({ needsLine: "    needs: [a, b, zzz]" }),
  '"zzz", which is not a defined job',
);
expectError(
  "scalar needs is rejected",
  yaml({ needsLine: "    needs: a" }),
  "must be a list of job ids",
);
expectError("no needs", yaml({ needsLine: "    # needs: [a, b]" }), "no `needs:` key");
expectError(
  "duplicate job key is a parse error",
  yaml({ jobsB: JOB("a") + JOB("b") }),
  "not parseable YAML",
);
expectError(
  "two needs keys is a parse error",
  yaml({ needsLine: "    needs: [a, b]\n    needs: [a, b]" }),
  "not parseable YAML",
);
expectError("no ci-complete", "jobs:\n  a:\n    runs-on: x\n", "no `ci-complete` job");
expectError("no jobs block", "name: x\n", "no top-level `jobs:` mapping");
expectError("jobs is a list", "jobs:\n  - a\n", "no top-level `jobs:` mapping");
expectError("zero jobs", "jobs: {}\n", "no jobs found");
expectError("empty file", "", "no top-level `jobs:` mapping");
expectError("broken YAML", "jobs: [\n", "not parseable YAML");
expectError(
  "comment listing all jobs above the real needs line cannot stand in",
  yaml({ needsLine: "    # needs: [a, b]\n    needs: [a]" }),
  'job "b" is missing',
);
expectError(
  "job after ci-complete missing from needs",
  "jobs:\n  ci-complete:\n    needs: [a]\n  a:\n  b:\n",
  'job "b" is missing',
);

// Named regressions: the three evaluator attacks (cycles 1-3). Each hides structure-looking lines in a
// multi-line quoted scalar; a line scanner mis-reads them, the parser sees plain string content.
expectError(
  "REGRESSION cycle 1: column-0 continuation line inside a quoted scalar",
  'jobs:\n  a:\n    runs-on: x\n  ci-complete:\n    needs: [a, b]\n  b:\n    steps:\n      - run: "echo\nfoo: bar"\n  c:\n    runs-on: x\n',
  'job "c" is missing',
);
expectError(
  "REGRESSION cycle 2: fake duplicate ci-complete + needs inside an earlier job's quoted scalar",
  'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: "x\n  ci-complete:\n    needs: [a, b]\n    end"\n  b:\n    runs-on: x\n  ci-complete:\n    needs: [a]\n',
  'job "b" is missing',
);
expectError(
  "REGRESSION cycle 3: fake `zz:` key inside the gate's own quoted scalar hiding the real needs",
  'on: push\njobs:\n  a:\n    runs-on: x\n  b:\n    runs-on: x\n  ci-complete:\n    name: "x\n    needs: [a, b, zz]\n  zz:\n    y"\n    needs: [a]\n',
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
assert(dropped !== real, "fixture: docker-image removed from real needs");
expectError(
  "real ci.yml with docker-image dropped from needs",
  dropped,
  'job "docker-image" is missing',
);
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
