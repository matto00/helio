import { expect, test, type Page } from "@playwright/test";

import {
  attachApiRequestCounter,
  MAX_WINDOW_TARGET,
  type ApiRequestCounter,
} from "./support/apiRequestCounter";
import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { setMotion } from "./support/motionPrimitivesSeed";

// HEL-1632: the pipeline page's live Output column, proven against the running app. The Output renders from the walked
// rows of its node with the panel renderers; a client-evaluable edit updates it with NO request (the network log shows only
// the one-time baseline history read at load); the caption, the "live" marker and the stale / updating / not-previewed states
// follow the draft. The 10-edit burst is re-measured with a chart Output on screen (design.md D6, C7): the step count must
// still update in under 100 ms (first edit) / 50 ms (edits 2-10), the HEL-1631 budget, never relaxed.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1632", displayName: "HEL-1632", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?.*)?$/;

interface Seeded {
  pipelineId: string;
  chartId: string;
  metricId: string;
  stepIds: string[];
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface SeedOptions {
  /** Add a server-only step (convertformat) after compute, with an Output on it. */
  serverStep?: boolean;
  /** Add an AI step after compute, with an Output on it (never run: no model key is needed to save it). */
  aiStep?: boolean;
}

/** 14 rows, durations 260..351; filter >= 260 keeps all 14. Chart Output on the filter, metric Output on the compute step. */
async function seed(
  page: Page,
  options: SeedOptions = {},
): Promise<Seeded & { extraOutputId?: string }> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
    `note ${i}`,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1632-src-runs",
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
    name: "hel1632-pipe-runs",
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
  const stepIds = [filter.id, sort.id, compute.id];
  const output = (kind: string, name: string, nodeStepId: string, config: unknown) =>
    post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
      kind,
      name,
      nodeStepId,
      config,
    });
  const chart = await output("chart", "Run duration", filter.id, {
    chartType: "line",
    fieldMapping: { xAxis: "date", yAxis: "duration_s" },
  });
  const metric = await output("metric", "Avg minutes", compute.id, {
    fieldMapping: {},
    aggregation: { value: "duration_min", agg: "avg" },
    label: "Avg minutes",
  });
  let extraOutputId: string | undefined;
  if (options.serverStep) {
    const convert = await step("convertformat", { field: "note", from: "text", to: "markdown" });
    stepIds.push(convert.id);
    extraOutputId = (await output("table", "Converted", convert.id, {})).id;
  }
  if (options.aiStep) {
    const ai = await step("generatetext", {
      inputField: "note",
      instruction: "Summarise this note",
      outputField: "summary",
    });
    stepIds.push(ai.id);
    extraOutputId = (await output("table", "AI summary", ai.id, {})).id;
  }
  if (!options.aiStep) await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return {
    pipelineId: pipeline.id,
    chartId: chart.id,
    metricId: metric.id,
    stepIds,
    extraOutputId,
  };
}

function recordApi(page: Page): { stop: () => string[] } {
  const log: string[] = [];
  const onRequest = (r: { method(): string; url(): string }) => {
    const { pathname, search } = new URL(r.url());
    if (pathname.startsWith("/api/")) log.push(`${r.method()} ${pathname}${search}`);
  };
  page.on("request", onRequest);
  return {
    stop: () => {
      page.off("request", onRequest);
      return log;
    },
  };
}

async function openPipeline(page: Page, pipelineId: string): Promise<void> {
  const sample = page.waitForResponse((r) =>
    SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
  );
  await page.goto(`/pipelines/${pipelineId}`);
  await sample;
  await expect(page.getByRole("region", { name: /^Rows after step 1/ })).toBeVisible();
  await expect(page.locator(".step-preview__body tbody tr").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

const column = (page: Page) => page.getByRole("region", { name: "Live Output" });
const tile = (page: Page, label: string) =>
  column(page).locator(".live-output__tile").filter({ hasText: label });
/** Sets the filter value like a keystroke; resolves with ms until step 1's count text changed AND ms until the live column's
 *  rows-out tile changed (-1 when it never did within 2 s). */
async function timedFilterEdit(
  page: Page,
  value: string,
): Promise<{ count: number; live: number }> {
  return page.evaluate(
    (next) =>
      new Promise<{ count: number; live: number }>((resolve) => {
        const inputs = document.querySelectorAll<HTMLInputElement>(
          ".pipeline-detail-page__filter-condition-row input",
        );
        const target = document.querySelector(".spine-row .spine-row__count");
        const field = inputs[inputs.length - 1];
        if (!field || !target) return resolve({ count: -1, live: -1 });
        const rowsTile = () =>
          [...document.querySelectorAll(".live-output__tile")]
            .find((t) => t.textContent?.includes("Rows out"))
            ?.querySelector(".live-output__tile-value");
        const beforeCount = target.textContent;
        const beforeRows = rowsTile()?.textContent ?? null;
        const out = { count: -2, live: -1 };
        const start = performance.now();
        const check = () => {
          if (out.count < 0 && target.textContent !== beforeCount)
            out.count = performance.now() - start;
          const now = rowsTile()?.textContent ?? null;
          if (out.live < 0 && now !== null && now !== beforeRows)
            out.live = performance.now() - start;
          if (out.count >= 0 && out.live >= 0) {
            observer.disconnect();
            resolve(out);
          }
        };
        const observer = new MutationObserver(check);
        observer.observe(document.body, { childList: true, characterData: true, subtree: true });
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(field, next);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        setTimeout(() => {
          observer.disconnect();
          resolve(out);
        }, 2000);
      }),
    value,
  );
}

test.describe("HEL-1632 live Output column", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test.setTimeout(150_000);

  let counter: ApiRequestCounter;
  test.beforeEach(({ page }) => {
    counter = attachApiRequestCounter(page);
  });
  test.afterEach(async ({ page: _page }, info) => {
    const r = counter.report();
    console.log(`[HEL-1632 e2e] ${info.title}: ${counter.describe()}`);
    expect(r.count429, `rate-limited (429) responses: ${counter.describe()}`).toBe(0);
    expect(r.maxWindow, `worst 60s /api window: ${counter.describe()}`).toBeLessThanOrEqual(
      MAX_WINDOW_TARGET,
    );
  });

  test("one baseline history read at load, then a burst of edits sends nothing and the Output follows the draft", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "burst" });
    const { pipelineId, chartId } = await seed(page);
    const histories: string[] = [];
    page.on("request", (r) => {
      const { pathname } = new URL(r.url());
      if (/\/api\/outputs\/[^/]+\/history$/.test(pathname)) histories.push(pathname);
    });
    await openPipeline(page, pipelineId);

    // The saved pipeline over the sample: no draft, so no "live" marker and the saved-pipeline caption.
    await expect(column(page).getByText("Run duration")).toBeVisible();
    await expect(
      column(page).getByText("Rendered from the saved pipeline over the cached sample."),
    ).toBeVisible();
    await expect(page.getByLabel("Output is live")).toHaveCount(0);
    await expect(tile(page, "Rows out")).toContainText("14");
    await expect(tile(page, "Rows out")).toContainText("same as last run");
    expect(histories, "one baseline history read at load").toEqual([
      `/api/outputs/${chartId}/history`,
    ]);

    const recording = recordApi(page);
    for (let k = 1; k <= 6; k += 1) {
      await timedFilterEdit(page, String(260 + 7 * k));
    }
    await page.waitForTimeout(1500);
    const requests = recording.stop();
    expect(requests, `requests during the burst: ${requests.join(", ")}`).toEqual([]);

    await expect(tile(page, "Rows out")).toContainText("8");
    await expect(tile(page, "Rows out")).toContainText("−6 vs last run");
    await expect(
      column(page).getByText("Rendered from the draft. Nothing is written until you save and run."),
    ).toBeVisible();
    await expect(column(page).getByLabel("Output is live")).toBeVisible();
    await expect(column(page).locator("canvas, svg").first()).toBeVisible();
    expect(histories).toHaveLength(1);
  });

  // HEL-1691: measured against the production build, like the HEL-1631 burst test; the tag is the whole opt-in.
  test(
    "the 10-edit burst with a chart Output on screen keeps the HEL-1631 latency budget; input to live-output update measured",
    { tag: "@prod-build" },
    async ({ page, request }) => {
      await registerAndLogin(page, request, { ...AUTH, label: "latency" });
      const { pipelineId } = await seed(page);
      await openPipeline(page, pipelineId);
      await expect(column(page).locator("canvas, svg").first()).toBeVisible();
      await expect(page.locator(".spine-row").first().locator(".spine-row__count")).toHaveText(
        "14",
      );

      const results: { count: number; live: number }[] = [];
      for (let k = 1; k <= 10; k += 1) {
        results.push(await timedFilterEdit(page, String(260 + 7 * k)));
      }
      const counts = results.map((r) => r.count);
      const lives = results.map((r) => r.live);
      console.log(
        `[HEL-1632 e2e] step-count latency ms: ${counts.map((n) => n.toFixed(1)).join(", ")}`,
      );
      console.log(
        `[HEL-1632 e2e] input to live-output ms: ${lives.map((n) => n.toFixed(1)).join(", ")}`,
      );
      expect(
        counts.every((ms) => ms >= 0),
        `every edit updated the count: ${counts}`,
      ).toBe(true);
      expect(counts[0], `first edit: ${counts}`).toBeLessThan(100);
      expect(Math.max(...counts.slice(1)), `edits 2-10: ${counts}`).toBeLessThan(50);
      await expect(tile(page, "Rows out")).toContainText("4");
    },
  );

  test("an error above the Output's node keeps the last good render and shows stale", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "error" });
    const { pipelineId } = await seed(page);
    await openPipeline(page, pipelineId);
    await page.getByRole("button", { name: /^Step 3:/ }).click();
    await expect(column(page).getByText("Avg minutes").first()).toBeVisible();
    const expression = page.getByRole("textbox", { name: /expression/i }).first();
    await expect(expression).toBeVisible();
    await expression.fill("$duration_s /");
    await expect(column(page).getByLabel("Output is stale")).toBeVisible();
    await expect(column(page).getByLabel("Output is live")).toHaveCount(0);
    await expect(column(page).getByText("Avg minutes").first()).toBeVisible();
  });

  test("a server-only step shows updating, then live; Discard returns to the saved render with zero requests", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "server" });
    const { pipelineId } = await seed(page, { serverStep: true });
    await page.route("**/draft-preview", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await openPipeline(page, pipelineId);
    await page.getByRole("button", { name: /^Step 4:/ }).click();
    await expect(column(page).getByText("Converted").first()).toBeVisible();
    await page.getByRole("textbox", { name: "Destination field" }).fill("note_md");
    await expect(column(page).getByLabel("Output is updating")).toBeVisible();
    await expect(column(page).getByLabel("Output is live")).toBeVisible({ timeout: 10_000 });

    const recording = recordApi(page);
    await page.getByRole("button", { name: "Discard draft" }).click();
    await page.waitForTimeout(1500);
    expect(recording.stop()).toEqual([]);
    await expect(page.getByLabel("Output is live")).toHaveCount(0);
    // A server-only node has no client frame to show without a draft: saved rows, labelled "saved".
    await expect(column(page).getByText("Showing the last run.")).toBeVisible();
    await expect(column(page).getByLabel("Output is saved")).toBeVisible();
  });

  test("an Output below an AI step shows its saved data labelled stale", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "ai" });
    const { pipelineId } = await seed(page, { aiStep: true });
    await openPipeline(page, pipelineId);
    await page.getByRole("button", { name: /^Step 1:/ }).click();
    await timedFilterEdit(page, "267");
    await page.getByRole("button", { name: /^Step 4:/ }).click();
    await expect(column(page).getByText("AI summary").first()).toBeVisible();
    await expect(column(page).getByLabel("Output is stale")).toBeVisible();
    await expect(
      column(page).getByText("Not previewed (AI step): showing the last run's data."),
    ).toBeVisible();
  });

  const WIDTHS = [
    { name: "1280", width: 1280, height: 800 },
    { name: "900", width: 900, height: 800 },
    { name: "375", width: 375, height: 812 },
    { name: "430", width: 430, height: 932 },
  ];
  for (const theme of ["light", "dark"] as const) {
    for (const w of WIDTHS) {
      test(`screenshots ${w.name} ${theme}`, async ({ page, request }) => {
        await page.setViewportSize({ width: w.width, height: w.height });
        await registerAndLogin(page, request, { ...AUTH, label: `shot${w.name}${theme}` });
        await page.addInitScript((t) => localStorage.setItem("helio-theme", t), theme);
        const { pipelineId } = await seed(page);
        if (w.width <= 768) {
          const sample = page.waitForResponse((r) => SAMPLE_URL.test(new URL(r.url()).pathname));
          await page.goto(`/pipelines/${pipelineId}`);
          await sample;
          await page.getByRole("tab", { name: "Preview" }).click();
          await column(page).scrollIntoViewIfNeeded();
        } else {
          await openPipeline(page, pipelineId);
          await timedFilterEdit(page, "281");
        }
        await page.waitForTimeout(800);
        await page.screenshot({ path: evidencePath("HEL-1632", `live-${w.name}-${theme}.png`) });
        if (w.name === "900") {
          await column(page).getByRole("button", { name: "Output" }).click();
          await expect(column(page).locator(".live-output__card")).toBeVisible();
          await page.waitForTimeout(500);
          await page.screenshot({
            path: evidencePath("HEL-1632", `live-${w.name}-${theme}-open.png`),
          });
        }
      });
    }
  }

  for (const motion of ["full", "subtle", "off"] as const) {
    test(`screenshot motion ${motion}`, async ({ page, request }) => {
      await registerAndLogin(page, request, { ...AUTH, label: `motion${motion}` });
      await setMotion(page.request, motion);
      const { pipelineId } = await seed(page);
      await openPipeline(page, pipelineId);
      await timedFilterEdit(page, "281");
      await page.waitForTimeout(800);
      await expect(page.locator("html")).toHaveAttribute("data-motion", motion);
      await page.screenshot({ path: evidencePath("HEL-1632", `live-motion-${motion}.png`) });
    });
  }
});
