import type { Page } from "@playwright/test";

// HEL-1289 / HEL-1300 — the seed-while-`/home`-is-live race.
//
// After a UI login the page stays live on `/home`: it fetches dashboards, auto-selects the most recent
// one, fetches that board's panels and runs its effects (the owner layout repair, the recent-visit
// recorder, an SSE subscription, and, for a user with no dashboard, the onboarding checklist's
// sources/pipelines fetch). A spec that then seeds through the API races those effects, so the page
// may observe (or act on) the seed before the spec's own navigation. Whether it does is timing, so
// the test flakes or passes vacuously for reasons unrelated to what it asserts.
//
// `isolateLivePage` idles the page on `about:blank`, where no app code runs, so the spec's own next
// `page.goto(<app route>)` is the first app load that can see the seed. The session cookie lives in
// the browser context and `addInitScript` re-applies on the next goto, so nothing else changes.
//
// Call it right after a UI login and before any API seeding.
//
// HAZARD: `about:blank` has no app origin. Never follow it with `page.reload()` (it reloads a blank
// page), `page.evaluate`, or a localStorage step before the next app-origin `page.goto`. Where a spec
// wanted "a fresh document on `/home`" from a `page.reload()`, use `page.goto("/dashboards")` instead.
export async function isolateLivePage(page: Page): Promise<void> {
  await page.goto("about:blank");
}

/** The standard UI form login: `/login`, fill, submit, wait for the post-login `/home`. Never isolates.
 *
 *  HEL-1754: both navigations wait for `domcontentloaded`, not the default `load`. A stylesheet link (the
 *  non-render-blocking Google Fonts one included) still delays the window `load` event, so one unanswered
 *  third-party request made `goto("/login")` time out after the form had rendered. `fill` waits for the field
 *  it uses, so nothing here needs `load`. */
export async function uiLogin(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click("button[type=submit]");
  await page.waitForURL("/home", { waitUntil: "domcontentloaded" });
}

/** The UI login (`uiLogin`), then idle the post-login `/home` on `about:blank`. */
export async function loginThenIsolate(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await uiLogin(page, credentials);
  await isolateLivePage(page);
}
