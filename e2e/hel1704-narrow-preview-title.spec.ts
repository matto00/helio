import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1704: on the narrow-desktop disclosure layout with the Output section open, the step preview's title row is never
// clipped, and the step editor still shows its first condition row in full (HEL-1685 addendum G). Guard for the min-height
// on `.step-preview`; red on main at 900x600 (title clipped), green at 900x700.

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1704", displayName: "HEL-1704", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample(\?.*)?$/;
const THEMES = ["dark", "light"] as const;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** A source, a pipeline with one filter step and a chart Output on it, run once. */
async function seed(page: Page): Promise<string> {
  const rows = Array.from({ length: 14 }, (_, i) => [
    `2026-09-${String(i + 10).padStart(2, "0")}`,
    i % 5 === 0 ? "failed" : "success",
    260 + i * 7,
  ]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "hel1704-src-runs",
    type: "static",
    columns: [
      { name: "date", type: "string" },
      { name: "status", type: "string" },
      { name: "duration_s", type: "integer" },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "hel1704-pipe-runs",
    roots: [{ sourceId: source.id }],
  });
  const filter = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "filter",
    config: {
      combinator: "and",
      conditions: [{ field: "duration_s", operator: ">=", value: "260" }],
    },
  });
  await post(page, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "chart",
    name: "Run duration",
    nodeStepId: filter.id,
    config: { chartType: "line", fieldMapping: { xAxis: "date", yAxis: "duration_s" } },
  });
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  return pipeline.id;
}

test.describe("HEL-1704 narrow-desktop step preview title (live)", () => {
  test.setTimeout(180_000);

  test("with the Output section open, the preview title and the editor's first condition row both stay visible", async ({
    page,
    request,
  }) => {
    const creds = await registerAndLogin(page, request, { ...AUTH, label: "preview-title" });
    expect(creds.email).toContain("hel1704");
    const pipelineId = await seed(page);
    for (const theme of THEMES) {
      for (const height of [700, 600]) {
        const label = `900x${height} ${theme}`;
        await page.setViewportSize({ width: 900, height });
        await page.evaluate((value) => window.localStorage.setItem("helio-theme", value), theme);
        const sample = page.waitForResponse((r) =>
          SAMPLE_URL.test(new URL(r.url()).pathname + new URL(r.url()).search),
        );
        await page.goto(`/pipelines/${pipelineId}`);
        await sample;
        await page.waitForLoadState("networkidle");
        await page.locator(".live-output__toggle").click();
        await expect(page.locator(".live-output__toggle")).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator(".spine-body__editor")).toBeVisible();
        await expect(page.locator(".step-preview__title")).toBeAttached();

        const m = await page.evaluate(() => {
          const box = (sel: string) => {
            const r = document.querySelector(sel)!.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
          };
          return {
            title: box(".step-preview__title"),
            preview: box(".step-preview"),
            main: box(".spine-body__main"),
            editor: box(".spine-body__editor"),
            row: box(".pipeline-detail-page__filter-condition-row"),
            scrolls: document.documentElement.scrollHeight > window.innerHeight,
          };
        });
        expect(m.title.top, `title above its preview (${label})`).toBeGreaterThanOrEqual(
          m.preview.top,
        );
        expect(
          m.title.bottom,
          `title clipped by the preview's bottom (${label})`,
        ).toBeLessThanOrEqual(m.preview.bottom);
        expect(
          m.title.bottom,
          `title clipped by the column's bottom (${label})`,
        ).toBeLessThanOrEqual(m.main.bottom);
        expect(
          m.row.bottom,
          `first condition row clipped by the editor (${label})`,
        ).toBeLessThanOrEqual(m.editor.bottom);
        expect(m.scrolls, `document scrolls (${label})`).toBe(false);
        await page.screenshot({
          path: evidencePath("HEL-1704", `narrow-preview-900x${height}-${theme}.png`),
        });
      }
    }
  });
});
