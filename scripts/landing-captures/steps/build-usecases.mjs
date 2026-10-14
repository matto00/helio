// Revenue, Open source and Fantasy league example dashboards, built through helio-mcp. Example data only.
const day = (i) => new Date(Date.UTC(2026, 8, 14 + i)).toISOString();
const week = (i) => new Date(Date.UTC(2026, 6, 20 + 7 * i)).toISOString();
const col = (name, type) => ({ name, type });
const root = (name, columns, rows) => [{ type: "static", name, config: { columns, rows } }];

const revenueDaily = Array.from({ length: 30 }, (_, i) => [
  day(i),
  Math.round((262 + i * 4.1 + [0, 14, 22, 9, -6, -31, -24][i % 7]) * 100) / 100,
]);
const subscribers = [212, 219, 231, 236, 244, 259, 266, 281, 290, 304, 318, 331].map((v, i) => [
  week(i),
  v,
]);
const starsDaily = [
  14, 11, 18, 16, 12, 9, 21, 17, 15, 19, 22, 13, 16, 24, 20, 18, 31, 412, 236, 98, 61, 44, 39, 33,
  41, 29, 35, 27, 38, 32,
].map((v, i) => [day(i), v]);
const prs = [6, 9, 7, 11, 8, 12, 10, 14, 9, 13, 16, 15].map((v, i) => [week(i), v]);
const scores = [118.4, 96.2, 131.8, 104.6, 142.3, 125.9].map((v, i) => [i + 1, v]);
const bar = (name, x, y) => ({
  kind: "chart",
  name,
  config: { chartType: "bar", fieldMapping: { xAxis: x, yAxis: y } },
});
const line = (name, x, y) => ({
  kind: "chart",
  name,
  config: { chartType: "line", fieldMapping: { xAxis: x, yAxis: y } },
});
const total = (name, field, format) => ({
  kind: "metric",
  name,
  config: { fieldMapping: { value: field }, aggregation: { agg: "sum" }, label: name, format },
});

export const USECASES = [
  {
    key: "revenue",
    dashboard: "Revenue",
    pipelines: [
      {
        name: "Revenue",
        roots: root(
          "Daily revenue",
          [col("day", "timestamp"), col("revenue", "float")],
          revenueDaily,
        ),
        outputs: [
          total("Revenue, last 30 days", "revenue", "currency"),
          line("Daily revenue", "day", "revenue"),
        ],
      },
      {
        name: "Subscribers",
        roots: root(
          "Weekly subscribers",
          [col("week", "timestamp"), col("subscribers", "integer")],
          subscribers,
        ),
        outputs: [bar("Active subscribers by week", "week", "subscribers")],
      },
      {
        name: "Plans",
        roots: root(
          "MRR by plan",
          [col("plan", "string"), col("mrr", "float")],
          [
            ["Hobby", 1240],
            ["Pro", 3890],
            ["Team", 2150],
            ["Annual", 980],
          ],
        ),
        outputs: [bar("MRR by plan", "plan", "mrr")],
      },
    ],
    order: ["Revenue, last 30 days", "Daily revenue", "Active subscribers by week", "MRR by plan"],
  },
  {
    key: "oss",
    dashboard: "Open source",
    pipelines: [
      {
        name: "Stars",
        roots: root("Daily stars", [col("day", "timestamp"), col("stars", "integer")], starsDaily),
        outputs: [
          total("New stars, last 30 days", "stars", "integer"),
          bar("Stars per day", "day", "stars"),
        ],
      },
      {
        name: "Issues",
        roots: root(
          "Open issues by label",
          [col("label", "string"), col("issues", "integer")],
          [
            ["enhancement", 41],
            ["bug", 23],
            ["docs", 12],
            ["question", 9],
          ],
        ),
        outputs: [bar("Open issues by label", "label", "issues")],
      },
      {
        name: "Pull requests",
        roots: root(
          "PRs merged per week",
          [col("week", "timestamp"), col("merged", "integer")],
          prs,
        ),
        outputs: [line("PRs merged per week", "week", "merged")],
      },
    ],
    order: [
      "New stars, last 30 days",
      "Stars per day",
      "Open issues by label",
      "PRs merged per week",
    ],
  },
  {
    key: "fantasy",
    dashboard: "Fantasy league",
    pipelines: [
      {
        name: "My team",
        roots: root("Weekly scores", [col("week", "integer"), col("points", "float")], scores),
        outputs: [
          total("Points this season", "points", "number"),
          line("Weekly score", "week", "points"),
        ],
      },
      {
        name: "Standings",
        roots: root(
          "Points for, by team",
          [col("team", "string"), col("points", "float")],
          [
            ["Gridiron", 781.2],
            ["Waiver Wire", 744.9],
            ["Dynasty", 719.2],
            ["Taco Corp", 702.5],
            ["Bench Mob", 668.1],
          ],
        ),
        outputs: [bar("Points for, by team", "team", "points")],
      },
      {
        name: "Waivers",
        roots: root(
          "Waiver adds",
          [col("team", "string"), col("adds", "integer")],
          [
            ["Gridiron", 9],
            ["Waiver Wire", 17],
            ["Dynasty", 6],
            ["Taco Corp", 11],
            ["Bench Mob", 4],
          ],
        ),
        outputs: [bar("Waiver adds by team", "team", "adds")],
      },
    ],
    order: ["Points this season", "Weekly score", "Points for, by team", "Waiver adds by team"],
  },
];

export async function buildUsecases({ call, setLayout }) {
  const ids = {};
  for (const spec of USECASES) {
    const tag = `landing-mock-${spec.key}`;
    const outputs = {};
    for (const p of spec.pipelines) {
      const created = await call("create_pipeline", {
        name: p.name,
        tag,
        roots: p.roots,
        outputs: p.outputs,
      });
      for (const o of created.outputs) outputs[o.name] = o.id;
      await call("run_pipeline", { pipelineId: created.id });
    }
    const dash = await call("create_dashboard", { name: spec.dashboard, tag });
    const placed = await call("place_outputs", {
      dashboardId: dash.id,
      items: spec.order.map((n) => ({ outputId: outputs[n], title: n })),
    });
    await setLayout(
      dash.id,
      (placed.panels ?? placed).map((p) => p.id),
    );
    ids[spec.key] = dash.id;
  }
  return ids;
}
