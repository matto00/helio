#!/usr/bin/env node
// Guards that every job in `.github/workflows/ci.yml` (except `ci-complete` itself) is listed in
// `ci-complete.needs` (HEL-1428). A job left out of `needs` silently stops being a required check:
// `ci-complete` goes green without waiting for it.
//
// Deliberately NOT built on check-precommit-ci-parity.mjs's `parseCiCompleteNeeds`: that helper is
// lenient by design (no `ci-complete` -> scans the whole file; non-flow `needs` -> []). This guard
// fails CLOSED instead -- any shape it cannot parse with certainty is an error, never a pass.
// No YAML parser dependency: the file is scanned line-by-line under the strict shape rules below.
//
// Usage: node check-ci-complete-needs.mjs [repoRoot]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GATE_JOB = "ci-complete";
const JOB_KEY_RE = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/;
const BARE_ID_RE = /^[A-Za-z0-9_-]+$/;
const NEEDS_LINE_RE = /^ {4}needs:/;
const NEEDS_FLOW_RE = /^ {4}needs:\s*\[([^\]]*)\]\s*(#.*)?$/;

const isCommentOrBlank = (line) => line.trim() === "" || line.trim().startsWith("#");

/**
 * Pure check of ci.yml text. Returns `{errors, jobs, needs}`; a non-empty `errors` is a failure.
 */
export function checkCiCompleteNeeds(ciYamlText) {
  const errors = [];
  const lines = ciYamlText.split("\n");

  const jobsStart = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsStart === -1) {
    return { errors: ["no top-level `jobs:` block found in ci.yml"], jobs: [], needs: [] };
  }
  // `jobs:` must be the last top-level key, so the block runs to end of file. A column-0 line after
  // it is NOT treated as a terminator (it may be the continuation of a multi-line quoted scalar, which
  // would hide every later job): it is an error, since the job set cannot be established.
  const jobsEnd = lines.length;
  for (let i = jobsStart + 1; i < jobsEnd; i++) {
    if (!isCommentOrBlank(lines[i]) && /^\S/.test(lines[i])) {
      errors.push(
        `column-0 line after \`jobs:\` -- jobs must be the last top-level key in ci.yml (cannot establish the job set): ${JSON.stringify(lines[i])}`,
      );
    }
  }

  // Job keys: every non-comment line at exactly 2-space indent must be a plain `name:` key.
  const jobLines = []; // {name, index}
  for (let i = jobsStart + 1; i < jobsEnd; i++) {
    const line = lines[i];
    if (isCommentOrBlank(line) || !/^ {2}\S/.test(line)) continue;
    const m = JOB_KEY_RE.exec(line);
    if (m) jobLines.push({ name: m[1], index: i });
    else
      errors.push(
        `unrecognised 2-space line in jobs: block (cannot parse as a job key): ${JSON.stringify(line)}`,
      );
  }
  const jobs = jobLines.map((j) => j.name);
  const seen = new Set();
  for (const { name } of jobLines) {
    if (seen.has(name))
      errors.push(`duplicate job key "${name}" in jobs: block (cannot establish the job set)`);
    seen.add(name);
  }
  if (jobs.length === 0) errors.push("no jobs found in the jobs: block");

  const gate = jobLines.find((j) => j.name === GATE_JOB);
  if (!gate) {
    errors.push(`no \`${GATE_JOB}\` job found`);
    return { errors, jobs, needs: [] };
  }
  const gateEnd = jobLines.find((j) => j.index > gate.index)?.index ?? jobsEnd;

  const needsIdx = [];
  for (let i = gate.index + 1; i < gateEnd; i++) {
    if (!isCommentOrBlank(lines[i]) && NEEDS_LINE_RE.test(lines[i])) needsIdx.push(i);
  }
  if (needsIdx.length === 0) {
    errors.push(`\`${GATE_JOB}\` has no \`needs:\` key (4-space indent)`);
    return { errors, jobs, needs: [] };
  }
  if (needsIdx.length > 1) {
    errors.push(`\`${GATE_JOB}\` has ${needsIdx.length} \`needs:\` lines; expected exactly one`);
    return { errors, jobs, needs: [] };
  }
  const flow = NEEDS_FLOW_RE.exec(lines[needsIdx[0]]);
  if (!flow) {
    errors.push(
      `\`${GATE_JOB}.needs\` is not in single-line flow form \`needs: [a, b]\`: ${JSON.stringify(lines[needsIdx[0]])}`,
    );
    return { errors, jobs, needs: [] };
  }

  const needs = [];
  for (const raw of flow[1].split(",")) {
    const entry = raw.trim();
    if (BARE_ID_RE.test(entry)) needs.push(entry);
    else
      errors.push(
        `invalid \`${GATE_JOB}.needs\` entry (must be a bare job id): ${JSON.stringify(entry)}`,
      );
  }

  for (const n of needs) {
    if (!jobs.includes(n))
      errors.push(`\`${GATE_JOB}.needs\` names "${n}", which is not a defined job`);
  }
  for (const j of jobs) {
    if (j !== GATE_JOB && !needs.includes(j)) {
      errors.push(
        `job "${j}" is missing from \`${GATE_JOB}.needs\` (it would silently stop being required)`,
      );
    }
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
      `\nAdd every job to \`${GATE_JOB}.needs\` (single-line \`needs: [a, b]\`) in .github/workflows/ci.yml.`,
    );
    process.exit(1);
  }
  console.log(`\ncheck-ci-complete-needs: OK -- every job is in ${GATE_JOB}.needs.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
