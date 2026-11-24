import { expect, test, type APIRequestContext } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { LIVE_GRID_ITEMS, waitForPanelGrid } from "./support/panelGridReady";

// HEL-1835: a full page load of a dashboard whose stored `md` layout is empty (derived at render) and whose `sm`
// layout is authored logged "Maximum update depth exceeded" 3-4 times. The loop was the loading SKELETON's grid:
// the skeleton `Responsive` was drawn once at the pre-measure width (1280, `md`) with the default stub layout, then
// in ONE render at the measured width (`sm`) with the dashboard's stub layout, and react-grid-layout 2.2.4 does
// not settle on a breakpoint + layouts change in one render (the HEL-1575 shape). The skeleton grid is now keyed
// by the active breakpoint as well as the dashboard. The load must also write nothing: no layout PATCH.

const CSRF = { "X-Helio-Requested-With": "1" };
const COLS = { lg: 12, md: 10, sm: 6 } as const;
const GRID_MARGIN = 12;
const ROW_HEIGHT = 52;

interface Item {
  panelId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
const it = (panelId: string, x: number, y: number, w: number, h: number): Item => ({
  panelId,
  x,
  y,
  w,
  h,
});

// Nine text panels; `sm` leaves column gaps (x=3, w=2); `md` and `xs` are empty, so they are derived at render.
function layoutFor(ids: string[]) {
  const sm = [
    it(ids[0], 0, 0, 3, 4),
    it(ids[1], 3, 0, 2, 4),
    it(ids[2], 0, 4, 3, 4),
    it(ids[3], 3, 4, 2, 4),
    it(ids[4], 0, 8, 6, 4),
    it(ids[5], 0, 12, 3, 4),
    it(ids[6], 3, 12, 2, 4),
    it(ids[7], 0, 16, 3, 4),
    it(ids[8], 3, 16, 2, 4),
  ];
  const lg = ids.map((id, i) => it(id, (i % 3) * 4, Math.floor(i / 3) * 4, 4, 4));
  return { lg, md: [], sm, xs: [] };
}

async function seed(request: APIRequestContext) {
  const dash = await request.post("/api/dashboards", { data: { name: "HEL-1835" }, headers: CSRF });
  expect(dash.status()).toBe(201);
  const dashboardId = ((await dash.json()) as { id: string }).id;
  const ids: string[] = [];
  for (let i = 0; i < 9; i++) {
    const panel = await request.post("/api/panels", {
      data: { dashboardId, title: `T${i}`, type: "text", config: { content: `t${i}` } },
      headers: CSRF,
    });
    expect(panel.status()).toBe(201);
    ids.push(((await panel.json()) as { id: string }).id);
  }
  const layout = layoutFor(ids);
  const patch = await request.patch(`/api/dashboards/${dashboardId}/update`, {
    data: { fields: ["layout"], dashboard: { layout } },
    headers: CSRF,
  });
  expect(patch.status()).toBe(200);
  return { dashboardId, layout };
}

// Window width -> grid container width: the rail, the default-width context list and page padding take 352px.
const windows = [
  { name: "sm", width: 1280, bp: "sm" },
  { name: "md", width: 1500, bp: "md" },
  { name: "lg", width: 1900, bp: "lg" },
] as const;

for (const win of windows) {
  test(`a full load at ${win.name} runs no update-depth loop and writes no layout`, async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: win.width, height: 1000 });
    await registerAndLogin(page, request, {
      prefix: "hel1835",
      displayName: "HEL-1835",
      logEmail: false,
    });
    await page.goto("about:blank");
    const { dashboardId, layout } = await seed(request);
    try {
      const layoutWrites: string[] = [];
      page.on("request", (req) => {
        if (
          req.method() === "PATCH" &&
          /\/api\/dashboards\/[^/?]+(\/update)?(\?|$)/.test(req.url())
        ) {
          layoutWrites.push(req.url());
        }
      });
      errors.length = 0;
      await page.goto(`/dashboards/${dashboardId}`);
      await waitForPanelGrid(page, 9);
      // Long enough for the skeleton/real swap and every layout write the load could stage, well short of the
      // 30 s auto-save.
      await page.waitForTimeout(3000);
      expect(errors.filter((text) => text.includes("Maximum update depth"))).toEqual([]);
      expect(layoutWrites).toEqual([]);

      if (win.bp === "sm") {
        const geometry = await page.evaluate(
          ({ itemSel }) => {
            const grid = document.querySelector(".panel-grid")!.getBoundingClientRect();
            return {
              grid: { x: grid.left, y: grid.top, w: grid.width },
              items: [...document.querySelectorAll(itemSel)].map((el) => {
                const b = el.getBoundingClientRect();
                return {
                  title: el.querySelector(".panel-grid-card__title")?.textContent?.trim() ?? "",
                  x: b.left,
                  y: b.top,
                  w: b.width,
                  h: b.height,
                };
              }),
            };
          },
          { itemSel: LIVE_GRID_ITEMS },
        );
        const colW = (geometry.grid.w - GRID_MARGIN * (COLS.sm - 1)) / COLS.sm;
        layout.sm.forEach((item, index) => {
          const rendered = geometry.items.find((i) => i.title === `T${index}`);
          expect(rendered, `T${index} rendered`).toBeDefined();
          expect(rendered!.x - geometry.grid.x).toBeCloseTo(item.x * (colW + GRID_MARGIN), 0);
          expect(rendered!.y - geometry.grid.y).toBeCloseTo(item.y * (ROW_HEIGHT + GRID_MARGIN), 0);
          expect(rendered!.w).toBeCloseTo(item.w * colW + (item.w - 1) * GRID_MARGIN, 0);
          expect(rendered!.h).toBeCloseTo(item.h * ROW_HEIGHT + (item.h - 1) * GRID_MARGIN, 0);
        });
      }
    } finally {
      await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    }
  });
}
