import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { spineRows } from "./support/pipelineSpine";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1763: the Output editor dialog must not scroll past its content when a chart preview is shown. The cause (found
// by probe, not the ticket's guess): visually-hidden `.sr-only` elements are `position: absolute` and resolved to the
// fixed dialog rather than the scrolling `.ui-modal__body`, so one low in the body stretched the dialog's own scroll
// extent. The chart canvas is contained by ECharts' own `position: relative` container. Everything here is measured
// geometry. The content bottom comes from in-flow content only (the modal's in-flow inner column, and the body's last
// in-flow child), never a max over every descendant, which would include the absolutely positioned escapees.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1763", displayName: "HEL-1763", domain: "example.test" } as const;
const OUTPUT_NAME = "hel1763 chart";
const EPS = 1.5;

type Theme = "light" | "dark";

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function seed(page: Page): Promise<{ pipelineId: string }> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1763-src",
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
    name: "hel1763-pipe",
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
  return { pipelineId: pipeline.id };
}

const outputSheet = (page: Page) => page.getByRole("dialog", { name: /^(New output|Edit )/ });

/** Opens the chart Output's editor and waits until the preview canvas has a real size. */
async function openEditor(page: Page, pipelineId: string, theme: Theme): Promise<Locator> {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(`/pipelines/${pipelineId}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(spineRows(page).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.getByRole("button", { name: `Open ${OUTPUT_NAME} output` }).click();
  const s = outputSheet(page);
  await expect(s.getByLabel("Name")).toBeVisible();
  await expect(s.getByText("Checking column types")).toHaveCount(0);
  const canvas = s.locator(".output-preview-pane__chart canvas").first();
  await expect(canvas).toBeVisible();
  await expect
    .poll(async () => (await canvas.boundingBox())?.height ?? 0, { message: "canvas has a size" })
    .toBeGreaterThan(20);
  await settleTransitions(page);
  return s;
}

interface ScrollGeometry {
  dialog: { scrollHeight: number; contentBottom: number };
  body: { scrollHeight: number; contentBottom: number };
  canvas: { top: number; bottom: number; left: number; right: number };
  wrapper: { top: number; bottom: number; left: number; right: number };
}

async function measure(sheet: Locator): Promise<ScrollGeometry> {
  return sheet.evaluate((dlg: HTMLElement) => {
    const inner = dlg.querySelector(".ui-modal__inner") as HTMLElement;
    const body = dlg.querySelector(".ui-modal__body") as HTMLElement;
    const lastInFlow = body.lastElementChild as HTMLElement;
    const dr = dlg.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const bcs = getComputedStyle(body);
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    return {
      // The dialog's in-flow content is its inner column (header, body, footer) measured from the dialog's top edge.
      dialog: {
        scrollHeight: dlg.scrollHeight,
        contentBottom: inner.getBoundingClientRect().bottom - dr.top + dlg.scrollTop,
      },
      // The body's in-flow content is its last child's bottom plus the body's own bottom padding.
      body: {
        scrollHeight: body.scrollHeight,
        contentBottom:
          lastInFlow.getBoundingClientRect().bottom -
          br.top +
          body.scrollTop +
          parseFloat(bcs.paddingBottom),
      },
      canvas: rect(dlg.querySelector(".output-preview-pane__chart canvas") as Element),
      wrapper: rect(dlg.querySelector(".output-preview-pane__chart") as Element),
    };
  });
}

function expectBounded(g: ScrollGeometry): void {
  expect(
    g.dialog.scrollHeight,
    `dialog scrollHeight ${g.dialog.scrollHeight} vs content bottom ${g.dialog.contentBottom}`,
  ).toBeLessThanOrEqual(g.dialog.contentBottom + EPS);
  expect(
    g.body.scrollHeight,
    `body scrollHeight ${g.body.scrollHeight} vs content bottom ${g.body.contentBottom}`,
  ).toBeLessThanOrEqual(g.body.contentBottom + EPS);
}

for (const vp of [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
]) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`HEL-1763 Output editor scroll extent: ${vp.width}x${vp.height}, ${theme}`, () => {
      test.use({ viewport: vp, actionTimeout: 15_000 });
      test.setTimeout(120_000);

      test("the dialog and its body end at their content", async ({ page, request }) => {
        await registerAndLogin(page, request, { ...AUTH, label: `phone-${vp.width}-${theme}` });
        const { pipelineId } = await seed(page);
        const sheet = await openEditor(page, pipelineId, theme);
        const g = await measure(sheet);
        await page.screenshot({ path: evidencePath("HEL-1763", `phone-${vp.width}-${theme}.png`) });
        console.log(`[HEL-1763 measure] ${vp.width} ${theme} ${JSON.stringify(g)}`);
        expectBounded(g);
      });
    });
  }
}

test.describe("HEL-1763 Output editor chart preview: desktop 1280x800", () => {
  test.use({ viewport: { width: 1280, height: 800 }, actionTimeout: 15_000 });
  test.setTimeout(120_000);

  test("the canvas renders non-empty inside its preview wrapper and the dialog stays bounded", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, { ...AUTH, label: "desktop" });
    const { pipelineId } = await seed(page);
    const sheet = await openEditor(page, pipelineId, "light");
    const g = await measure(sheet);
    await page.screenshot({ path: evidencePath("HEL-1763", "desktop-light.png") });
    expect(g.canvas.bottom - g.canvas.top, "canvas height").toBeGreaterThan(20);
    expect(g.canvas.right - g.canvas.left, "canvas width").toBeGreaterThan(20);
    expect(g.canvas.top, "canvas top within wrapper").toBeGreaterThanOrEqual(g.wrapper.top - EPS);
    expect(g.canvas.bottom, "canvas bottom within wrapper").toBeLessThanOrEqual(
      g.wrapper.bottom + EPS,
    );
    expect(g.canvas.left, "canvas left within wrapper").toBeGreaterThanOrEqual(
      g.wrapper.left - EPS,
    );
    expect(g.canvas.right, "canvas right within wrapper").toBeLessThanOrEqual(
      g.wrapper.right + EPS,
    );
    expectBounded(g);
  });
});
