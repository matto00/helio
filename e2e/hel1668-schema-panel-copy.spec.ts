import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { evidencePath } from "./support/evidencePath";
import { AUTH, THEMES, openPipeline, seedPipeline } from "./support/hel1582Phone";
import { realTap, seedTallSchemaPipeline, stubLastRun } from "./support/hel1668";

// HEL-1668 items 4, 5 (compact spine on a touch tablet) and 6: the output schema panel is placed by its real height
// (desktop 1280x800 and 1000x800, phone below-placement clearing the bottom nav), the spine copy is unambiguous, and
// the last-run time survives an 8-digit row count. Light and dark.

const fieldsTrigger = (page: Page) => page.getByRole("button", { name: /\d+ fields/ }).first();
const schemaPanel = (page: Page) => page.getByRole("dialog", { name: "Output schema" });

/** Opens the panel, reads its geometry, closes it. */
async function openSchemaPanel(page: Page) {
  const trigger = fieldsTrigger(page);
  await trigger.scrollIntoViewIfNeeded();
  const t = await trigger.evaluate((el) => el.getBoundingClientRect().toJSON());
  await trigger.click();
  const panel = schemaPanel(page);
  await expect(panel).toBeVisible();
  const p = await panel.evaluate((el) => ({
    rect: el.getBoundingClientRect().toJSON(),
    contentHeight: el.scrollHeight,
    maxHeight: parseFloat((el as HTMLElement).style.maxHeight),
    visibility: getComputedStyle(el).visibility,
  }));
  return { trigger: t as DOMRect, panel: p };
}

// HEL-1632: at 1280 the live Output column takes a third column, so the centre column is ~363px wide (was ~660px) and the
// filter editor's rows stack (267px tall, 163px at 1700 where they do not). The "N fields" trigger therefore sits ~12px
// lower and the pinned fixture's "below is roomier" premise (trigger centre above the viewport's midline) needs 40px more
// height; the placement logic under test is unchanged.
for (const viewport of [
  { width: 1280, height: 840 },
  { width: 1000, height: 800 },
]) {
  const at = `${viewport.width}x${viewport.height}`;
  test.describe(`HEL-1668 item 4 desktop schema panel at ${at}`, () => {
    test.use({ viewport });

    test(`a panel whose content fits above its trigger opens above although its 24rem cap would not (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `panel-short-${viewport.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        await page.locator(".spine-row__select").nth(0).click();
        await expect(fieldsTrigger(page)).toBeVisible();
        const { trigger, panel } = await openSchemaPanel(page);
        // The pinned fixture: content fits above, the 24rem (384px) cap does not, and below has more room.
        const roomAbove = trigger.top - 16;
        const roomBelow = viewport.height - trigger.bottom - 16;
        console.log(`trigger top ${trigger.top} content ${panel.contentHeight} (${at}, ${theme})`);
        expect(panel.contentHeight, "content fits above").toBeLessThanOrEqual(roomAbove);
        expect(roomAbove, "the 384px cap does not fit above").toBeLessThan(384);
        expect(roomBelow, "below is roomier").toBeGreaterThan(roomAbove);
        expect(panel.rect.bottom, "opens above the trigger").toBeLessThanOrEqual(trigger.top);
        expect(panel.rect.top).toBeGreaterThanOrEqual(0);
        expect(panel.visibility).toBe("visible");
        await page.screenshot({
          path: evidencePath("HEL-1668", `schema-above-${at}-${theme}.png`),
        });
        await page.keyboard.press("Escape");
      }
    });

    test(`content taller than the room above opens on the roomier side, capped, inside the viewport (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `panel-tall-${viewport.width}` });
      const pipelineId = await seedTallSchemaPipeline(page);
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        await page.locator(".spine-row__select").nth(0).click();
        await expect(fieldsTrigger(page)).toBeVisible();
        const { trigger, panel } = await openSchemaPanel(page);
        const roomAbove = trigger.top - 16;
        const roomBelow = viewport.height - trigger.bottom - 16;
        console.log(
          `tall: trigger top ${trigger.top} content ${panel.contentHeight} (${at}, ${theme})`,
        );
        expect(panel.contentHeight, "content is taller than the room above").toBeGreaterThan(
          roomAbove,
        );
        expect(roomBelow, "below is roomier").toBeGreaterThan(roomAbove);
        expect(panel.rect.top, "opens below the trigger").toBeGreaterThanOrEqual(trigger.bottom);
        expect(panel.rect.bottom, "inside the viewport").toBeLessThanOrEqual(viewport.height);
        expect(panel.rect.height, "capped by its 24rem").toBeLessThanOrEqual(384.5);
        await page.screenshot({ path: evidencePath("HEL-1668", `schema-tall-${at}-${theme}.png`) });
        await page.keyboard.press("Escape");
      }
    });
  });
}

for (const size of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
]) {
  const at = `${size.width}x${size.height}`;
  test.describe(`HEL-1668 item 4 phone schema panel at ${at}`, () => {
    test.use({ viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test(`a panel opened below its trigger on the phone Preview tab ends above the bottom nav (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `panel-phone-${size.width}` });
      const pipelineId = await seedTallSchemaPipeline(page);
      for (const theme of THEMES) {
        await page.setViewportSize(size);
        await openPipeline(page, pipelineId, theme);
        await page.getByRole("tab", { name: "Preview" }).tap();
        await expect(fieldsTrigger(page)).toBeVisible();
        const base = await fieldsTrigger(page).evaluate((el) =>
          el.getBoundingClientRect().toJSON(),
        );
        const navH = await page
          .getByRole("navigation", { name: "Primary" })
          .evaluate((el) => el.getBoundingClientRect().height);
        // Pin the fixture: choose the viewport height so the room below ends 340px under the trigger (past the old
        // viewport-edge limit, short of the 384px cap), with the room above smaller, so the panel opens BELOW.
        const gapBelow = 340;
        const height = Math.ceil(base.bottom + 8 + gapBelow + 8 + navH);
        await page.setViewportSize({ width: size.width, height });
        const { trigger, panel } = await (async () => {
          await fieldsTrigger(page).tap();
          const panelEl = schemaPanel(page);
          await expect(panelEl).toBeVisible();
          return {
            trigger: await fieldsTrigger(page).evaluate(
              (el) => el.getBoundingClientRect().toJSON() as DOMRect,
            ),
            panel: await panelEl.evaluate((el) => ({
              rect: el.getBoundingClientRect().toJSON(),
              contentHeight: el.scrollHeight,
            })),
          };
        })();
        const navTop = await page
          .getByRole("navigation", { name: "Primary" })
          .evaluate((el) => el.getBoundingClientRect().top);
        console.log(
          `phone ${at} ${theme}: trigger ${trigger.top}-${trigger.bottom} navTop ${navTop} panel ${panel.rect.top}-${panel.rect.bottom}`,
        );
        expect(panel.contentHeight).toBeGreaterThan(trigger.top - 16);
        expect(panel.rect.top, "opens below").toBeGreaterThanOrEqual(trigger.bottom);
        expect(panel.rect.bottom, "ends above the bottom nav").toBeLessThanOrEqual(navTop);
        await page.screenshot({
          path: evidencePath("HEL-1668", `schema-phone-${at}-${theme}.png`),
        });
        await page.keyboard.press("Escape");
      }
    });
  });
}

// ---- item 5: the compact spine on a touch tablet keeps HEL-1608's tapped-row tones -----------------------------------

test.describe("HEL-1668 item 5 compact spine on a touch tablet (1024x800)", () => {
  test.use({ viewport: { width: 1024, height: 800 }, isMobile: true, hasTouch: true });

  test("a tapped compact row keeps its accent select and menu-backing tones and opens its step menu, light and dark", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await registerAndLogin(page, request, { ...AUTH, label: "compact-touch" });
    const pipelineId = await seedPipeline(page, false, false, true);
    for (const theme of THEMES) {
      await openPipeline(page, pipelineId, theme);
      expect(await page.evaluate(() => matchMedia("(hover: hover)").matches)).toBe(false);
      await realTap(page, page.locator(".spine-row__select").nth(1));
      const row = page.locator(".spine-row--selected").first();
      await expect(row).toBeVisible();
      await row
        .locator(".spine-row__menu")
        .evaluate((el) =>
          Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
        );
      const tones = await row.evaluate((el) => {
        const select = el.querySelector(".spine-row__select") as HTMLElement;
        const menu = el.querySelector(".spine-row__menu") as HTMLElement;
        const probe = document.createElement("i");
        document.body.appendChild(probe);
        probe.style.background = "var(--app-accent-mid)";
        const accentMid = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          compactMenu: getComputedStyle(menu).position === "absolute",
          select: getComputedStyle(select).backgroundColor,
          accentMid,
          menuImage: getComputedStyle(menu).backgroundImage,
          menuColor: getComputedStyle(menu).backgroundColor,
          menuOpacity: getComputedStyle(menu).opacity,
        };
      });
      console.log("COMPACT-TONES", theme, JSON.stringify(tones));
      expect(tones.compactMenu, "this width is the compact spine").toBe(true);
      expect(tones.select).toBe(tones.accentMid);
      expect(tones.menuOpacity).toBe("1");
      // origin/main's tapped-row menu backing: the accent-mid wash layered over the canvas colour.
      expect(tones.menuImage).toBe(`linear-gradient(${tones.accentMid}, ${tones.accentMid}), none`);
      await row.getByRole("button", { name: /^Step actions for/ }).tap();
      await expect(page.getByRole("menuitem").first()).toBeVisible();
      await page.screenshot({ path: evidencePath("HEL-1668", `compact-touch-1024-${theme}.png`) });
      await page.keyboard.press("Escape");
    }
  });
});

// ---- item 6: copy ------------------------------------------------------------------------------------------------------

for (const viewport of [
  { width: 375, height: 812, phone: true },
  { width: 390, height: 844, phone: true },
  { width: 768, height: 1024, phone: true },
  { width: 1000, height: 800, phone: false },
  { width: 1280, height: 800, phone: false },
]) {
  const at = `${viewport.width}x${viewport.height}`;
  test.describe(`HEL-1668 item 6 copy at ${at}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.phone,
      hasTouch: viewport.phone,
    });

    test(`the source card names Static once, the Output reads "from", and an 8-digit row count never clips the time (${at})`, async ({
      page,
      request,
    }) => {
      test.setTimeout(150_000);
      await registerAndLogin(page, request, { ...AUTH, label: `copy-${viewport.width}` });
      const pipelineId = await seedPipeline(page, false, false, true);
      await stubLastRun(page, 12_345_678);
      for (const theme of THEMES) {
        await openPipeline(page, pipelineId, theme);
        const card = page.locator(".spine-source-card");
        await expect(card.locator(".source-sample-label__text")).toHaveText(/^Static · /);
        const staticCount = await card.evaluate(
          (el) => (el.textContent ?? "").match(/Static/g)?.length ?? 0,
        );
        expect(staticCount, "Static is named once on the source card").toBe(1);

        const output = page.locator(".spine-output-card").first();
        await expect(output.locator(".spine-card__meta").last()).toHaveText("from Compute column");
        await expect(output).not.toContainText(/\boff\b/);

        const meta = page.getByLabel("Last run metadata");
        await expect(meta).toBeVisible();
        await expect(meta.locator(".spine-header__meta-time")).toHaveText(/ago|just now|minute/);
        const clip = await meta.evaluate((el) => {
          // The very last character of the meta text must lie inside the clipping container.
          const text = el.querySelector(".spine-header__meta-text")!;
          const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
          let last: Text | null = null;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if ((n.textContent ?? "").trim() !== "") last = n as Text;
          }
          const range = document.createRange();
          range.setStart(last!, Math.max(0, last!.length - 1));
          range.setEnd(last!, last!.length);
          const c = el.getBoundingClientRect();
          const r = range.getBoundingClientRect();
          const count = el.querySelector(".spine-header__meta-count") as HTMLElement | null;
          return {
            lastRight: r.right,
            containerRight: c.right,
            countEllipsized: count ? count.scrollWidth > count.clientWidth : null,
            text: el.textContent,
          };
        });
        console.log("META", at, theme, JSON.stringify(clip));
        expect(clip.lastRight, "the relative time is fully visible").toBeLessThanOrEqual(
          clip.containerRight + 0.5,
        );
        await page.screenshot({ path: evidencePath("HEL-1668", `copy-${at}-${theme}.png`) });
      }
    });
  });
}
