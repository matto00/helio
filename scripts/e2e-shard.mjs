#!/usr/bin/env node
// HEL-1361 -- weighted e2e shard assignment for the CI `e2e` matrix.
//
//   node scripts/e2e-shard.mjs run <index> <count>      CI: run leg <index> (1-based) of <count>
//   node scripts/e2e-shard.mjs plan <count>             print every leg's assignment (no tests run)
//   node scripts/e2e-shard.mjs weights <runDir>...      regenerate e2e/shard-weights.tsv on stdout
//
// Why: Playwright 1.55's `--shard` cuts the alphabetically ordered test groups by test COUNT, so
// one slow file (state-surface-contrast-guard) landed wholly on one leg. This script partitions the
// spec FILES by weight (longest-processing-time-first, mirroring backend/project/TestShards.scala).
//
// Discovery is still Playwright's own (HEL-951): `playwright test --list` honours the config's
// `testDir` glob and `testIgnore`. The weight table only orders/weighs files; it never adds one.
// Every leg recomputes ALL legs, verifies the partition is exact, and re-lists the exact selection
// it is about to run, failing (naming files) on any difference. An empty leg never runs the suite.
//
// Regenerate the table from CI Playwright JSON artifacts (never a local run, never hand-edited).
// Each <runDir> holds ONE CI run's per-shard reports, i.e. <runDir>/<shard>/results.json, e.g.
//   for r in <runId>...; do gh run download "$r" -p 'playwright-json-shard-*' -D /tmp/art/$r; done
//   (artifacts land as <runDir>/playwright-json-shard-<n>/results.json -- both layouts work)
//   node scripts/e2e-shard.mjs weights /tmp/art/<runId>... > e2e/shard-weights.tsv
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const WEIGHTS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "e2e",
  "shard-weights.tsv",
);

export function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Parse `<file>\t<seconds>` rows; `#` comments and blanks ignored. */
export function parseWeights(text) {
  const out = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [file, sec] = line.split("\t");
    const n = Number(sec);
    if (!file || !Number.isFinite(n) || n < 0)
      throw new Error(`bad weight row: ${JSON.stringify(raw)}`);
    out.set(file, n);
  }
  return out;
}

/** Weight per discovered file; unknown = median of table rows for DISCOVERED files. */
export function resolveWeights(files, table) {
  const known = files.filter((f) => table.has(f)).map((f) => table.get(f));
  const fallback = median(known);
  const weights = new Map();
  const defaulted = [];
  for (const f of files) {
    if (table.has(f)) weights.set(f, table.get(f));
    else {
      weights.set(f, fallback);
      defaulted.push(f);
    }
  }
  const stale = [...table.keys()].filter((f) => !files.includes(f)).sort();
  return { weights, defaulted: defaulted.sort(), stale };
}

/** LPT: sort by (-weight, path), give each to the least-loaded leg (ties: lowest index). */
export function partition(files, weights, count) {
  const legs = Array.from({ length: count }, () => ({ files: [], load: 0 }));
  const order = [...files].sort(
    (a, b) => weights.get(b) - weights.get(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  for (const f of order) {
    let best = 0;
    for (let i = 1; i < count; i++) if (legs[i].load < legs[best].load) best = i;
    legs[best].files.push(f);
    legs[best].load += weights.get(f);
  }
  for (const l of legs) l.files.sort();
  return legs;
}

/** Throws naming every file that is missing, duplicated, or not discovered. */
export function verifyExactlyOnce(files, legs) {
  const seen = new Map();
  for (const l of legs) for (const f of l.files) seen.set(f, (seen.get(f) ?? 0) + 1);
  const disc = new Set(files);
  const missing = files.filter((f) => !seen.has(f));
  const dup = [...seen].filter(([, n]) => n > 1).map(([f]) => f);
  const extra = [...seen.keys()].filter((f) => !disc.has(f));
  if (missing.length || dup.length || extra.length) {
    throw new Error(
      `e2e shard partition is not exact: unassigned=[${missing}] duplicated=[${dup}] not-discovered=[${extra}]`,
    );
  }
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** Anchored CLI arg for a testDir-relative spec file, in Playwright's `/re/` form (no `g`). */
export function fileArg(file) {
  return `/(^|\\/)e2e\\/${escapeRegExp(file)}$/`;
}

/** Throws naming the difference when the listed selection is not exactly the assignment. */
export function verifySelection(assigned, listed) {
  const a = new Set(assigned);
  const l = new Set(listed);
  const unexpected = [...l].filter((f) => !a.has(f)).sort();
  const absent = [...a].filter((f) => !l.has(f)).sort();
  if (unexpected.length || absent.length) {
    throw new Error(
      `e2e selection differs from assignment: would-run-but-unassigned=[${unexpected}] assigned-but-not-selected=[${absent}]`,
    );
  }
}

/** Distinct top-level spec files from a `playwright test --list --reporter=json` document. */
export function filesFromList(doc) {
  if (doc.errors?.length)
    throw new Error(`playwright --list reported errors: ${JSON.stringify(doc.errors)}`);
  return [...new Set((doc.suites ?? []).map((s) => s.file))].sort();
}

/** Exit code for a spawned child: signal-killed (null) maps to non-zero. */
export function exitCodeOf(code, signal) {
  if (code === null || code === undefined) return signal ? 128 : 1;
  return code;
}

function sumDurations(node, acc) {
  for (const spec of node.specs ?? []) {
    for (const t of spec.tests ?? []) {
      for (const r of t.results ?? []) acc.ms += r.duration ?? 0;
    }
  }
  for (const c of node.suites ?? []) sumDurations(c, acc);
}

/** Per file, summed ms across ALL shard reports of ONE run. reports = parsed results.json docs. */
export function fileSumsForRun(reports) {
  const sums = new Map();
  for (const doc of reports) {
    for (const top of doc.suites ?? []) {
      const acc = { ms: 0 };
      sumDurations(top, acc);
      sums.set(top.file, (sums.get(top.file) ?? 0) + acc.ms);
    }
  }
  return sums;
}

/** Median across runs (of per-run sums), whole seconds, min 1. Files absent from a run skip it. */
export function weightsFromRuns(runSums) {
  const per = new Map();
  for (const sums of runSums)
    for (const [f, ms] of sums) (per.get(f) ?? per.set(f, []).get(f)).push(ms / 1000);
  return new Map([...per].map(([f, v]) => [f, Math.max(1, Math.round(median(v)))]));
}

function findReports(runDir) {
  const out = [];
  for (const d of readdirSync(runDir, { withFileTypes: true })) {
    const p = join(runDir, d.name, "results.json");
    if (d.isDirectory() && existsSync(p)) out.push(JSON.parse(readFileSync(p, "utf8")));
  }
  if (out.length === 0) throw new Error(`no <shard>/results.json under ${runDir}`);
  return out;
}

function playwrightJson(args) {
  const r = spawnSync("npx", ["playwright", "test", "--list", "--reporter=json", ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`playwright --list failed (exit ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function plan(count) {
  const files = filesFromList(playwrightJson([]));
  if (files.length === 0) throw new Error("playwright discovered no spec files");
  const { weights, defaulted, stale } = resolveWeights(
    files,
    parseWeights(readFileSync(WEIGHTS_PATH, "utf8")),
  );
  const legs = partition(files, weights, count);
  verifyExactlyOnce(files, legs);
  return { files, legs, weights, defaulted, stale };
}

function printPlan({ legs, weights, defaulted, stale }, only) {
  legs.forEach((l, i) => {
    if (only !== undefined && only !== i) return;
    console.log(
      `leg ${i + 1}/${legs.length}: ${l.files.length} files, ${l.load.toFixed(0)}s weighted`,
    );
    for (const f of l.files)
      console.log(
        `  ${weights.get(f).toFixed(0).padStart(4)}s  ${f}${defaulted.includes(f) ? "  (defaulted)" : ""}`,
      );
  });
  if (defaulted.length) console.log(`defaulted (no weight row): ${defaulted.join(", ")}`);
  if (stale.length) console.log(`stale weight rows (not discovered, ignored): ${stale.join(", ")}`);
}

async function run(index, count) {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(count) ||
    count < 1 ||
    index < 1 ||
    index > count
  ) {
    throw new Error(`usage: run <index 1..count> <count>; got ${index}/${count}`);
  }
  const p = plan(count);
  printPlan(p, index - 1);
  const mine = p.legs[index - 1].files;
  if (mine.length === 0)
    throw new Error(`leg ${index}/${count} has no assigned specs; refusing to run the full suite`);
  const args = mine.map(fileArg);
  verifySelection(mine, filesFromList(playwrightJson(args)));
  const code = await new Promise((resolve) => {
    const child = spawn("npx", ["playwright", "test", ...args], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (c, s) => resolve(exitCodeOf(c, s)));
  });
  process.exit(code);
}

function weightsMode(runDirs) {
  if (runDirs.length === 0) throw new Error("usage: weights <runDir>...");
  const w = weightsFromRuns(runDirs.map((d) => fileSumsForRun(findReports(d))));
  console.log(
    "# HEL-1361 e2e shard weights: seconds per spec file, from CI Playwright JSON reports.",
  );
  console.log("# Per run: durations summed across ALL shard reports; weight = median across runs.");
  console.log(`# Runs: ${runDirs.map((d) => basename(d)).join(" ")}`);
  console.log(
    "# Regenerate: node scripts/e2e-shard.mjs weights <runDir>... > e2e/shard-weights.tsv (never hand-edit).",
  );
  for (const f of [...w.keys()].sort()) console.log(`${f}\t${w.get(f)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === "run") await run(Number(rest[0]), Number(rest[1]));
    else if (mode === "plan") printPlan(plan(Number(rest[0] ?? 4)));
    else if (mode === "weights") weightsMode(rest);
    else
      throw new Error(
        "usage: e2e-shard.mjs run <index> <count> | plan <count> | weights <runDir>...",
      );
  } catch (e) {
    console.error(`e2e-shard: ${e.message}`);
    process.exit(1);
  }
}
