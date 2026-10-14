import { expect, test, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";

// Every test registers its own user and seeds its own data, so tests are independently schedulable.
test.describe.configure({ mode: "parallel" });

// HEL-1574 -- live verification of the icon rail and the resizable, collapsible context list. jsdom evaluates
// no media queries or layout, so the breakpoint boundary (768 is a phone, 769 is the rail shell), the persisted
// width and the phone tab tiling can only be observed in a real browser.

const AUTH = { prefix: "hel1574", displayName: "HEL-1574", domain: "example.com" } as const;
const CSRF_HEADER = "X-Helio-Requested-With";

async function shellRenders(page: Page) {
  return {
    rail: await page.locator(".app-rail").count(),
    list: await page.locator(".context-list").count(),
    bottomNav: await page.locator(".bottom-nav").isVisible(),
  };
}

test.describe("HEL-1574 shell rail and context list", () => {
  for (const width of [769, 820, 1280]) {
    test(`renders the rail and the dashboards list at ${width}px, and no bottom nav`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await registerAndLogin(page, request, { ...AUTH, label: `rail${width}`, waitForShell: true });
      const rail = page.getByRole("navigation", { name: "Main navigation" });
      await expect(rail).toBeVisible();
      for (const name of [
        "Home",
        "Dashboards",
        "Data Sources",
        "Data Pipelines",
        "Connectors",
        "Assistant",
      ]) {
        await expect(rail.getByRole("link", { name })).toBeVisible();
      }
      expect((await page.locator(".app-rail").boundingBox())?.width).toBe(56);
      expect(await shellRenders(page)).toEqual({ rail: 1, list: 1, bottomNav: false });
      await expect(rail.getByRole("link", { name: "Dashboards" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(rail.getByRole("link", { name: "Home" })).not.toHaveAttribute(
        "aria-current",
        "page",
      );
    });
  }

  test("exactly 768px is the phone shell: no rail, no context list, the glass bottom nav with Home first", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "phone768" });
    await expect(page.locator(".bottom-nav")).toBeVisible();
    expect(await shellRenders(page)).toEqual({ rail: 0, list: 0, bottomNav: true });
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link").first(),
    ).toHaveAttribute("aria-label", "Home");
    await expect(page.getByRole("button", { name: "User menu" })).toHaveCount(1);
  });

  test("at 375px the bottom nav tabs are each at least 44px wide and do not overlap", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "tabs375" });
    const tabs = page.locator(".bottom-nav__tab");
    await expect(tabs).toHaveCount(6); // a non-owner: Home + the five sections
    const boxes = await tabs.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width };
      }),
    );
    for (const box of boxes) expect(box.width).toBeGreaterThanOrEqual(44);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.left).toBeGreaterThanOrEqual(boxes[i - 1]!.right - 0.5);
    }
    // An owner adds a seventh tab (Usage). Owners cannot be registered here, so prove the same tiling
    // arithmetic from the measured bar: seven 44px tabs must fit the usable width.
    const usable = await page.locator(".bottom-nav").evaluate((el) => {
      const style = getComputedStyle(el);
      return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(usable).toBeGreaterThanOrEqual(7 * 44);
  });

  test("resizes from the keyboard within 200..400 and the width survives a reload", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "resize", waitForShell: true });
    const separator = page.getByRole("separator", { name: "Resize dashboard list" });
    await expect(separator).toHaveAttribute("aria-valuenow", "248");
    await separator.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", "312");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", "400");
    await page.keyboard.press("Home");
    await expect(separator).toHaveAttribute("aria-valuenow", "200");
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/users/me/preferences") && r.request().method() === "PATCH",
    );
    await page.keyboard.press("Shift+ArrowRight");
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("separator", { name: "Resize dashboard list" })).toHaveAttribute(
      "aria-valuenow",
      "264",
    );
    expect((await page.locator(".context-list").boundingBox())?.width).toBeCloseTo(264, 0);
  });

  test("a pointer drag clamps at the maximum and issues one preference write", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "drag", waitForShell: true });
    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/users/me/preferences")) writes.push(r.method());
    });
    const box = (await page
      .getByRole("separator", { name: "Resize dashboard list" })
      .boundingBox())!;
    const y = box.y + 200;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let x = 300; x <= 900; x += 60) await page.mouse.move(x, y);
    await page.mouse.up();
    await expect(page.getByRole("separator", { name: "Resize dashboard list" })).toHaveAttribute(
      "aria-valuenow",
      "400",
    );
    await page.waitForTimeout(600);
    expect(writes).toEqual(["PATCH"]);
  });

  test("collapses to rail-only, keeps every section one click away, and stays collapsed after a reload", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "collapse", waitForShell: true });
    // Register the response wait BEFORE the click: on a fast runner the PATCH can finish before a wait registered
    // after it, which then times out (the CI failure on 0cd7d5e69).
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/users/me/preferences") && r.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Collapse list" }).click();
    await expect(page.locator(".context-list")).toHaveCount(0);
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand list" })).toBeVisible();
    await expect(page.locator(".context-list")).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Data Pipelines" })
      .click();
    await expect(page).toHaveURL(/\/pipelines$/);
    await page.getByRole("button", { name: "Expand list" }).click();
    await expect(page.getByRole("complementary", { name: "Data Pipelines list" })).toBeVisible();
  });

  test("creates a folder, files a dashboard in it, and both survive a reload", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "folders", isolate: true });
    const created = await page.request.post("/api/dashboards", {
      data: { name: "HEL-1574 Markets" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(created.status()).toBe(201);
    await page.goto("/home");
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByRole("textbox", { name: "Folder name" }).fill("Daily");
    await page.getByRole("button", { name: "Create folder" }).click();
    await expect(page.getByRole("region", { name: "Folder Daily" })).toBeVisible();
    await page.getByRole("button", { name: "HEL-1574 Markets actions" }).click();
    await page.getByRole("menuitem", { name: "Move to…" }).click();
    await page
      .getByRole("group", { name: "Move to" })
      .getByRole("button", { name: "Daily" })
      .click();
    const folder = page.getByRole("region", { name: "Folder Daily" });
    await expect(
      folder.getByRole("button", { name: "HEL-1574 Markets", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page
        .getByRole("region", { name: "Folder Daily" })
        .getByRole("button", { name: "HEL-1574 Markets", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Daily 1" })).toBeVisible();
  });

  test("the Pipelines list is a compact Recent and Scheduled list, not a copy of the table", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "pipelines", waitForShell: true });
    await page.goto("/pipelines");
    const list = page.getByRole("complementary", { name: "Data Pipelines list" });
    await expect(list.getByRole("region", { name: "Recent" })).toBeVisible();
    await expect(list.getByRole("region", { name: "Scheduled" })).toBeVisible();
    await expect(list.getByRole("link", { name: "View all pipelines" })).toBeVisible();
  });

  test("the folder holding the open dashboard can be collapsed, and the saved state survives a reload", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await registerAndLogin(page, request, { ...AUTH, label: "activefolder", isolate: true });
    const created = await page.request.post("/api/dashboards", {
      data: { name: "HEL-1574 Active" },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(created.status()).toBe(201);
    const dashboardId = ((await created.json()) as { id: string }).id;
    const folder = await page.request.post("/api/dashboard-folders", {
      data: { name: "Holder" },
      headers: { [CSRF_HEADER]: "1" },
    });
    const folderId = ((await folder.json()) as { id: string }).id;
    const filed = await page.request.put(`/api/dashboards/${dashboardId}/folder`, {
      data: { folderId },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(filed.status()).toBe(204);
    await page.goto("/home");
    const toggle = page.getByRole("button", { name: "Holder 1" });
    const row = page.getByRole("button", { name: "HEL-1574 Active", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(row).toHaveCount(0);
    await page.reload();
    // The saved state is collapsed; navigating into the open dashboard's folder reveals it once.
    await expect(page.getByRole("button", { name: "Holder 1" })).toBeVisible();
    await page.getByRole("button", { name: "Holder 1" }).click();
    await expect(page.getByRole("button", { name: "Holder 1" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  for (const [label, viewport] of [
    ["desktop 1280px", { width: 1280, height: 900 }],
    ["phone 375px", { width: 375, height: 800 }],
  ] as const) {
    test(`Delete is a row action on the Pipelines and Sources overviews, keyboard reachable, at ${label}`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(viewport);
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `delete${viewport.width}`,
        isolate: true,
      });
      const sourceName = `HEL-1574 Source ${viewport.width}`;
      const pipelineName = `HEL-1574 Pipeline ${viewport.width}`;
      const sourceRes = await page.request.post("/api/data-sources", {
        data: {
          name: sourceName,
          type: "static",
          columns: [{ name: "a", type: "integer" }],
          rows: [[1]],
        },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(sourceRes.status()).toBe(201);
      const source = (await sourceRes.json()) as { id: string };
      const sourceB = await page.request.post("/api/data-sources", {
        data: {
          name: `${sourceName} spare`,
          type: "static",
          columns: [{ name: "a", type: "integer" }],
          rows: [[1]],
        },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(sourceB.status()).toBe(201);
      const pipelineRes = await page.request.post("/api/pipelines", {
        data: { name: pipelineName, roots: [{ sourceId: source.id }] },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(pipelineRes.status()).toBe(201);

      // Pipelines overview.
      await page.goto("/pipelines");
      const pipelineDelete = page.getByRole("button", { name: `Delete ${pipelineName}` });
      await pipelineDelete.scrollIntoViewIfNeeded();
      await expect(pipelineDelete).toBeVisible();
      await pipelineDelete.focus();
      await page.keyboard.press("Enter");
      const group = page.getByRole("group", { name: `Confirm delete ${pipelineName}` });
      await expect(group).toBeFocused();
      await expect(group).toContainText(
        "Any panels bound to this pipeline's Outputs will stop working.",
      );
      await page.getByRole("button", { name: `Confirm delete ${pipelineName}` }).click();
      await expect(page.getByRole("button", { name: `Delete ${pipelineName}` })).toHaveCount(0);
      await expect(page).toHaveURL(/\/pipelines$/);

      // Sources overview: the source the pipeline used is free again, and the spare can go too.
      await page.goto("/sources");
      const sourceDelete = page.getByRole("button", { name: `Delete ${sourceName} spare` });
      await sourceDelete.scrollIntoViewIfNeeded();
      await expect(sourceDelete).toBeVisible();
      await sourceDelete.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: `Confirm delete ${sourceName} spare` }).click();
      await expect(page.getByRole("button", { name: `Delete ${sourceName} spare` })).toHaveCount(0);
      await expect(page).toHaveURL(/\/sources$/);
    });
  }

  for (const viewport of [
    { width: 1280, height: 700 },
    { width: 375, height: 700 },
  ]) {
    test(`row Delete confirm opens below its row: double-click, and the last row of a long list keeps the scroll, at ${viewport.width}px`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize(viewport);
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `scroll${viewport.width}`,
        isolate: true,
      });
      for (let i = 0; i < 28; i++) {
        const res = await page.request.post("/api/data-sources", {
          data: {
            name: `HEL-1574 Long ${String(i).padStart(2, "0")}`,
            type: "static",
            columns: [{ name: "a", type: "integer" }],
            rows: [[1]],
          },
          headers: { [CSRF_HEADER]: "1" },
        });
        expect(res.status()).toBe(201);
      }
      await page.goto("/sources");
      const deletes = page.getByRole("button", { name: /^Delete HEL-1574 Long/ });
      await expect(deletes).toHaveCount(28);

      // Double-click on a middle row's Delete: the confirm names that row and the row does not move.
      const middle = deletes.nth(10);
      const name = ((await middle.getAttribute("aria-label")) ?? "").replace(/^Delete /, "");
      await middle.scrollIntoViewIfNeeded();
      const before = await middle.evaluate((el) => el.closest("tr")!.getBoundingClientRect().top);
      await middle.dblclick();
      await expect(page).toHaveURL(/\/sources$/);
      await expect(page.getByRole("group", { name: `Confirm delete ${name}` })).toBeVisible();
      await expect(page.getByRole("group", { name: /Confirm delete/ })).toHaveCount(1);
      const after = await page
        .getByRole("button", { name: `Delete ${name}`, exact: true })
        .evaluate((el) => el.closest("tr")!.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThan(2);
      await page.getByRole("button", { name: "Cancel" }).click();

      // Delete the last row: the scroll position stays at the bottom instead of jumping to the top.
      const last = deletes.last();
      await last.scrollIntoViewIfNeeded();
      const lastName = ((await last.getAttribute("aria-label")) ?? "").replace(/^Delete /, "");
      const scroller = page.locator(".app-content");
      await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
      expect(scrollBefore).toBeGreaterThan(200);
      await last.click();
      await page.getByRole("button", { name: `Confirm delete ${lastName}` }).click();
      await expect(
        page.getByRole("button", { name: `Delete ${lastName}`, exact: true }),
      ).toHaveCount(0);
      await expect(deletes).toHaveCount(27);
      const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
      expect(scrollAfter).toBeGreaterThan(scrollBefore - 300);
    });
  }

  test("at 375px a confirm opened with the table scrolled to its end stays in view, and Share/Delete have a gap", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "stickyconfirm", isolate: true });
    const name = "HEL-1574 Sticky Source With A Fairly Long Name";
    const srcRes = await page.request.post("/api/data-sources", {
      data: { name, type: "static", columns: [{ name: "a", type: "integer" }], rows: [[1]] },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(srcRes.status()).toBe(201);
    const source = (await srcRes.json()) as { id: string };
    const pipelineName = "HEL-1574 Sticky Pipeline With A Fairly Long Name";
    const pipeRes = await page.request.post("/api/pipelines", {
      data: { name: pipelineName, roots: [{ sourceId: source.id }] },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(pipeRes.status()).toBe(201);

    for (const [route, itemName, scroller] of [
      ["/sources", name, ".source-list-table__scroll"],
      ["/pipelines", pipelineName, ".pipeline-list-table__scroll"],
    ] as const) {
      await page.goto(route);
      const button = page.getByRole("button", { name: `Delete ${itemName}`, exact: true });
      await expect(button).toBeVisible();
      await page.locator(scroller).evaluate((el) => (el.scrollLeft = el.scrollWidth));
      await button.click();
      const group = page.getByRole("group", { name: `Confirm delete ${itemName}` });
      await expect(group).toBeVisible();
      const [box, scrollBox, viewport] = await Promise.all([
        group.boundingBox(),
        page.locator(scroller).boundingBox(),
        page.viewportSize(),
      ]);
      expect(box!.x).toBeGreaterThanOrEqual(scrollBox!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(scrollBox!.x + scrollBox!.width + 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
      await expect(group.getByText(new RegExp(`Delete ${itemName}\\?`))).toBeInViewport();
      await expect(
        page.getByRole("button", { name: `Confirm delete ${itemName}` }),
      ).toBeInViewport();
      await page.getByRole("button", { name: "Cancel" }).click();
    }

    // Pipelines actions cell: Share and Delete are not touching.
    await page.goto("/pipelines");
    const share = await page.getByRole("button", { name: `Share ${pipelineName}` }).boundingBox();
    const del = await page
      .getByRole("button", { name: `Delete ${pipelineName}`, exact: true })
      .boundingBox();
    expect(del!.x - (share!.x + share!.width)).toBeGreaterThanOrEqual(7);
  });

  // HEL-1604: the second click of a double-click on a row's Delete must not navigate to the item. At 820px with the
  // list at 400px the table is narrow and scrolled, so the layout shifts under the first click's confirm.
  test("820px, list at 400: double-clicking the last row's Delete on Pipelines and Sources opens one confirm and stays on the page", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 820, height: 800 });
    await registerAndLogin(page, request, { ...AUTH, label: "dbl820", isolate: true });
    const patched = await page.request.patch("/api/users/me/preferences", {
      data: { contextListWidth: 400 },
      headers: { [CSRF_HEADER]: "1" },
    });
    expect(patched.status()).toBe(200);
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await page.request.post("/api/data-sources", {
        data: {
          name: `HEL-1604 Row ${String(i).padStart(2, "0")}`,
          type: "static",
          columns: [{ name: "a", type: "integer" }],
          rows: [[1]],
        },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.status()).toBe(201);
      ids.push(((await res.json()) as { id: string }).id);
    }
    for (let i = 0; i < 22; i++) {
      const res = await page.request.post("/api/pipelines", {
        data: {
          name: `HEL-1604 Pipe ${String(i).padStart(2, "0")}`,
          roots: [{ sourceId: ids[i] }],
        },
        headers: { [CSRF_HEADER]: "1" },
      });
      expect(res.status()).toBe(201);
    }
    for (const [route, scroller, prefix] of [
      ["/pipelines", ".pipeline-list-table__scroll", "HEL-1604 Pipe"],
      ["/sources", ".source-list-table__scroll", "HEL-1604 Row"],
    ] as const) {
      await page.goto(route);
      const deletes = page.getByRole("button", { name: new RegExp(`^Delete ${prefix}`) });
      await expect(deletes).toHaveCount(22);
      await page.locator(".app-content").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.locator(scroller).evaluate((el) => (el.scrollLeft = el.scrollWidth));
      const last = deletes.last();
      await last.scrollIntoViewIfNeeded();
      const name = ((await last.getAttribute("aria-label")) ?? "").replace(/^Delete /, "");
      await last.dblclick();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole("group", { name: /Confirm delete/ })).toHaveCount(1);
      await expect(page.getByRole("group", { name: `Confirm delete ${name}` })).toBeVisible();
      await page.getByRole("button", { name: "Cancel" }).click();
    }
  });
});
