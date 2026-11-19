import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { spineRows } from "./support/pipelineSpine";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1775 item 1: the Output editor's chart preview drew at 100px inside its 240px `.output-preview-pane__chart` card,
// because `.panel-content` (flex: 1; min-height: 0) sits in a plain block box there, so the chart container had no definite
// height. Measured geometry only: the ECharts canvas must fill the card's content box (within 4px) at desktop and phone
// widths, in both themes. The seed has no chart footnote or annotation, so nothing else may take height inside the card.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1775", displayName: "HEL-1775", domain: "example.test" } as const;
const OUTPUT_NAME = "hel1775 chart";
const TOLERANCE = 4;

type Theme = "light" | "dark";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function seed(page: Page): Promise<string> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1775-src",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows: Array.from({ length: 8 }, (_, i) => [
      `2026-09-${String(i + 10).padStart(2, "0")}`,
      260 + i * 7,
    ]),
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1775-pipe",
    roots: [{ sourceId: source.id }],
  });
  const sort = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "sort",
    config: { sortBy: [{ field: "date", direction: "asc" }] },
  });
  await post(page, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: OUTPUT_NAME,
    nodeStepId: sort.id,
    config: { chartType: "line", fieldMapping: { xAxis: "date", yAxis: "duration_s" } },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return pipeline.id;
}

async function openEditor(page: Page, pipelineId: string, theme: Theme): Promise<Locator> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(spineRows(page).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
  const sheet = page.getByRole("dialog", { name: /^(New output|Edit )/ });
  await expect(sheet.getByLabel("Name")).toBeVisible();
  await expect(sheet.getByText("Checking column types")).toHaveCount(0);
  const canvas = sheet.locator(".output-preview-pane__chart canvas").first();
  await expect(canvas).toBeVisible();
  await settleTransitions(page);
  return sheet;
}

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
];

for (const vp of VIEWPORTS) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`HEL-1775 editor chart fills its card: ${vp.width}x${vp.height}, ${theme}`, () => {
      test.use({ viewport: vp, actionTimeout: 15_000 });
      test.setTimeout(120_000);

      test("the canvas height equals the 240px preview card's content height", async ({
        page,
        request,
      }) => {
        await registerAndLogin(page, request, { ...AUTH, label: `${vp.width}-${theme}` });
        const pipelineId = await seed(page);
        const sheet = await openEditor(page, pipelineId, theme);
        const card = sheet.locator(".output-preview-pane__chart");
        const expectedHeight = await card.evaluate((el) => {
          const cs = getComputedStyle(el);
          return el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        });
        const canvas = sheet.locator(".output-preview-pane__chart canvas").first();
        // ECharts sizes the canvas after layout; poll until it matches or the tolerance fails with the measurement.
        await expect
          .poll(async () => (await canvas.boundingBox())?.height ?? 0, {
            message: `canvas height vs card content height ${expectedHeight}`,
          })
          .toBeGreaterThanOrEqual(expectedHeight - TOLERANCE);
        const canvasHeight = (await canvas.boundingBox())?.height ?? 0;
        expect(canvasHeight).toBeLessThanOrEqual(expectedHeight + TOLERANCE);
        console.log(
          `[HEL-1775 measure] ${vp.width} ${theme} card=${expectedHeight} canvas=${canvasHeight}`,
        );
        await page.screenshot({
          path: evidencePath("HEL-1775", `editor-${vp.width}-${theme}.png`),
        });
      });
    });
  }
}
