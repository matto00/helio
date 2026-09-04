#!/usr/bin/env node
// Self-test for scripts/check-node-root-encoding.mjs (HEL-913 task 5.8b-i: "prove the guard
// fires" -- a guard never observed failing against the defect it names is not evidence).
// Drives `scanTextForViolations` against in-memory fixture text -- no disk, no real repo files
// touched -- and asserts on the VIOLATION COUNT AND CONTENT, never on "the function ran without
// throwing" alone.

import { scanTextForViolations } from "./check-node-root-encoding.mjs";

let failures = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) {
    failures++;
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

// (a) Raw SQL standalone `node_step_id IS NULL` -- the exact form V98/R12 bans -- FIRES.
{
  const text = `sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pid AND node_step_id IS NULL"`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("raw SQL standalone fires", violations.length, 1);
}

// (b) Raw SQL WITH a same-line root_id qualifier -- does NOT fire (this is the correct,
// already-fixed shape this ticket's Stage 2 introduced).
{
  const text = `sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pid AND node_step_id IS NULL AND root_id = $rid"`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("raw SQL root-qualified does not fire", violations.length, 0);
}

// (c) Slick-lifted `.nodeStepId.isEmpty` on a table row -- FIRES.
{
  const text = `val filtered = table.filter(r => r.pipelineId === pid && r.nodeStepId.isEmpty)`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("Slick .nodeStepId.isEmpty fires", violations.length, 1);
}

// (d) Slick-lifted `.nodeStepId.isDefined` -- FIRES.
{
  const text = `if (r.nodeStepId.isDefined) doSomething()`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check(".nodeStepId.isDefined fires", violations.length, 1);
}

// (e) `=== Option.empty` -- FIRES.
{
  const text = `table.filter(r => r.nodeStepId === Option.empty)`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("=== Option.empty fires", violations.length, 1);
}

// (f) Slick form WITH a same-line rootId qualifier -- does NOT fire.
{
  const text = `table.filter(r => r.nodeStepId.isEmpty && r.rootId === Option(rid))`;
  const violations = scanTextForViolations("fake/File.scala", text);
  check("Slick root-qualified does not fire", violations.length, 0);
}

// (g) A line inside KNOWN_UNFIXED_LINES for the REAL target file does not fire (proves the
// exemption mechanism works, using the actual exempted line from the shipped file).
//
// HEL-913 task 5.8b-iv: was previously pinned to `OutputRepository.scala:84`
// (`listByNodeInternal`'s `(None, None)` arm) -- that method was DELETED outright (proven
// zero callers anywhere), so its exemption entry is gone too. Repinned to
// `NodeSnapshotRepository.scala:52` (`overwriteRows`'s `(None, None)` delete branch), one of
// the 6 entries that survive 5.8b-iv's re-audit -- production-unreachable but genuinely
// test-reachable, see that file's own KNOWN_UNFIXED_LINES comment for the full proof.
{
  const relPath =
    "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala";
  const text = Array.from({ length: 52 }, (_, i) =>
    i === 51
      ? `        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"`
      : "",
  ).join("\n");
  const violations = scanTextForViolations(relPath, text);
  check("known-unfixed line 52 of NodeSnapshotRepository.scala is exempted", violations.length, 0);
}

// (h) The SAME banned pattern at a DIFFERENT, non-exempted line in that same file DOES fire --
// proves the exemption is line-pinned, not file-wide.
{
  const relPath =
    "backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala";
  const text = Array.from({ length: 10 }, (_, i) =>
    i === 4 ? `  case None => table.filter(r => r.nodeStepId.isEmpty)` : "",
  ).join("\n");
  const violations = scanTextForViolations(relPath, text);
  check("same pattern at a non-exempted line still fires", violations.length, 1);
}

if (failures > 0) {
  console.error(`\n${failures} selftest case(s) failed.`);
  process.exit(1);
}
console.log("\nAll check-node-root-encoding selftest cases passed.");
