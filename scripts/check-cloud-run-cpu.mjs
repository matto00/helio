#!/usr/bin/env node
// HEL-1245: the backend's in-process timers (scheduler tick, auto-run debounce,
// rollups) need CPU between requests. Cloud Run's default request-based CPU
// allocation freezes the container, which surfaced as intermittent
// `Response entity was not subscribed after 1 second` on scheduled REST runs.
// Fails if either deploy path loses `--no-cpu-throttling` (matched as a whole
// token inside the real `flags:` value / `gcloud run deploy` invocation --
// comments never count) or carries the positive `--cpu-throttling`.
//
// Usage: node check-cloud-run-cpu.mjs [repoRoot]

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const NO_THROTTLE = "--no-cpu-throttling";
const THROTTLE = "--cpu-throttling";

function verdict(label, tokens) {
  const problems = [];
  if (!tokens.includes(NO_THROTTLE)) problems.push(`${label}: missing ${NO_THROTTLE}`);
  if (tokens.includes(THROTTLE)) problems.push(`${label}: must not pass ${THROTTLE}`);
  return problems;
}

/** Check the CD workflow text: the non-comment `flags:` value(s). */
export function checkWorkflow(text) {
  const label = ".github/workflows/cd-backend.yml";
  const values = [];
  for (const line of text.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*flags:\s*(.*)$/);
    if (m) values.push(m[1].replace(/^["']|["']\s*$/g, ""));
  }
  if (values.length === 0) return [`${label}: no flags: value found`];
  return values.flatMap((v) => verdict(label, v.split(/\s+/)));
}

/** Check the deploy script text: the (backslash-continued) `gcloud run deploy` command. */
export function checkDeployScript(text) {
  const label = "infra/deploy-backend.sh";
  const lines = text.split("\n");
  const start = lines.findIndex((l) => !/^\s*#/.test(l) && /gcloud\s+run\s+deploy\b/.test(l));
  if (start === -1) return [`${label}: no gcloud run deploy invocation found`];
  let cmd = "";
  for (let i = start; i < lines.length; i++) {
    const l = lines[i].replace(/\s+$/, "");
    if (l.endsWith("\\")) cmd += ` ${l.slice(0, -1)}`;
    else {
      cmd += ` ${l}`;
      break;
    }
  }
  return verdict(label, cmd.trim().split(/\s+/));
}

export function check(root) {
  return [
    ...checkWorkflow(readFileSync(join(root, ".github/workflows/cd-backend.yml"), "utf8")),
    ...checkDeployScript(readFileSync(join(root, "infra/deploy-backend.sh"), "utf8")),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const problems = check(root);
  if (problems.length) {
    console.error(
      `check-cloud-run-cpu FAILED (HEL-1245):\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log("check-cloud-run-cpu OK");
}
