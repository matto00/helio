# HEL-1330: Apply live-page isolation to the guard specs after #774 (focus-presence + state-surface-contrast)

## Description

origin_kind: followup
origin_ticket: HEL-1300

HEL-1300 found both guard specs exposed to the race where data is seeded while `/` is still live (the HEL-1289
class). The owner ruled to leave them alone because HEL-1288's PR matto00/helio#774 rewrites both files.

- **Main's versions** seed a source and a pipeline through the API while `/` is live. The live page can read them
  through onboarding's one-shot fetch (`useOnboardingHost.ts:83-92`).
- **#774's versions** inject the cookie, `goto("/")`, then create a dashboard through the API while `/` is live, which
  the page auto-selects. They then write localStorage via `page.evaluate` on that same live page, so a bare
  `about:blank` would break the write.

## Acceptance Criteria

(after both #774 and HEL-1300 merge — both are merged: 0c792eb26 and e29f580cd)

- Apply HEL-1300's `isolateLivePage` helper in the order isolate -> seed -> `goto("/")` -> `evaluate`.
- The guard population is unchanged: the per-view line counts equal main's.
- Run `--repeat-each 10` at 2 workers under `nice -n 19`, and get a green CI run under the 4-leg sharding.
- Also consolidate the ~34 local `registerAndLogin` copies into the shared helper. HEL-1300 deferred this, along with
  an `e2e/README.md` usage note.

## Premise validation notes (orchestrator, 2026-10-07)

- 32 files (not ~34) define a local `registerAndLogin`/`registerAndLoginWithDashboard` today; no shared
  `registerAndLogin` exists yet (only `loginThenIsolate` in `e2e/support/isolateLivePage.ts`).
- `focus-presence-guard.spec.ts` on main matches the ticket's description of #774's shape (cookie, `goto("/")`, API
  seed while live, `page.evaluate` theme write, `goto(route)`).
- `state-surface-contrast-guard.spec.ts` on main does NOT: `newCell` seeds everything over the API before its first
  `page.goto`, and applies the theme with `addInitScript`, so it never seeds while an app page is live.
