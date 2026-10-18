import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CSRF_HEADER, registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";

// HEL-1646: the phone dashboard skeleton reserves the "refreshed" line slot for a pipeline-fed dashboard BEFORE its
// panels load (from the dashboard list's `hasPipelineFedPanels`), so the placeholder cards sit exactly where the real
// cards land. Without it the placeholders paint ~27px (the slot + its margin) higher and the swap visibly jumps.
//
// Every case slows the panels fetch and samples, per animation frame, the first placeholder's and the first real card's
// layout top (`offsetTop`: it ignores the cards' entrance transform), the chip row's top, whether a slot exists, and
// every layout-shift entry. Sampling starts once the routed dashboard's skeleton is on screen (the deep link first
// paints the most recent dashboard for a frame, pre-existing selection behaviour that is not under test here).

test.describe.configure({ mode: "parallel" });
test.setTimeout(180_000);

const AUTH = { prefix: "hel1646", displayName: "HEL-1646", domain: "example.com" } as const;
const PANELS_DELAY_MS = 2500;

async function post<T>(request: APIRequestContext, url: string, data: unknown): Promise<T> {
  const res = await request.post(url, { data, headers: { [CSRF_HEADER]: "1" } });
  expect(res.status(), `${url}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()) as T;
}

interface Seeded {
  fedId: string;
  mdId: string;
  soloId: string;
}

/** A pipeline-fed dashboard (output + markdown), a markdown-only one, and a one-output-panel one. The three are
 *  created last-to-first so the dashboard under test is the most recently updated, as the HEL-1583 spec does. */
async function seed(api: APIRequestContext, tag: string): Promise<Seeded> {
  const source = await post<{ id: string }>(api, "/api/data-sources", {
    name: `${tag} source`,
    type: "static",
    columns: [{ name: "region", type: "string" }],
    rows: [["East"]],
  });
  const pipeline = await post<{ id: string }>(api, "/api/pipelines", {
    name: `${tag} pipeline`,
    roots: [{ sourceId: source.id }],
  });
  const output = await post<{ id: string }>(api, `/api/pipelines/${pipeline.id}/outputs`, {
    kind: "table",
    name: `${tag} output`,
    config: {},
  });
  await post(api, `/api/pipelines/${pipeline.id}/run`, {});
  const outputPanel = (dashboardId: string, title: string) =>
    post(api, "/api/panels", {
      dashboardId,
      title,
      type: "output",
      config: { outputId: output.id },
    });
  const mdPanel = (dashboardId: string, title: string) =>
    post(api, "/api/panels", { dashboardId, title, type: "markdown", config: { content: "note" } });

  const solo = await post<{ id: string }>(api, "/api/dashboards", { name: `${tag} Solo` });
  await outputPanel(solo.id, "Solo table");
  const md = await post<{ id: string }>(api, "/api/dashboards", { name: `${tag} Plain` });
  await mdPanel(md.id, "Note A");
  await mdPanel(md.id, "Note B");
  const fed = await post<{ id: string }>(api, "/api/dashboards", { name: `${tag} Fed` });
  await outputPanel(fed.id, "Fed table");
  await mdPanel(fed.id, "Note");
  return { fedId: fed.id, mdId: md.id, soloId: solo.id };
}

/** Delay only the panels-list fetch, and count how many times it was hit (so a case can prove it was really slowed). */
async function slowPanels(page: Page) {
  const state = { enabled: true, hits: 0 };
  await page.route(/\/api\/dashboards\/[^/]+\/panels(\?.*)?$/, async (route) => {
    if (state.enabled) {
      state.hits += 1;
      await new Promise((resolve) => setTimeout(resolve, PANELS_DELAY_MS));
    }
    await route.continue();
  });
  return state;
}

interface Frame {
  t: number;
  placeholderTop: number | null;
  cardTop: number | null;
  chipTop: number | null;
  slot: "none" | "reserved" | "filled";
}
interface Shift {
  t: number;
  value: number;
  nodes: string[];
}

async function startSampler(page: Page) {
  await page.evaluate(() => {
    const frames: Frame[] = [];
    const shifts: Shift[] = [];
    const w = window as unknown as {
      __hel1646: { frames: Frame[]; shifts: Shift[]; stop: boolean };
    };
    w.__hel1646 = { frames, shifts, stop: false };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{
        value: number;
        hadRecentInput: boolean;
        sources?: Array<{ node: Node | null; previousRect: DOMRect; currentRect: DOMRect }>;
      }>) {
        const nodes = (e.sources ?? []).map((s) => {
          const el = s.node instanceof Element ? s.node : s.node?.parentElement;
          const dy = Math.round((s.currentRect.top - s.previousRect.top) * 10) / 10;
          return el
            ? `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}@dy${dy}`
            : "?";
        });
        shifts.push({ t: performance.now(), value: e.value, nodes });
      }
    }).observe({ type: "layout-shift" });
    // Layout top from the document origin: the offsetTop chain ignores the cards' entrance transform, and (unlike an
    // offsetTop relative to the stack) includes everything above the stack, such as the reserved slot.
    const top = (sel: string) => {
      let el: HTMLElement | null = document.querySelector<HTMLElement>(sel);
      if (!el) return null;
      let sum = 0;
      for (; el; el = el.offsetParent as HTMLElement | null) sum += el.offsetTop;
      return sum;
    };
    const tick = () => {
      if (w.__hel1646.stop) return;
      const slotEl = document.querySelector(".dashboard-refresh-line");
      frames.push({
        t: performance.now(),
        placeholderTop: top('div.mobile-panel-stack__item[aria-hidden="true"]'),
        cardTop: top("article.mobile-panel-stack__item"),
        chipTop: top(".dashboard-chip-row"),
        slot: !slotEl ? "none" : slotEl.hasAttribute("data-reserved") ? "reserved" : "filled",
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function stopSampler(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as {
      __hel1646: { frames: Frame[]; shifts: Shift[]; stop: boolean };
    };
    w.__hel1646.stop = true;
    return { frames: w.__hel1646.frames, shifts: w.__hel1646.shifts };
  });
}

async function realCardsReady(page: Page) {
  await expect(page.locator('.mobile-panel-stack__item[aria-hidden="true"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.locator("article.mobile-panel-stack__item").first()).toBeVisible();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => (a as CSSAnimation).animationName === "motion-enter")
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Stops sampling once real cards are visible, and returns what the frames say about the swap. */
async function finish(page: Page) {
  await realCardsReady(page);
  await page.waitForTimeout(400); // let a late refresh fact resolve into its reserved slot
  const { frames, shifts } = await stopSampler(page);
  const skeleton = frames.filter((f) => f.placeholderTop !== null && f.cardTop === null);
  // Only frames after the swap: a switch case also samples the previous dashboard's loaded cards before the click.
  const lastSkeleton = frames.map((f) => f.placeholderTop !== null).lastIndexOf(true);
  const loaded = frames
    .slice(lastSkeleton + 1)
    .filter((f) => f.cardTop !== null && f.placeholderTop === null);
  return { frames, shifts, skeleton, loaded };
}

function summarize(label: string, r: Awaited<ReturnType<typeof finish>>) {
  const first = (fs: Frame[]) => fs[0];
  console.log(
    `HEL1646 ${label} ${JSON.stringify({
      skeletonFrames: r.skeleton.length,
      loadedFrames: r.loaded.length,
      skeletonFirst: first(r.skeleton),
      loadedFirst: first(r.loaded),
      shiftTotal: r.shifts.reduce((n, s) => n + s.value, 0),
      shifts: r.shifts,
    })}`,
  );
}

/** The chip row and the first-card/placeholder top must be the same in every skeleton frame and every loaded frame. */
function expectNoJump(r: Awaited<ReturnType<typeof finish>>) {
  expect(r.skeleton.length, "the skeleton was sampled over several frames").toBeGreaterThan(5);
  expect(r.loaded.length, "the loaded cards were sampled").toBeGreaterThan(0);
  const placeholder = r.skeleton[r.skeleton.length - 1].placeholderTop!;
  const card = r.loaded[0].cardTop!;
  expect(
    Math.abs(card - placeholder),
    `placeholder ${placeholder} vs real card ${card}`,
  ).toBeLessThanOrEqual(0.5);
  // From the first skeleton frame on: a switch case also samples the previous dashboard, whose own slot state differs.
  const t0 = r.skeleton[0].t;
  const chips = r.frames
    .filter((f) => f.t >= t0)
    .map((f) => f.chipTop)
    .filter((v): v is number => v !== null);
  expect(Math.max(...chips) - Math.min(...chips), "chip row never moved").toBeLessThanOrEqual(0.5);
  // Shifts at the swap and after it. (A shift as the switch itself commits is the previous dashboard's slot state
  // giving way to the target's, which is the flag doing its job, not the skeleton-to-card swap.)
  const swapT = r.skeleton[r.skeleton.length - 1].t - 20;
  const sources = r.shifts.filter((s) => s.t >= swapT).flatMap((s) => s.nodes);
  expect(
    sources.filter(
      (n) => /dashboard-chip-row|dashboard-refresh-line/.test(n) && !/@dy-?0(\.0)?$/.test(n),
    ),
    "no layout shift moved the chip row or the line vertically",
  ).toEqual([]);
}

for (const width of [375, 430] as const) {
  for (const theme of ["light", "dark"] as const) {
    test.describe(`${width}px ${theme}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.addInitScript((t) => window.localStorage.setItem("helio-theme", t), theme);
      });

      test("pipeline-fed dashboard: the slot is reserved in the skeleton and the placeholders sit where the real cards land", async ({
        page,
        request,
      }) => {
        await registerAndLogin(page, request, { ...AUTH, label: `fed${width}${theme}` });
        const ids = await seed(page.request, "HEL-1646");
        const slow = await slowPanels(page);
        await page.goto(`/dashboards/${ids.fedId}`);
        await expect(
          page.locator('div.mobile-panel-stack__item[aria-hidden="true"]').first(),
        ).toBeVisible();
        await startSampler(page);
        await page.screenshot({ path: evidencePath("HEL-1646", `skeleton-${width}-${theme}.png`) });
        const r = await finish(page);
        await page.screenshot({ path: evidencePath("HEL-1646", `loaded-${width}-${theme}.png`) });
        summarize(`fed ${width} ${theme}`, r);
        expect(slow.hits).toBeGreaterThan(0);
        expect(
          r.skeleton.every((f) => f.slot !== "none"),
          "a slot exists in every skeleton frame",
        ).toBe(true);
        expectNoJump(r);
      });

      test("markdown-only dashboard: no slot in the skeleton or after, and no jump", async ({
        page,
        request,
      }) => {
        await registerAndLogin(page, request, { ...AUTH, label: `md${width}${theme}` });
        const ids = await seed(page.request, "HEL-1646");
        const slow = await slowPanels(page);
        await page.goto(`/dashboards/${ids.mdId}`);
        await expect(
          page.locator('div.mobile-panel-stack__item[aria-hidden="true"]').first(),
        ).toBeVisible();
        await startSampler(page);
        await page.screenshot({
          path: evidencePath("HEL-1646", `md-skeleton-${width}-${theme}.png`),
        });
        const r = await finish(page);
        summarize(`md ${width} ${theme}`, r);
        expect(slow.hits).toBeGreaterThan(0);
        expect(
          r.frames.every((f) => f.slot === "none"),
          "no slot at any frame",
        ).toBe(true);
        expectNoJump(r);
      });
    });
  }
}

test.describe("in-app dashboard switches (375px, light)", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
  });

  async function openThenSwitch(
    page: Page,
    request: APIRequestContext,
    from: "fed" | "md",
    label: string,
  ) {
    await registerAndLogin(page, request, { ...AUTH, label });
    const ids = await seed(page.request, "HEL-1646");
    const slow = await slowPanels(page);
    slow.enabled = false;
    const fromId = from === "fed" ? ids.fedId : ids.mdId;
    const toId = from === "fed" ? ids.mdId : ids.fedId;
    await page.goto(`/dashboards/${fromId}`);
    await realCardsReady(page);
    // Only the TARGET's first-ever panels fetch is slowed; it has no warm copy to restore from.
    slow.enabled = true;
    await startSampler(page);
    const chip = page
      .getByRole("group", { name: "Dashboards" })
      .getByRole("button", { name: from === "fed" ? /Plain$/ : /Fed$/ });
    await chip.scrollIntoViewIfNeeded();
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/dashboards/${toId}$`));
    return { slow, ids };
  }

  test("pipeline-fed -> markdown-only: no slot while the target's skeleton shows, nor after", async ({
    page,
    request,
  }) => {
    const { slow } = await openThenSwitch(page, request, "fed", "sw-fed-md");
    const r = await finish(page);
    summarize("switch fed->md", r);
    expect(slow.hits).toBeGreaterThan(0);
    expect(r.skeleton.length).toBeGreaterThan(5);
    expect(
      r.skeleton.every((f) => f.slot === "none"),
      "no slot in the target's skeleton",
    ).toBe(true);
    expect(
      r.loaded.every((f) => f.slot === "none"),
      "no slot after",
    ).toBe(true);
    expectNoJump(r);
  });

  test("markdown-only -> pipeline-fed: the slot is reserved in the target's skeleton and the tops match", async ({
    page,
    request,
  }) => {
    const { slow } = await openThenSwitch(page, request, "md", "sw-md-fed");
    const r = await finish(page);
    summarize("switch md->fed", r);
    expect(slow.hits).toBeGreaterThan(0);
    expect(r.skeleton.length).toBeGreaterThan(5);
    expect(
      r.skeleton.every((f) => f.slot !== "none"),
      "a slot in the target's skeleton",
    ).toBe(true);
    expectNoJump(r);
  });
});

test("deleting the last panel of a pipeline-fed dashboard leaves no slot, now or on a slow reopen", async ({
  page,
  request,
}) => {
  // The phone stack has no delete control, so delete at desktop width, then narrow to the phone shell (client side).
  await page.setViewportSize({ width: 1280, height: 800 });
  await registerAndLogin(page, request, { ...AUTH, label: "delete-last" });
  const ids = await seed(page.request, "HEL-1646");
  const slow = await slowPanels(page);
  slow.enabled = false;
  await page.goto(`/dashboards/${ids.soloId}`);
  await page.getByRole("button", { name: "Solo table panel actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("No panels yet")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.locator(".dashboard-chip-row")).toBeVisible();
  await expect(page.getByText("No panels yet")).toBeVisible();
  expect(
    await page.locator(".dashboard-refresh-line").count(),
    "no slot above the empty state",
  ).toBe(0);

  // Reopen the (now empty) dashboard through a slowed fetch: switch away to a never-opened dashboard, then back.
  const row = page.getByRole("group", { name: "Dashboards" });
  await row.getByRole("button", { name: /Plain$/ }).click();
  await realCardsReady(page);
  slow.enabled = true;
  const hitsBefore = slow.hits;
  await startSampler(page);
  await row.getByRole("button", { name: /Solo$/ }).click();
  await expect(page.getByText("No panels yet")).toBeVisible({ timeout: 30_000 });
  const { frames } = await stopSampler(page);
  console.log(
    `HEL1646 delete-last ${JSON.stringify({ frames: frames.length, slots: [...new Set(frames.map((f) => f.slot))], fetches: slow.hits - hitsBefore })}`,
  );
  expect(
    frames.every((f) => f.slot === "none"),
    "no slot at any frame of the reopen",
  ).toBe(true);
});
