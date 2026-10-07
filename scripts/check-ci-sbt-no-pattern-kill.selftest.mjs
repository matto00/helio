#!/usr/bin/env node
// Selftest for scripts/check-ci-sbt-no-pattern-kill.mjs: proves each forbidden spelling is flagged (guard is
// failable) and that legitimate lines (grep of a file, comments, kill of a recorded group) are not.
import { checkText, SCANNED } from "./check-ci-sbt-no-pattern-kill.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let failed = 0;
const rec = (name, ok) => {
  if (!ok) failed++;
  process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);
};
for (const bad of [
  "pgrep -f sbt",
  "  pkill -f java",
  "killall java",
  "kill $(pidof java)",
  "ps aux | grep sbt",
  "ps -ef | awk '{print}' | grep java",
  "run: pkill sbt",
])
  rec(`flags: ${bad}`, checkText("x", bad).length === 1);
for (const ok of [
  "grep -qE 'compiling' \"$LOG\"",
  "# never pgrep here",
  'kill -TERM -- "-$pgid"',
  'ps -o pid,ppid --sid "$pgid"',
  "echo kill-switch-pgrepish",
])
  rec(`allows: ${ok}`, checkText("x", ok).length === 0);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rec(
  "real tree is clean",
  SCANNED.every((f) => checkText(f, readFileSync(join(root, f), "utf8")).length === 0),
);
process.exit(failed ? 1 : 0);
