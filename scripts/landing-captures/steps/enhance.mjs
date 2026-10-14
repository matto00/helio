// Turns on real Helio features on the example dashboards: previous-run comparisons (a run on earlier data, then the
// current data), reference lines, an annotation and a pie chart.
import { list, sleep } from "../lib/api.mjs";

// Dataset sources: replacing their rows auto-runs the pipeline, so writing earlier rows, waiting for that run,
// then restoring the current rows and waiting again leaves exactly earlier -> current as the last two history points.
const PREV = {
  "Daily signups": [
    "Signups, last 30 days",
    (rows) => rows.map(([d, v]) => [d, Math.round(v * 0.79)]),
  ],
  "API p95 latency": [
    "API p95 latency (ms)",
    (rows) => rows.map(([d, v], i) => [d, v + 18 + (i > 14 && i < 19 ? 40 : 0)]),
  ],
  "Daily revenue": [
    "Revenue, last 30 days",
    (rows) => rows.map(([d, v]) => [d, Math.round(v * 0.86 * 100) / 100]),
  ],
  "Daily stars": [
    "New stars, last 30 days",
    (rows) => rows.map(([d, v]) => [d, Math.round(v * 0.55)]),
  ],
  "Weekly scores": ["Points this season", (rows) => rows.slice(0, rows.length - 1)],
};

const FEATURES = {
  "Signups, last 30 days": { compare: "previous_run" },
  "Daily signups": { referenceLines: [{ value: 150, label: "Target", tone: "success" }] },
  "API p95 latency (ms)": {
    compare: "previous_run",
    referenceLines: [{ value: 200, label: "SLO", tone: "warning" }],
  },
  "Revenue, last 30 days": { compare: "previous_run" },
  "Daily revenue": { referenceLines: [{ value: 400, label: "Goal", tone: "success" }] },
  "MRR by plan": { chartType: "pie" },
  "New stars, last 30 days": { compare: "previous_run" },
  "Stars per day": { annotation: "Oct 1: launched on Hacker News." },
  "Points this season": { compare: "previous_run" },
  "Weekly score": { referenceLines: [{ value: 112.4, label: "League avg", tone: "neutral" }] },
};

export async function enhanceUsecases({ rest }) {
  const sources = list(await rest("GET", "/api/data-sources"));
  const outputsAll = list(await rest("GET", "/api/outputs"));
  const pipelines = list(await rest("GET", "/api/pipelines"));
  // A scheduled run would push the earlier data out of "previous run".
  const signupsPipe = pipelines.find((p) => p.name === "Signups");
  if (signupsPipe)
    await rest("PUT", `/api/pipelines/${signupsPipe.id}/schedule`, {
      kind: "interval",
      expression: "15m",
      timezone: "UTC",
      enabled: false,
    });

  const jobs = Object.entries(PREV).map(([name, [outName, toPrev]]) => {
    const src = sources.find((s) => s.name === name);
    const out = outputsAll.find((o) => o.name === outName);
    if (!src || !out) throw new Error(`missing source/output for ${name}`);
    return { name, src, out, toPrev };
  });
  const pointCount = async (j) =>
    (await rest("GET", `/api/outputs/${j.out.id}/history?limit=100`)).points.length;
  const waitForNewPoint = async (j, before) => {
    for (let t = 0; t < 40; t++) {
      if ((await pointCount(j)) > before) return;
      await sleep(5000);
    }
    throw new Error(`${j.name}: no new history point after 200 s`);
  };
  for (const j of jobs) {
    const page = await rest("GET", `/api/data-sources/${j.src.id}/rows?limit=500`);
    j.current = page.rows.map((r) => r.data);
  }
  for (const phase of ["earlier", "current"]) {
    // Each dataset write auto-runs its pipeline; let the per-minute run budget from the builds drain first.
    await sleep(65_000);
    for (const j of jobs) {
      j.before = await pointCount(j);
      await rest("PUT", `/api/data-sources/${j.src.id}/rows`, {
        rows: phase === "earlier" ? j.toPrev(j.current) : j.current,
      });
    }
    for (const j of jobs) {
      await waitForNewPoint(j, j.before);
      console.log(`  history: ${j.name} <- ${phase} run recorded`);
    }
  }

  const outputs = list(await rest("GET", "/api/outputs"));
  for (const [name, extra] of Object.entries(FEATURES)) {
    const o = outputs.find((x) => x.name === name);
    if (!o) throw new Error(`output ${name} not found`);
    await rest("PATCH", `/api/outputs/${o.id}`, { config: { ...o.config, ...extra } });
    console.log(`  config: ${name} <- ${Object.keys(extra).join(", ")}`);
  }
}
