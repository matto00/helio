import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";

// HEL-1260 — the owner of a dashboard holding a panel with NO stored layout item (an orphan, which
// the API itself can no longer produce, so it is made by clearing the stored layout) triggers exactly
// one repair POST on open; afterwards the panel has a stored item in every breakpoint, the position
// is unchanged by a reload, and the dirty indicator never appears. Run in both themes. Seeds its own
// user/dashboard through the API and deletes the dashboard by exact id.

const CSRF = { "X-Helio-Requested-With": "1" };
const BREAKPOINTS = ["lg", "md", "sm", "xs"] as const;

const AUTH = { prefix: "hel1260", displayName: "HEL-1260", logEmail: false } as const;

async function storedLayout(request: APIRequestContext, dashboardId: string) {
  const res = await request.get("/api/dashboards");
  const body = (await res.json()) as {
    items: { id: string; layout: Record<string, { panelId: string }[]> }[];
  };
  return body.items.find((d) => d.id === dashboardId)!.layout;
}

type Box = { x: number; y: number; width: number; height: number };
const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

/**
 * HEL-1658: the grid item's box once its layout has settled. A box read at a wall-clock moment is null while the
 * HEL-1584 grid entrance has not given the item a box yet (a slow runner); wait on the state itself: non-null and
 * unchanged across two reads one animation frame apart.
 */
async function settledGridItemBox(page: Page): Promise<Box> {
  const item = page.locator(".react-grid-item").first();
  let previous: Box | null = null;
  await expect
    .poll(
      async () => {
        const box = await item.boundingBox();
        const settled = box !== null && previous !== null && sameBox(previous, box);
        previous = box;
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
        return settled;
      },
      { message: "the grid item has a settled layout box" },
    )
    .toBe(true);
  return previous!;
}

for (const theme of ["light", "dark"] as const) {
  test(`owner open of an orphaned text panel sends one repair POST and stores every breakpoint (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    // Attached before login so the whole page lifetime is counted: "exactly one repair POST" holds
    // over the test, wherever the page sends it from. The dashboard id is unknown yet, so record
    // the url and assert it once seeded.
    const repairPosts: { url: string; body: string }[] = [];
    const layoutPatches: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/dashboards\/[^/]+\/layout\/repair$/.test(r.url()))
        repairPosts.push({ url: r.url(), body: r.postData() ?? "" });
      if (r.method() === "PATCH" && r.url().includes("/api/dashboards/"))
        layoutPatches.push(r.url());
    });
    const { email } = await registerAndLogin(page, request, AUTH);
    console.log(`[HEL-1260 e2e] throwaway user: ${email}`);
    // After login the page is live on `/home`, whose mount fetches race the API seeding below and can
    // observe the orphan and repair it there. Idle the page so the explicit open is the only app load.
    await page.goto("about:blank");

    const dash = await request.post("/api/dashboards", {
      data: { name: `HEL-1260 orphan ${theme}` },
      headers: CSRF,
    });
    expect(dash.status()).toBe(201);
    const dashboardId = ((await dash.json()) as { id: string }).id;
    try {
      const panel = await request.post("/api/panels", {
        data: { dashboardId, title: "HEL-1260 Text", type: "text", config: { content: "orphan" } },
        headers: CSRF,
      });
      expect(panel.status()).toBe(201);
      const panelId = ((await panel.json()) as { id: string }).id;
      // A create now stores an item, so clear it to recreate the pre-fix orphan.
      const clear = await request.patch(`/api/dashboards/${dashboardId}/update`, {
        data: { fields: ["layout"], dashboard: { layout: { lg: [], md: [], sm: [], xs: [] } } },
        headers: CSRF,
      });
      expect(clear.status()).toBe(200);
      const before = await storedLayout(request, dashboardId);
      for (const bp of BREAKPOINTS) expect(before[bp]).toHaveLength(0);

      expect(repairPosts).toHaveLength(0);
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
      await expect.poll(() => repairPosts.length, { timeout: 15_000 }).toBe(1);
      const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(repairPosts[0].url).toMatch(
        new RegExp(`/api/dashboards/${escapeRe(dashboardId)}/layout/repair$`),
      );
      const sent = JSON.parse(repairPosts[0].body) as Record<string, { panelId: string }[]>;
      expect(Object.keys(sent).sort()).toEqual([...BREAKPOINTS].sort());

      await expect
        .poll(async () => {
          const layout = await storedLayout(request, dashboardId);
          return BREAKPOINTS.every((bp) => layout[bp].some((i) => i.panelId === panelId));
        })
        .toBe(true);
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);
      const rectBefore = await settledGridItemBox(page);

      await page.reload();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
      const rectAfter = await settledGridItemBox(page);
      expect(Math.abs(rectAfter.x - rectBefore.x)).toBeLessThan(2);
      expect(Math.abs(rectAfter.y - rectBefore.y)).toBeLessThan(2);
      expect(Math.abs(rectAfter.width - rectBefore.width)).toBeLessThan(2);
      expect(repairPosts).toHaveLength(1);
      expect(layoutPatches).toHaveLength(0);
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);
    } finally {
      await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`creating a text panel through the UI stores an item in every breakpoint and the position survives a reload (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1920, height: 1200 });
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    const repairPosts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/layout/repair")) repairPosts.push(r.url());
    });
    const { email } = await registerAndLogin(page, request, AUTH);
    console.log(`[HEL-1260 e2e] throwaway user: ${email}`);
    // Idle the page so no app code runs while the dashboard is seeded (see the orphan test).
    await page.goto("about:blank");

    const dash = await request.post("/api/dashboards", {
      data: { name: `HEL-1260 ui create ${theme}` },
      headers: CSRF,
    });
    expect(dash.status()).toBe(201);
    const dashboardId = ((await dash.json()) as { id: string }).id;
    try {
      await page.goto(`/dashboards/${dashboardId}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      // HEL-1576: Add panel is the dashboard meta row's primary button now, not a kebab item.
      await page
        .getByRole("group", { name: "Dashboard actions" })
        .getByRole("button", { name: "Add panel" })
        .click();
      await page.getByRole("option", { name: "Add Text panel" }).click();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });

      const layout = await storedLayout(request, dashboardId);
      for (const bp of BREAKPOINTS) expect(layout[bp], `${theme} ${bp}`).toHaveLength(1);
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);
      const rectBefore = await settledGridItemBox(page);

      await page.reload();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
      const rectAfter = await settledGridItemBox(page);
      expect(Math.abs(rectAfter.x - rectBefore.x)).toBeLessThan(2);
      expect(Math.abs(rectAfter.y - rectBefore.y)).toBeLessThan(2);
      expect(Math.abs(rectAfter.width - rectBefore.width)).toBeLessThan(2);
      expect(Math.abs(rectAfter.height - rectBefore.height)).toBeLessThan(2);
      expect(await storedLayout(request, dashboardId)).toEqual(layout);
      expect(repairPosts).toHaveLength(0);
    } finally {
      await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    }
  });
}
