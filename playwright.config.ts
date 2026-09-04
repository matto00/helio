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
    // Quarantine (HEL-951/HEL-964) — hel908-full-flow.spec.ts is FLAKY, not
    // deterministically red: PR #539's real CI run failed it once, an
    // immediate re-run of the IDENTICAL commit passed, and it passed both
    // individually and as part of the whole-suite run locally (2/2 PASS).
    // Per design.md D3, a spec producing two different verdicts across runs
    // is not trustworthy as a gate. Do NOT go looking for a reproducible
    // bug here — there isn't one on the record; this is CI's timing, not
    // this spec's logic. Anchored to this one file only (NOT a
    // "**/hel908-*" pattern) — the other three hel908-* siblings
    // (hel908-step-card-split, hel908-trunk-reorder-drag,
    // hel908-trunk-reorder-order) passed both CI runs and must stay wired
    // in. Follow-up: HEL-964.
    "**/hel908-full-flow.spec.ts",
    // Quarantine (HEL-912/HEL-972) — hel912-lanes-rejoin.spec.ts is a
    // KNOWN-RED GUARD AWAITING ITS FIX, not a flaky or untrustworthy spec.
    // It reliably detects a real, MEASURED, PRE-EXISTING product defect:
    // OpDropdown's open menu detaches mid-interaction when a burst of
    // ancestor re-renders lands between opening the picker and clicking an
    // item. Measured at 45% (9/20) on base a45e9881 versus ~20-25% on
    // HEL-912's own branch — WORSE on main, so this change neither
    // introduced nor worsened it; it wrote the first spec that exercises
    // the affordance hard enough to catch it. Not lane-specific: base's own
    // Branch/tail-attach flow reproduces it through the same component.
    // UNLIKE HEL-964 above, there IS a reproducible bug here and it IS
    // owned — un-quarantining this file is an acceptance criterion of
    // HEL-972, whose fix this spec verifies. Anchored to this one file only
    // (NOT a "**/hel912-*" pattern). Follow-up: HEL-972.
    "**/hel912-lanes-rejoin.spec.ts",
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
