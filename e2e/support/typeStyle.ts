import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { CSRF_HEADER } from "./auth";

// HEL-1572 — type-style parametrization for the layout specs (HEL-813 touch-target floor, HEL-866 contrast guard).
//
// The style is seeded through the real server preference (`PATCH /api/users/me/preferences`), NOT a localStorage
// cache write: after sign-in the signed-in user's saved preference is authoritative, so a cache-only seed would be
// reset to Sans + mono and the "Mono" run would silently measure the default face (design-gate r5 note 1).
// `assertTypeStyleActive` is the non-vacuity precondition every non-default run must pass before measuring.

export type TypeStyle = "sans" | "mono" | "serif";

/** The style the contrast guard runs under; `HEL1572_TYPE_STYLE=mono` re-runs it in Mono. Default: sans. */
export function typeStyleUnderTest(): TypeStyle {
  const raw = process.env.HEL1572_TYPE_STYLE ?? "sans";
  if (raw !== "sans" && raw !== "mono" && raw !== "serif") {
    throw new Error(`HEL1572_TYPE_STYLE must be sans|mono|serif, got "${raw}"`);
  }
  return raw;
}

/** Saves a type style for the session user owning `request`'s cookie jar. Sans is the default and saves nothing. */
export async function seedTypeStyle(request: APIRequestContext, style: TypeStyle): Promise<void> {
  if (style === "sans") return;
  const res = await request.patch("/api/users/me/preferences", {
    data: { typeStyle: style },
    headers: { [CSRF_HEADER]: "1" },
  });
  expect(res.status()).toBe(200);
}

/** Asserts the style is really applied: the root attribute AND the computed `font-family` of `body` (a Mono run
 *  must be in JetBrains Mono, so a reset-to-default would fail here rather than pass vacuously). */
export async function assertTypeStyleActive(page: Page, style: TypeStyle): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-type-style", style);
  if (style === "mono") {
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    expect(family.replace(/["']/g, "")).toMatch(/^JetBrains Mono/);
    const button = page.locator("button").first();
    if ((await button.count()) > 0) {
      const buttonFamily = await button.evaluate((el) => getComputedStyle(el).fontFamily);
      expect(buttonFamily.replace(/["']/g, "")).toMatch(/^JetBrains Mono/);
    }
  }
}
