import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1628: the source sample store and label, proven against the running app. The static cases (dataset,
// uploaded CSV over 1,000 rows) and every network count use the REAL `/api/data-sources/:id/sample` endpoint.
// The two non-static cases cannot reach a real REST/SQL host from the dev stack (the egress guard refuses
// localhost), so their screenshots fulfil `/sample` with a fixture that is validated against the committed
// schema first (design.md D10).

const CSRF = { "X-Helio-Requested-With": "1" };
const AUTH = { prefix: "hel1628", displayName: "HEL-1628", domain: "example.test" } as const;
const SAMPLE_URL = /\/api\/data-sources\/[^/]+\/sample$/;

const requireFromFrontend = createRequire(resolve(__dirname, "../frontend/package.json"));
const Ajv2020 = requireFromFrontend("ajv/dist/2020").default;
const schema = JSON.parse(
  readFileSync(resolve(__dirname, "../schemas/sources/source-sample-response.schema.json"), "utf8"),
);
const validateSample = new Ajv2020({ allErrors: true, validateFormats: false }).compile(schema);

function liveFixture(over: Record<string, unknown>) {
  const body = {
    rows: Array.from({ length: 5 }, (_, i) => ({ id: { $int: i }, label: `row-${i}` })),
    capturedAt: new Date(Date.now() - 3.5 * 60_000).toISOString(),
    sourceRowCount: 5,
    truncated: false,
    live: true,
    ...over,
  };
  expect(validateSample(body), JSON.stringify(validateSample.errors)).toBe(true);
  return body;
}

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: CSRF });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

async function seedStatic(
  page: Page,
  rowCount: number,
): Promise<{ pipelineId: string; sourceId: string }> {
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: `samples-static-${rowCount}`,
    type: "static",
    columns: [
      { name: "n", type: "integer" },
      { name: "label", type: "string" },
    ],
    rows: Array.from({ length: rowCount }, (_, i) => [i, `row-${i}`]),
  });
  return { sourceId: source.id, pipelineId: await seedPipeline(page, source.id) };
}

async function seedCsv(
  page: Page,
  rowCount: number,
): Promise<{ pipelineId: string; sourceId: string }> {
  const csv =
    "n,label\n" + Array.from({ length: rowCount }, (_, i) => `${i},row-${i}`).join("\n") + "\n";
  const res = await page.request.post("/api/data-sources", {
    multipart: {
      name: `samples-csv-${rowCount}`,
      file: { name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
    },
    headers: CSRF,
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const source = (await res.json()) as { id: string };
  return { sourceId: source.id, pipelineId: await seedPipeline(page, source.id) };
}

async function seedPipeline(page: Page, sourceId: string): Promise<string> {
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: `samples-pipe-${Date.now()}`,
    roots: [{ sourceId }],
  });
  await post(page, `/api/pipelines/${pipeline.id}/steps`, {
    type: "filter",
    config: { combinator: "and", conditions: [{ field: "n", operator: ">=", value: "0" }] },
  });
  return pipeline.id;
}

function countSampleRequests(page: Page): { count: () => number; reset: () => void } {
  let n = 0;
  page.on("request", (r) => {
    if (r.method() === "GET" && SAMPLE_URL.test(new URL(r.url()).pathname)) n++;
  });
  return { count: () => n, reset: () => (n = 0) };
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
}

test.describe("HEL-1628 source sample store and label (live)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("captures once on open, never per edit, once per refresh, and a reload starts fresh", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "counts" });
    const { pipelineId } = await seedStatic(page, 30);
    const sampleRequests = countSampleRequests(page);

    await page.goto(`/pipelines/${pipelineId}`);
    const label = page.locator(".spine-source-card .source-sample-label");
    await expect(label).toContainText("Static · 30 rows");
    expect(sampleRequests.count()).toBe(1);

    // Edits: select the step and change its condition value; the debounced save + analyze + preview all run.
    await page.locator(".spine-row__select").first().click();
    const editor = page.getByRole("region", { name: /^Step 1 / });
    const value = editor.getByRole("spinbutton", { name: "Value for condition 1" });
    await value.fill("5");
    await page.waitForTimeout(2000);
    expect(sampleRequests.count()).toBe(1);

    // Manual refresh: exactly one more request.
    await page.getByRole("button", { name: /^Refresh sample of / }).click();
    await expect.poll(() => sampleRequests.count()).toBe(2);
    await expect(label).toContainText("Static · 30 rows");
    await page.waitForTimeout(1000);
    expect(sampleRequests.count()).toBe(2);

    // Reload: nothing carried over, one fresh capture.
    sampleRequests.reset();
    await page.reload();
    await expect(label).toContainText("Static · 30 rows");
    expect(sampleRequests.count()).toBe(1);
    const stored = await page.evaluate(() =>
      [...Object.keys(window.localStorage), ...Object.keys(window.sessionStorage)].filter((k) =>
        /sample/i.test(k),
      ),
    );
    expect(stored).toEqual([]);
  });

  test("the four label cases render in both themes", async ({ page, request }) => {
    test.setTimeout(180_000);
    await registerAndLogin(page, request, { ...AUTH, label: "cases" });
    const staticExact = await seedStatic(page, 30);
    const staticOver = await seedCsv(page, 1200);
    const liveExact = await seedStatic(page, 3);
    const livePrefix = await seedStatic(page, 3);

    // Non-static cases: fulfil `/sample` with a schema-valid fixture (design.md D10).
    await page.route(SAMPLE_URL, async (route) => {
      const sourceId = new URL(route.request().url()).pathname.split("/")[3];
      if (sourceId === liveExact.sourceId) {
        return route.fulfill({ json: liveFixture({ sourceRowCount: 412 }) });
      }
      if (sourceId === livePrefix.sourceId) {
        return route.fulfill({
          json: liveFixture({ truncated: true, sourceRowCount: 12431 }),
        });
      }
      return route.fallback();
    });

    const cases: Array<[string, { pipelineId: string }, RegExp, boolean]> = [
      ["static-exact", staticExact, /^Static · 30 rows$/, false],
      ["static-over-cap", staticOver, /^first 1,000 of 1,200 rows$/, true],
      ["live-exact", liveExact, /^sample · 412 rows · fetched 3 minutes ago$/, false],
      [
        "live-prefix",
        livePrefix,
        /^sample · first 1,000 of 12,431 rows · fetched 3 minutes ago$/,
        true,
      ],
    ];
    for (const theme of ["dark", "light"] as const) {
      await setTheme(page, theme);
      for (const [name, seeded, text, caveat] of cases) {
        await page.goto(`/pipelines/${seeded.pipelineId}`);
        const label = page.locator(".spine-source-card .source-sample-label");
        await expect(label.locator(".source-sample-label__text")).toHaveText(text);
        if (caveat) await expect(label).toContainText("Counts and aggregates describe this sample");
        else await expect(label).not.toContainText("Counts and aggregates");
        await page.locator(".spine-source-card").screenshot({
          path: evidencePath("HEL-1628", `label-${name}-${theme}.png`),
        });
        if (name === "live-prefix") {
          await page.screenshot({ path: evidencePath("HEL-1628", `page-${name}-${theme}.png`) });
        }
      }
    }
  });

  test("phone viewport: the chip carries the label and refresh, one capture on open", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await registerAndLogin(page, request, { ...AUTH, label: "phone" });
    const { pipelineId } = await seedStatic(page, 30);
    const sampleRequests = countSampleRequests(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ["dark", "light"] as const) {
      await setTheme(page, theme);
      await page.goto(`/pipelines/${pipelineId}`);
      const label = page.locator(".pipeline-detail-header__source-chip-group .source-sample-label");
      await expect(label).toContainText("Static · 30 rows");
      await expect(label.getByRole("button", { name: /^Refresh sample of / })).toBeVisible();
      await page.screenshot({ path: evidencePath("HEL-1628", `phone-chip-${theme}.png`) });
    }
    // Two page loads (one per theme), one capture each.
    expect(sampleRequests.count()).toBe(2);
  });
});
