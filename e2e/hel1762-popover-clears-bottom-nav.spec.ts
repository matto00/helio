import { expect, test, type Locator, type Page } from "@playwright/test";
import { registerAndLogin } from "./support/auth";
import { seedProvenanceDashboard } from "./support/hel1756Seed";
import { seedPipeline } from "./support/hel1582Phone";

// HEL-1762 -- on a phone the shared popover fit keeps a popover clear of the fixed bottom nav (and the safe area).
// HEL-1756 fitted a popover to the window only, so one opened low on the page could end inside the band the app
// reserves for the nav (at 390x844 the provenance popover's bottom was y=800, the nav's top ~776). Each case places the
// trigger so the UNFIXED fit would put the popover's bottom edge at the window margin (its last item's centre then
// lies inside the nav band), opens the popover and asserts, on its last item: (a) the popover's bottom is >= 8px above
// the nav's top, (b) `document.elementFromPoint` at the item's centre returns the item, (c) `document.elementsFromPoint`
// there contains no `.bottom-nav` element. The throwaway user is recorded by registerUser and deleted by exact id in
// the run's global teardown.

const AUTH = { prefix: "hel1762", displayName: "HEL-1762" } as const;
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone short", width: 390, height: 400 },
] as const;
/** Slack so sub-pixel rounding cannot make the unfixed fit flip the panel above its trigger. */
const FIT_SLACK = 4;

/** Scrolls so `trigger`'s bottom edge sits at `targetBottom` (viewport px), then waits for the box to settle. */
async function placeTriggerBottom(trigger: Locator, targetBottom: number) {
  await trigger.evaluate((el, target) => {
    for (let i = 0; i < 4; i += 1) {
      const delta = el.getBoundingClientRect().bottom - target;
      let n: HTMLElement | null = el.parentElement;
      while (
        n &&
        !(
          n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)
        )
      ) {
        n = n.parentElement;
      }
      if (n) n.scrollTop += delta;
      else window.scrollBy(0, delta);
    }
  }, targetBottom);
  const reads: string[] = [];
  await expect
    .poll(
      async () => {
        reads.push(JSON.stringify(await trigger.boundingBox()));
        const last = reads.slice(-4);
        return last.length === 4 && last.every((r) => r === last[0]);
      },
      { timeout: 15_000, intervals: [50, 100, 100, 100, 250] },
    )
    .toBe(true);
}

interface Surface {
  trigger: Locator;
  /** The opened panel. */
  panel: (page: Page) => Locator;
  /** Selector (within the panel) of the items whose last one is probed. */
  item: string;
}

/** Opens `surface` with its trigger placed so the unfixed fit would end the panel at the window's bottom margin, and
 *  asserts the last item is clear of, and not stacked over, the bottom nav. */
async function expectClearsNav(page: Page, surface: Surface, size: { height: number }) {
  const { trigger, item } = surface;
  const panel = surface.panel(page);
  // Pass 1: learn the panel's natural height and its gap to the trigger.
  await placeTriggerBottom(trigger, Math.round(size.height * 0.2));
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator(item).last()).toBeVisible();
  await panel.locator(item).last().scrollIntoViewIfNeeded();
  const first = await panel.evaluate((el, sel) => {
    const items = el.querySelectorAll(sel);
    const r = items[items.length - 1].getBoundingClientRect();
    return {
      natural: el.scrollHeight + (el as HTMLElement).offsetHeight - el.clientHeight,
      top: el.getBoundingClientRect().top,
      // The last item's centre, measured up from the panel's bottom edge with the panel scrolled to its end.
      centreAboveBottom: el.getBoundingClientRect().bottom - (r.top + r.height / 2),
    };
  }, item);
  const tb = (await trigger.boundingBox())!;
  // Both popovers use an 8px trigger gap; a pass-1 open that landed above its trigger measures nothing, so fall back to it.
  const measuredGap = first.top - (tb.y + tb.height);
  const gap = measuredGap >= 0 && measuredGap <= 12 ? measuredGap : 8;
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  // Pass 2: the unfixed fit would now end the panel at (viewport - 8): its last item sits inside the nav band.
  const cap = Math.min(0.7 * size.height, 480);
  const wanted = Math.min(first.natural, cap);
  await placeTriggerBottom(trigger, size.height - 8 - FIT_SLACK - gap - wanted);
  // The setup must really be the one the unfixed fit would put into the nav band, or this case proves nothing.
  const placed = (await trigger.boundingBox())!;
  const navTop = await page.evaluate(
    () => document.querySelector(".bottom-nav")!.getBoundingClientRect().top,
  );
  const unfixedBottom = placed.y + placed.height + gap + wanted;
  const unfixedItemCentre = unfixedBottom - first.centreAboveBottom;
  expect(
    unfixedItemCentre,
    "the unfixed fit would put the last ITEM's centre inside the nav band",
  ).toBeGreaterThan(navTop);
  expect(unfixedBottom).toBeLessThanOrEqual(size.height - 8 + 0.5);
  await trigger.click();
  await expect(panel).toBeVisible();
  const last = panel.locator(item).last();
  await last.scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () =>
        page.evaluate(
          (sel) => {
            const panelEl = document.querySelector(sel.panel)!;
            const items = panelEl.querySelectorAll<HTMLElement>(sel.item);
            const it = items[items.length - 1];
            const r = it.getBoundingClientRect();
            const x = r.left + r.width / 2;
            const y = r.top + r.height / 2;
            const nav = document.querySelector(".bottom-nav")!.getBoundingClientRect();
            const hit = document.elementFromPoint(x, y);
            const stack = document.elementsFromPoint(x, y);
            const p = panelEl.getBoundingClientRect();
            return {
              navTop: nav.top,
              panelBottom: p.bottom,
              itemBottom: r.bottom,
              clearOfNav: p.bottom <= nav.top - 8 + 0.5,
              hitIsItem: hit === it || (hit !== null && it.contains(hit)),
              navInStack: stack.some((e) => e.closest(".bottom-nav") !== null),
            };
          },
          { panel: await panelSelector(panel), item },
        ),
      { timeout: 4_000, message: "last item clear of the bottom nav" },
    )
    .toMatchObject({ clearOfNav: true, hitIsItem: true, navInStack: false });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
}

async function panelSelector(panel: Locator): Promise<string> {
  return panel.evaluate((el) =>
    el.classList.contains("provenance-popover") ? ".provenance-popover" : '[role="menu"]',
  );
}

for (const theme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    test(`provenance popover clears the bottom nav (${size.name} ${size.width}x${size.height}, ${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      await page.setViewportSize({ width: size.width, height: 900 });
      await registerAndLogin(page, request, {
        ...AUTH,
        label: `prov-${size.name.replaceAll(" ", "-")}-${theme}`,
      });
      const { dashboardId } = await seedProvenanceDashboard(page, `HEL-1762 ${theme}`, 6);
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/dashboards/${dashboardId}`);
      const triggers = page.getByRole("button", { name: "Data provenance" });
      await expect(triggers.first()).toBeVisible({ timeout: 20_000 });
      await expectClearsNav(
        page,
        {
          trigger: triggers.nth(3),
          panel: (p) => p.locator(".provenance-popover"),
          item: "a.provenance-popover__link",
        },
        size,
      );
    });
  }
}

// The pipeline page's Output actions trigger sits low on the page (above the nav) and its menu opens below it. The page
// cannot scroll that trigger lower, so the window height is tuned until the unfixed fit would end the menu at the
// window's bottom margin, the same setup the provenance cases make by scrolling.
for (const theme of ["light", "dark"] as const) {
  test(`actions menu clears the bottom nav (phone width 390, ${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await registerAndLogin(page, request, { ...AUTH, label: `menu-${theme}` });
    const pipelineId = await seedPipeline(page);
    await page.goto(`/pipelines/${pipelineId}`);
    const trigger = page.getByRole("button", { name: /^Source actions for / }).first();
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const natural = await menu.evaluate(
      (el) => el.scrollHeight + (el as HTMLElement).offsetHeight - el.clientHeight,
    );
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    let height = 844;
    for (let i = 0; i < 3; i += 1) {
      const box = (await trigger.boundingBox())!;
      height = Math.ceil(box.y + box.height + 8 + natural + 8 + FIT_SLACK);
      await page.setViewportSize({ width: 390, height });
      await expect(trigger).toBeVisible();
    }
    await expectClearsNav(
      page,
      { trigger, panel: (p) => p.getByRole("menu"), item: '[role="menuitem"]' },
      { height },
    );
  });
}
