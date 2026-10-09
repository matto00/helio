import { writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";
import { deleteExact, seedBurstDashboard, type BurstSeed } from "./support/remountBurstSeed";

// HEL-1392 — crossing the 768px grid-CONTAINER boundary swaps the desktop grid for the phone stack
// (container = viewport - 288px sidebar) and remounts every card. This spec counts EVERY /api
// request across N=3 crossings in the real app. HEL1392_MODE=baseline records the numbers without
// asserting (run on the unmodified tree); the default asserts zero rows / zero /api/outputs/:id
// requests per crossing. React.StrictMode doubles effects in the dev build, so absolute dev numbers
// are roughly twice the production ones; the zero assertions hold in both.

const MODE = process.env.HEL1392_MODE === "baseline" ? "baseline" : "after";
const DESKTOP = { width: 1400, height: 900 };
const PHONE = { width: 1000, height: 900 };
const CROSSINGS = 3;

type Counts = Record<string, number>;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

function classify(method: string, pathname: string): string {
  return `${method} ${pathname.replace(UUID, ":id")}`;
}

function recorder(page: Page) {
  const log: string[] = [];
  page.on("request", (r) => {
    const url = new URL(r.url());
    if (url.pathname.startsWith("/api/")) log.push(classify(r.method(), url.pathname));
  });
  const since = (from: number): Counts => {
    const counts: Counts = {};
    for (const key of log.slice(from)) counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  };
  return { size: () => log.length, since };
}

/** Resolves once no new /api request has started for `quietMs`. */
async function quiet(rec: { size: () => number }, quietMs = 2_500, capMs = 30_000) {
  const start = Date.now();
  let last = rec.size();
  let lastChange = Date.now();
  while (Date.now() - start < capMs) {
    await new Promise((r) => setTimeout(r, 250));
    if (rec.size() !== last) {
      last = rec.size();
      lastChange = Date.now();
    } else if (Date.now() - lastChange >= quietMs) return;
  }
}

async function crossTo(page: Page, target: typeof DESKTOP) {
  await page.evaluate(() => {
    document
      .querySelectorAll(".panel-grid-shell .panel-grid-card")
      .forEach((n) => n.setAttribute("data-probe-old", "1"));
  });
  await page.setViewportSize(target);
  if (target === PHONE) {
    await expect(page.locator(".panel-grid")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator(".mobile-panel-stack__item")).toHaveCount(8, { timeout: 15_000 });
  } else {
    // HEL-1413: RGL receives the new width after a ResizeObserver -> rAF chain; wait for it.
    await expect(page.locator(".panel-grid")).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator(".react-grid-item")).toHaveCount(8, { timeout: 15_000 });
    await expect
      .poll(
        () =>
          page
            .locator(".panel-grid")
            .evaluate((el) => el.style.getPropertyValue("--panel-grid-processed-width")),
        { timeout: 15_000 },
      )
      .toMatch(/^\d+px$/);
  }
  // The swap really remounted the cards (none of the pre-swap card nodes survive).
  await expect(page.locator("[data-probe-old]")).toHaveCount(0);
}

async function openDashboard(page: Page, seed: BurstSeed, extraQuery = "") {
  await page.setViewportSize(DESKTOP);
  const params = new URLSearchParams(extraQuery);
  for (const id of seed.controlPanelIds) params.set(`p.${id}.c1`, "East");
  await page.goto(`/dashboards/${seed.dashboardId}?${params.toString()}`);
  await expect(page.locator(".react-grid-item")).toHaveCount(8, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "HEL-1392 T1" })).toBeVisible();
}

const rowsKey = "GET /api/outputs/:id/rows";
const metaKey = "GET /api/outputs/:id";

function summarize(c: Counts) {
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  return { total, rows: c[rowsKey] ?? 0, outputMeta: c[metaKey] ?? 0, byEndpoint: c };
}

test.describe("HEL-1392 desktop <-> phone crossing request burst", () => {
  test.setTimeout(300_000);
  let seed: BurstSeed;
  const evidence: Record<string, unknown> = { mode: MODE };

  test.beforeEach(async ({ page, request }) => {
    const { email } = await registerAndLogin(page, request, {
      prefix: "hel1392",
      displayName: "HEL-1392 e2e",
    });
    evidence.user = email;
    await isolateLivePage(page);
    seed = await seedBurstDashboard(request);
    evidence.created = seed.created;
    console.log(`[HEL-1392 e2e] created ${JSON.stringify(seed.created)} user ${email}`);
  });

  test.afterEach(async ({ request }, info) => {
    const statuses = {
      dashboard: await deleteExact(request, `/api/dashboards/${seed.dashboardId}`),
      pipelines: await Promise.all(
        seed.pipelineIds.map((id) => deleteExact(request, `/api/pipelines/${id}`)),
      ),
      source: await deleteExact(request, `/api/data-sources/${seed.sourceId}`),
    };
    console.log(`[HEL-1392 e2e] deleted ${JSON.stringify(statuses)}`);
    writeFileSync(
      evidencePath("HEL-1392", `burst-${MODE}-${info.title.replace(/\W+/g, "_")}.json`),
      JSON.stringify({ ...evidence, deleteStatuses: statuses }, null, 2),
    );
  });

  test("read > 30s on the dashboard, then 3 crossings in a burst", async ({ page }) => {
    const rec = recorder(page);
    await openDashboard(page, seed);
    await quiet(rec);
    evidence.coldLoad = summarize(rec.since(0));
    // On screen for > 30s (retention is anchored to the card being mounted, not fetch time); the
    // wait also drains the 60s rate-limit window consumed by seeding + cold load.
    await page.waitForTimeout(62_000);

    const crossings: ReturnType<typeof summarize>[] = [];
    const burstStart = rec.size();
    for (let i = 0; i < CROSSINGS; i++) {
      const from = rec.size();
      await crossTo(page, i % 2 === 0 ? PHONE : DESKTOP);
      await quiet(rec);
      crossings.push(summarize(rec.since(from)));
    }
    const burst = summarize(rec.since(burstStart));
    evidence.crossings = crossings;
    evidence.burst = burst;
    evidence.rateLimitedPanels = await page.getByText("Rate limit exceeded").count();
    console.log(
      `[HEL-1392 e2e] ${MODE} crossings ${JSON.stringify(crossings.map((c) => [c.total, c.rows, c.outputMeta]))} burst total ${burst.total}`,
    );
    if (MODE === "after") {
      for (const c of crossings) {
        expect(c.rows, JSON.stringify(c.byEndpoint)).toBe(0);
        expect(c.outputMeta, JSON.stringify(c.byEndpoint)).toBe(0);
      }
      expect(evidence.rateLimitedPanels).toBe(0);
    }
  });

  test("crossing within seconds of the first load", async ({ page }) => {
    const rec = recorder(page);
    await openDashboard(page, seed);
    await quiet(rec);
    const crossings: ReturnType<typeof summarize>[] = [];
    for (let i = 0; i < 2; i++) {
      const from = rec.size();
      await crossTo(page, i % 2 === 0 ? PHONE : DESKTOP);
      await quiet(rec);
      crossings.push(summarize(rec.since(from)));
    }
    evidence.crossings = crossings;
    console.log(
      `[HEL-1392 e2e] ${MODE} early crossings ${JSON.stringify(crossings.map((c) => [c.total, c.rows, c.outputMeta]))}`,
    );
    if (MODE === "after") {
      for (const c of crossings) {
        expect(c.rows, JSON.stringify(c.byEndpoint)).toBe(0);
        expect(c.outputMeta, JSON.stringify(c.byEndpoint)).toBe(0);
      }
    }
  });

  test("an active cross-filter, then a crossing", async ({ page }) => {
    const rec = recorder(page);
    await openDashboard(page, seed);
    await quiet(rec);
    const pieCard = page
      .locator(".panel-grid-card")
      .filter({ has: page.getByRole("heading", { name: seed.piePanelTitle }) });
    const canvas = pieCard.locator(".chart-panel__canvas canvas").first();
    await expect(canvas).toBeVisible();
    await page.waitForTimeout(1_500);
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no chart canvas");
    await page.mouse.click(
      box.x + box.width / 2,
      box.y + box.height / 2 - Math.min(box.width, box.height) * 0.2,
    );
    const inspect = page.getByRole("dialog", { name: `Inspect ${seed.piePanelTitle}` });
    await expect(inspect).toBeVisible();
    await inspect.getByRole("button", { name: /^Filter dashboard by region = / }).click();
    await expect(page.getByRole("status").filter({ hasText: "Filtered by region" })).toBeVisible();
    await quiet(rec);
    const from = rec.size();
    await crossTo(page, PHONE);
    await quiet(rec);
    const down = summarize(rec.since(from));
    const upFrom = rec.size();
    await crossTo(page, DESKTOP);
    await quiet(rec);
    const up = summarize(rec.since(upFrom));
    evidence.crossings = [down, up];
    console.log(
      `[HEL-1392 e2e] ${MODE} cross-filter crossings ${JSON.stringify([down, up].map((c) => [c.total, c.rows, c.outputMeta]))}`,
    );
    if (MODE === "after") {
      for (const c of [down, up]) expect(c.outputMeta, JSON.stringify(c.byEndpoint)).toBe(0);
    }
  });
});
