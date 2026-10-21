import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";
import { post, seedWorld, setMotion } from "./support/motionPrimitivesSeed";

// HEL-1681: the phone dashboard's visible "Refresh dashboard" button, the WCAG 2.5.1 single-pointer / keyboard
// alternative to HEL-1656's pull. Rows requests are counted from the network, the button's tap area is MEASURED with
// `document.elementFromPoint` (never read from CSS text), and the stack's resting position is sampled per frame.

test.use({ isMobile: true, hasTouch: true });
test.describe.configure({ mode: "parallel" });

const AUTH = { prefix: "hel1681", displayName: "HEL-1681", domain: "example.com" } as const;
const ROWS = /\/api\/outputs\/[^/]+\/rows/;
const SIZES = [
  { width: 375, height: 812 },
  { width: 430, height: 932 },
] as const;
const BUTTON_NAME = "Refresh dashboard";
/** WCAG 2.5.5 / DESIGN.md §5 tap floor. */
const TAP_FLOOR_PX = 44;

function countRequests(page: Page) {
  const urls: string[] = [];
  const runs: string[] = [];
  page.on("request", (req) => {
    if (ROWS.test(req.url()) && req.method() === "GET") urls.push(req.url());
    if (/\/runs?\b/.test(req.url()) && req.method() === "POST") runs.push(req.url());
  });
  return { urls, runs };
}

async function login(
  page: Page,
  request: APIRequestContext,
  width: number,
  height: number,
  label: string,
) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => window.localStorage.setItem("helio-theme", "light"));
  await registerAndLogin(page, request, { ...AUTH, label });
  await isolateLivePage(page);
  await setMotion(page.request, "full");
}

async function openDashboard(
  page: Page,
  request: APIRequestContext,
  width: number,
  height: number,
  label: string,
) {
  await login(page, request, width, height, label);
  const world = await seedWorld(page.request, `P${label}`);
  // One text panel: it has no output, so a refresh must not touch it.
  await post(page.request, "/api/panels", {
    dashboardId: world.dashboardId,
    title: "Notes",
    type: "markdown",
    config: { content: "Lorem ipsum dolor sit amet." },
  });
  const seen = countRequests(page);
  await page.goto(`/dashboards/${world.dashboardId}`);
  await expect(page.locator(".mobile-panel-stack")).toHaveCount(1);
  await expect(page.locator(".mobile-panel-stack__item--output")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(() => seen.urls.length).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".mobile-panel-stack__item--output .ui-spinner")).toHaveCount(0);
  return { ...world, seen };
}

function refreshButton(page: Page) {
  return page.getByRole("button", { name: BUTTON_NAME });
}

/** Delay every rows response so a round stays busy long enough to observe and to poke a second time. */
async function slowRows(page: Page, ms: number) {
  await page.route(ROWS, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

for (const size of SIZES) {
  test.describe(`HEL-1681 refresh button at ${size.width}`, () => {
    test("a single tap refreshes each output panel once, runs no pipeline, and shows a busy cue", async ({
      page,
      request,
    }) => {
      const { seen } = await openDashboard(
        page,
        request,
        size.width,
        size.height,
        `tap${size.width}`,
      );
      await expect(refreshButton(page)).toBeVisible();
      // Item 2 regression: the chart card is not collapsed after a cold load (it initialised at 24px, axis only, on
      // about 4 cold loads in 10 before the fix).
      await expect(page.locator(".mobile-panel-stack__item--output canvas")).toHaveCount(1);
      expect(
        await page
          .locator(".mobile-panel-stack__item--output canvas")
          .evaluate((c) => c.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(100);
      await slowRows(page, 700);
      const before = seen.urls.length;

      await refreshButton(page).tap();
      await expect(refreshButton(page)).toHaveAttribute("aria-disabled", "true");
      await expect(refreshButton(page).locator(".ui-spinner")).toHaveCount(1);
      // A button round shows its busy cue on the button only: no pull indicator, no translated stack.
      await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
      await expect(page.locator(".mobile-panel-stack")).toHaveCSS("transform", "none");
      await page.screenshot({ path: evidencePath("HEL-1681", `busy-${size.width}.png`) });

      await expect.poll(() => seen.urls.length - before).toBe(3);
      await expect(refreshButton(page)).not.toHaveAttribute("aria-disabled", "true");
      await expect(refreshButton(page).locator(".ui-spinner")).toHaveCount(0);
      await expect(page.locator(".mobile-panel-pull__status")).toHaveText("Refreshed");
      expect(seen.runs).toEqual([]);
      expect(seen.urls.length - before).toBe(3);
    });

    test("keyboard: Enter on the focused button refreshes once and announces Refreshing then Refreshed", async ({
      page,
      request,
    }) => {
      const { seen } = await openDashboard(
        page,
        request,
        size.width,
        size.height,
        `key${size.width}`,
      );
      await slowRows(page, 700);
      const before = seen.urls.length;
      await page.evaluate(() => {
        const w = window as unknown as { __said: string[] };
        w.__said = [];
        const status = document.querySelector(".mobile-panel-pull__status")!;
        new MutationObserver(() => w.__said.push(status.textContent ?? "")).observe(status, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
      await refreshButton(page).focus();
      await expect(refreshButton(page)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect.poll(() => seen.urls.length - before).toBe(3);
      await expect(page.locator(".mobile-panel-pull__status")).toHaveText("Refreshed");
      const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
      expect(said).toEqual(["Refreshing", "Refreshed"]);
      expect(seen.runs).toEqual([]);
      // Focus is kept through the busy round (aria-disabled, not disabled).
      await expect(refreshButton(page)).toBeFocused();
    });

    test("a second activation while a round is busy sends nothing", async ({ page, request }) => {
      const { seen } = await openDashboard(
        page,
        request,
        size.width,
        size.height,
        `busy${size.width}`,
      );
      await slowRows(page, 900);
      const before = seen.urls.length;
      await refreshButton(page).tap();
      await expect(refreshButton(page)).toHaveAttribute("aria-disabled", "true");
      // Playwright's own tap() waits for an aria-disabled control to become enabled, so tap its centre by coordinates.
      const box = (await refreshButton(page).boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await refreshButton(page).focus();
      await page.keyboard.press("Enter");
      await expect.poll(() => seen.urls.length - before).toBe(3);
      await expect(refreshButton(page)).not.toHaveAttribute("aria-disabled", "true");
      expect(seen.urls.length - before).toBe(3);
    });

    test("the tap area is at least 44x44, inside the panel list, and leaves the chip row its own taps", async ({
      page,
      request,
    }) => {
      await openDashboard(page, request, size.width, size.height, `area${size.width}`);
      await expect(refreshButton(page)).toBeVisible();
      const r = await page.evaluate((floor) => {
        const btn = document.querySelector<HTMLElement>('button[aria-label="Refresh dashboard"]')!;
        const list = document.querySelector(".panel-list")!.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        const after = getComputedStyle(btn, "::after");
        const w = parseFloat(after.width);
        const h = parseFloat(after.height);
        // Pseudo-elements have no rect: the box is the button's rect plus the ::after's resolved offsets.
        const left = Number.isNaN(parseFloat(after.left))
          ? b.right - w
          : b.left + parseFloat(after.left);
        const top = b.top + parseFloat(after.top);
        const box = { left, top, right: left + w, bottom: top + h, width: w, height: h };
        const hits = (x: number, y: number) => {
          const el = document.elementFromPoint(x, y);
          return el !== null && (el === btn || btn.contains(el));
        };
        const chip = document.querySelector(".dashboard-chip")!;
        const cr = chip.getBoundingClientRect();
        const chipHit = (x: number, y: number) => {
          const el = document.elementFromPoint(x, y);
          return el !== null && chip.contains(el);
        };
        return {
          floor,
          box,
          inside:
            box.left >= list.left &&
            box.right <= list.right &&
            box.top >= list.top &&
            box.bottom <= list.bottom,
          corners: [
            hits(box.left + 1, box.top + 1),
            hits(box.right - 1, box.top + 1),
            hits(box.left + 1, box.bottom - 1),
            hits(box.right - 1, box.bottom - 1),
            hits((box.left + box.right) / 2, (box.top + box.bottom) / 2),
          ],
          belowMisses: !hits((box.left + box.right) / 2, box.bottom + 1),
          chipCentre: chipHit(cr.left + cr.width / 2, cr.top + cr.height / 2),
          chipTopEdge: chipHit(cr.left + cr.width / 2, cr.top + 1),
        };
      }, TAP_FLOOR_PX);
      expect(r.box.width).toBeGreaterThanOrEqual(TAP_FLOOR_PX);
      expect(r.box.height).toBeGreaterThanOrEqual(TAP_FLOOR_PX);
      expect(r.inside, JSON.stringify(r.box)).toBe(true);
      expect(r.corners).toEqual([true, true, true, true, true]);
      expect(r.belowMisses).toBe(true);
      expect(r.chipCentre).toBe(true);
      expect(r.chipTopEdge).toBe(true);
    });

    test("showing the button does not move the stack's resting position", async ({
      page,
      request,
    }) => {
      await login(page, request, size.width, size.height, `shift${size.width}`);
      const world = await seedWorld(page.request, `Pshift${size.width}`);
      await page.addInitScript(() => {
        const w = window as unknown as { __tops: number[] };
        w.__tops = [];
        const tick = () => {
          const stack = document.querySelector(".mobile-panel-stack");
          if (stack && document.querySelectorAll(".mobile-panel-stack__item").length >= 3) {
            w.__tops.push(Math.round(stack.getBoundingClientRect().top * 10) / 10);
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.goto(`/dashboards/${world.dashboardId}`);
      await expect(refreshButton(page)).toBeVisible();
      for (let i = 0; i < 12; i += 1) await page.evaluate(() => new Promise(requestAnimationFrame));
      const tops = await page.evaluate(() => (window as unknown as { __tops: number[] }).__tops);
      expect(tops.length).toBeGreaterThan(6);
      expect(new Set(tops).size, `stack top samples ${[...new Set(tops)].join(",")}`).toBe(1);
    });

    test("no button on a dashboard with no output-bound panel", async ({ page, request }) => {
      await login(page, request, size.width, size.height, `none${size.width}`);
      const dash = await post<{ id: string }>(page.request, "/api/dashboards", {
        name: "Notes only",
      });
      await post(page.request, "/api/panels", {
        dashboardId: dash.id,
        title: "Notes",
        type: "markdown",
        config: { content: "Nothing to refresh here." },
      });
      await page.goto(`/dashboards/${dash.id}`);
      await expect(page.locator(".mobile-panel-stack__item--markdown")).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await expect(refreshButton(page)).toHaveCount(0);
    });
  });
}

test("Full motion: after a pull-started round the settling indicator reads Refreshed, never Pull to refresh", async ({
  page,
  request,
}) => {
  const { seen } = await openDashboard(page, request, 375, 812, "settle");
  await slowRows(page, 500);
  await page.evaluate(() => {
    const w = window as unknown as { __labels: string[] };
    w.__labels = [];
    const tick = () => {
      const el = document.querySelector(".pull-refresh-indicator__label");
      const text = el?.textContent ?? null;
      if (text !== null && w.__labels[w.__labels.length - 1] !== text) w.__labels.push(text);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const before = seen.urls.length;
  const cdp = await page.context().newCDPSession(page);
  const card = (await page.locator(".mobile-panel-stack__item").first().boundingBox())!;
  const x = card.x + card.width / 2;
  const y = card.y + 24;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 26; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + i * 10 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(() => seen.urls.length - before).toBe(3);
  await expect(page.locator(".pull-refresh-indicator")).toHaveCount(0);
  const labels = await page.evaluate(() => (window as unknown as { __labels: string[] }).__labels);
  expect(labels).toEqual(["Pull to refresh", "Release to refresh", "Refreshing", "Refreshed"]);
});

test("no refresh button at 1280", async ({ page, request }) => {
  const world = await (async () => {
    await login(page, request, 1280, 900, "desk");
    return seedWorld(page.request, "Pdesk");
  })();
  await page.goto(`/dashboards/${world.dashboardId}`);
  await expect(page.locator(".panel-list__zoom-container")).toHaveCount(1);
  await expect(page.locator(".mobile-panel-stack")).toHaveCount(0);
  await expect(page.locator(".panel-grid-card").first()).toBeVisible();
  await expect(refreshButton(page)).toHaveCount(0);
});

test("crossing 768px keeps the same zoom container and a non-zero grid width", async ({
  page,
  request,
}) => {
  await login(page, request, 1280, 900, "cross");
  const world = await seedWorld(page.request, "Pcross");
  await page.goto(`/dashboards/${world.dashboardId}`);
  await expect(page.locator(".panel-grid-card").first()).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __zoom: Element }).__zoom = document.querySelector(
      ".panel-list__zoom-container",
    )!;
  });
  const same = () =>
    page.evaluate(() => {
      const el = document.querySelector(".panel-list__zoom-container")!;
      return {
        same: (window as unknown as { __zoom: Element }).__zoom === el,
        width: el.getBoundingClientRect().width,
      };
    });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".mobile-panel-stack")).toHaveCount(1);
  expect(await same()).toEqual({ same: true, width: expect.any(Number) });
  expect((await same()).width).toBeGreaterThan(0);
  await expect(refreshButton(page)).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".mobile-panel-stack")).toHaveCount(0);
  const back = await same();
  expect(back.same).toBe(true);
  expect(back.width).toBeGreaterThan(0);
  await expect(refreshButton(page)).toHaveCount(0);
});
