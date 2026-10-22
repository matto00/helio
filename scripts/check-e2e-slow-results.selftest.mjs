#!/usr/bin/env node
// Self-test for scripts/check-e2e-slow-results.mjs (HEL-1698): the weekly e2e-slow lane's guard that a green run
// exercised something. Each RED case asserts on what the failure names; the GREEN case proves the guard can pass.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import { evaluate, collectSkipped } from "./check-e2e-slow-results.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "check-e2e-slow-results.mjs");
let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

const green = { stats: { expected: 3, skipped: 0, unexpected: 0, flaky: 0 }, suites: [] };
const skippedSuite = {
  title: "hel1582-sweep-390.spec.ts",
  file: "hel1582-sweep-390.spec.ts",
  suites: [
    {
      title: "MAXIMAL sweep",
      specs: [{ title: "gated test", tests: [{ status: "skipped" }] }],
    },
  ],
};

test("GREEN: an all-passed report has no problems", () => assert.deepEqual(evaluate(green), []));

test("RED: a skipped test fails and is named", () => {
  const report = { stats: { expected: 2, skipped: 1, unexpected: 0 }, suites: [skippedSuite] };
  const problems = evaluate(report).join("\n");
  assert.match(problems, /1 test\(s\) skipped/);
  assert.match(problems, /MAXIMAL sweep > gated test/);
  assert.deepEqual(collectSkipped(report.suites).length, 1);
});

test("RED: zero tests ran fails", () => {
  assert.match(
    evaluate({ stats: { expected: 0, skipped: 0, unexpected: 0 } }).join(),
    /no test ran/,
  );
});

test("RED: unexpected failures fail", () => {
  assert.match(
    evaluate({ stats: { expected: 3, skipped: 0, unexpected: 2 } }).join(),
    /2 test\(s\) failed unexpectedly/,
  );
});

test("RED: a report without stats fails", () => {
  assert.deepEqual(evaluate({}), ["report has no stats"]);
  assert.deepEqual(evaluate(undefined), ["report has no stats"]);
});

function cliRun(args) {
  return spawnSync("node", [cli, ...args], { encoding: "utf8" });
}

test("CLI: green report exits 0; unreadable file exits 1; missing arg exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-slow-selftest-"));
  try {
    const ok = join(dir, "ok.json");
    writeFileSync(ok, JSON.stringify(green));
    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify({ stats: { expected: 1, skipped: 1, unexpected: 0 }, suites: [skippedSuite] }),
    );
    assert.equal(cliRun([ok]).status, 0);
    const r = cliRun([bad]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /gated test/);
    const missing = cliRun([join(dir, "nope.json")]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /cannot read/);
    assert.equal(cliRun([]).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`${n} check-e2e-slow-results selftest cases passed`);
