import { expect, test, type Page } from "@playwright/test";

import { CSRF_HEADER, currentUserId, registerUser } from "./support/auth";
import { setUserTierForTest } from "./support/historySeed";
import { loginThenIsolate } from "./support/isolateLivePage";

// HEL-1575 task 8.2 -- measures a warm vs a cold tab switch on a dashboard of 12 Output-bound panels, as an
// owner-tier user, median of 5. Opt-in (HEL1575_MEASURE=1): it records numbers, it asserts none, so it never
// runs in the default e2e glob.
//
// A cold 12-panel load costs about 50 requests, so the spec waits out the 60 s rate-limit window between
// iterations (about 6 minutes in all).
//
// Method. The measured dashboard X (12 table panels, 100 rows each) and a filler dashboard Y are open as tabs.
// Time zero is the click on X's tab; the stop is the first animation frame at which all 12 panel bodies show
// their rows (a cell rendered in each) and no body skeleton remains, both read inside the page with
// performance.now() so no test-runner round trip is in the figure.
//   cold: the page is loaded on Y with the browser-stored warm copy deleted (nothing for X to restore), then
//         X's tab is clicked: panel list, 12 metadata reads, 12 row reads.
//   warm: X was shown, left for Y, and is clicked again within the TTL.

test.skip(
  process.env.HEL1575_MEASURE !== "1",
  "set HEL1575_MEASURE=1 to record the switch timings",
);

const RUNS = 5;
const PANELS = 12;

async function post<T>(page: Page, url: string, data: unknown): Promise<T> {
  const res = await page.request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** Clicks the tab and resolves, in-page, with the ms until all `PANELS` bodies hold data. */
async function timeSwitch(page: Page, tabName: string, panels: number): Promise<number> {
  return page.evaluate(
    ({ tabName: name, panels: want }) =>
      new Promise<number>((resolve, reject) => {
        const tab = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find(
          (el) => el.getAttribute("aria-label") === name,
        );
        if (!tab) return reject(new Error(`no tab ${name}`));
        const started = performance.now();
        tab.click();
        const check = () => {
          const cards = [...document.querySelectorAll<HTMLElement>(".panel-grid-card")];
          const withData = cards.filter((card) => card.querySelector('[role="cell"], td')).length;
          const skeletons = document.querySelectorAll(".panel-body-skeleton").length;
          if (cards.length >= want && withData >= want && skeletons === 0) {
            resolve(performance.now() - started);
          } else if (performance.now() - started > 30_000) {
            reject(new Error(`timed out: ${withData}/${want} bodies, ${skeletons} skeletons`));
          } else {
            requestAnimationFrame(check);
          }
        };
        requestAnimationFrame(check);
      }),
    { tabName, panels },
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test("HEL-1575 warm vs cold tab switch on a 12-panel dashboard (owner tier, median of 5)", async ({
  page,
  request,
}) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 1600 });
  const credentials = await registerUser(request, {
    prefix: "hel1575m",
    displayName: "HEL-1575 measure",
    logEmail: false,
  });
  const userId = await currentUserId(request);
  console.log(
    `[HEL-1575 measure] user ${userId}; tier set for ${setUserTierForTest(userId, "owner")}`,
  );
  await loginThenIsolate(page, credentials);

  const rows = Array.from({ length: 100 }, (_, i) => [`R${i % 10}`, i * 7]);
  const source = await post<{ id: string }>(page, "/api/data-sources", {
    name: "HEL-1575 measure source",
    type: "static",
    columns: [
      { name: "region", type: "string", required: true },
      { name: "revenue", type: "integer", required: true },
    ],
    rows,
  });
  const pipeline = await post<{ id: string }>(page, "/api/pipelines", {
    name: "HEL-1575 measure pipeline",
    roots: [{ sourceId: source.id }],
  });
  const big = await post<{ id: string }>(page, "/api/dashboards", { name: "Measure X" });
  const filler = await post<{ id: string }>(page, "/api/dashboards", { name: "Measure Y" });
  const bigPanels: { id: string }[] = [];
  for (let i = 0; i < PANELS; i++) {
    const output = await post<{ id: string }>(page, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "table",
      name: `HEL-1575 measure output ${i}`,
      config: {},
    });
    bigPanels.push(
      await post<{ id: string }>(page, "/api/panels", {
        dashboardId: big.id,
        title: `Measure panel ${i}`,
        type: "output",
        config: { outputId: output.id },
      }),
    );
  }
  await post(page, `/api/pipelines/${pipeline.id}/run`, {});
  await post(page, `/api/dashboards/${big.id}/auto-layout`, {
    items: bigPanels.map((p) => ({ panelId: p.id, w: 4, h: 3 })),
  });
  const note = await post<{ id: string }>(page, "/api/panels", {
    dashboardId: filler.id,
    title: "Measure filler",
    type: "markdown",
    config: { content: "filler" },
  });
  expect(note.id).toBeTruthy();

  const cold: number[] = [];
  const warm: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    // The general /api limit (120 requests per fixed 60 s window per user) is below what seeding plus one cold
    // load of 12 panels costs, so each iteration starts in a fresh window; a 429 would measure the limiter.
    await page.waitForTimeout(62_000);
    // Cold: a fresh page on Y, the stored warm copy removed, X open but never restorable.
    await page.goto(`/dashboards/${filler.id}`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const del = indexedDB.deleteDatabase("helio-warm");
          del.onsuccess = del.onerror = del.onblocked = () => resolve();
        }),
    );
    await page.goto(`/dashboards/${filler.id}`);
    if (run === 0) {
      await page
        .locator(".dashboard-list")
        .getByRole("button", { name: "Measure X", exact: true })
        .click({
          modifiers: ["Control"],
        });
    }
    await expect(page.locator(".panel-grid-card", { hasText: "Measure filler" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Measure X" })).toBeVisible();
    await page.waitForTimeout(1_000);
    cold.push(await timeSwitch(page, "Measure X", PANELS));

    // Warm: leave X for Y and come back.
    await page.waitForTimeout(1_500);
    await timeSwitch(page, "Measure Y", 0).catch(() => undefined);
    await expect(page.locator(".panel-grid-card", { hasText: "Measure filler" })).toBeVisible();
    await page.waitForTimeout(1_500);
    warm.push(await timeSwitch(page, "Measure X", PANELS));
  }
  const round = (n: number) => Math.round(n);
  console.log(
    `[HEL-1575 measure] cold ms ${JSON.stringify(cold.map(round))} median ${round(median(cold))}`,
  );
  console.log(
    `[HEL-1575 measure] warm ms ${JSON.stringify(warm.map(round))} median ${round(median(warm))}`,
  );
});
