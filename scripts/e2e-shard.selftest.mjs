#!/usr/bin/env node
// Self-test for scripts/e2e-shard.mjs (HEL-1361). Pure-function cases plus one CLI case; no
// Playwright, no servers. Each "must fail" case asserts on the FILE NAMED in the error, and the
// mutation cases prove the exact-once check is failable (a partition that drops/duplicates a file
// must be rejected) rather than vacuously green.
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { load } from "js-yaml";

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
  validateRunReports,
  parseWeightsArgs,
  DEFAULT_E2E_LEGS,
  EXPECTED_SHARD_REPORTS,
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

test("out-of-range leg index: CLI refuses with usage and never reaches Playwright", () => {
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

const rep = (shard, stats = { unexpected: 0, flaky: 0 }) => ({ shard, doc: { stats, suites: [] } });
const reps = (k) => Array.from({ length: k }, (_, i) => rep(String(i + 1)));
const six = () => reps(6);
const four = () => reps(4);

test("weights guard: six clean reports pass by default", () => validateRunReports("runX", six()));

test("RED: a runDir without exactly 6 reports is refused by default, naming the runDir", () => {
  throwsNaming(() => validateRunReports("runX", six().slice(0, 5)), "runX", "found 5");
  throwsNaming(() => validateRunReports("runX", [...six(), rep("7")]), "runX", "found 7");
  throwsNaming(() => validateRunReports("runX", four()), "runX", "expected exactly 6", "found 4");
});

test("--legs 4 accepts a pre-HEL-1698 four-report run and still refuses 5-of-6", () => {
  validateRunReports("runOld", four(), parseWeightsArgs(["--legs", "4", "d"]).legs);
  throwsNaming(() => validateRunReports("runX", six().slice(0, 5), 6), "runX", "found 5");
  assert.deepEqual(parseWeightsArgs(["a", "--legs", "4", "b"]), { legs: 4, runDirs: ["a", "b"] });
  assert.equal(parseWeightsArgs(["a"]).legs, EXPECTED_SHARD_REPORTS);
  assert.throws(() => parseWeightsArgs(["--legs", "0", "a"]), /usage/);
  assert.throws(() => parseWeightsArgs(["--legs"]), /usage/);
});

test("CLI: weights --legs 4 accepts four clean reports; without --legs the dir is refused, naming it", () => {
  const dir = mkdtempSync(join(tmpdir(), "e2e-shard-weights-"));
  try {
    const run = join(dir, "run4");
    for (let i = 1; i <= 4; i++) {
      mkdirSync(join(run, `playwright-json-shard-${i}`), { recursive: true });
      writeFileSync(
        join(run, `playwright-json-shard-${i}`, "results.json"),
        JSON.stringify({ stats: { unexpected: 0, flaky: 0 }, suites: [] }),
      );
    }
    const cli = (...args) =>
      spawnSync("node", [join(here, "e2e-shard.mjs"), "weights", ...args], { encoding: "utf8" });
    assert.equal(cli("--legs", "4", run).status, 0);
    const r = cli(run);
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(run) && r.stderr.includes("expected exactly 6"), r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("default leg count equals the ci.yml e2e matrix length (cannot drift)", () => {
  const ci = load(readFileSync(join(here, "..", ".github", "workflows", "ci.yml"), "utf8"));
  const strategy = ci.jobs.e2e.strategy;
  assert.equal(strategy.matrix.shard.length, DEFAULT_E2E_LEGS);
  assert.equal(strategy["max-parallel"], DEFAULT_E2E_LEGS);
  assert.equal(EXPECTED_SHARD_REPORTS, DEFAULT_E2E_LEGS);
});

test("RED: missing stats, unexpected > 0 and flaky > 0 are refused, naming runDir and shard", () => {
  const noStats = six();
  noStats[2] = { shard: "3", doc: { suites: [] } };
  throwsNaming(() => validateRunReports("runY", noStats), "runY", "shard 3", "missing stats");
  const bad = six();
  bad[1] = rep("2", { unexpected: 2, flaky: 0 });
  throwsNaming(() => validateRunReports("runY", bad), "runY", "shard 2", "unexpected=2");
  const flaky = six();
  flaky[3] = rep("4", { unexpected: 0, flaky: 1 });
  throwsNaming(() => validateRunReports("runY", flaky), "runY", "shard 4", "flaky=1");
});

console.log(`${n} e2e-shard selftest cases passed`);
