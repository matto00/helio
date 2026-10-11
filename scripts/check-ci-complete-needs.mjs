#!/usr/bin/env node
// Guards that every job in `.github/workflows/ci.yml` (except `ci-complete` itself) is listed in
// `ci-complete.needs` (HEL-1428). A job left out of `needs` silently stops being a required check:
// `ci-complete` goes green without waiting for it.
//
// ci.yml is parsed with js-yaml (root devDependency), never scanned line-by-line: a line scanner cannot tell
// structure from the continuation lines of a multi-line quoted scalar, and three review cycles each found
// another way to hide a job that way. The guard fails CLOSED on the parsed tree: anything it cannot establish
// with certainty is an error, never a pass. js-yaml rejects duplicate keys, which surfaces as a parse error.
//
// `needs` must be a YAML list of bare job ids. GitHub also accepts the scalar form `needs: a`; this guard
// rejects it on purpose (ci-complete aggregates several jobs, and a scalar would be a single-job gate).
//
// Usage: node check-ci-complete-needs.mjs [repoRoot]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";

const GATE_JOB = "ci-complete";
const BARE_ID_RE = /^[A-Za-z0-9_-]+$/;
const GUARD_SCRIPT_NAME = "check:ci-complete-needs";
const GUARD_SCRIPT_PATH = "scripts/check-ci-complete-needs.mjs";

const NPM_RUN_RE = /npm(?:\s+--prefix\s+\S+)?\s+run\s+([\w:.-]+)/g;
const NPM_BARE_ALIAS_RE = /npm(?:\s+--prefix\s+\S+)?\s+(test|start)\b(?!\S)/g;
const NODE_PATH_RE = /\bnode\s+(\S+\.m?js)\b/g;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Extract every `npm run <script>` and bare-alias (`npm test`/`npm start`) name from a command string. */
export function extractNpmScriptInvocations(text) {
  const names = new Set();
  let m;
  NPM_RUN_RE.lastIndex = 0;
  while ((m = NPM_RUN_RE.exec(text))) names.add(m[1]);
  NPM_BARE_ALIAS_RE.lastIndex = 0;
  while ((m = NPM_BARE_ALIAS_RE.exec(text))) names.add(m[1]);
  return names;
}

/** Extract every direct `node <path>` invocation from a command string. */
export function extractNodePaths(text) {
  const paths = new Set();
  let m;
  NODE_PATH_RE.lastIndex = 0;
  while ((m = NODE_PATH_RE.exec(text))) paths.add(m[1]);
  return paths;
}

/**
 * The `run` strings of one parsed job's `steps`. Absent/null `steps` contributes nothing; any other non-list
 * value is an error (returned as `error`), never silently treated as empty. A step without a string `run`
 * (e.g. `uses:`) contributes nothing.
 */
export function jobRunCommands(doc, jobName) {
  const job = doc.jobs[jobName];
  const steps = isPlainObject(job) ? job.steps : undefined;
  if (steps === undefined || steps === null) return { commands: [], error: null };
  if (!Array.isArray(steps)) {
    return { commands: [], error: `job "${jobName}" has a \`steps:\` that is not a list` };
  }
  const commands = [];
  for (const step of steps) {
    if (isPlainObject(step) && typeof step.run === "string") commands.push(step.run);
  }
  return { commands, error: null };
}

/**
 * Structural read of ci.yml's merge-gate topology (shared with check-precommit-ci-parity.mjs so there is one
 * parser of this file). Returns `{errors, doc, jobs, needs}`; a non-empty `errors` is a failure and the
 * structural errors are exclusive (the first one found is returned alone).
 */
export function readCiTopology(ciYamlText) {
  let doc;
  try {
    doc = load(ciYamlText);
  } catch (e) {
    const reason = String(e && e.message ? e.message : e).split("\n")[0];
    return {
      errors: [`ci.yml is not parseable YAML (duplicate keys included): ${reason}`],
      doc: null,
      jobs: [],
      needs: [],
    };
  }
  if (!isPlainObject(doc) || !isPlainObject(doc.jobs)) {
    return { errors: ["ci.yml has no top-level `jobs:` mapping"], doc: null, jobs: [], needs: [] };
  }

  const jobs = Object.keys(doc.jobs);
  if (jobs.length === 0) {
    return { errors: ["no jobs found in the jobs: mapping"], doc, jobs, needs: [] };
  }
  if (!jobs.includes(GATE_JOB)) {
    return { errors: [`no \`${GATE_JOB}\` job found`], doc, jobs, needs: [] };
  }

  const gate = doc.jobs[GATE_JOB];
  const rawNeeds = isPlainObject(gate) ? gate.needs : undefined;
  if (rawNeeds === undefined) {
    return { errors: [`\`${GATE_JOB}\` has no \`needs:\` key`], doc, jobs, needs: [] };
  }
  if (!Array.isArray(rawNeeds)) {
    return {
      errors: [`\`${GATE_JOB}.needs\` must be a list of job ids (a scalar or mapping is rejected)`],
      doc,
      jobs,
      needs: [],
    };
  }

  const errors = [];
  const needs = [];
  for (const entry of rawNeeds) {
    if (typeof entry === "string" && BARE_ID_RE.test(entry)) needs.push(entry);
    else
      errors.push(
        `invalid \`${GATE_JOB}.needs\` entry (must be a bare job id): ${JSON.stringify(entry)}`,
      );
  }
  for (const n of needs) {
    if (!jobs.includes(n))
      errors.push(`\`${GATE_JOB}.needs\` names "${n}", which is not a defined job`);
  }
  return { errors, doc, jobs, needs };
}

/**
 * Pure check of ci.yml text. Returns `{errors, jobs, needs}`; a non-empty `errors` is a failure.
 */
export function checkCiCompleteNeeds(ciYamlText) {
  const { errors, doc, jobs, needs } = readCiTopology(ciYamlText);
  if (doc === null || !jobs.includes(GATE_JOB) || !Array.isArray(doc.jobs[GATE_JOB]?.needs)) {
    return { errors, jobs, needs };
  }
  for (const j of jobs) {
    if (j !== GATE_JOB && !needs.includes(j)) {
      errors.push(
        `job "${j}" is missing from \`${GATE_JOB}.needs\` (it would silently stop being required)`,
      );
    }
  }

  // HEL-1462 D5: the guard must run inside `ci-complete` itself (exact tokens, never a substring), or
  // dropping the job that hosted it would silently disarm it in CI. Only checked once the structure is sound.
  const { commands, error } = jobRunCommands(doc, GATE_JOB);
  if (error) {
    errors.push(error);
  } else if (
    !commands.some(
      (c) =>
        extractNpmScriptInvocations(c).has(GUARD_SCRIPT_NAME) ||
        extractNodePaths(c).has(GUARD_SCRIPT_PATH),
    )
  ) {
    errors.push(
      `\`${GATE_JOB}\` must run the guard itself: add a step running \`npm run ${GUARD_SCRIPT_NAME}\` ` +
        `(or \`node ${GUARD_SCRIPT_PATH}\`) to the ${GATE_JOB} job`,
    );
  }
  return { errors, jobs, needs };
}

function main() {
  const repoRoot = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const ciYamlText = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
  const { errors, jobs, needs } = checkCiCompleteNeeds(ciYamlText);

  console.log(`check-ci-complete-needs: jobs (${jobs.length}): ${jobs.join(", ")}`);
  console.log(`check-ci-complete-needs: ${GATE_JOB}.needs (${needs.length}): ${needs.join(", ")}`);
  if (errors.length > 0) {
    console.error("\ncheck-ci-complete-needs: FAILED\n");
    for (const error of errors) console.error(`  - ${error}`);
    console.error(
      `\nAdd every job to \`${GATE_JOB}.needs\` (a YAML list of job ids) in .github/workflows/ci.yml.`,
    );
    process.exit(1);
  }
  console.log(`\ncheck-ci-complete-needs: OK -- every job is in ${GATE_JOB}.needs.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
