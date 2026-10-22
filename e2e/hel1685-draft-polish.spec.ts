import { expect, test, type Page } from "@playwright/test";

import { attachApiRequestCounter } from "./support/apiRequestCounter";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1685: the draft-mode polish bugs that only show in a laid-out page. Item 4: a draft notice takes only its own height
// on desktop (no empty band under it). Item 5: on a phone the floating action bar's draft-status line never covers an Output
// card's menu button, even with the list scrolled to its end. Item 7: finishing a run after a save that removed an Output
// requests no preview of that Output.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1685", displayName: "HEL-1685", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?.*)?$/;
const THEMES = ["dark", "light"] as const;

interface Seeded {
  pipelineId: string;
  stepIds: string[];
  outputIds: string[];
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** filter -> sort -> compute with a chart Output on the filter, a metric Output on the compute step and a table Output on the sort. */
/** `outputs: false` seeds the steps only: the shortest page, where an empty band under a notice is easiest to see. */
async function seed(page: Page, extraOutputs = 0, outputs = true): Promise<Seeded> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1685-src-runs",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1685-pipe-runs",
    roots: [{ sourceId: source.id }],
  });
  const step = (type: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, { type, config });
  const filter = await step("filter", {
    combinator: "and",
    conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
  });
  const sort = await step("sort", { sortBy: [{ field: "date", direction: "asc" }] });
  const compute = await step("compute", {
    column: "duration_min",
    expression: "$duration_s / 60",
    type: "float",
  });
  const output = (kind: string, name: string, nodeStepId: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
      kind,
      name,
      nodeStepId,
      config,
    });
  const outputIds: string[] = [];
  if (outputs) {
    const chart = await output("chart", "Run duration", filter.id, {
      chartType: "line",
      fieldMapping: { xAxis: "date", yAxis: "duration_s" },
    });
    const table = await output("table", "Sorted runs", sort.id, {});
    const metric = await output("metric", "Avg minutes", compute.id, {
      fieldMapping: {},
      aggregation: { value: "duration_min", agg: "avg" },
      label: "Avg minutes",
    });
    outputIds.push(chart.id, table.id, metric.id);
  }
  for (let i = 0; i < extraOutputs; i += 1) {
    outputIds.push((await output("table", `Extra table ${i + 1}`, compute.id, {})).id);
  }
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return { pipelineId: pipeline.id, stepIds: [filter.id, sort.id, compute.id], outputIds };
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((value) => window.localStorage.setItem("helio-theme", value), theme);
}

async function openPipeline(page: Page, pipelineId: string): Promise<void> {
  const sample = page.waitForResponse((r) =>
    SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
  );
  await page.goto(`/pipelines/${pipelineId}`);
  await sample;
  await page.waitForLoadState("networkidle");
}

const filterValueInput = (page: Page) =>
  page.locator(".pipeline-detail-page__filter-condition-row input").last();

test.describe("HEL-1685 draft polish (live)", () => {
  test.setTimeout(180_000);

  test("1280x800: a refused save's notice takes only its own height and the page does not scroll (item 4)", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const counter = attachApiRequestCounter(page);
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "notice" });
    expect(creds.email).toContain("hel1685");
    const { pipelineId } = await seed(page, 0, false);
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await openPipeline(page, pipelineId);
      await expect(page.locator(".spine-row").first()).toBeVisible();
      await filterValueInput(page).fill("300");
      await page.route(/\/draft\/save$/, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "boom" }),
        }),
      );
      await page.getByRole("button", { name: "Save and run" }).click();
      const notice = page.locator(".draft-notice");
      await expect(notice).toBeVisible();

      const noticeBox = (await notice.boundingBox())!;
      const bodyBox = (await page.locator(".spine-body").boundingBox())!;
      const gap = bodyBox.y - (noticeBox.y + noticeBox.height);
      expect(gap, `gap between the notice and the step body (${theme})`).toBeLessThanOrEqual(16);
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollHeight > window.innerHeight,
      );
      expect(scrolls, `document scrolls (${theme})`).toBe(false);
      await page.screenshot({ path: evidencePath("HEL-1685", `notice-1280-${theme}.png`) });
      await page.unroute(/\/draft\/save$/);
    }
    expect(counter.report().count429).toBe(0);
  });

  for (const width of [375, 430]) {
    test(`${width}px: an Output card's menu never takes a tap meant for the floating action bar (item 5)`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 812 });
      const creds = await registerAndLogin(page, request, { ...AUTH, label: `phone-${width}` });
      expect(creds.email).toContain("hel1685");
      const { pipelineId } = await seed(page, 6);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        await openPipeline(page, pipelineId);
        await page.getByRole("button", { name: /^Step 1:/ }).click();
        const sheet = page.getByRole("dialog", { name: "Step editor" });
        await expect(sheet).toBeVisible();
        await sheet.locator(".pipeline-detail-page__filter-condition-row input").last().fill("300");
        await sheet.getByRole("button", { name: "Close" }).first().click();
        await expect(sheet).toBeHidden();
        await expect(page.locator('[data-slot="draft-status"]')).toHaveText(
          "Draft \u00b7 unsaved changes",
        );

        // Walk the list from top to end. At every position, for every Output menu button whose centre lies under the
        // draft-status pill or a pill button, the hit target at that point must be inside the action bar.
        const result = await page.evaluate(async () => {
          const scroller = document.querySelector<HTMLElement>(".mobile-body")!;
          const bar = document.querySelector<HTMLElement>(".mobile-actions")!;
          const targets = [
            document.querySelector<HTMLElement>('[data-slot="draft-status"]')!,
            ...Array.from(bar.querySelectorAll<HTMLElement>("button")),
          ];
          const inside = (r: DOMRect, x: number, y: number) =>
            x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
          let covered = 0;
          const stolen: string[] = [];
          for (let top = 0; top <= scroller.scrollHeight; top += 12) {
            scroller.scrollTop = top;
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            for (const menu of document.querySelectorAll<HTMLElement>(".spine-card__menu button")) {
              const r = menu.getBoundingClientRect();
              const x = r.left + r.width / 2;
              const y = r.top + r.height / 2;
              if (!targets.some((t) => inside(t.getBoundingClientRect(), x, y))) continue;
              covered += 1;
              const hit = document.elementFromPoint(x, y);
              if (hit === null || !bar.contains(hit))
                stolen.push(`scrollTop ${top}: ${hit?.className}`);
            }
          }
          return { covered, stolen };
        });
        expect(result.covered, `an Output menu passes under the bar (${theme})`).toBeGreaterThan(0);
        expect(result.stolen, `taps the Output menu took from the bar (${theme})`).toEqual([]);
        await page.screenshot({ path: evidencePath("HEL-1685", `phone-${width}-${theme}.png`) });
      }
    });
  }

  test("900px wide: with the Output section open the step editor shows its first input row with no inner scroll (addendum G)", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "disclosure" });
    expect(creds.email).toContain("hel1685");
    const { pipelineId } = await seed(page);
    for (const theme of THEMES) {
      for (const height of [800, 700]) {
        await page.setViewportSize({ width: 900, height });
        await setTheme(page, theme);
        await openPipeline(page, pipelineId);
        await page.locator(".live-output__toggle").click();
        await expect(page.locator(".live-output__toggle")).toHaveAttribute("aria-expanded", "true");
        const editor = page.locator(".spine-body__editor");
        await expect(editor).toBeVisible();
        const m = await editor.evaluate((el) => {
          const row = el.querySelector(".pipeline-detail-page__filter-condition-row")!;
          const r = row.getBoundingClientRect();
          const e = el.getBoundingClientRect();
          return {
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
            rowBottom: r.bottom,
            editorBottom: e.bottom,
          };
        });
        const label = `900x${height} ${theme}`;
        expect(m.scrollHeight, `editor scrolls inside itself (${label})`).toBeLessThanOrEqual(
          m.clientHeight + 1,
        );
        expect(m.rowBottom, `first input row clipped (${label})`).toBeLessThanOrEqual(
          m.editorBottom,
        );
        const scrolls = await page.evaluate(
          () => document.documentElement.scrollHeight > window.innerHeight,
        );
        expect(scrolls, `document scrolls (${label})`).toBe(false);
        await page.screenshot({
          path: evidencePath("HEL-1685", `disclosure-900x${height}-${theme}.png`),
        });
      }
    }
  });

  test("1280x800: Save & run that removes an Output requests no preview of it (item 7)", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "removed-output" });
    expect(creds.email).toContain("hel1685");
    const { pipelineId, stepIds, outputIds } = await seed(page);
    const removedOutputId = outputIds[2];
    const requested: string[] = [];
    const failed: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes(removedOutputId)) requested.push(`${r.method()} ${r.url()}`);
    });
    page.on("response", (r) => {
      if (r.status() === 404 && r.url().includes(removedOutputId))
        failed.push(`${r.status()} ${r.url()}`);
    });
    await openPipeline(page, pipelineId);
    await page.getByRole("button", { name: /^Step 3:/ }).click();
    await page.getByRole("button", { name: "Remove step" }).click();
    expect(stepIds.length).toBe(3);
    const before = requested.length;
    await page.getByRole("button", { name: "Save and run" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm removals" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Remove and save" }).click();
    await expect(page.getByText("Draft · unsaved changes")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    expect(requested.slice(before), "requests naming the removed Output").toEqual([]);
    expect(failed, "404 responses for the removed Output").toEqual([]);
  });
});
