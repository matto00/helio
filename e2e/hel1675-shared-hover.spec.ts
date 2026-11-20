import { expect, test, type Locator, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { AUTH, THEMES, openPipeline, seedPipeline, sheet } from "./support/hel1582Phone";
import { realTap } from "./support/hel1668";
import { settleToHover, settleToRest, trackPointer } from "./support/hel1790Rest";

// HEL-1675: shared controls keep no sticky hover fill after a touch tap, and desktop hover is unchanged.
//
// Touch: a phone (`isMobile`/`hasTouch`, so `(hover: hover)` is false), a real tap (touch events, then the compat mouse
// move that leaves the finger's element in :hover), a wait on a real signal (the popover/listbox/dialog/panel shown then
// gone, the refresh response, animations finished), then the control's computed paint must equal its rest paint. Computed
// styles are read, never `:hover` matching (`el.matches(":hover")` reads false while the painted fill persists).
// Desktop: the same controls hovered by a mouse (`(hover: hover)` true) must paint the values recorded from the
// pre-change CSS (DESKTOP_HOVER below), so gating changed nothing there.

const PAINT = [
  "backgroundColor",
  "borderTopColor",
  "borderLeftColor",
  "color",
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

/** A touch tap on the phone project, a click when the desktop (mouse) describe is running. */
let touchMode = true;
const press = (loc: Locator) => (touchMode ? loc.tap() : loc.click());

const openSheet = async (page: Page, index = 0) => {
  await press(page.locator(".spine-row__select").nth(index));
  await expect(sheet(page)).toBeVisible();
  await noAnimations(page);
};
const stepActions = (page: Page) => sheet(page).getByRole("button", { name: /^Step actions for/ });

interface Instance {
  name: string;
  /** Not red on the unchanged CSS (reopened under a stationary pointer): measured and logged, never asserted. */
  probeOnly?: boolean;
  /** Brings the page to the state where `control` is visible. */
  open: (page: Page) => Promise<void>;
  control: (page: Page) => Locator;
  /** Called just before the tap; the returned function runs after it and must leave `control` visible again. */
  arm: (page: Page) => Promise<() => Promise<void>>;
}

const noArm = (settle: (page: Page) => Promise<void>) => async (page: Page) => () => settle(page);

const INSTANCES: Instance[] = [
  {
    name: "1 ActionsMenu trigger (popover__trigger)",
    open: (page) => openSheet(page),
    control: (page) => stepActions(page),
    arm: noArm(async (page) => {
      await expect(page.getByRole("menuitem").first()).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menuitem")).toHaveCount(0);
      await noAnimations(page);
    }),
  },
  {
    name: "2 ActionsMenu item (Move down)",
    probeOnly: true,
    open: async (page) => {
      await openSheet(page);
      await press(stepActions(page));
      await expect(page.getByRole("menuitem", { name: /^Move step down/ })).toBeVisible();
      await noAnimations(page);
    },
    control: (page) => page.getByRole("menuitem", { name: /^Move step down/ }),
    // Reopened by keyboard so the pointer stays at the tapped point (a second tap would move it to the trigger).
    arm: noArm(async (page) => {
      await expect(page.getByRole("menuitem")).toHaveCount(0);
      await stepActions(page).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menuitem", { name: /^Move step down/ })).toBeVisible();
      await noAnimations(page);
    }),
  },
  {
    name: "3 Select trigger",
    open: (page) => openSheet(page),
    control: (page) => sheet(page).locator(".ui-select__trigger").first(),
    arm: noArm(async (page) => {
      await expect(page.getByRole("listbox")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await noAnimations(page);
    }),
  },
  {
    name: "4 Disclosure summary (compute function reference)",
    open: async (page) => {
      await press(page.locator(".spine-row__select", { hasText: "Compute column" }));
      await expect(sheet(page)).toBeVisible();
      await noAnimations(page);
    },
    control: (page) => sheet(page).locator("summary.disclosure-summary"),
    arm: noArm(async (page) => {
      const details = sheet(page).locator("details", {
        has: page.locator("summary.disclosure-summary"),
      });
      await expect(details).toHaveAttribute("open", "");
      await expect(sheet(page).getByRole("list", { name: "Expression functions" })).toBeVisible();
      await noAnimations(page);
    }),
  },
  {
    name: "5 IconButton (refresh sample)",
    open: async (page) => {
      await expect(page.getByRole("button", { name: /^Refresh sample of/ }).first()).toBeEnabled();
      await noAnimations(page);
    },
    control: (page) => page.getByRole("button", { name: /^Refresh sample of/ }).first(),
    arm: async (page) => {
      const done = page.waitForResponse(
        (r) => /\/api\/data-sources\/[^/]+\/sample/.test(r.url()) && r.request().method() === "GET",
      );
      return async () => {
        await done;
        await expect(page.locator(".source-sample-label").first()).toHaveAttribute(
          "aria-busy",
          "false",
        );
        await expect(
          page.getByRole("button", { name: /^Refresh sample of/ }).first(),
        ).toBeEnabled();
        await noAnimations(page);
      };
    },
  },
  {
    name: "6 .ui-modal-btn (leave guard, Keep editing)",
    open: async (page) => {
      // A config edit (not a reorder, which saves at once) starts the draft the leave guard protects.
      await press(page.locator(".spine-row__select", { hasText: "Filter rows" }));
      await expect(sheet(page)).toBeVisible();
      await sheet(page)
        .locator(".pipeline-detail-page__filter-condition-row input")
        .last()
        .fill("300");
      await press(sheet(page).getByRole("button", { name: "Close" }));
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.locator('[data-slot="draft-status"]')).toHaveText(
        "Draft · unsaved changes",
      );
      await noAnimations(page);
      await press(page.getByRole("navigation", { name: "Primary" }).getByRole("link").first());
      await expect(page.getByRole("button", { name: "Keep editing" })).toBeVisible();
      await noAnimations(page);
    },
    control: (page) => page.getByRole("button", { name: "Keep editing" }),
    arm: noArm(async (page) => {
      await expect(page.getByRole("button", { name: "Keep editing" })).toHaveCount(0);
      await page.getByRole("navigation", { name: "Primary" }).getByRole("link").first().focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "Keep editing" })).toBeVisible();
      await noAnimations(page);
    }),
  },
];

// Hover paint of each named control, recorded from the UNCHANGED CSS on desktop (hover: hover).
const DESKTOP_HOVER: Record<string, Record<string, Paint>> = {
  dark: {
    "1 ActionsMenu trigger (popover__trigger)": {
      backgroundColor: "rgb(22, 21, 20)",
      borderTopColor: "rgba(242, 239, 233, 0.18)",
      borderLeftColor: "rgba(242, 239, 233, 0.18)",
      color: "rgb(242, 239, 233)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "2 ActionsMenu item (Move down)": {
      backgroundColor: "rgb(22, 21, 20)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "3 Select trigger": {
      backgroundColor: "rgb(22, 21, 20)",
      borderTopColor: "rgba(242, 239, 233, 0.18)",
      borderLeftColor: "rgba(242, 239, 233, 0.18)",
      color: "rgb(242, 239, 233)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "4 Disclosure summary (compute function reference)": {
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "5 IconButton (refresh sample)": {
      backgroundColor: "rgb(38, 35, 32)",
      borderTopColor: "rgb(242, 239, 233)",
      borderLeftColor: "rgb(242, 239, 233)",
      color: "rgb(242, 239, 233)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "6 .ui-modal-btn (leave guard, Keep editing)": {
      backgroundColor: "rgb(22, 21, 20)",
      borderTopColor: "rgba(242, 239, 233, 0.18)",
      borderLeftColor: "rgba(242, 239, 233, 0.18)",
      color: "rgb(242, 239, 233)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
  },
  light: {
    "1 ActionsMenu trigger (popover__trigger)": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgba(33, 29, 25, 0.2)",
      borderLeftColor: "rgba(33, 29, 25, 0.2)",
      color: "rgb(33, 29, 25)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "2 ActionsMenu item (Move down)": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "3 Select trigger": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgba(33, 29, 25, 0.2)",
      borderLeftColor: "rgba(33, 29, 25, 0.2)",
      color: "rgb(33, 29, 25)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "4 Disclosure summary (compute function reference)": {
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "5 IconButton (refresh sample)": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgb(33, 29, 25)",
      borderLeftColor: "rgb(33, 29, 25)",
      color: "rgb(33, 29, 25)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
    "6 .ui-modal-btn (leave guard, Keep editing)": {
      backgroundColor: "rgb(239, 236, 230)",
      borderTopColor: "rgba(33, 29, 25, 0.2)",
      borderLeftColor: "rgba(33, 29, 25, 0.2)",
      color: "rgb(33, 29, 25)",
      transform: "none",
      boxShadow: "none",
      opacity: "1",
    },
  },
};

test.describe("HEL-1675 touch: no sticky hover on shared controls", () => {
  test.use({
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    viewport: { width: 390, height: 844 },
  });

  for (const theme of THEMES) {
    test(`a real tap leaves every shared control at its rest paint (${theme})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(240_000);
      await registerAndLogin(page, request, { ...AUTH, label: `shover-${theme}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      const verdicts: string[] = [];
      for (const inst of INSTANCES) {
        await openPipeline(page, pipelineId, theme);
        expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
        await inst.open(page);
        const control = inst.control(page);
        const rest = await paint(control);
        const settle = await inst.arm(page);
        const box = await control.boundingBox();
        await realTap(page, control);
        await settle();
        // The reopened control must sit under the pointer, or the read says nothing about stickiness.
        const underPointer = await inst
          .control(page)
          .evaluate((el, pt) => el.contains(document.elementFromPoint(pt.x, pt.y)), {
            x: box!.x + box!.width / 2,
            y: box!.y + box!.height / 2,
          });
        // Focus returns to the trigger when its popover closes and paints a (legitimate) focus ring; blurring removes it
        // without moving the pointer, so what remains is hover alone (needed by instance 3, the Select trigger).
        await inst.control(page).evaluate((el) => (el as HTMLElement).blur());
        await noAnimations(page);
        const after = await paint(inst.control(page));
        const sticky = PAINT.filter((p) => after[p] !== rest[p]);
        verdicts.push(
          `${inst.name}: ${sticky.length ? `RED ${JSON.stringify(sticky.map((p) => [p, rest[p], after[p]]))}` : "green"}${underPointer ? "" : " (control not under the pointer)"}`,
        );
        if (inst.probeOnly) continue;
        expect.soft(underPointer, `${inst.name}: control under pointer`).toBe(true);
        expect.soft(after, `${inst.name} sticky hover after tap`).toEqual(rest);
      }
      console.log(`HEL-1675 ${theme} verdicts\n${verdicts.join("\n")}`);
    });
  }
});

// Runs at 390x844 with a hover-capable mouse (no touch): the named in-sheet controls render only in the phone layout.
test.describe("HEL-1675 desktop: hover unchanged", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.beforeAll(() => {
    touchMode = false;
  });
  test.afterAll(() => {
    touchMode = true;
  });

  for (const theme of THEMES) {
    test(`a mouse hover paints the recorded values (${theme})`, async ({ page, request }) => {
      test.setTimeout(240_000);
      await trackPointer(page);
      await registerAndLogin(page, request, { ...AUTH, label: `dhover-${theme}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      const recorded: Record<string, Paint> = {};
      for (const inst of INSTANCES) {
        await openPipeline(page, pipelineId, theme);
        expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(true);
        await inst.open(page);
        const control = inst.control(page);
        // HEL-1790: "rest" is read only once the pointer is provably off the control and any transition has ended, and
        // "hover" only once it is provably on it and its transition has ended (both asserted, not slept).
        // One terse line per instance: the state at the FIRST sample is what the old (unsettled) read would have seen.
        console.log(`HEL-1790 ${theme} ${inst.name}: ${await settleToRest(control)}`);
        const rest = await paint(control);
        await control.hover();
        await settleToHover(control);
        recorded[inst.name] = await paint(control);
        expect(recorded[inst.name], `${inst.name} must differ from rest on hover`).not.toEqual(
          rest,
        );
      }
      console.log(`HEL-1675 DESKTOP_HOVER ${theme} ${JSON.stringify(recorded)}`);
      expect(recorded).toEqual(DESKTOP_HOVER[theme]);
    });
  }
});
