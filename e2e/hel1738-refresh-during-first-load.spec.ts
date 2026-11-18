import { expect, test, type APIRequestContext, type Page, type Request } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { isolateLivePage } from "./support/isolateLivePage";
import { post, seedWorld, setMotion } from "./support/motionPrimitivesSeed";
import { LIVE_STACK_ITEMS, waitForPanelGrid } from "./support/panelGridReady";

// HEL-1738: pressing "Refresh dashboard" (or pulling) while a panel's FIRST rows load is still in flight must queue
// exactly one refresh per panel, sent once that load settles, and keep the round busy until it settles. The first
// load is held open by hand on gate A and the queued request on gate B (a route handler per phase), so every step
// waits on a real network signal: held-request counts and `requestfinished` events. No sleeps, no skeleton or spinner
// selectors. Before the fix the press sent nothing and the round ended when the first load landed (step 4 sees no
// request held on B).

test.describe.configure({ mode: "parallel" });

const AUTH = { prefix: "hel1738", displayName: "HEL-1738", domain: "example.com" } as const;
const ROWS = /\/api\/outputs\/[^/]+\/rows/;
const BUTTON_NAME = "Refresh dashboard";

type Theme = "light" | "dark";
type Pointer = "touch" | "mouse";

interface Context {
  name: string;
  width: number;
  height: number;
  pointer: Pointer;
}

const CONTEXTS: Context[] = [
  { name: "phone 375", width: 375, height: 812, pointer: "touch" },
  { name: "phone 430", width: 430, height: 932, pointer: "touch" },
  { name: "desktop browser at 375 (non-touch)", width: 375, height: 812, pointer: "mouse" },
];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Holds every rows GET: those arriving first on gate A, those arriving after A is released on gate B. */
async function installGates(page: Page) {
  let phase: "A" | "B" | "open" = "A";
  const gateA = deferred();
  const gateB = deferred();
  const held = { A: 0, B: 0 };
  await page.route(ROWS, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (phase === "A") {
      held.A += 1;
      await gateA.promise;
    } else if (phase === "B") {
      held.B += 1;
      await gateB.promise;
    }
    await route.continue();
  });
  return {
    held,
    releaseA() {
      phase = "B";
      gateA.resolve();
    },
    releaseB() {
      phase = "open";
      gateB.resolve();
    },
  };
}

function watchRows(page: Page) {
  const urls: string[] = [];
  const runs: string[] = [];
  const concurrent = new Map<string, number>();
  let maxConcurrentPerUrl = 0;
  let finished = 0;
  const isRowsGet = (req: Request) => ROWS.test(req.url()) && req.method() === "GET";
  page.on("request", (req) => {
    if (isRowsGet(req)) {
      urls.push(req.url());
      const n = (concurrent.get(req.url()) ?? 0) + 1;
      concurrent.set(req.url(), n);
      maxConcurrentPerUrl = Math.max(maxConcurrentPerUrl, n);
    }
    if (/\/runs?\b/.test(req.url()) && req.method() === "POST") runs.push(req.url());
  });
  const done = (req: Request) => {
    if (!isRowsGet(req)) return;
    finished += 1;
    concurrent.set(req.url(), (concurrent.get(req.url()) ?? 1) - 1);
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return {
    urls,
    runs,
    finished: () => finished,
    maxConcurrentPerUrl: () => maxConcurrentPerUrl,
  };
}

function refreshButton(page: Page) {
  return page.getByRole("button", { name: BUTTON_NAME });
}

async function login(
  page: Page,
  request: APIRequestContext,
  ctx: Context,
  theme: Theme,
  label: string,
) {
  await page.setViewportSize({ width: ctx.width, height: ctx.height });
  await page.addInitScript((t: string) => window.localStorage.setItem("helio-theme", t), theme);
  await registerAndLogin(page, request, { ...AUTH, label });
  await isolateLivePage(page);
  await setMotion(page.request, "full");
}

async function seed(page: Page, tag: string) {
  const world = await seedWorld(page.request, tag);
  await post(page.request, "/api/panels", {
    dashboardId: world.dashboardId,
    title: "Notes",
    type: "markdown",
    config: { content: "Lorem ipsum dolor sit amet." },
  });
  return world;
}

async function pressThreeTimes(page: Page, pointer: Pointer) {
  const button = refreshButton(page);
  if (pointer === "touch") await button.tap();
  else await button.click();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  // Playwright's own tap()/click() wait for an aria-disabled control to become enabled, so press by coordinates.
  const box = (await button.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (pointer === "touch") await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await button.focus();
  await page.keyboard.press("Enter");
}

for (const theme of ["light", "dark"] as const) {
  for (const ctx of CONTEXTS) {
    test.describe(`HEL-1738 ${ctx.name}, ${theme}`, () => {
      test.use(
        ctx.pointer === "touch"
          ? { isMobile: true, hasTouch: true }
          : { isMobile: false, hasTouch: false },
      );

      test("a press during the first load queues exactly one refresh per panel, held busy until it settles", async ({
        page,
        request,
      }) => {
        const label = `q${ctx.width}${ctx.pointer}${theme}`;
        await login(page, request, ctx, theme, label);
        const world = await seed(page, `P${label}`);
        const gates = await installGates(page);
        const seen = watchRows(page);
        await page.goto(`/dashboards/${world.dashboardId}`);

        // Step 1 -- readiness from real signals: the stack shows its output cards, every one of them has a rows
        // request held on gate A, and the button is on screen.
        const outputCards = page.locator(`${LIVE_STACK_ITEMS}--output`);
        await expect(refreshButton(page)).toBeVisible();
        await expect(outputCards.first()).toBeVisible();
        const n = await outputCards.count();
        expect(n).toBeGreaterThanOrEqual(2);
        await expect.poll(() => gates.held.A).toBe(n);
        expect(seen.urls.length).toBe(n);

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

        // Step 2 -- three presses while every first load is still held; nothing new is sent.
        await pressThreeTimes(page, ctx.pointer);
        await expect(refreshButton(page)).toHaveAttribute("aria-disabled", "true");
        expect(seen.urls.length).toBe(n);
        expect(gates.held.B).toBe(0);
        await page.screenshot({
          path: evidencePath("HEL-1738", `busy-${ctx.pointer}-${ctx.width}-${theme}.png`),
        });

        // Step 3 -- release the first loads and wait until all of them have finished.
        gates.releaseA();
        await expect.poll(() => seen.finished()).toBeGreaterThanOrEqual(n);

        // Step 4 -- the queued refresh is sent (held on gate B), one per Output and never two at once for one URL,
        // while the round is still busy and has not said "Refreshed".
        await expect.poll(() => gates.held.B).toBe(n);
        await expect(refreshButton(page)).toHaveAttribute("aria-disabled", "true");
        const midSaid = await page.evaluate(
          () => (window as unknown as { __said: string[] }).__said,
        );
        expect(midSaid).toEqual(["Refreshing"]);
        expect(seen.maxConcurrentPerUrl()).toBe(1);
        expect(seen.urls.length).toBe(2 * n);

        // Step 5 -- release the queued requests; the round settles; the total is exactly 2N.
        gates.releaseB();
        await expect(page.locator(".mobile-panel-pull__status")).toHaveText("Refreshed");
        await expect(refreshButton(page)).not.toHaveAttribute("aria-disabled", "true");
        await page.screenshot({
          path: evidencePath("HEL-1738", `settled-${ctx.pointer}-${ctx.width}-${theme}.png`),
        });
        // Equality read after the round ended (two frames later), not a poll that passes at the first 2N.
        await page.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            ),
        );
        expect(seen.urls.length).toBe(2 * n);
        expect(seen.runs).toEqual([]);
        const said = await page.evaluate(() => (window as unknown as { __said: string[] }).__said);
        expect(said).toEqual(["Refreshing", "Refreshed"]);
      });
    });
  }
}

test("at 1280 there is no refresh button and the first load sends one request per panel", async ({
  page,
  request,
}) => {
  const ctx: Context = { name: "desktop", width: 1280, height: 900, pointer: "mouse" };
  await login(page, request, ctx, "light", "desk1280");
  const world = await seed(page, "Pdesk1738");
  const seen = watchRows(page);
  await page.goto(`/dashboards/${world.dashboardId}`);
  await waitForPanelGrid(page, 4);
  await expect(page.locator(".mobile-panel-stack")).toHaveCount(0);
  await expect(refreshButton(page)).toHaveCount(0);
  // The three output panels each sent their one first-load request, and all of them have finished.
  await expect.poll(() => seen.finished()).toBeGreaterThanOrEqual(3);
  expect(seen.urls.length).toBe(3);
  expect(seen.runs).toEqual([]);
});
