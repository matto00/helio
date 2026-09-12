#!/usr/bin/env node
// Self-test for scripts/check-test-temp-dir-hygiene.mjs (HEL-1120). Proves the guard actually
// flags all four temp-file/dir creation spellings it claims to cover, and that it correctly
// leaves alone the two exemptions (TempDirectorySupport.scala itself, and a reviewed-comment
// site) — a guard proven failable once in a PR body can silently stop being failable through a
// later refactor; this selftest re-proves it on every commit and CI run.

import { checkFile } from "./check-test-temp-dir-hygiene.mjs";

let passed = 0;
let failed = 0;

function record(name, ok, detail) {
  if (ok) {
    passed++;
  } else {
    failed++;
    process.stderr.write(`FAIL: ${name}${detail ? ` — ${detail}` : ""}\n`);
  }
}

const REL = "backend/src/test/scala/com/helio/example/FixtureSpec.scala";

// Each of the four spellings, as a bare call with no exemption, must be flagged.
const rawSpellings = [
  ['val d = Files.createTempDirectory("x")', "Files.createTempDirectory"],
  ['val f = Files.createTempFile("x", ".tmp")', "Files.createTempFile"],
  ['val f = java.io.File.createTempFile("x", ".tmp")', "java.io.File.createTempFile"],
  ['val f = File.createTempFile("x", ".tmp")', "File.createTempFile"],
];

for (const [line, label] of rawSpellings) {
  const violations = checkFile(REL, line);
  record(`flags bare ${label}`, violations.length === 1, `got ${JSON.stringify(violations)}`);
}

// All four together, to prove the walk doesn't stop at the first hit.
const allFour = rawSpellings.map(([line]) => line).join("\n");
const allViolations = checkFile(REL, allFour);
record(
  "flags all four spellings in one file",
  allViolations.length === 4,
  `got ${allViolations.length}: ${JSON.stringify(allViolations)}`,
);

// TempDirectorySupport.scala itself is exempt regardless of content.
const helperRel = "backend/src/test/scala/com/helio/testkit/TempDirectorySupport.scala";
const helperViolations = checkFile(helperRel, 'val d = Files.createTempDirectory("x")');
record("does not flag TempDirectorySupport.scala itself", helperViolations.length === 0);

// A same-line trailing reviewed-comment is exempt.
const trailing = 'val d = Files.createTempDirectory("x") // temp-dir-hygiene: reviewed — fixture';
record("does not flag a same-line reviewed comment", checkFile(REL, trailing).length === 0);

// A reviewed-comment on the line directly above is exempt.
const above = [
  "// temp-dir-hygiene: reviewed — fixture",
  'val d = Files.createTempDirectory("x")',
].join("\n");
record("does not flag a reviewed comment on the line above", checkFile(REL, above).length === 0);

// A plain call with NO exemption two lines away must still be flagged (the escape hatch is not
// transitive across unrelated lines).
const notAdjacent = [
  "// temp-dir-hygiene: reviewed — unrelated line",
  "val unrelated = 1",
  'val d = Files.createTempDirectory("x")',
].join("\n");
record(
  "still flags when the reviewed comment is not adjacent",
  checkFile(REL, notAdjacent).length === 1,
);

process.stdout.write(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
