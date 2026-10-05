import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1260 — the owner of a dashboard holding a panel with NO stored layout item (an orphan, which
// the API itself can no longer produce, so it is made by clearing the stored layout) triggers exactly
// one repair POST on open; afterwards the panel has a stored item in every breakpoint, the position
// is unchanged by a reload, and the dirty indicator never appears. Run in both themes. Seeds its own
// user/dashboard through the API and deletes the dashboard by exact id.

const CSRF = { "X-Helio-Requested-With": "1" };
const BREAKPOINTS = ["lg", "md", "sm", "xs"] as const;

async function registerAndLogin(page: Page, request: APIRequestContext) {
  const email = `hel1260-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
  const password = "correcthorsebattery1";
  const res = await request.post("/api/auth/register", {
    data: { email, password, displayName: "HEL-1260" },
    headers: CSRF,
  });
  expect(res.status()).toBe(201);
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
  return email;
}

async function storedLayout(request: APIRequestContext, dashboardId: string) {
  const res = await request.get("/api/dashboards");
  const body = (await res.json()) as {
    items: { id: string; layout: Record<string, { panelId: string }[]> }[];
  };
  return body.items.find((d) => d.id === dashboardId)!.layout;
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
    const email = await registerAndLogin(page, request);
    console.log(`[HEL-1260 e2e] throwaway user: ${email}`);
    // After login the page is live on `/`, whose mount fetches race the API seeding below and can
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
      expect(repairPosts[0].url.endsWith(`/api/dashboards/${dashboardId}/layout/repair`)).toBe(
        true,
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
      const rectBefore = await page.locator(".react-grid-item").first().boundingBox();

      await page.reload();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
      await page.waitForTimeout(500);
      const rectAfter = await page.locator(".react-grid-item").first().boundingBox();
      expect(Math.abs(rectAfter!.x - rectBefore!.x)).toBeLessThan(2);
      expect(Math.abs(rectAfter!.y - rectBefore!.y)).toBeLessThan(2);
      expect(Math.abs(rectAfter!.width - rectBefore!.width)).toBeLessThan(2);
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
    const email = await registerAndLogin(page, request);
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
      await page.getByRole("button", { name: "Dashboard actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Add panel" }).click();
      await page.getByRole("option", { name: "Add Text panel" }).click();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });

      const layout = await storedLayout(request, dashboardId);
      for (const bp of BREAKPOINTS) expect(layout[bp], `${theme} ${bp}`).toHaveLength(1);
      await expect(page.getByText("Unsaved changes")).toHaveCount(0);
      await page.waitForTimeout(500);
      const rectBefore = await page.locator(".react-grid-item").first().boundingBox();

      await page.reload();
      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
      await page.waitForTimeout(500);
      const rectAfter = await page.locator(".react-grid-item").first().boundingBox();
      expect(Math.abs(rectAfter!.x - rectBefore!.x)).toBeLessThan(2);
      expect(Math.abs(rectAfter!.y - rectBefore!.y)).toBeLessThan(2);
      expect(Math.abs(rectAfter!.width - rectBefore!.width)).toBeLessThan(2);
      expect(Math.abs(rectAfter!.height - rectBefore!.height)).toBeLessThan(2);
      expect(await storedLayout(request, dashboardId)).toEqual(layout);
      expect(repairPosts).toHaveLength(0);
    } finally {
      await request.delete(`/api/dashboards/${dashboardId}`, { headers: CSRF });
    }
  });
}
