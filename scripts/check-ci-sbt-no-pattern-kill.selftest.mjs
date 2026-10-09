#!/usr/bin/env node
// Selftest for scripts/check-ci-sbt-no-pattern-kill.mjs: proves each forbidden spelling is flagged (guard is
// failable) and that legitimate lines (grep of a file, comments, kill of a recorded group) are not.
import { checkText, logicalLines, SCANNED } from "./check-ci-sbt-no-pattern-kill.mjs";
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
// HEL-1362: pipelines split across physical lines (backslash or trailing pipe) are one logical shell line.
const flagsOnce = (name, text) => rec(`flags (split): ${name}`, checkText("x", text).length === 1);
flagsOnce("backslash then | grep", "ps -ef \\\n  | grep sbt");
flagsOnce("trailing | then grep", "ps -ef |\n  grep sbt");
flagsOnce("three-line split", "ps -ef \\\n  | awk '{print}' \\\n  | grep sbt");
flagsOnce("trailing && continuation", "pgrep -f x &&\n  echo y");
flagsOnce("comment inside a continuation does not hide the rest", "ps -ef |\n# note\n  grep sbt");
flagsOnce(
  "YAML run: | body with a split pipeline",
  "  - run: |\n      ps -ef \\\n        | grep sbt",
);
rec(
  "reports the FIRST physical line number",
  /^x:3:/.test(checkText("x", "a\nb\nps -ef |\n grep s")[0] ?? ""),
);
const allowsText = (name, text) =>
  rec(`allows (split): ${name}`, checkText("x", text).length === 0);
allowsText("two separate lines ps x / grep y", "ps x\ngrep y");
allowsText("YAML `run: |` header is not a continuation", "  - run: |\n      grep y file");
allowsText("block header followed by a ps and then a grep line", "key: |\n  ps x\n  grep y");
// The YAML block-header exclusion must be failable: the header stays its own logical line and the flagged body
// line is reported at the BODY's physical line (2), not the header's (1).
{
  const ll = logicalLines("  - run: |\n      ps -ef | grep x");
  rec(
    "YAML `run: |` header is its own logical line (not joined to the body)",
    ll.length === 2 && ll[0].n === 1 && !ll[0].text.includes("grep") && ll[1].n === 2,
  );
  rec(
    "flagged YAML body line reports the body's line number",
    /^x:2:/.test(checkText("x", "  - run: |\n      ps -ef | grep x")[0] ?? ""),
  );
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
rec(
  "real tree is clean",
  SCANNED.every((f) => checkText(f, readFileSync(join(root, f), "utf8")).length === 0),
);
process.exit(failed ? 1 : 0);
