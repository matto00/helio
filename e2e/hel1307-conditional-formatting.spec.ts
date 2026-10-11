import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";
import { registerAndLogin } from "./support/auth";

// HEL-1307 -- conditional formatting (threshold colours) on the RUNNING app. Jest cannot measure CSS
// (jest maps .css to a style mock), so every colour / wash claim is proven here by computed styles, in
// both themes:
//  (a) a metric value's colour equals the resolved --app-<tone> token;
//  (b) the metric UNIT keeps exactly the colour it has with no rules, on a panel with a custom text colour;
//  (c) exactly ONE wash per table cell: an unpinned and a PINNED cell inside a washed row, and a cell-rule
//      cell in that row; the <tr> itself is never painted.
// Plus: a long toned cell still ellipsises, and screenshots (desktop + 375px) for the evidence dir.
// Cleans up by exact recorded ids.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1307", displayName: "HEL-1307" } as const;
const LONG = "a long note that must still truncate with an ellipsis ".repeat(8);
const RULES_TABLE = [
  {
    column: "status",
    op: "eq",
    value: "failed",
    tone: "error",
    target: "row",
    label: "Build failed",
  },
  { column: "pass_rate", op: "lt", value: 0.8, tone: "error", label: "Failing" },
  { column: "duration_s", op: "gt", value: 600, tone: "warning", target: "cell" },
  { column: "note", op: "neq", value: "zzz", tone: "warning" },
];

async function postJson<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  status: number,
): Promise<T> {
  const res = await request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBe(status);
  return (await res.json()) as T;
}

/** The computed value of `var(--token)` for `prop`, resolved on a probe in the live document. */
async function token(page: Page, prop: "color" | "backgroundColor", name: string): Promise<string> {
  return page.evaluate(
    ([p, n]) => {
      const probe = document.createElement("div");
      (probe.style as unknown as Record<string, string>)[p] = `var(${n})`;
      document.body.appendChild(probe);
      const value = getComputedStyle(probe)[p as "color"];
      probe.remove();
      return value;
    },
    [prop, name] as const,
  );
}

const css = (loc: Locator, prop: string) =>
  loc.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

async function seed(request: APIRequestContext, theme: string, created: Record<string, string>) {
  const metricSource = await postJson<{ id: string }>(
    request,
    "/api/data-sources",
    {
      name: `HEL-1307 metric ${theme}`,
      type: "static",
      columns: [
        { name: "region", type: "string" },
        { name: "amount", type: "integer" },
      ],
      rows: [
        ["east", 20],
        ["west", 22],
      ],
    },
    201,
  );
  created.metricSource = metricSource.id;
  const tableSource = await postJson<{ id: string }>(
    request,
    "/api/data-sources",
    {
      name: `HEL-1307 table ${theme}`,
      type: "static",
      columns: [
        { name: "id", type: "string" },
        { name: "status", type: "string" },
        { name: "pass_rate", type: "float" },
        { name: "duration_s", type: "integer" },
        { name: "note", type: "string" },
      ],
      rows: [
        ["1", "failed", 0.5, 700, LONG],
        ["2", "passed", 0.95, 20, LONG],
        ["3", " Failed ", 0.9, 30, "short"],
      ],
    },
    201,
  );
  created.tableSource = tableSource.id;
  const mp = await postJson<{ id: string }>(
    request,
    "/api/pipelines",
    { name: `HEL-1307 metric pipeline ${theme}`, roots: [{ sourceId: metricSource.id }] },
    201,
  );
  created.metricPipeline = mp.id;
  const tp = await postJson<{ id: string }>(
    request,
    "/api/pipelines",
    { name: `HEL-1307 table pipeline ${theme}`, roots: [{ sourceId: tableSource.id }] },
    201,
  );
  created.tablePipeline = tp.id;
  const out = (pipeline: string, kind: string, name: string, config: unknown) =>
    postJson<{ id: string }>(
      request,
      `/api/pipelines/${pipeline}/outputs`,
      { kind, name, config },
      201,
    );
  const ladder = [
    { op: "lt", value: 50, tone: "error", label: "Failing" },
    { op: "lt", value: 80, tone: "warning" },
  ];
  const base = { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" }, unit: "ms" };
  const ruled = await out(mp.id, "metric", "CF ruled", { ...base, conditionalFormats: ladder });
  const plain = await out(mp.id, "metric", "CF plain", base);
  const warn = await out(mp.id, "metric", "CF warn", {
    ...base,
    aggregation: { value: "amount", agg: "max" },
    conditionalFormats: [
      { op: "lt", value: 20, tone: "error" },
      { op: "lt", value: 30, tone: "warning" },
    ],
  });
  const collection = await out(mp.id, "collection", "CF collection", {
    fieldMapping: { value: "amount", label: "region" },
    layout: "grid",
    conditionalFormats: [
      { op: "lt", value: 21, tone: "error" },
      { op: "gte", value: 21, tone: "success" },
    ],
  });
  const table = await out(tp.id, "table", "CF table", {
    fieldMapping: {},
    columnOrder: ["id", "status", "pass_rate", "duration_s", "note"],
    pinnedColumns: ["id"],
    conditionalFormats: RULES_TABLE,
  });
  for (const pipeline of [mp.id, tp.id]) {
    const run = await request.post(`/api/pipelines/${pipeline}/run`, { data: {}, headers: CSRF });
    expect(run.status(), await run.text()).toBe(200);
  }
  const dashboard = await postJson<{ id: string }>(
    request,
    "/api/dashboards",
    { name: `HEL-1307 ${theme}` },
    201,
  );
  created.dashboard = dashboard.id;
  const custom = { background: "#f3f4f6", color: "#6d28d9", transparency: 0 };
  const panel = (title: string, outputId: string, appearance?: unknown) =>
    postJson<{ id: string }>(
      request,
      "/api/panels",
      { dashboardId: dashboard.id, title, type: "output", config: { outputId }, appearance },
      201,
    );
  await panel("CF ruled metric", ruled.id, custom);
  await panel("CF plain metric", plain.id, custom);
  await panel("CF warn metric", warn.id);
  const coll = await panel("CF collection panel", collection.id);
  const tbl = await panel("CF table panel", table.id);
  await postJson(
    request,
    `/api/dashboards/${dashboard.id}/auto-layout`,
    {
      items: [
        { panelId: tbl.id, w: 12, h: 6 },
        { panelId: coll.id, w: 6, h: 3 },
      ],
    },
    200,
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`conditional formatting renders the tone tokens, one wash per cell, and keeps the unit colour (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, AUTH);
    const me = await request.get("/api/auth/me");
    console.log(`[HEL-1307 e2e] user id: ${((await me.json()) as { id: string }).id}`);
    await isolateLivePage(page);

    const created: Record<string, string> = {};
    try {
      await seed(request, theme, created);
      await page.goto(`/dashboards/${created.dashboard}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const card = (title: string) => page.locator(".react-grid-item", { hasText: title });

      // (a) metric value colour == the resolved token
      const warnCard = card("CF warn metric");
      const warnFigure = warnCard.locator(".panel-content__metric-figure");
      await expect(warnFigure).toBeVisible({ timeout: 20_000 });
      expect(await css(warnFigure, "color")).toBe(await token(page, "color", "--app-warning"));
      await expect(warnFigure.locator(".sr-only")).toHaveText("Warning");
      await expect(warnFigure).toHaveAttribute("title", "Warning");
      expect(await warnFigure.locator("svg").getAttribute("aria-hidden")).toBe("true");

      const ruledCard = card("CF ruled metric");
      const ruledFigure = ruledCard.locator(".panel-content__metric-figure");
      await expect(ruledFigure).toBeVisible();
      expect(await css(ruledFigure, "color")).toBe(await token(page, "color", "--app-error"));
      await expect(ruledFigure.locator(".sr-only")).toHaveText("Failing");

      // (b) the unit keeps exactly its no-rules colour on a panel with a custom text colour
      const plainCard = card("CF plain metric");
      await expect(plainCard.locator(".panel-content__metric-unit")).toBeVisible();
      const unitRuled = await css(ruledCard.locator(".panel-content__metric-unit"), "color");
      const unitPlain = await css(plainCard.locator(".panel-content__metric-unit"), "color");
      expect(unitRuled, "unit colour with rules vs the same panel with none").toBe(unitPlain);
      expect(unitRuled).not.toBe(await token(page, "color", "--app-error"));
      // the plain panel's value carries no tone, and the panel text override is really non-default
      expect(await css(ruledCard.locator(".panel-content__metric-unit"), "color")).not.toBe(
        await css(warnCard.locator(".panel-content__metric-unit"), "color"),
      );

      // collection: per-item tones
      const items = card("CF collection panel").locator(".panel-content__collection-item");
      await expect(items).toHaveCount(2);
      expect(await css(items.nth(0).locator(".panel-content__metric-figure"), "color")).toBe(
        await token(page, "color", "--app-error"),
      );
      expect(await css(items.nth(1).locator(".panel-content__metric-figure"), "color")).toBe(
        await token(page, "color", "--app-success"),
      );

      // (c) one wash per cell
      const table = card("CF table panel");
      const bodyRows = table.locator("tbody tr");
      await expect(bodyRows).toHaveCount(3, { timeout: 20_000 });
      const surfaceError = await token(page, "backgroundColor", "--app-error-surface");
      const surfaceWarning = await token(page, "backgroundColor", "--app-warning-surface");
      const washedRow = bodyRows.nth(0);
      const plainRow = bodyRows.nth(1);
      const TRANSPARENT = "rgba(0, 0, 0, 0)";

      // the <tr> is never painted
      expect(await css(washedRow, "background-color")).toBe(TRANSPARENT);
      expect(await css(washedRow, "background-image")).toBe("none");

      // an UNPINNED cell in the washed row: exactly the plain translucent error surface
      const status = washedRow.locator("td").nth(1);
      expect(await css(status, "background-color")).toBe(surfaceError);
      expect(await css(status, "background-image")).toBe("none");

      // the PINNED cell: opaque panel surface under ONE gradient layer of the error surface
      const pinned = washedRow.locator("td").nth(0);
      const pinnedPlain = plainRow.locator("td").nth(0);
      const panelSurface = await css(pinnedPlain, "background-color");
      expect(await css(pinnedPlain, "background-image")).toBe("none");
      expect(await css(pinned, "background-color")).toBe(panelSurface);
      const pinnedImage = await css(pinned, "background-image");
      expect(pinnedImage.match(/linear-gradient\(/g)?.length, pinnedImage).toBe(1);
      // the second background layer is the (colour-only) panel surface, whose image computes to `none`
      expect(pinnedImage).toBe(`linear-gradient(${surfaceError}, ${surfaceError}), none`);
      // the pinned cell carries the row mark (glyph + "Build failed")
      await expect(pinned.locator(".sr-only")).toHaveText("Build failed");

      // a cell-rule cell inside the washed row: ONLY its own surface, own text colour
      const slow = washedRow.locator("td").nth(3);
      expect(await css(slow, "background-color")).toBe(surfaceWarning);
      expect(await css(slow, "background-image")).toBe("none");
      expect(await css(slow, "color")).toBe(await token(page, "color", "--app-warning"));
      const failing = washedRow.locator("td").nth(2);
      expect(await css(failing, "background-color")).toBe(surfaceError);
      await expect(failing.locator("[title='Failing']")).toHaveCount(1);

      // the un-washed row has no wash on its non-rule cells
      expect(await css(plainRow.locator("td").nth(1), "background-color")).toBe(TRANSPARENT);

      // a long toned cell still ellipsises
      const note = washedRow.locator("td").nth(4);
      expect(await css(note, "text-overflow")).toBe("ellipsis");
      expect(await note.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

      await page.screenshot({ path: evidencePath("HEL-1307", `dashboard-${theme}-desktop.png`) });
      await warnCard.screenshot({ path: evidencePath("HEL-1307", `metric-${theme}.png`) });
      await table.screenshot({ path: evidencePath("HEL-1307", `table-${theme}.png`) });

      // 375px (mobile stack)
      await page.setViewportSize({ width: 375, height: 900 });
      await expect(page.getByText("CF table panel").first()).toBeVisible({ timeout: 20_000 });
      await page.screenshot({
        path: evidencePath("HEL-1307", `dashboard-${theme}-375.png`),
        fullPage: true,
      });
    } finally {
      for (const [key, path] of [
        ["dashboard", "dashboards"],
        ["metricPipeline", "pipelines"],
        ["tablePipeline", "pipelines"],
        ["metricSource", "data-sources"],
        ["tableSource", "data-sources"],
      ] as const) {
        if (created[key]) await request.delete(`/api/${path}/${created[key]}`, { headers: CSRF });
      }
    }
  });
}
