import type { Page } from "@playwright/test";

// HEL-1289 / HEL-1300 — the seed-while-`/`-is-live race.
//
// After a UI login the page stays live on `/`: it fetches dashboards, auto-selects the most recent
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
// wanted "a fresh document on `/`" from a `page.reload()`, use `page.goto("/")` instead.
export async function isolateLivePage(page: Page): Promise<void> {
  await page.goto("about:blank");
}

/** The standard UI form login: `/login`, fill, submit, wait for the post-login `/`. Never isolates. */
export async function uiLogin(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", credentials.email);
  await page.fill("#password", credentials.password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** The UI login (`uiLogin`), then idle the post-login `/` on `about:blank`. */
export async function loginThenIsolate(
  page: Page,
  credentials: { email: string; password: string },
): Promise<void> {
  await uiLogin(page, credentials);
  await isolateLivePage(page);
}
