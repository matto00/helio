import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CSRF_HEADER, registerAndLogin } from "./support/auth";

// HEL-1583 (owner answer `reserve-line-space`): the phone "refreshed" line resolves only after the Output and pipeline
// fetches, so a line that merely appeared would push every card down by its own height (CI saw ~27px in the HEL-1065
// pin-toggle spec). Its slot is reserved from first paint on a dashboard with pipeline-fed panels, and absent on one
// without. Measured from rendered boxes at 375px with `/api/pipelines/**` held for several seconds.

test.describe.configure({ mode: "parallel" });
test.setTimeout(120_000);

const AUTH = { prefix: "hel1583r", displayName: "HEL-1583 R", domain: "example.com" } as const;

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

/** The skeleton's placeholders share the real cards' `.mobile-panel-stack__item` class but sit at a different height
 *  (they are `div[aria-hidden]`, the real cards are `article`s). Sample only once the skeleton is gone and a real card
 *  is visible, or the "before" read can be a placeholder. */
async function realCardsReady(page: Page) {
  await expect(page.locator('.mobile-panel-stack__item[aria-hidden="true"]')).toHaveCount(0);
  await expect(page.locator("article.mobile-panel-stack__item").first()).toBeVisible();
}

async function layoutTops(page: Page) {
  return page.evaluate(() => {
    const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
    return {
      card: top("article.mobile-panel-stack__item"),
      chips: top(".dashboard-chip-row"),
      scrollHeight: document.querySelector<HTMLElement>(".panel-list")?.scrollHeight ?? null,
    };
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`pipeline-fed dashboard: the cards do not move when the refreshed line resolves (${theme})`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, { ...AUTH, label: `fed${theme}` });
    const api = page.request;
    const dash = await post<{ id: string }>(api, "/api/dashboards", { name: "HEL-1583 Fed" });
    const source = await post<{ id: string }>(api, "/api/data-sources", {
      name: "HEL-1583 fed source",
      type: "static",
      columns: [{ name: "region", type: "string" }],
      rows: [["East"]],
    });
    const pipeline = await post<{ id: string }>(api, "/api/pipelines", {
      name: "HEL-1583 fed pipeline",
      roots: [{ sourceId: source.id }],
    });
    const output = await post<{ id: string }>(api, `/api/pipelines/${pipeline.id}/outputs`, {
      kind: "table",
      name: "HEL-1583 fed output",
      config: {},
    });
    await post(api, `/api/pipelines/${pipeline.id}/run`, {});
    await post(api, "/api/panels", {
      dashboardId: dash.id,
      title: "Fed table",
      type: "output",
      config: { outputId: output.id },
    });
    await post(api, "/api/panels", {
      dashboardId: dash.id,
      title: "Note",
      type: "markdown",
      config: { content: "note" },
    });

    // Hold the pipeline summary (what the refreshed line waits on) for 5s.
    await page.route("**/api/pipelines/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.continue();
    });
    await page.goto(`/dashboards/${dash.id}`);
    await realCardsReady(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const before = await layoutTops(page);
    expect(
      await page.locator(".dashboard-refresh-line:not([data-reserved])").count(),
      "the line has not resolved yet at first paint",
    ).toBe(0);

    await expect(page.locator(".dashboard-refresh-line:not([data-reserved])")).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(300);
    const after = await layoutTops(page);
    console.log(`HEL1583-NOSHIFT ${theme} ${JSON.stringify({ before, after })}`);
    expect(Math.abs(after.card! - before.card!), "first card top moved").toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.chips! - before.chips!), "chip row top moved").toBeLessThanOrEqual(0.5);
    expect(
      Math.abs(after.scrollHeight! - before.scrollHeight!),
      ".panel-list height moved",
    ).toBeLessThanOrEqual(0.5);
  });

  test(`dashboard with no pipeline-fed panels: no reserved gap and no shift (${theme})`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await registerAndLogin(page, request, { ...AUTH, label: `plain${theme}` });
    const api = page.request;
    const dash = await post<{ id: string }>(api, "/api/dashboards", { name: "HEL-1583 Plain" });
    await post(api, "/api/panels", {
      dashboardId: dash.id,
      title: "Note",
      type: "markdown",
      config: { content: "note" },
    });
    await page.goto(`/dashboards/${dash.id}`);
    await realCardsReady(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const before = await layoutTops(page);
    await page.waitForTimeout(1500);
    const after = await layoutTops(page);
    console.log(`HEL1583-NOGAP ${theme} ${JSON.stringify({ before, after })}`);
    expect(await page.locator(".dashboard-refresh-line").count(), "no slot at all").toBe(0);
    const chipsIsFirst = await page.evaluate(
      () =>
        document.querySelector(".dashboard-chip-row")?.parentElement?.firstElementChild ===
        document.querySelector(".dashboard-chip-row"),
    );
    expect(chipsIsFirst, "the chip row is the first child: no reserved gap").toBe(true);
    expect(Math.abs(after.card! - before.card!)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.chips! - before.chips!)).toBeLessThanOrEqual(0.5);
  });
}
