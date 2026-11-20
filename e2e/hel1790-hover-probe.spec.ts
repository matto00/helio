import { expect, test, type Page } from "@playwright/test";

import { registerAndLogin } from "./support/auth";
import { AUTH, THEMES, openPipeline, seedPipeline, sheet } from "./support/hel1582Phone";
import { settleToRest, trackPointer } from "./support/hel1790Rest";

// This guards the helper (`settleToRest`), not the HEL-1675 spec's call to it: deleting that call would not redden it.
// HEL-1790 forced-condition guard (NOT a reproduction of the CI flake, whose natural rate locally is 0/40).
//
// The HEL-1675 desktop test reads the Select trigger's "rest" paint right after the step sheet's slide-in, with the
// mouse left at the click point on the spine row (195, 363). The sheet slides up, so the trigger sweeps under that
// stationary pointer; if the browser refreshes hover during the sweep, the trigger is :hover (and transitions to its
// hover border) when the slide lands, and the browser's follow-up refresh clears it only a little later. A rest read in
// that window returns the hover paint. This forces both ingredients: a mouse event while the trigger is under the
// pointer, and a main-thread stall as the slide lands (a loaded runner's late refresh). Then it reads rest the way the
// HEL-1675 spec did before the fix: right after `noAnimations`; the fix waits for rest first (`settleToRest`).

async function noAnimations(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
}

test.use({ viewport: { width: 390, height: 844 } });

for (const theme of THEMES) {
  test(`HEL-1790 guard: the select trigger's rest read is not hovered (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(240_000);
    await trackPointer(page);
    await registerAndLogin(page, request, { ...AUTH, label: `h1790-${theme}` });
    const pipelineId = await seedPipeline(page, false, false, true);
    await openPipeline(page, pipelineId, theme);
    await page.locator(".spine-row__select").first().click();
    await page.waitForFunction(
      () => {
        const r = document
          .querySelector(".mobile-step-sheet .ui-select__trigger")
          ?.getBoundingClientRect();
        return !!r && r.top <= 360 && r.bottom >= 366;
      },
      undefined,
      { polling: "raf" },
    );
    await page.mouse.move(195, 363);
    await page.evaluate((ms) => {
      const tick = () => {
        const t = document.querySelector(".mobile-step-sheet .ui-select__trigger");
        if (t && Math.round(t.getBoundingClientRect().top) <= 250) {
          const end = performance.now() + ms;
          while (performance.now() < end);
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, 150);
    await expect(sheet(page)).toBeVisible();
    const trigger = sheet(page).locator(".ui-select__trigger").first();
    const read = () => trigger.evaluate((el) => getComputedStyle(el).borderTopColor);
    // The fix: the HEL-1675 spec's rest read waits for rest (`settleToRest`); the red version used `noAnimations` alone.
    await settleToRest(trigger);
    const early = await read();
    await expect.poll(() => trigger.evaluate((el) => el.matches(":hover"))).toBe(false);
    await noAnimations(page);
    const settled = await read();
    expect(
      early,
      "rest read taken once the control is at rest equals the settled rest border",
    ).toBe(settled);
  });
}
