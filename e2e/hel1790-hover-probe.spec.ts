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
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running"),
    undefined,
    { timeout: 10_000 },
  );
}

test.use({ viewport: { width: 390, height: 844 } });

for (const theme of THEMES) {
  test(`HEL-1790 guard: the select trigger's rest read is not hovered (${theme})`, async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    await trackPointer(page);
    await registerAndLogin(page, request, { ...AUTH, label: `h1790-${theme}` });
    const pipelineId = await seedPipeline(page, false, false, true);
    await openPipeline(page, pipelineId, theme);
    // HEL-1813: the slide is held and driven by hand, not sampled. A rule installed BEFORE the click makes the
    // `bottom-sheet-in` animation start paused at currentTime 0 whatever the frame timing (a per-frame poll of a
    // ~38 px band that moves 50-110 px a frame misses it by phase alone, and then never runs true again).
    await page.evaluate(() => {
      const hold = document.createElement("style");
      hold.id = "hel1813-hold-slide";
      hold.textContent =
        ".ui-modal.bottom-sheet[open] { animation-play-state: paused !important; }";
      document.head.append(hold);
    });
    await page.locator(".spine-row__select").first().click();
    // Seek the held slide to where the trigger straddles the pointer row (top in [322, 360]), by bisection.
    const seek = await page
      .waitForFunction(
        () => {
          const trigger = document.querySelector(".mobile-step-sheet .ui-select__trigger");
          const slide = document
            .getAnimations()
            .find((a) => (a as CSSAnimation).animationName === "bottom-sheet-in");
          if (!trigger || !slide) return false;
          const top = () => trigger.getBoundingClientRect().top;
          const total = Number(slide.effect?.getComputedTiming().duration);
          let lo = 0;
          let hi = total;
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            slide.currentTime = mid;
            if (top() > 341) lo = mid;
            else hi = mid;
          }
          const r = trigger.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), state: slide.playState };
        },
        undefined,
        { polling: 50, timeout: 10_000 },
      )
      .catch((e: Error) => {
        throw new Error(
          `the step sheet's bottom-sheet-in slide was never captured paused (motion setting or selector changed?): ${e.message}`,
        );
      });
    const held = (await seek.jsonValue()) as { top: number; bottom: number; state: string };
    expect(
      held.top <= 360 && held.bottom >= 366 && held.state === "paused",
      `held slide straddles the pointer row (the trigger is under (195, 363)): ${JSON.stringify(held)}`,
    ).toBe(true);
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
    // Release the held slide: it runs on to rest, and the stall above fires as the trigger passes top <= 250.
    await page.evaluate(() => {
      document.getElementById("hel1813-hold-slide")?.remove();
      for (const a of document.getAnimations()) {
        if ((a as CSSAnimation).animationName === "bottom-sheet-in") a.play();
      }
    });
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 });
    const trigger = sheet(page).locator(".ui-select__trigger").first();
    const read = () => trigger.evaluate((el) => getComputedStyle(el).borderTopColor);
    // The fix: the HEL-1675 spec's rest read waits for rest (`settleToRest`); the red version used `noAnimations` alone.
    await settleToRest(trigger);
    const early = await read();
    await expect
      .poll(() => trigger.evaluate((el) => el.matches(":hover")), { timeout: 10_000 })
      .toBe(false);
    await noAnimations(page);
    const settled = await read();
    expect(
      early,
      "rest read taken once the control is at rest equals the settled rest border",
    ).toBe(settled);
  });
}
