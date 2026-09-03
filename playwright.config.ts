import { defineConfig } from "@playwright/test";

// HEL-287 (httpOnly-cookie session migration) live verification. Assumes the
// frontend (Vite, proxying /api to the backend — same-origin, matching the
// dev `SameSite=Lax` cookie shape in design.md D1) and backend dev servers
// are already running — see scripts/concertino/start-servers.sh, which uses
// these same DEV_PORT / BACKEND_PORT env vars.
const DEV_PORT = process.env.DEV_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  // Quarantine register (HEL-951) — the single exclusion list for both a
  // bare `npm run e2e` and CI's glob (`.github/workflows/ci.yml`'s `e2e`
  // job). Every entry below carries a comment naming its reason; a
  // quarantine entry (as opposed to the one permanent/by-design entry)
  // MUST additionally name the follow-up ticket that will remove it — an
  // entry without one is exactly the silent allowlist this change replaced
  // (design.md D2). See openspec/changes/wire-orphaned-e2e-specs/
  // orphan-status-report.md for the measurement each quarantine below is
  // based on.
  testIgnore: [
    // Permanent/by-design — HEL-813 design.md D1/CR3. The demonstrated-RED
    // regression harness mutates real component source on disk
    // (self-reverting) and must never run as part of a bare `npm run e2e`
    // or CI. This is one of THREE independent exclusion layers (the
    // harness file also self-gates on `HEL813_REGRESSION`, and
    // `playwright.regression.config.ts` is the only config that clears
    // this `testIgnore`) — see e2e/README.md for how/why to run it on
    // demand. HEL-951 confirmed and preserved this exclusion; it is an
    // explicit anti-goal of that change to wire it into CI.
    "**/*.regression.spec.ts",
    // Quarantine (HEL-951) — hel665-message-composer.spec.ts +
    // hel666-single-assistant-entry.spec.ts both fail identically:
    // `getByLabel("Message")` is never found/visible at `/chat` after a
    // fresh register/login. Follow-up: HEL-960.
    "**/hel665-message-composer.spec.ts",
    "**/hel666-single-assistant-entry.spec.ts",
    // Quarantine (HEL-951) — hel716-panel-detail-tall-viewport-footer.spec.ts
    // fails in setup: the panel-creation POST returns 400, not 201, before
    // the file's actual footer-visibility assertions run. Follow-up:
    // HEL-961.
    "**/hel716-panel-detail-tall-viewport-footer.spec.ts",
    // Quarantine (HEL-951) — hel908-tail-attach.spec.ts: the "Add tail
    // step" button locator resolves to 0 elements (expected 2) in the
    // first test; all four tests in the file depend on this affordance and
    // fail the same way. Follow-up: HEL-962.
    "**/hel908-tail-attach.spec.ts",
    // Quarantine (HEL-951) — hel909-output-picker-panel-sheet.spec.ts: a
    // panel placed via the OutputPicker never becomes visible in the grid
    // / mobile stack; all four tests in the file fail the same way.
    // Follow-up: HEL-963.
    "**/hel909-output-picker-panel-sheet.spec.ts",
  ],
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "retain-on-failure",
    // Optional escape hatch: point at an already-installed Chromium binary
    // directly (e.g. when a sandboxed CI/dev environment's OS isn't one of
    // Playwright's officially-supported distros and the bundled
    // chromium-headless-shell build isn't published for it). Unset by
    // default everywhere else.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
});
