# Latency measurement (design Decision 6)

Budget (spike `docs/live-draft-preview.md`): **median < 50 ms per edit** on the board pipeline at 1,000 rows.

## Method

A scratch Node script (kept in the HEL-1581 scratch directory, not in the repo; reproduced below) compiles the evaluator with `tsc`
to CommonJS and runs `evaluatePipeline` over a `runs`-shaped frame (`run_id`, `pipeline`, `started_at`, `duration_s`, `status`,
`row_count`; deterministic PRNG) with the board's three steps: `filter duration_s >= X`, `sort duration_s desc`,
`compute minutes = $duration_s / 60`. Each edit sets a new filter threshold and recomputes incrementally
(`previous`, `editedStepId: "filter"`, so all three steps recompute). 50 warm-up edits, then 500 measured edits timed with
`performance.now()`. The 10,000-row variant is informational. "Full" is a non-incremental recompute of the same pipeline (median of 50).
There is deliberately **no timing assertion in Jest**: timing on one shared machine is not a reliable gate.

## Environment

AMD Ryzen 5 7600X (12 threads), Node v22.23.2, run on the developer desktop with unrelated background load
(1-minute load average 5.11 to 5.59 across the three runs). The script was not niced.

## Results (milliseconds per edit)

| Run | Rows | Edits | Median | p95 | Max | Full recompute median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,000 | 500 | 0.36 | 0.654 | 1.754 | 0.28 |
| 1 | 10,000 | 500 | 6.643 | 9.907 | 17.622 | 6.308 |
| 2 | 1,000 | 500 | 0.316 | 0.536 | 1.214 | 0.243 |
| 2 | 10,000 | 500 | 5.912 | 9.838 | 13.305 | 4.77 |
| 3 | 1,000 | 500 | 0.426 | 0.67 | 1.646 | 0.342 |
| 3 | 10,000 | 500 | 5.699 | 8.657 | 11.06 | 5.604 |

**1,000 rows: median 0.36 / 0.316 / 0.426 ms against a 50 ms budget**, roughly two orders of magnitude of headroom
(p95 under 1 ms, max under 2 ms). At 10,000 rows (ten times the preview cap) the median is about 6 ms. Slower hardware (a phone) would
have to be about 100 times slower than this desktop to break the budget at 1,000 rows.

## Script

```js
// HEL-1581 latency benchmark (design Decision 6): the board pipeline (filter duration_s >= X, sort, compute $duration_s / 60)
// over a `runs`-shaped frame. 50 warm-up edits, then 500 measured filter edits; median, p95, max.
const { evaluatePipeline } = require("./build/features/pipelines/evaluator/index.js");
const fs = require("fs");

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

function runsFrame(n) {
  const r = rng(42);
  const pipelines = ["nightly-etl", "hourly-sync", "report-build", "backfill", "alerts", "export"];
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      run_id: `run-${i}`,
      pipeline: pipelines[Math.floor(r() * pipelines.length)],
      started_at: new Date(Date.UTC(2026, 9, 1) + i * 60000).toISOString(),
      duration_s: Math.round(r() * 60000) / 100,
      status: r() < 0.9 ? "succeeded" : "failed",
      row_count: Math.floor(r() * 100000),
    });
  }
  return rows;
}

const steps = (threshold) => [
  { id: "filter", kind: "filter", parentStepId: null, rootId: "root", position: 0, enabled: true,
    config: { combinator: "AND", conditions: [{ field: "duration_s", operator: ">=", value: String(threshold) }] } },
  { id: "sort", kind: "sort", parentStepId: "filter", rootId: null, position: 0, enabled: true, config: { sortBy: [{ field: "duration_s", direction: "desc" }] } },
  { id: "compute", kind: "compute", parentStepId: "sort", rootId: null, position: 0, enabled: true, config: { column: "minutes", expression: "$duration_s / 60" } },
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function measure(n, label) {
  const roots = [{ rootId: "root", rows: runsFrame(n) }];
  const r = rng(7);
  let previous = evaluatePipeline(steps(100), roots);
  const edit = () => {
    const threshold = Math.round(r() * 400) / 4; // a new filter value on every edit
    const next = evaluatePipeline(steps(threshold), roots, { previous, editedStepId: "filter" });
    previous = next;
    return next;
  };
  for (let i = 0; i < 50; i++) edit();
  const times = [];
  let rowsOut = 0;
  for (let i = 0; i < 500; i++) {
    const t0 = performance.now();
    const res = edit();
    times.push(performance.now() - t0);
    rowsOut = res.nodes.get("compute").count;
  }
  const full = [];
  for (let i = 0; i < 50; i++) { const t0 = performance.now(); evaluatePipeline(steps(100), roots); full.push(performance.now() - t0); }
  times.sort((a, b) => a - b); full.sort((a, b) => a - b);
  const out = {
    label, rows: n, edits: times.length, medianMs: +pct(times, 50).toFixed(3), p95Ms: +pct(times, 95).toFixed(3), maxMs: +times[times.length - 1].toFixed(3),
    fullRecomputeMedianMs: +pct(full, 50).toFixed(3), lastResultRows: rowsOut,
  };
  console.log(JSON.stringify(out));
  return out;
}

const load = fs.readFileSync("/proc/loadavg", "utf8").trim();
const results = { node: process.version, loadavgBefore: load, runs: [measure(1000, "board pipeline, 1,000 rows"), measure(10000, "board pipeline, 10,000 rows (informational)")], loadavgAfter: fs.readFileSync("/proc/loadavg", "utf8").trim() };
fs.writeFileSync(process.argv[2] || "result.json", JSON.stringify(results, null, 2));
```
