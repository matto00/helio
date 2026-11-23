import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { registerUser } from "./support/auth";
import { LIVE_GRID_ITEMS } from "./support/panelGridReady";

// HEL-1618 -- on the desktop grid a form panel cannot be placed or resized below 5 rows (a compact counter keeps 4); a
// SAVED sub-5 form is never bumped on load; when a resize ends below 5 rows it lifts to 5 only if the space directly below
// is free ("lift-when-free"), as ONE persisted write. Measured from rendered boxes; 1280 px wide is the `sm` breakpoint
// (the grid container is 928 px, 6 columns), so layouts are seeded for sm. The row height is read from computed style.
// Row heights at the Comfortable density: h rows are h * 52 + (h - 1) * 12 px.

const CSRF = { "X-Helio-Requested-With": "1" };
const RUN = Date.now();
const rowsPx = (h: number) => h * 52 + (h - 1) * 12;

interface Item {
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const item = (panelId: string, x: number, y: number, w: number, h: number): Item => ({
  panelId,
  x,
  y,
  w,
  h,
});

let context: BrowserContext;
let api: APIRequestContext;
let noteSourceId: string;
let counterSourceId: string;

async function post<T>(url: string, data: unknown): Promise<T> {
  const res = await api.post(url, { data, headers: CSRF });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

const twoFields = [
  { sourceField: "note", control: "text", label: "Note" },
  { sourceField: "qty", control: "number", label: "Quantity" },
];
const counterField = [{ sourceField: "delta", control: "counter", label: "Widgets", step: 5 }];

async function dashboardWith(
  specs: {
    title: string;
    kind: "form" | "text";
    counter?: boolean;
    at: [number, number, number, number];
  }[],
): Promise<{ id: string; ids: Record<string, string> }> {
  const dash = await post<{ id: string }>("/api/dashboards", {
    name: `HEL1618 ${RUN} ${Math.random()}`,
  });
  const ids: Record<string, string> = {};
  for (const s of specs) {
    const body =
      s.kind === "text"
        ? { dashboardId: dash.id, title: s.title, type: "text", config: { content: s.title } }
        : {
            dashboardId: dash.id,
            title: s.title,
            type: "form",
            config: {
              dataSourceId: s.counter ? counterSourceId : noteSourceId,
              fields: s.counter ? counterField : twoFields,
              submit: s.counter
                ? { writeMode: "append", resetOnSuccess: false }
                : { writeMode: "append" },
            },
          };
    ids[s.title] = (await post<{ id: string }>("/api/panels", body)).id;
  }
  const items = specs.map((s) => item(ids[s.title], ...s.at));
  const res = await api.patch(`/api/dashboards/${dash.id}/update`, {
    data: { fields: ["layout"], dashboard: { layout: { lg: items, sm: items } } },
    headers: CSRF,
  });
  expect(res.status(), await res.text()).toBe(200);
  return { id: dash.id, ids };
}

async function open(page: Page, id: string, count: number): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.goto(`/dashboards/${id}`);
  await expect(page.locator(LIVE_GRID_ITEMS)).toHaveCount(count, { timeout: 20_000 });
  await expect(page.getByLabel("Loading panels")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(600);
}

const card = (page: Page, title: string) =>
  page
    .locator(LIVE_GRID_ITEMS)
    .filter({ has: page.getByRole("form", { name: title }) })
    .or(page.locator(LIVE_GRID_ITEMS).filter({ hasText: title }))
    .first();

async function height(page: Page, title: string): Promise<number> {
  return Math.round((await card(page, title).boundingBox())!.height);
}
async function width(page: Page, title: string): Promise<number> {
  return Math.round((await card(page, title).boundingBox())!.width);
}

async function drag(page: Page, title: string, dx: number, dy: number): Promise<void> {
  const toggle = page.getByRole("button", { name: "Edit layout" });
  if ((await toggle.count()) > 0) await toggle.click();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
  const handle = card(page, title).locator(".react-resizable-handle").first();
  const bb = (await handle.boundingBox())!;
  const sx = bb.x + bb.width / 2;
  const sy = bb.y + bb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + dx / 2, sy + dy / 2, { steps: 6 });
  await page.mouse.move(sx + dx, sy + dy, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(700);
}

/** Records every layout PATCH of `dashboardId` made from now on. */
function recordLayoutPatches(page: Page, dashboardId: string): { sm: Item[][] } {
  const seen: { sm: Item[][] } = { sm: [] };
  page.on("request", (r) => {
    if (r.method() !== "PATCH" || !r.url().includes(`/api/dashboards/${dashboardId}`)) return;
    const body = r.postDataJSON() as { dashboard?: { layout?: { sm?: Item[] } } } | null;
    const sm = body?.dashboard?.layout?.sm;
    if (sm) seen.sm.push(sm);
  });
  return seen;
}

test.describe("HEL-1618 form minimum rows", () => {
  test.setTimeout(120_000);

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      baseURL: `http://localhost:${process.env.DEV_PORT ?? "5173"}`,
    });
    api = context.request;
    await registerUser(api, { prefix: "hel1618", label: "rows", displayName: "HEL1618" });
    noteSourceId = (
      await post<{ id: string }>("/api/data-sources", {
        name: `HEL1618 notes ${RUN}`,
        type: "static",
        columns: [
          { name: "note", type: "string", required: true },
          { name: "qty", type: "integer" },
        ],
        rows: [],
      })
    ).id;
    counterSourceId = (
      await post<{ id: string }>("/api/data-sources", {
        name: `HEL1618 counts ${RUN}`,
        type: "static",
        columns: [
          { name: "occurred_at", type: "timestamp" },
          { name: "delta", type: "integer", required: true },
          { name: "value", type: "integer" },
        ],
        rows: [],
      })
    ).id;
  });

  test.afterAll(async () => {
    await api.delete(`/api/data-sources/${noteSourceId}`, { headers: CSRF });
    await api.delete(`/api/data-sources/${counterSourceId}`, { headers: CSRF });
    await context.close();
  });

  test("a multi-field form stops at 5 rows; a compact counter still reaches 4", async () => {
    const page = await context.newPage();
    const { id } = await dashboardWith([
      { title: "Multi", kind: "form", at: [0, 0, 3, 7] },
      { title: "Counter", kind: "form", counter: true, at: [3, 0, 3, 7] },
    ]);
    await open(page, id, 2);
    await drag(page, "Multi", 0, -500);
    expect(await height(page, "Multi")).toBe(rowsPx(5));
    await drag(page, "Counter", 0, -500);
    expect(await height(page, "Counter")).toBe(rowsPx(4));
    await page.close();
  });

  test("GUARD: a saved 4-row form is not bumped on load and nothing is saved", async () => {
    const page = await context.newPage();
    const { id } = await dashboardWith([{ title: "Saved", kind: "form", at: [0, 0, 3, 4] }]);
    const patches = recordLayoutPatches(page, id);
    await open(page, id, 1);
    expect(await height(page, "Saved")).toBe(rowsPx(4));
    await page.waitForTimeout(2500);
    expect(await height(page, "Saved")).toBe(rowsPx(4));
    expect(patches.sm).toEqual([]);
    await expect(page.getByRole("button", { name: "Save now" })).toHaveCount(0);
    await page.close();
  });

  test("a saved 4-row form with free space below grows to 5 on a width resize, persisted once", async () => {
    const page = await context.newPage();
    const { id, ids } = await dashboardWith([{ title: "Lift", kind: "form", at: [0, 0, 3, 4] }]);
    await open(page, id, 1);
    const patches = recordLayoutPatches(page, id);
    const w0 = await width(page, "Lift");
    await drag(page, "Lift", 160, 0);
    expect(await width(page, "Lift")).toBeGreaterThan(w0 + 100);
    expect(await height(page, "Lift")).toBe(rowsPx(5));
    await page.getByRole("button", { name: "Save now" }).click();
    await expect.poll(() => patches.sm.length).toBe(1);
    expect(patches.sm[0].find((i) => i.panelId === ids.Lift)).toMatchObject({ w: 4, h: 5 });
    await page.waitForTimeout(1200);
    expect(await height(page, "Lift")).toBe(rowsPx(5));
    await expect(page.getByRole("button", { name: "Save now" })).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(patches.sm.length).toBe(1);
    await page.reload();
    await expect(page.locator(LIVE_GRID_ITEMS)).toHaveCount(1, { timeout: 20_000 });
    await page.waitForTimeout(800);
    expect(await height(page, "Lift")).toBe(rowsPx(5));
    await page.close();
  });

  test("a saved 4-row form with a panel directly below stays 4 rows; the neighbour does not move", async () => {
    const page = await context.newPage();
    const { id, ids } = await dashboardWith([
      { title: "Blocked", kind: "form", at: [0, 0, 3, 4] },
      { title: "Neighbour", kind: "text", at: [0, 4, 3, 5] },
    ]);
    await open(page, id, 2);
    const patches = recordLayoutPatches(page, id);
    const w0 = await width(page, "Blocked");
    await drag(page, "Blocked", 160, 0);
    expect(await width(page, "Blocked")).toBeGreaterThan(w0 + 100);
    expect(await height(page, "Blocked")).toBe(rowsPx(4));
    await page.getByRole("button", { name: "Save now" }).click();
    await expect.poll(() => patches.sm.length).toBe(1);
    const sm = patches.sm[0];
    expect(sm.find((i) => i.panelId === ids.Blocked)).toMatchObject({ w: 4, h: 4 });
    expect(sm.find((i) => i.panelId === ids.Neighbour)).toEqual(item(ids.Neighbour, 0, 4, 3, 5));
    await page.close();
  });
});
