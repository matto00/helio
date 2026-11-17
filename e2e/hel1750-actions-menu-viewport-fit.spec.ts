import { expect, test, type Locator, type Page } from "@playwright/test";
import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { seedPipeline } from "./support/hel1582Phone";
import { settleTransitions } from "./support/settleTransitions";

// HEL-1750 -- the shared actions menu (the three-dot trigger) opens fully reachable inside the viewport. A short
// viewport and a trigger low on the page used to put the menu's lower items below the screen edge (the portalled
// panel sat at a one-shot `trigger.bottom + 8` with no collision handling). Each case asserts that the LAST menu
// item is inside the viewport and is the element hit at its own centre, then clicks it. The throwaway user is
// recorded by registerUser and deleted by exact id (cascading its dashboards, sources, pipelines) in the run's
// global teardown.

/** A phone-width viewport short enough that a multi-item touch menu cannot open below its trigger. */
const PHONE_SHORT_HEIGHT = 300;

const AUTH = { prefix: "hel1750", displayName: "HEL-1750", waitForShell: true } as const;

/** Waits for the menu's open animation to finish, so geometry and hit-testing are measured at rest. */
async function menuSettled(page: Page): Promise<Locator> {
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
  );
  return menu;
}

/** The last item's geometry and what `elementFromPoint` returns at its centre. */
async function lastItemProbe(menu: Locator) {
  return menu.evaluate((el) => {
    const items = el.querySelectorAll<HTMLElement>('[role="menuitem"]');
    const item = items[items.length - 1];
    const r = item.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      label: item.textContent,
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
      hitIsItem: hit === item || (hit !== null && item.contains(hit)),
      panelTop: el.getBoundingClientRect().top,
      panelBottom: el.getBoundingClientRect().bottom,
    };
  });
}

function expectInsideAndHit(probe: Awaited<ReturnType<typeof lastItemProbe>>) {
  const msg = JSON.stringify(probe);
  expect(probe.top, msg).toBeGreaterThanOrEqual(0);
  expect(probe.bottom, msg).toBeLessThanOrEqual(probe.innerHeight);
  expect(probe.left, msg).toBeGreaterThanOrEqual(0);
  expect(probe.right, msg).toBeLessThanOrEqual(probe.innerWidth);
  expect(probe.hitIsItem, msg).toBe(true);
}

/** Resolves once no finite animation is running on the rail (infinite ones, e.g. a spinner, are ignored by design). */
async function railSettled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .querySelector(".dashboard-list")
              ?.getAnimations({ subtree: true })
              .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).length ?? -1,
        ),
      { message: "the dashboard list's entrance animations settle" },
    )
    .toBe(0);
}

/** Creates `count` dashboards through the API and opens the (full) rail; returns the created names. */
async function seedRail(page: Page, count: number): Promise<string[]> {
  const headers = { [CSRF_HEADER]: "1" };
  const stamp = Date.now();
  const names: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const name = `HEL-1750 Row ${String(i).padStart(2, "0")} ${stamp}`;
    const res = await page.request.post("/api/dashboards", { data: { name }, headers });
    expect(res.status()).toBe(201);
    names.push(name);
  }
  await page.goto("/dashboards");
  // Real readiness: the first and last created dashboards' own rows (list order is not creation order).
  await expect(
    page.locator(".dashboard-list__item-row", { hasText: names[count - 1] }),
  ).toHaveCount(1);
  await expect(page.locator(".dashboard-list__item-row", { hasText: names[0] })).toHaveCount(1);
  await railSettled(page);
  return names;
}

// The rail's hidden three-dot wrappers are `position: absolute` (DashboardList.css) inside a `.dashboard-list` scroller that
// was not positioned, so they escaped it and stretched the PAGE's scroll height (a phantom page scroll: 538 at 1280x400).
// Hovering a row revealed its wrapper in flow, the phantom scroll shrank, and the rows jumped under the pointer, which is
// what made Playwright's pointer actionability (and a real user's hover) unstable on the bottom row.
for (const theme of ["dark", "light"] as const) {
  test(`rail: no phantom page scroll and no row shift on hover (1280x400, ${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.setViewportSize({ width: 1280, height: 400 });
    await registerAndLogin(page, request, { ...AUTH, label: `guard-${theme}` });
    await seedRail(page, 12);

    const before = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
      rows: [...document.querySelectorAll(".dashboard-list__item-row")].map(
        (r) => r.getBoundingClientRect().top,
      ),
    }));
    expect(before.scrollHeight, JSON.stringify(before)).toBeLessThanOrEqual(before.innerHeight);

    // Hover a mid-rail row with the real mouse and check nothing moved.
    const row = page.locator(".dashboard-list__item-row").nth(4);
    const box = await row.boundingBox();
    if (!box) throw new Error("row has no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(row.getByRole("button", { name: / actions$/ })).toBeVisible();
    await railSettled(page);
    const after = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      rows: [...document.querySelectorAll(".dashboard-list__item-row")].map(
        (r) => r.getBoundingClientRect().top,
      ),
    }));
    expect(after.scrollY).toBe(before.scrollY);
    expect(after.scrollHeight).toBeLessThanOrEqual(before.innerHeight);
    expect(after.rows).toEqual(before.rows);
  });
}

test.describe("HEL-1750 actions menu fits the viewport", () => {
  test("desktop: last dashboard-list row's menu is fully reachable in a short viewport", async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 400 });
    await registerAndLogin(page, request, { ...AUTH, label: "rail" });
    await seedRail(page, 12);
    // The real mouse path the owner uses: hover the last row (revealing its three-dot trigger), click the trigger.
    const row = page.locator(".dashboard-list__item-row").last();
    await row.scrollIntoViewIfNeeded();
    await row.hover();
    await row.getByRole("button", { name: / actions$/ }).click();

    const menu = await menuSettled(page);
    const probe = await lastItemProbe(menu);
    expect(probe.label).toBe("Delete");
    expectInsideAndHit(probe);

    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Confirm", exact: true })).toBeVisible();
    const cancel = page.getByRole("button", { name: "Cancel", exact: true });
    await cancel.click();
    await expect(cancel).toHaveCount(0);
  });

  // The pipeline Output menu (SpineOutputs, one item) cannot breach the viewport on a phone: its trigger must sit above
  // the bottom nav to be tappable, which always leaves room for a single touch-sized item. The phone surface that CAN
  // is a multi-item menu in a short phone viewport (landscape, or the keyboard open): the step sheet's "Step actions".
  test.describe("phone", () => {
    // Touch is enabled only here: hasTouch makes (pointer: coarse) match, which gives the menu 44px touch items. The
    // desktop case above runs with the default fine pointer, the mouse menu the owner reported.
    test.use({ hasTouch: true });

    test("phone (short, touch-sized): the step sheet's Step actions menu is fully reachable", async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 390, height: PHONE_SHORT_HEIGHT });
      await registerAndLogin(page, request, {
        prefix: "hel1750",
        displayName: "HEL-1750",
        label: "phone",
      });
      const pipelineId = await seedPipeline(page);
      await page.goto(`/pipelines/${pipelineId}`);
      // Real readiness: the seeded pipeline's step rows are rendered.
      await expect(page.locator(".spine-row__select").first()).toBeVisible();
      await page.locator(".spine-row__select").first().tap();
      const sheet = page.locator("dialog[open]");
      await expect(sheet).toBeVisible();
      await settleTransitions(page);
      const trigger = sheet.getByRole("button", { name: /^Step actions for/ });
      await trigger.tap();

      const menu = await menuSettled(page);
      // No side has room for every item here, so the menu scrolls inside itself; End moves focus to (and scrolls to) the last item.
      await page.keyboard.press("End");
      const probe = await lastItemProbe(menu);
      expect(await menu.evaluate((el) => el.closest("dialog") !== null)).toBe(true);
      expectInsideAndHit(probe);
      await page.getByRole("menuitem", { name: probe.label ?? "" }).tap();
      // The tap landed (not just the hit-test): choosing an item closes the menu.
      await expect(page.getByRole("menu")).toHaveCount(0);
    });
  });
});
