import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// HEL-1003 — regression guard for programmatic-focus-restore onto the resting
// dashboard-row ActionsMenu trigger, desktop width only (defect (a); see
// design.md). The discriminating assertion is PROGRAMMATIC FOCUS
// (`document.activeElement` after `.focus()` on the resting trigger), never
// tab-reachability (green both before and after the fix — see design.md D4)
// and never element-presence (`toBeVisible`/`toHaveCount`/etc. — jsdom cannot
// falsify a focus assertion at all; see design.md D0a). Fresh spec — the
// three scratch premise-probes from earlier rounds are deleted and must not
// be revived.

const CSRF_HEADER = "X-Helio-Requested-With";

function uniqueEmail(label: string): string {
  return `hel1003-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.test`;
}

async function registerAndLogin(page: Page, request: APIRequestContext, label: string) {
  const email = uniqueEmail(label);
  const password = "correcthorsebattery1";
  await request.post("/api/auth/register", {
    data: { email, password, displayName: `HEL-1003 ${label}` },
    headers: { [CSRF_HEADER]: "1" },
  });
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

async function createDashboard(page: Page, name: string) {
  await page.getByRole("button", { name: "Add dashboard" }).click();
  await page.getByLabel("Dashboard name").fill(name);
  await page.getByRole("button", { name: "Create dashboard" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
}

test.describe("HEL-1003 dashboard-row ActionsMenu keyboard reachability (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("negative control: probe reports not-found against a name with no rendered row", async ({
    page,
    request,
  }) => {
    // D0d — before trusting the probe against a real row, confirm it can
    // report the negative result against a row that does not exist.
    await registerAndLogin(page, request, "negctrl");
    const missingTrigger = page.locator(
      'button[aria-label="Definitely Not A Real Dashboard actions"]',
    );
    await expect(missingTrigger).toHaveCount(0);
  });

  test("resting trigger is a real focus target: .focus() lands on the trigger, not <body>", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "focus");
    const dashboardName = `HEL-1003 Focus ${Date.now()}`;
    await createDashboard(page, dashboardName);

    const trigger = page.locator(`button[aria-label="${dashboardName} actions"]`);
    // D0c instance 2 — assert the marked element is actually rendered before
    // acting on it. This is a real assertion, not `... || true`.
    await expect(trigger).toHaveCount(1);

    // Ensure resting state: move focus/mouse away from the row entirely so
    // neither :hover nor :focus-within is active on it.
    await page.mouse.move(5, 5);
    await page.locator("body").click({ position: { x: 5, y: 5 } });

    const activeElementInfo = await trigger.evaluate((el) => {
      (el as HTMLButtonElement).focus();
      const active = document.activeElement;
      return {
        isTrigger: active === el,
        isBody: active === document.body,
        tag: active?.tagName ?? null,
        className: active instanceof HTMLElement ? active.className : null,
      };
    });

    // Discriminating assertion: programmatic focus must land on the trigger,
    // not fall through to <body> (design.md D4 sentinel).
    expect(activeElementInfo, JSON.stringify(activeElementInfo)).toMatchObject({
      isTrigger: true,
      isBody: false,
    });
  });

  test("resting geometry unchanged and reveal paints correctly (position/clip/size/reflow)", async ({
    page,
    request,
  }) => {
    await registerAndLogin(page, request, "geometry");
    const dashboardName = `HEL-1003 Geometry ${Date.now()}`;
    await createDashboard(page, dashboardName);

    const row = page.locator(".dashboard-list__item-row", { hasText: dashboardName });
    const rowButton = row.locator(".dashboard-list__button");
    const wrapper = row.locator(".popover.actions-menu");
    const trigger = page.locator(`button[aria-label="${dashboardName} actions"]`);

    await page.mouse.move(5, 5);

    // Resting: row button ~215px, unaffected by the hidden trigger.
    const restingWidth = await rowButton.evaluate((el) => el.getBoundingClientRect().width);
    expect(Math.round(restingWidth)).toBeGreaterThanOrEqual(210);
    expect(Math.round(restingWidth)).toBeLessThanOrEqual(220);

    // Reveal via hover.
    await row.hover();
    const wrapperHandle = await wrapper.elementHandle();
    const triggerHandle = await trigger.elementHandle();
    const rowButtonHandle = await rowButton.elementHandle();
    if (!wrapperHandle || !triggerHandle || !rowButtonHandle) {
      throw new Error("expected wrapper/trigger/row-button to be present on reveal");
    }
    const revealed = await page.evaluate(
      ({ wrapperEl, triggerEl, rowButtonEl }) => {
        const wrapperStyle = getComputedStyle(wrapperEl as Element);
        const triggerRect = (triggerEl as Element).getBoundingClientRect();
        const wrapperRect = (wrapperEl as Element).getBoundingClientRect();
        return {
          position: wrapperStyle.position,
          clip: wrapperStyle.clip,
          wrapperHeight: wrapperRect.height,
          triggerWidth: triggerRect.width,
          triggerHeight: triggerRect.height,
          rowButtonWidth: (rowButtonEl as Element).getBoundingClientRect().width,
        };
      },
      { wrapperEl: wrapperHandle, triggerEl: triggerHandle, rowButtonEl: rowButtonHandle },
    );

    expect(revealed.position).toBe("relative");
    expect(revealed.clip).toBe("auto");
    expect(revealed.wrapperHeight).toBeGreaterThan(1);
    expect(Math.round(revealed.triggerWidth)).toBe(24);
    expect(Math.round(revealed.triggerHeight)).toBe(24);
    expect(Math.round(revealed.rowButtonWidth)).toBeGreaterThanOrEqual(183);
    expect(Math.round(revealed.rowButtonWidth)).toBeLessThanOrEqual(191);
  });

  test("keyboard: Tab reaches trigger, Enter opens menu, Escape restores focus (no-regression, not the red-arm proof)", async ({
    page,
    request,
  }) => {
    // Non-discriminating tab-walk retained as a no-regression check only —
    // measured (not merely asserted) to be green both before and after the
    // fix (see the red/green-arm record in files-modified.md), because
    // `:focus-within` (`DashboardList.css:244`) already reveals the wrapper
    // once the row button ahead of it in tab order has focus. Must never be
    // treated as proof of the defect fix — that is test 2's job, via the
    // programmatic-focus sentinel. This test drives real `Tab` keypresses
    // (not `.focus()`) so it actually exercises AC 2's Tab/arrow-key path,
    // rather than duplicating test 2's axis under a different name.
    await registerAndLogin(page, request, "keyboard");
    const dashboardName = `HEL-1003 Keyboard ${Date.now()}`;
    await createDashboard(page, dashboardName);

    const trigger = page.locator(`button[aria-label="${dashboardName} actions"]`);
    await expect(trigger).toHaveCount(1);

    // Start from a known point (the filter input) and press real Tabs until
    // the trigger is reached or a bound is hit — bounded, not hardcoded to a
    // specific index, so it isn't brittle to unrelated tab-order changes
    // elsewhere on the page.
    await page.getByLabel("Filter dashboards by name").focus();
    const maxTabs = 40;
    let reached = false;
    for (let i = 0; i < maxTabs; i += 1) {
      await page.keyboard.press("Tab");
      reached = await trigger.evaluate((el) => document.activeElement === el);
      if (reached) break;
    }
    expect(reached, `trigger not reached by Tab within ${maxTabs} presses`).toBe(true);
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Rename" })).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
});
