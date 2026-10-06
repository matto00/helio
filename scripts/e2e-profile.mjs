#!/usr/bin/env node
// HEL-1288 — ranks e2e specs and CI steps from CI evidence.
//
//   node scripts/e2e-profile.mjs json  <results.json> [more.json ...]   per-spec + top-15 test table
//   node scripts/e2e-profile.mjs steps <jobs.json>                      per-step table
//   node scripts/e2e-profile.mjs list  <ci.log> [more.log ...]          same as `json` but parsed from
//                                                                       the list-reporter text of a CI log
//
// `jobs.json` is `gh run view <run-id> --json jobs`. Durations come from CI artefacts only (the
// Playwright JSON report uploaded by the `e2e` job, or the job log) — never from a local run.
import { readFileSync } from "node:fs";

const [mode, ...files] = process.argv.slice(2);

function collectJson(node, file, out) {
  for (const spec of node.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const ms = (t.results ?? []).reduce((a, r) => a + (r.duration ?? 0), 0);
      out.push({ file: spec.file ?? file, title: spec.title, ms });
    }
  }
  for (const child of node.suites ?? []) collectJson(child, node.file ?? file, out);
}

function fromJson() {
  const out = [];
  for (const f of files) collectJson(JSON.parse(readFileSync(f, "utf8")), "", out);
  return out;
}

function fromList() {
  const unit = { ms: 1, s: 1000, m: 60000 };
  const out = [];
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(
        /(?:✓|✘)\s+\d+ (?:e2e\/)?(\S+\.spec\.ts):\d+:\d+ › (.*) \((\d+(?:\.\d+)?)(ms|s|m)\)/,
      );
      if (m) out.push({ file: m[1], title: m[2], ms: Number(m[3]) * unit[m[4]] });
    }
  }
  return out;
}

function report(tests) {
  const byFile = new Map();
  for (const t of tests) {
    const e = byFile.get(t.file) ?? { ms: 0, n: 0 };
    e.ms += t.ms;
    e.n += 1;
    byFile.set(t.file, e);
  }
  const total = tests.reduce((a, t) => a + t.ms, 0);
  console.log(`tests=${tests.length} files=${byFile.size} summed=${(total / 1000).toFixed(1)}s`);
  console.log("\nTop 15 spec files by summed test time:");
  [...byFile.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, 15)
    .forEach(([f, e]) =>
      console.log(
        `${(e.ms / 1000).toFixed(1).padStart(7)}s ${String(e.n).padStart(3)} tests  ${f}`,
      ),
    );
  console.log("\nTop 15 slowest tests:");
  [...tests]
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 15)
    .forEach((t) =>
      console.log(`${(t.ms / 1000).toFixed(1).padStart(7)}s  ${t.file} › ${t.title.slice(0, 90)}`),
    );
}

function steps() {
  const data = JSON.parse(readFileSync(files[0], "utf8"));
  for (const job of data.jobs) {
    const start = Date.parse(job.startedAt);
    const end = Date.parse(job.completedAt);
    console.log(`\n${job.name}  ${((end - start) / 1000).toFixed(0)}s  (${job.conclusion})`);
    for (const s of job.steps) {
      const d = (Date.parse(s.completedAt) - Date.parse(s.startedAt)) / 1000;
      console.log(`${String(Math.round(d)).padStart(6)}s  ${s.name}`);
    }
  }
}

if (mode === "json") report(fromJson());
else if (mode === "list") report(fromList());
else if (mode === "steps") steps();
else {
  console.error("usage: e2e-profile.mjs json|list|steps <files...>");
  process.exit(2);
}
