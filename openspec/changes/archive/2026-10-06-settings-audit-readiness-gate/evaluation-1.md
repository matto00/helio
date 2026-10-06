## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `76d9a7bd84e6a445aa802958544982a9182553e3` against live-resolved base `b16bfa1b3a74905eefc0208a01793efa047909c5`.
Diff: `e2e/support/settingsReady.ts` (new), `e2e/hel813-mobile-touch-target-floor.spec.ts` (+3 lines), change dir.

### Phase 1: Spec Review — FAIL

- AC1 (inventory): PASS. I re-ran the grep (`/settings` and case-insensitive `settings` across `e2e/**/*.ts`) in the worktree and got the same hits as design.md's table: two guard specs (out of scope), hel813 surfaces 2/3, the hel813 regression harness (excluded per D3, with a reason given), and dialog/comment hits that are not the `/settings` route. A grep for `"Settings"`, `Audit history` and `sortable-th` found no other `/settings` consumer.
- AC2 (shared helper + use): PASS. `waitForSettingsAuditTable` is in `e2e/support/` and is called right after both `page.goto("/settings")` calls.
- AC3 (no assertion/timeout change): PASS. The spec diff only adds the import and two helper calls. The helper uses the default timeout and has no literals.
- AC4 (`--repeat-each 10` at 2 workers): PASS on evidence. The log shows "Running 140 tests using 2 workers / 140 passed / exit=0". Each of the 140 throwaway-user emails in the log maps to the recorded id CSV.
- Protected files: none in the diff (checked against focus-presence-guard, state-surface-contrast-guard, ci.yml, playwright.config.ts, .gitignore, package-lock).
- CONSTRAINTS C1–C3:
  - C1 honoured. The probe defines "settled" as audit response received, no `Loading` text in `main`, then a 300 ms wait. It never calls the helper. The population divergence is recorded as a finding and the helper was not widened.
  - C2 honoured. The delay is 1500 ms, under 5 s.
  - C3 honoured. All probe sources and logs are persisted and cited with ref= paths.
- Proof evidence matches what the executor claimed:
  - natural-red: 2/20 iterations saw sort=0 / pop 14 at the heading.
  - natural-green: 10 passed. 2/10 of these also saw 0 at the heading, and all 10 had 5 after the helper.
  - delayed-red: 10/10 failed with sort=0.
  - delayed-green: 10 passed, 5/28.
  - mutant: 10/10 failed with sort=0 after the no-op helper.
- **Driver constraint not met (dev-DB residue).** files-modified.md says all residue was deleted by exact id and lists only 200 users and 40 dashboards. I queried every `uuid` column in `public` against the recorded 200 user ids. **20 `data_sources` rows ("HEL-813 Source") are still present**, owned by deleted repeat-run users. `data_sources.owner_id` has no FK, so deleting the users did not cascade to them. They come from surface 6's `POST /api/data-sources` (2 widths x 10 repeats). The ids are listed in Change Request 1. There are also 480 `audit_events` rows by those actors, but the HEL-471 trigger makes that table append-only (DELETE raises), so they cannot be removed and are not a change request. They should still be disclosed.
- Verified clean: 0 of the 200 user ids remain (checked by id and by email), 0 of the 40 dashboard ids remain, and `matt@helio.dev` is still present (1 row).

### Phase 2: Code Review — PASS

- Changed files match neither `frontend/**` nor `backend/**`, so the configured gates do not trigger. I ran these myself in WORKTREE_PATH and all exited 0: `npm run lint`, `npm run format:check`, `npm run check:e2e-types`.
- I also ran the touched spec once: `DEV_PORT=6768 nice -n 19 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts --workers 2` gave 14 passed, exit 0.
  - That run created 14 users, 4 dashboards and 2 data_sources. I recorded their ids in the scratchpad (`hel1336-eval-created-*`) and deleted them by exact id.
  - My run also left 36 append-only audit_events (unavoidable).
- Helper code:
  - Typed, small, web-first expects.
  - Scoping to `section` filtered by the "Audit history" heading matches the single `<section className="settings-page__section">` in `SettingsPage.tsx:136-139`, with no nested `<section>` ancestors.
  - It fails on the empty/error branches by design (D2).
  - The comment explains intent without restating the code.
- No dead code, no over-engineering, no new magic values. CONTRIBUTING.md import style is followed (named import from `./support/settingsReady`).
- `.npm-cache/` is untracked in the worktree and not committed. That is acceptable: the driver forbids touching .gitignore, and it stays out of the commit.

### Phase 3: UI Review — N/A

No trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The change is e2e tooling only, and the touched spec's live behaviour was re-verified above.

### Overall: FAIL

### Change Requests

1. Delete the 20 orphaned `data_sources` rows created by the repeat run, by exact id. They are not covered by the users delete, because `data_sources.owner_id` has no FK and so does not cascade:
   `0af953de-357f-4dce-95bc-707fda5d94fd, 105f0ca1-4fb6-4e52-ba3a-84437048728e, 3470b1ae-4ae0-432e-a414-c36a51538254, 3db7ab81-3b18-43d2-867f-a4e056b30d3e, 485a5293-3e59-4510-9691-25ea19e35405, 54ea662b-548e-4629-9094-262f445d588b, 6291c2a2-3625-4552-930f-c6cfd5ce5cf0, 7913f7b6-238b-4ddc-829c-0a64f093a73e, 7c4126fa-63a0-4d3f-9e6e-f82641b3eb62, 7dcb6308-064f-4484-bd68-b64485c77eb7, 8a6cba37-7e35-4bd6-88d3-b77182dca7bc, 8c61e53b-4317-4aa8-95c4-9f8b242ca1df, a4b4a69d-0df1-48d8-87a3-6abaa6dd7c0f, ab614902-ebfd-4db1-9a8c-2d2806a91aaf, b516a86b-3e10-4fa0-ab88-d8b54ccafc64, d2493abc-6e31-4368-8beb-4e45b0b8533c, d76f35b8-23d2-45f2-823d-b51039548821, e6cdf52b-2f76-450c-80bc-3c87af595517, f3d0343c-9861-419d-8ce9-35b3ea0b0e31, fbf2fbbd-c8d8-4309-a23a-dcc2d4b96f31`.
   - Confirm these ids yourself by re-deriving them from your recorded user-id CSV (`select id from data_sources where owner_id in (<your 200 ids>)`). Do not trust this list blindly. Persist the id list as evidence.
   - Then update `files-modified.md` § Residue to:
     - (a) list the data_sources ids as deleted;
     - (b) state that the post-delete check scanned every `uuid` column, not only `users`;
     - (c) disclose the 480 append-only `audit_events` rows (HEL-471 trigger) as un-deletable residue.

### Non-blocking Suggestions

- The 300 ms `waitForTimeout` in the probe's "settled" definition is fine for scratch evidence. Note in files-modified.md that it is probe-only and was never committed.
