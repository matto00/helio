// The "Launch week" example dashboard, built through the real helio-mcp tools. Example data only.
const TAG = "landing-mock-launch";

export async function buildLaunch({ call }) {
  const signupCounts = [
    41, 38, 44, 47, 39, 35, 52, 49, 55, 58, 51, 46, 60, 63, 59, 66, 71, 64, 58, 142, 188, 161, 133,
    121, 118, 126, 131, 124, 139, 147,
  ];
  const days = signupCounts.map((v, i) => [new Date(Date.UTC(2026, 8, 14 + i)).toISOString(), v]);
  const p95 = [
    168, 162, 158, 151, 147, 149, 156, 171, 188, 204, 211, 219, 226, 214, 207, 199, 193, 201, 212,
    198, 184, 176, 170, 165,
  ];
  const hours = p95.map((v, i) => [new Date(Date.UTC(2026, 9, 12, 14 + i)).toISOString(), v]);
  const errors = [
    ["POST /checkout", 41],
    ["GET /feed", 23],
    ["POST /login", 12],
    ["GET /search", 6],
    ["PATCH /habits", 4],
  ];

  const signups = await call("create_pipeline", {
    name: "Signups",
    tag: TAG,
    roots: [
      {
        type: "static",
        name: "Daily signups",
        config: {
          columns: [
            { name: "day", type: "timestamp" },
            { name: "signups", type: "integer" },
          ],
          rows: days,
        },
      },
    ],
    outputs: [
      {
        kind: "metric",
        name: "Signups, last 30 days",
        config: {
          fieldMapping: { value: "signups" },
          aggregation: { agg: "sum" },
          label: "Signups, last 30 days",
          format: "integer",
        },
      },
      {
        kind: "chart",
        name: "Daily signups",
        config: { chartType: "bar", fieldMapping: { xAxis: "day", yAxis: "signups" } },
      },
    ],
  });
  const latency = await call("create_pipeline", {
    name: "API latency",
    tag: TAG,
    roots: [
      {
        type: "static",
        name: "API p95 latency",
        config: {
          columns: [
            { name: "hour", type: "timestamp" },
            { name: "p95_ms", type: "float" },
          ],
          rows: hours,
        },
      },
    ],
    outputs: [
      {
        kind: "chart",
        name: "API p95 latency (ms)",
        config: { chartType: "line", fieldMapping: { xAxis: "hour", yAxis: "p95_ms" } },
      },
    ],
  });
  const errs = await call("create_pipeline", {
    name: "Errors",
    tag: TAG,
    roots: [
      {
        type: "static",
        name: "5xx by route",
        config: {
          columns: [
            { name: "route", type: "string" },
            { name: "errors", type: "integer" },
          ],
          rows: errors,
        },
      },
    ],
    outputs: [
      {
        kind: "chart",
        name: "5xx errors by route, 24 h",
        config: { chartType: "bar", fieldMapping: { xAxis: "route", yAxis: "errors" } },
      },
    ],
  });
  for (const p of [signups, latency, errs]) await call("run_pipeline", { pipelineId: p.id });
  await call("set_pipeline_schedule", {
    pipelineId: signups.id,
    kind: "interval",
    expression: "15m",
    timezone: "UTC",
  });

  const out = (p, name) => p.outputs.find((o) => o.name === name).id;
  const dash = await call("create_dashboard", { name: "Launch week", tag: TAG });
  const placed = await call("place_outputs", {
    dashboardId: dash.id,
    items: [
      { outputId: out(signups, "Signups, last 30 days"), title: "Signups, last 30 days" },
      { outputId: out(signups, "Daily signups"), title: "Daily signups" },
      { outputId: out(latency, "API p95 latency (ms)"), title: "API p95 latency (ms)" },
      { outputId: out(errs, "5xx errors by route, 24 h"), title: "5xx errors by route, 24 h" },
    ],
  });
  return { id: dash.id, panelIds: (placed.panels ?? placed).map((p) => p.id) };
}
