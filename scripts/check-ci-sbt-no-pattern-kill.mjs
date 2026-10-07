#!/usr/bin/env node
// HEL-1339 static guard: the CI sbt diagnostics/cleanup path must identify processes only from RECORDED PIDs/PGIDs
// (see scripts/lib/ci-sbt-diag.sh), never by name or command-line pattern. Fails on pgrep/pkill/killall/pidof or a
// `ps ... | ... grep` pipeline in the CI sbt helper scripts and in ci.yml. Comment lines are not scanned.
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

export function checkText(file, text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    for (const [re, why] of RULES)
      if (re.test(line)) out.push(`${file}:${i + 1}: ${why}: ${line.trim()}`);
  });
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
