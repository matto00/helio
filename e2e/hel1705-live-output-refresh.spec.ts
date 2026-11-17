import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1705, proven against the running app:
//   D: an Output whose node is server-resolved but whose step is NOT the selected one refreshes from the SAME single paced
//      draft-preview request (the focused step's rows line, then the Output's: `rowsStepIds`), with no "Select this step to
//      update it" note;
//   E: a plain unaggregated line chart shows a `LATEST <Y>` tile, and with `compare` set the live column draws the dashboard's
//      "vs previous" overlay (read from the live ECharts option) and the metric's comparison;
//   H: a saved table panel on a dashboard lays its columns out in the Output's schema order, the same as the live column.
// Every created user is removed by the e2e user registry's teardown (by recorded id).

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1705", displayName: "HEL-1705", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?.*)?$/;
const SHOTS = process.env.HEL1705_SHOTS ?? "";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface Seeded {
  pipelineId: string;
  chartId: string;
  metricId: string;
  tableId: string;
  convertOneId: string;
  convertTwoId: string;
}

/** 14 rows; chart (line, compare previous_run) and metric (avg, compare previous_run) on the filter and compute steps, a table
 *  Output on the filter, and two server-resolved convertformat steps with an Output on the second. Run twice so a baseline exists. */
async function seed(page: Page): Promise<Seeded> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
    `note ${i}`,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1705-src",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
      { name: "note", type: "string" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1705-pipe",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, { type, config });
  const output = (kind: string, name: string, nodeStepId: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
      kind,
      name,
      nodeStepId,
      config,
    });
  const filter = await step("filter", {
    combinator: "and",
    conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
  });
  const chart = await output("chart", "Run duration", filter.id, {
    chartType: "line",
    fieldMapping: { xAxis: "date", yAxis: "duration_s" },
    compare: "previous_run",
  });
  const compute = await step("compute", {
    column: "duration_min",
    expression: "$duration_s / 60",
    type: "float",
  });
  const metric = await output("metric", "Avg minutes", compute.id, {
    fieldMapping: {},
    aggregation: { value: "duration_min", agg: "avg" },
    label: "Avg minutes",
    compare: "previous_run",
  });
  const convertOne = await step("convertformat", { field: "note", from: "text", to: "markdown" });
  const convertTwo = await step("convertformat", { field: "status", from: "text", to: "markdown" });
  await output("table", "Converted", convertTwo.id, {});
  const table = await output("table", "Run table", compute.id, {});
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  // A second run so `previous_run` has a baseline; the rows are unchanged, so the overlay equals the current series.
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return {
    pipelineId: pipeline.id,
    chartId: chart.id,
    metricId: metric.id,
    tableId: table.id,
    convertOneId: convertOne.id,
    convertTwoId: convertTwo.id,
  };
}

async function openPipeline(page: Page, pipelineId: string): Promise<void> {
  const sample = page.waitForResponse((r) =>
    SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
  );
  await page.goto(`/pipelines/${pipelineId}`);
  await sample;
  await page.waitForLoadState("networkidle");
}

const column = (page: Page) => page.getByRole("region", { name: "Live Output" });
const tile = (page: Page, label: string) =>
  column(page).locator(".live-output__tile").filter({ hasText: label });

async function pickOutput(page: Page, name: string): Promise<void> {
  await column(page).getByRole("combobox", { name: "Displayed Output" }).click();
  await page.getByRole("option", { name }).click();
}

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === "") return;
  await page.screenshot({ path: evidencePath("HEL-1705", `${name}.png`), fullPage: false });
}

test.describe("HEL-1705 live Output column", () => {
  test.setTimeout(180_000);

  test("D: an unfocused server-resolved Output refreshes from the one draft-preview request", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "unfocused" });
    const seeded = await seed(page);
    const bodies: { rowsStepId?: string; rowsStepIds?: string[] }[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/draft-preview$/.test(new URL(r.url()).pathname)) {
        bodies.push(JSON.parse(r.postData() ?? "{}"));
      }
    });
    await openPipeline(page, seeded.pipelineId);

    // Step 3 (the first convertformat) is selected; the "Converted" Output hangs off the SECOND convertformat.
    await page.getByRole("button", { name: /^Step 3:/ }).click();
    // An explicit Output pick holds only for the step it was made on, so the selection must have landed before the pick
    // (under a slow CPU the click returns first: the pick was then made for step 1 and dropped when step 3 arrived).
    await expect(page.getByRole("button", { name: /^Step 3:/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await pickOutput(page, "Converted");
    await expect(column(page).getByText("Converted").first()).toBeVisible();

    await page.getByRole("textbox", { name: "Destination field" }).fill("note_md");
    await expect(column(page).getByLabel("Output is live")).toBeVisible({ timeout: 15_000 });
    await expect(column(page).getByText("Select this step to update it")).toHaveCount(0);
    await page.waitForTimeout(1500);

    expect(bodies.length, `draft-preview requests: ${bodies.length}`).toBe(1);
    expect(bodies[0].rowsStepId).toBe(seeded.convertOneId);
    expect(bodies[0].rowsStepIds).toEqual([seeded.convertTwoId]);

    // A second edit is one more request, never two.
    await page.getByRole("textbox", { name: "Destination field" }).fill("note_md2");
    await page.waitForTimeout(2500);
    expect(bodies.length, `after a second edit: ${bodies.length}`).toBe(2);
    await expect(column(page).getByLabel("Output is live")).toBeVisible();
    await shot(page, "d-unfocused-live-desktop");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`E: plain-chart LATEST tile and the compare overlay, desktop and phone (${theme})`, async ({
      page,
      request,
    }) => {
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await page.setViewportSize({ width: 1280, height: 800 });
      await registerAndLogin(page, request, { ...AUTH, label: `e-${theme}` });
      const seeded = await seed(page);
      await openPipeline(page, seeded.pipelineId);

      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(column(page).getByText("Run duration")).toBeVisible();
      await expect(tile(page, "Rows out")).toContainText("14");
      await expect(tile(page, "LATEST DURATION_S")).toContainText("351");
      // The overlay is a canvas legend entry: read the series names off the live ECharts instance.
      await expect
        .poll(
          async () =>
            column(page)
              .locator("canvas")
              .first()
              .evaluate((canvas) => {
                let host: Element | null = canvas;
                while (host) {
                  const key = Object.keys(host).find((k) => k.startsWith("__reactFiber$"));
                  let f = key
                    ? ((host as unknown as Record<string, unknown>)[key] as {
                        stateNode?: { getEchartsInstance?: () => { getOption(): unknown } };
                        return?: unknown;
                      } | null)
                    : null;
                  while (f) {
                    const inst = f.stateNode?.getEchartsInstance?.();
                    if (inst) {
                      const o = inst.getOption() as { series?: { name?: string }[] };
                      return (o.series ?? []).map((s) => s.name);
                    }
                    f = f.return as typeof f;
                  }
                  host = host.parentElement;
                }
                return null;
              }),
          { timeout: 15_000 },
        )
        .toContain("vs previous");
      await shot(page, `e-desktop-${theme}`);

      // The metric Output's comparison, over the draft rows (unchanged rows: flat against the previous run).
      await page.getByRole("button", { name: /^Step 2:/ }).click();
      await expect(column(page).getByText("Avg minutes").first()).toBeVisible();
      await expect(column(page).locator(".panel-content__metric-trend")).toContainText(
        "vs previous",
        { timeout: 15_000 },
      );
      await shot(page, `e-metric-desktop-${theme}`);

      // Phone: the Preview tab holds the live column.
      await page.setViewportSize({ width: 375, height: 812 });
      await openPipeline(page, seeded.pipelineId);
      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(column(page)).toBeVisible();
      await expect(tile(page, "Rows out")).toBeVisible();
      await shot(page, `e-phone-${theme}`);
    });
  }

  test("H: a saved table panel and the live column lay columns out in the Output's schema order", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "order" });
    const seeded = await seed(page);
    const dashboard = await post<{ id: string }>(page, "/api/dashboards", {
      name: "HEL-1705 order",
    });
    await post(page, "/api/panels", {
      dashboardId: dashboard.id,
      title: "HEL-1705 table",
      type: "output",
      config: { outputId: seeded.tableId },
    });
    await page.goto(`/dashboards/${dashboard.id}`);
    const headers = page.locator("article thead th");
    await expect(headers.first()).toBeVisible({ timeout: 15_000 });
    const saved = await headers.evaluateAll((els) =>
      els.map((e) => e.querySelector("button")?.textContent?.trim() ?? ""),
    );
    // The Output's own schema order, as the server reports it and as the rows response's `columns` carries it (the engine
    // derives it, and a hand-ordered schema is covered by the route specs); the live column must agree with it.
    const output = await (await page.request.get(`/api/outputs/${seeded.tableId}`)).json();
    const schemaOrder = (output.schema as { name: string }[]).map((f) => f.name);
    expect(schemaOrder.length).toBeGreaterThan(3);
    expect(saved).toEqual(schemaOrder);
    const rows = await (await page.request.get(`/api/outputs/${seeded.tableId}/rows`)).json();
    expect(rows.columns).toEqual(schemaOrder);
    await shot(page, "h-saved-table-desktop");

    await openPipeline(page, seeded.pipelineId);
    await pickOutput(page, "Run table");
    const live = (await column(page).locator("th").allTextContents()).map((t) => t.trim());
    expect(live).toEqual(schemaOrder);
    await shot(page, "h-live-table-desktop");
  });
});
