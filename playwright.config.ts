import { defineConfig } from "@playwright/test";

// HEL-287 (httpOnly-cookie session migration) live verification. Assumes the
// frontend (Vite, proxying /api to the backend — same-origin, matching the
// dev `SameSite=Lax` cookie shape in design.md D1) and backend dev servers
// are already running — see scripts/concertino/start-servers.sh, which uses
// these same DEV_PORT / BACKEND_PORT env vars.
const DEV_PORT = process.env.DEV_PORT ?? "5173";
// HEL-866 skeptic-final-2/2B non-blocking note — a bare run in a linked
// worktree (CON-165) silently falls back to 5173, so it can measure a
// DIFFERENT worktree's dev server and fail obscurely deep inside a spec
// (e.g. `registerAndLogin` timing out) rather than at the actual cause.
// One line, no config restructuring: name the fallback loudly so that
// failure mode is diagnosable from the run's own output.
if (!process.env.DEV_PORT) {
  console.warn(
    `[playwright.config] DEV_PORT is unset — defaulting to ${DEV_PORT}. In a linked worktree this may measure the WRONG server; pass DEV_PORT explicitly (see scripts/concertino/start-servers.sh, CON-165).`,
  );
}

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
    // Quarantine (HEL-991) — hel968-multi-root-editor-flow.spec.ts fails
    // intermittently at `locator.click: Test timeout of 30000ms exceeded`
    // waiting for the OpDropdown "Union" menuitem after clicking "Branch
    // this step". Measured at roughly 50% in CI (4 of ~8 PR runs on
    // 2026-09-05: #555, #562, #563, #564 — one of them twice in a row)
    // versus ~1.7% (1/60) locally on an idle dev box. That ~30x gap is
    // itself the leading lead: the environment, not the click speed, may be
    // the variable that opens the window — same class as the
    // gate-machine-note.md blind spot HEL-984 hit.
    //
    // Quarantined because it gated four PRs whose diffs were structurally
    // incapable of causing it (a Scala test file, a comment-only frontend
    // diff, backend domain logic, another Scala test file), each needing a
    // human to argue the red down from the diff's contents before it could
    // be dismissed. That erosion — training reviewers to discount a red
    // e2e — is worse than the lost minutes.
    //
    // Like HEL-912 above and UNLIKE HEL-964, this is a real owned defect,
    // not an untrustworthy spec: the mechanism is UNKNOWN and explicitly
    // NOT the anchor-churn story (HEL-972's MutationObserver probe recorded
    // zero node-removal events). Un-quarantining this file is an acceptance
    // criterion of HEL-991. Anchored to this one file only (NOT a
    // "**/hel968-*" pattern). Follow-up: HEL-991.
    "**/hel968-multi-root-editor-flow.spec.ts",
    // Quarantine (HEL-992) — RE-quarantined 2026-09-06 after HEL-972's fix
    // merged and un-quarantined it. The fix is real and shipped (`4ff73647`,
    // the debounced analyze no longer contends with an in-flight run), but the
    // spec still fails at a rate CI measurement does not support keeping it
    // gating: FIRST-ATTEMPT results after un-quarantine were main `4ff73647`
    // FAIL, PR #568 FAIL, PR #570 FAIL, PR #571 pass — 3 of 5, ~60%, against
    // the ~5.7% (4/70) composite measured locally during HEL-972.
    //
    // That ~10x local-vs-CI divergence is now HEL-992's primary lead, and it
    // is NOT general CPU contention: HEL-972 measured 0/20 reproductions under
    // load average 13.2, which kills the cheapest explanation.
    //
    // Re-quarantined because a guard failing 3 runs in 5 verifies nothing —
    // it blocked `main` and forced a re-run on most PRs, which is how a red
    // `main` stops meaning anything. Same reasoning applied to
    // `hel968-multi-root-editor-flow` in `75f59b04`. Like that one and UNLIKE
    // HEL-964, this is a real owned defect, not an untrustworthy spec.
    // Un-quarantining is an acceptance criterion of HEL-992. Anchored to this
    // one file only (NOT a "**/hel912-*" pattern). Follow-up: HEL-992.
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
