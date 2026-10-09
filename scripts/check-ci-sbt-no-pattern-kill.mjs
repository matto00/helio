#!/usr/bin/env node
// HEL-1339 static guard: the CI sbt diagnostics/cleanup path must identify processes only from RECORDED PIDs/PGIDs
// (see scripts/lib/ci-sbt-diag.sh), never by name or command-line pattern. Fails on pgrep/pkill/killall/pidof or a
// `ps ... | ... grep` pipeline in the CI sbt helper scripts and in ci.yml. Comment lines are not scanned. Matching runs over LOGICAL lines (HEL-1362):
// backslash / trailing-`|` / `&&` / `||` continuations are joined, so a pipeline split across lines is still caught.
// JDK-free, node built-ins only: runs in the CI `frontend` job (CI-only, like the other check:* guards there).
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const SCANNED = [
  "scripts/ci-sbt.sh",
  "scripts/lib/ci-sbt-diag.sh",
  "scripts/e2e-backend.sh",
  ".github/workflows/ci.yml",
];

const RULES = [
  [/(^|[^\w-])(pgrep|pkill|killall|pidof)(\s|$|;|\)|\|)/, "pattern-matching process lookup/kill"],
  [/(^|[^\w-])ps\s[^|]*\|.*\bgrep\b/, "`ps | grep` process lookup"],
];

// A YAML block-scalar header (`key: |`, `- run: |-`) ends in `|` but is NOT a shell continuation.
const YAML_BLOCK_HEADER = /:\s*\|[-+]?\s*$/;
const CONTINUES = /(\\|\|\||&&|\|)\s*$/;

// Fold physical lines into logical shell lines: a line ending in `\`, `|`, `||` or `&&` is joined with the next.
// Comment-only lines are dropped (also inside a continuation). Each logical line keeps its first physical line number.
export function logicalLines(text) {
  const out = [];
  let cur = null;
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const continues = !YAML_BLOCK_HEADER.test(line) && CONTINUES.test(line);
    const piece = continues && /\\\s*$/.test(line) ? line.replace(/\\\s*$/, "") : line;
    if (cur) cur.text += ` ${piece.trim()}`;
    else cur = { n: i + 1, text: piece };
    if (!continues) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

export function checkText(file, text) {
  const out = [];
  for (const { n, text: line } of logicalLines(text))
    for (const [re, why] of RULES)
      if (re.test(line)) out.push(`${file}:${n}: ${why}: ${line.trim()}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const violations = SCANNED.flatMap((f) => checkText(f, readFileSync(join(root, f), "utf8")));
  if (violations.length) {
    process.stderr.write(
      `check-ci-sbt-no-pattern-kill: ${violations.length} violation(s)\n${violations.join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`check-ci-sbt-no-pattern-kill: ok (${SCANNED.length} files scanned)\n`);
}
