#!/usr/bin/env node
// Self-test for scripts/e2e-shard.mjs (HEL-1361). Pure-function cases plus one CLI case; no
// Playwright, no servers. Each "must fail" case asserts on the FILE NAMED in the error, and the
// mutation cases prove the exact-once check is failable (a partition that drops/duplicates a file
// must be rejected) rather than vacuously green.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import {
  partition,
  resolveWeights,
  parseWeights,
  verifyExactlyOnce,
  verifySelection,
  fileArg,
  escapeRegExp,
  exitCodeOf,
  fileSumsForRun,
  weightsFromRuns,
  filesFromList,
} from "./e2e-shard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let n = 0;
function test(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}
function throwsNaming(fn, ...names) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected a throw");
  for (const name of names)
    assert.ok(err.message.includes(name), `error must name ${name}: ${err.message}`);
}

const files = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts", "e.spec.ts"];
const table = parseWeights(
  "# c\na.spec.ts\t100\nb.spec.ts\t40\nc.spec.ts\t30\nd.spec.ts\t30\nstale.spec.ts\t999\n",
);

test("LPT is deterministic and balanced", () => {
  const { weights } = resolveWeights(files, table);
  const one = partition(files, weights, 2);
  const two = partition([...files].reverse(), weights, 2);
  assert.deepEqual(one, two);
  // order a(100) b(40) e(35, defaulted) c(30) d(30): a->0, b->1, e->1(75<100), c->1(75<100), d->0(100<105)
  assert.deepEqual(one[0].files, ["a.spec.ts", "d.spec.ts"]);
  assert.equal(one[0].load, 130);
  assert.deepEqual(one[1].files, ["b.spec.ts", "c.spec.ts", "e.spec.ts"]);
  assert.equal(one[1].load, 105);
  verifyExactlyOnce(files, one);
});

test("unknown file defaults to the median of rows for discovered files; stale rows ignored", () => {
  const { weights, defaulted, stale } = resolveWeights(files, table);
  assert.equal(weights.get("e.spec.ts"), 35); // median of 100,40,30,30 -- stale 999 excluded
  assert.deepEqual(defaulted, ["e.spec.ts"]);
  assert.deepEqual(stale, ["stale.spec.ts"]);
});

test("equal weights tie-break by path then lowest leg index", () => {
  const w = new Map(files.map((f) => [f, 10]));
  const legs = partition(files, w, 2);
  assert.deepEqual(legs[0].files, ["a.spec.ts", "c.spec.ts", "e.spec.ts"]);
  assert.deepEqual(legs[1].files, ["b.spec.ts", "d.spec.ts"]);
});

test("exact partition passes", () => {
  verifyExactlyOnce(files, partition(files, resolveWeights(files, table).weights, 4));
});

test("RED mutation: a partition that drops a file is rejected, naming it", () => {
  const legs = partition(files, resolveWeights(files, table).weights, 3);
  legs[0].files = legs[0].files.filter((f) => f !== "a.spec.ts"); // mutate: drop a.spec.ts
  throwsNaming(() => verifyExactlyOnce(files, legs), "a.spec.ts");
});

test("RED mutation: a duplicated or undiscovered file is rejected, naming it", () => {
  const legs = partition(files, resolveWeights(files, table).weights, 3);
  legs[1].files.push("a.spec.ts");
  throwsNaming(() => verifyExactlyOnce(files, legs), "duplicated=[a.spec.ts]");
  const legs2 = partition(files, resolveWeights(files, table).weights, 3);
  legs2[0].files.push("ghost.spec.ts");
  throwsNaming(() => verifyExactlyOnce(files, legs2), "not-discovered=[ghost.spec.ts]");
});

test("selection must equal assignment, both directions named", () => {
  verifySelection(["a.spec.ts"], ["a.spec.ts"]);
  throwsNaming(() => verifySelection(["a.spec.ts"], ["a.spec.ts", "b.spec.ts"]), "b.spec.ts");
  throwsNaming(() => verifySelection(["a.spec.ts", "c.spec.ts"], ["a.spec.ts"]), "c.spec.ts");
});

test("file arg is anchored, escaped, in /re/ form without g", () => {
  assert.equal(escapeRegExp("a.b-c.spec.ts"), "a\\.b\\-c\\.spec\\.ts");
  const arg = fileArg("hel1-x.spec.ts");
  const re = new RegExp(arg.slice(1, -1));
  assert.ok(arg.startsWith("/") && arg.endsWith("/"));
  assert.ok(re.test("/repo/e2e/hel1-x.spec.ts"));
  assert.ok(!re.test("/repo/e2e/xhel1-x.spec.ts"));
  assert.ok(!re.test("/repo/e2e/hel1-x.spec.ts.bak"));
  assert.ok(!re.test("/repo/e2e/hel1-xyspec.ts")); // dot is literal
});

test("empty shard: CLI refuses and never reaches Playwright", () => {
  const r = spawnSync("node", [join(here, "e2e-shard.mjs"), "run", "5", "4"], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /usage: run <index 1\.\.count>/);
});

test("signal-killed child maps to non-zero", () => {
  assert.equal(exitCodeOf(0, null), 0);
  assert.equal(exitCodeOf(3, null), 3);
  assert.notEqual(exitCodeOf(null, "SIGKILL"), 0);
  assert.notEqual(exitCodeOf(null, null), 0);
});

test("a file split across two shard reports of one run is weighted by its SUM; median across runs", () => {
  const rep = (file, ms) => ({
    suites: [{ file, specs: [{ tests: [{ results: [{ duration: ms }] }] }], suites: [] }],
  });
  const run = (a, b) => fileSumsForRun([rep("x.spec.ts", a), rep("x.spec.ts", b)]);
  assert.equal(run(30000, 40000).get("x.spec.ts"), 70000);
  const w = weightsFromRuns([run(30000, 40000), run(10000, 10000), run(35000, 40000)]);
  assert.equal(w.get("x.spec.ts"), 70); // runs 70 / 20 / 75 -> median 70
});

test("filesFromList dedupes and surfaces listing errors", () => {
  assert.deepEqual(filesFromList({ suites: [{ file: "b" }, { file: "a" }, { file: "a" }] }), [
    "a",
    "b",
  ]);
  assert.throws(() => filesFromList({ suites: [], errors: [{ message: "boom" }] }), /boom/);
});

console.log(`${n} e2e-shard selftest cases passed`);
