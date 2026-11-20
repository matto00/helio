import { expect, test, type Locator, type Page } from "@playwright/test";

import { currentUserId, registerAndLogin } from "./support/auth";
import { CSRF, THEMES } from "./support/hel1582Phone";
import { realTap } from "./support/hel1668";
import { setUserTierForTest } from "./support/historySeed";
import { settleToHover, settleToRest, trackPointer } from "./support/hel1790Rest";

// HEL-1735: feature controls (outside shared/ and the pipeline page) keep no sticky hover fill after a touch tap, and
// desktop hover is unchanged.
//
// Touch: a touch context (`isMobile`/`hasTouch`, so `(hover: hover)` is false), a real tap (touch events, then the compat
// mouse move that leaves the finger's element in :hover), a wait on a real signal (animations finished), then the control's
// computed paint must equal its rest paint. Computed styles are read, never `:hover` matching. Two contexts: P (phone
// 390x844: phone shell, no rail / context list / tab bar) and T (touch tablet 1024x768: rail, context list, tab bar).
// Desktop: the same controls hovered by a mouse (`(hover: hover)` true) must paint the values recorded from the
// pre-change CSS (DESKTOP_HOVER below), read through the HEL-1790 settle helpers.

const PAINT = [
  "backgroundColor",
  "borderTopColor",
  "borderLeftColor",
  "color",
  "outlineColor",
  "textDecorationLine",
  "filter",
  "transform",
  "boxShadow",
  "opacity",
] as const;
type Paint = Record<(typeof PAINT)[number], string>;

const paint = (loc: Locator): Promise<Paint> =>
  loc.evaluate((el, props) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(
      props.map((p) => [p, (cs as unknown as Record<string, string>)[p]]),
    ) as Paint;
  }, PAINT);

async function noAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
}

type Ctx = "P" | "T";

interface Seed {
  dashboardId: string;
  sourceId: string;
}

interface Instance {
  name: string;
  ctx: Ctx;
  /** The stylesheet rule this instance covers (its own rule sets a visible paint). */
  rule: string;
  /** Not red on the unchanged CSS: measured and logged, never asserted. */
  probeOnly?: boolean;
  route: (seed: Seed) => string;
  control: (page: Page) => Locator;
}

const INSTANCES: Instance[] = [
  {
    name: "P1 home card",
    ctx: "P",
    rule: "features/home/ui/HomePage.css a.home-card:hover (border-color)",
    route: () => "/home",
    control: (page) => page.locator("a.home-card").first(),
  },
  {
    name: "P2 sources list row",
    ctx: "P",
    probeOnly: true,
    rule: "features/sources/ui/SourceListTable.css .source-list-table__row:hover (background)",
    route: () => "/sources",
    control: (page) => page.locator(".source-list-table__row").first(),
  },
  {
    name: "P3 settings add color",
    ctx: "P",
    probeOnly: true,
    rule: "features/settings/ui/PreferencesEditor.css .preferences-editor__add-btn:hover",
    route: () => "/settings",
    control: (page) => page.locator(".preferences-editor__add-btn").first(),
  },
  {
    name: "P4 command bar logo",
    ctx: "P",
    rule: "app/App.css .app-command-bar__logo:hover (background)",
    route: () => "/sources",
    control: (page) => page.locator(".app-command-bar__logo").first(),
  },
  {
    name: "T1 dashboard tab",
    ctx: "T",
    rule: "features/dashboards/tabs/ui/DashboardTabBar.css .dashboard-tab__button:hover",
    route: (s) => `/dashboards/${s.dashboardId}`,
    control: (page) => page.locator(".dashboard-tab__button").first(),
  },
  {
    name: "T2 context-list selected dashboard row",
    ctx: "T",
    rule: "features/dashboards/ui/DashboardList.css .dashboard-list__button:hover (background)",
    route: (s) => `/dashboards/${s.dashboardId}`,
    control: (page) => page.locator('.context-list .dashboard-list__button[aria-pressed="true"]'),
  },
  {
    name: "T3 rail item (Data Sources)",
    ctx: "T",
    rule: "app/shell/AppRail.css .app-rail__item:hover (background)",
    route: () => "/home",
    control: (page) => page.locator('a.app-rail__item[aria-label="Data Sources"]'),
  },
  {
    name: "T4 sources list row",
    ctx: "T",
    probeOnly: true,
    rule: "features/sources/ui/SourceListTable.css .source-list-table__row:hover (background)",
    route: () => "/sources",
    control: (page) => page.locator(".source-list-table__row").first(),
  },
  {
    name: "T5 rail logo",
    ctx: "T",
    rule: "app/shell/AppRail.css .app-rail__logo:hover (background)",
    route: () => "/sources",
    control: (page) => page.locator("a.app-rail__logo"),
  },
];

async function seed(page: Page, label: string): Promise<Seed> {
  const post = async <T>(url: string, data: unknown): Promise<T> => {
    const res = await page.request.post(url, { data, headers: CSRF });
    expect(res.status(), `${url} ${await res.text()}`).toBeLessThan(300);
    return (await res.json()) as T;
  };
  await post("/api/dashboards", { name: `hel1735-${label}-a` });
  const dash = await post<{ id: string }>("/api/dashboards", { name: `hel1735-${label}-b` });
  const source = await post<{ id: string }>("/api/data-sources", {
    name: `hel1735-${label}-src`,
    type: "static",
    columns: [{ name: "amount", type: "integer" }],
    rows: [[10], [20]],
  });
  return { dashboardId: dash.id, sourceId: source.id };
}

async function open(page: Page, route: string, theme: (typeof THEMES)[number]) {
  await page.evaluate((t) => window.localStorage.setItem("helio-theme", t), theme);
  await page.goto(route);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await page.evaluate(() => document.fonts.ready);
}

const touchTests = (ctx: Ctx, viewport: { width: number; height: number }) =>
  test.describe(`HEL-1735 touch ${ctx}: no sticky hover on feature controls`, () => {
    test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2, viewport });
    const mine = INSTANCES.filter((i) => i.ctx === ctx);
    for (const theme of THEMES) {
      test(`a real tap leaves every control at its rest paint (${ctx}, ${theme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(240_000);
        await registerAndLogin(page, request, {
          prefix: "hel1735",
          displayName: "HEL-1735",
          label: `t${ctx}-${theme}`,
        });
        const s = await seed(page, `t${ctx}${theme}`);
        const verdicts: string[] = [];
        for (const inst of mine) {
          await open(page, inst.route(s), theme);
          expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
          const control = inst.control(page);
          await expect(control).toBeVisible();
          await noAnimations(page);
          const rest = await paint(control);
          const box = (await control.boundingBox())!;
          const url = page.url();
          await realTap(page, control);
          await noAnimations(page);
          // A tap that navigates unmounts the control: go back so the same control is re-rendered under the stationary
          // pointer (the stuck-hover state is the browser's, and survives the re-render).
          if (page.url() !== url || (await control.count()) === 0) {
            await page.goBack();
            await expect(control).toBeVisible();
            await noAnimations(page);
          }
          const underPointer = await control.evaluate(
            (el, pt) => el.contains(document.elementFromPoint(pt.x, pt.y)),
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          );
          await control.evaluate((el) => (el as HTMLElement).blur());
          await noAnimations(page);
          const after = await paint(control);
          const sticky = PAINT.filter((p) => after[p] !== rest[p]);
          verdicts.push(
            `${inst.name}: ${sticky.length ? `RED ${JSON.stringify(sticky.map((p) => [p, rest[p], after[p]]))}` : "green"}${underPointer ? "" : " (control not under the pointer)"}`,
          );
          if (inst.probeOnly) continue;
          expect.soft(underPointer, `${inst.name}: control under pointer`).toBe(true);
          expect.soft(after, `${inst.name} sticky hover after tap`).toEqual(rest);
        }
        console.log(`HEL-1735 ${ctx} ${theme} verdicts\n${verdicts.join("\n")}`);
      });
    }
  });

touchTests("P", { width: 390, height: 844 });
touchTests("T", { width: 1024, height: 768 });

// Hover paint of each named control, recorded from the UNCHANGED CSS on desktop (hover: hover).
const DESKTOP_HOVER: Record<string, Record<string, Paint>> = {
  dark: {
    "P1 home card": {
      backgroundColor: "rgb(26, 24, 22)",
      borderTopColor: "rgba(242, 239, 233, 0.18)",
      borderLeftColor: "rgba(242, 239, 233, 0.18)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "rgba(0, 0, 0, 0.3) 0px 1px 2px 0px, rgba(0, 0, 0, 0.5) 0px 8px 24px -12px",
      opacity: "1",
    },
    "P2 sources list row": {
      backgroundColor: "rgb(35, 32, 25)",
      borderTopColor: "rgb(128, 128, 128)",
      borderLeftColor: "rgb(128, 128, 128)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "P3 settings add color": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgba(242, 239, 233, 0.18)",
      borderLeftColor: "rgba(242, 239, 233, 0.18)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "P4 command bar logo": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T1 dashboard tab": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T2 context-list selected dashboard row": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgba(0, 0, 0, 0)",
      borderLeftColor: "rgba(0, 0, 0, 0)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T3 rail item (Data Sources)": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T4 sources list row": {
      backgroundColor: "rgb(35, 32, 25)",
      borderTopColor: "rgb(128, 128, 128)",
      borderLeftColor: "rgb(128, 128, 128)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T5 rail logo": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      outlineColor: "rgb(242, 239, 233)",
      textDecorationLine: "underline",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
  },
  light: {
    "P1 home card": {
      backgroundColor: "rgb(253, 252, 250)",
      borderTopColor: "rgba(33, 29, 25, 0.2)",
      borderLeftColor: "rgba(33, 29, 25, 0.2)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow:
        "rgba(33, 29, 25, 0.05) 0px 1px 2px 0px, rgba(33, 29, 25, 0.14) 0px 8px 24px -12px",
      opacity: "1",
    },
    "P2 sources list row": {
      backgroundColor: "rgb(255, 255, 255)",
      borderTopColor: "rgb(128, 128, 128)",
      borderLeftColor: "rgb(128, 128, 128)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "P3 settings add color": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgba(33, 29, 25, 0.2)",
      borderLeftColor: "rgba(33, 29, 25, 0.2)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "P4 command bar logo": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T1 dashboard tab": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T2 context-list selected dashboard row": {
      backgroundColor: "color(srgb 0.976471 0.45098 0.0862745 / 0.26)",
      borderTopColor: "rgba(0, 0, 0, 0)",
      borderLeftColor: "rgba(0, 0, 0, 0)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T3 rail item (Data Sources)": {
      backgroundColor: "rgb(255, 255, 255)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T4 sources list row": {
      backgroundColor: "rgb(255, 255, 255)",
      borderTopColor: "rgb(128, 128, 128)",
      borderLeftColor: "rgb(128, 128, 128)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "none",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "T5 rail logo": {
      backgroundColor: "rgb(255, 255, 255)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      outlineColor: "rgb(33, 29, 25)",
      textDecorationLine: "underline",
      filter: "none",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
  },
};

const DESKTOP_VIEWPORT = {
  P: { width: 390, height: 844 },
  T: { width: 1280, height: 800 },
} as const;

for (const ctx of ["P", "T"] as const)
  test.describe(`HEL-1735 desktop ${ctx}: hover unchanged`, () => {
    test.use({ viewport: DESKTOP_VIEWPORT[ctx] });
    const mine = INSTANCES.filter((i) => i.ctx === ctx);
    for (const theme of THEMES) {
      test(`a mouse hover paints the recorded values (${ctx}, ${theme})`, async ({
        page,
        request,
      }) => {
        test.setTimeout(240_000);
        await trackPointer(page);
        await registerAndLogin(page, request, {
          prefix: "hel1735",
          displayName: "HEL-1735",
          label: `d${ctx}-${theme}`,
        });
        const s = await seed(page, `d${ctx}${theme}`);
        const recorded: Record<string, Paint> = {};
        for (const inst of mine) {
          await open(page, inst.route(s), theme);
          expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true);
          const control = inst.control(page);
          await expect(control).toBeVisible();
          await page.mouse.move(1, 1);
          console.log(`HEL-1790 ${ctx} ${theme} ${inst.name}: ${await settleToRest(control)}`);
          const rest = await paint(control);
          await control.hover();
          await settleToHover(control);
          recorded[inst.name] = await paint(control);
          expect(recorded[inst.name], `${inst.name} must differ from rest on hover`).not.toEqual(
            rest,
          );
        }
        console.log(`HEL-1735 DESKTOP_HOVER ${ctx} ${theme} ${JSON.stringify(recorded)}`);
        expect(recorded).toEqual(
          Object.fromEntries(mine.map((i) => [i.name, DESKTOP_HOVER[theme][i.name]])),
        );
      });
    }
  });

// The one hover REVEAL left ungated (DashboardList.css `.dashboard-list__item-row:hover .popover.actions-menu`, HEL-1003)
// has two render sites, both in the context list that only mounts outside the phone shell: the dashboards list
// (DashboardList) and the Assistant conversation rows (SidebarItemList). On a touch tablet a tap on the row must leave
// its actions trigger painted and tappable, and a tap on the trigger must open the menu. The rule is not edited by this
// change, so the verdict is identical before and after it.
test.describe("HEL-1735 touch T: the row actions reveal keeps its touch path", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    viewport: { width: 1024, height: 768 },
  });

  const reach = async (page: Page, site: string, row: Locator, button: Locator) => {
    const trigger = row.locator(".actions-menu__trigger");
    const before = await trigger.boundingBox();
    await realTap(page, button);
    await noAnimations(page);
    const box = await trigger.boundingBox();
    const clip = await row
      .locator(".popover.actions-menu")
      .evaluate((el) => `${getComputedStyle(el).clip}|${getComputedStyle(el).width}`);
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const menuOpened = await page
      .getByRole("menuitem", { name: "Delete" })
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(
        () => true,
        () => false,
      );
    const verdict = `${site}: trigger before tap ${JSON.stringify(before)}, after row tap ${JSON.stringify(box)}, popover clip|width ${clip}, menu opened by tapping the trigger: ${menuOpened}`;
    console.log(`HEL-1735 reveal ${verdict}`);
    expect(menuOpened, verdict).toBe(true);
  };

  for (const theme of THEMES) {
    test(`both render sites reveal a tappable actions trigger on a tap (${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      const credentials = await registerAndLogin(page, request, {
        prefix: "hel1735",
        displayName: "HEL-1735",
        label: `rv-${theme}`,
      });
      void credentials;
      const userId = await currentUserId(request);
      setUserTierForTest(userId, "beta");
      const s = await seed(page, `rv${theme}`);
      const conv = await page.request.post("/api/assistant-conversations", {
        data: { title: "hel1735-conv" },
        headers: CSRF,
      });
      expect(conv.status()).toBeLessThan(300);

      await open(page, `/dashboards/${s.dashboardId}`, theme);
      const dRow = page.locator(".context-list .dashboard-list__item-row").first();
      await reach(page, "dashboard row", dRow, dRow.locator(".dashboard-list__button"));
      await page.keyboard.press("Escape");

      // design.md D3 named a second render site (the Assistant conversation rows). On the tree they render no
      // `.popover.actions-menu` at all (no `onDelete`; Rename and Pin are plain row-action buttons), so the reveal rule
      // has exactly one render site. Recorded here so a future `onDelete` there shows up as a failing probe.
      await open(page, "/chat", theme);
      const cRow = page
        .locator(".context-list .dashboard-list__item-row", { hasText: "hel1735-conv" })
        .first();
      await expect(cRow).toBeVisible();
      await realTap(page, cRow.locator(".dashboard-list__button"));
      await noAnimations(page);
      const popovers = await cRow.locator(".popover.actions-menu").count();
      const actionBoxes = await cRow
        .locator(".dashboard-list__row-action-btn")
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
      console.log(
        `HEL-1735 reveal assistant conversation row: actions-menu popovers=${popovers}, row-action button widths=${JSON.stringify(actionBoxes)}`,
      );
      expect(popovers).toBe(0);
      expect(actionBoxes.length).toBeGreaterThan(0);
      for (const width of actionBoxes) expect(width).toBeGreaterThan(16);
    });
  }
});
