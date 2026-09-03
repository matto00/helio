# HEL-951 Orphan E2E Spec Status Report

Measured against dev servers started via `scripts/concertino/start-servers.sh` at
`DEV_PORT=6383`, `BACKEND_PORT=9290` (this worktree's assigned ports), on
2026-09-03. `playwright.config.ts` sets `retries: 0`, so each run below is one
sample; a spec passing once is not thereby proven stable for CI's different
timing — see D3's residual-risk note (also called out in `design.md` Risks).
Every PASS-verdict spec below was run **twice** to sample for instability
(task 1.4); every run is stable across both samples. FAIL-verdict specs were
sampled **once only** — per D3, "fails" is not asserted as a stable verdict;
the disposition (quarantine + follow-up ticket) is identical whether the
failure is a stable defect or itself flaky, so a second run would not change
the outcome recorded here.

## Full 14-spec enumeration (ticket AC 10)

| # | Spec | Classification |
|---|------|-----------------|
| 1 | `hel813-mobile-touch-target-floor.spec.ts` | Already wired (ci.yml, pre-change) |
| 2 | `hel910-pipeline-to-dashboard-flow.spec.ts` | Already wired (ci.yml, pre-change) |
| 3 | `hel813-mobile-touch-target-floor.regression.spec.ts` | Deliberately excluded — anti-goal of this change, three-layer exclusion preserved (see below) |
| 4 | `auth-cookie-migration.spec.ts` | Orphan → PASS → globbed in |
| 5 | `hel665-message-composer.spec.ts` | Orphan → FAIL → quarantined (HEL-960) |
| 6 | `hel666-single-assistant-entry.spec.ts` | Orphan → FAIL → quarantined (HEL-960) |
| 7 | `hel716-panel-detail-tall-viewport-footer.spec.ts` | Orphan → FAIL → quarantined (HEL-961) |
| 8 | `hel773-top-anchored-mobile-nav-sheet.spec.ts` | Orphan → PASS → globbed in |
| 9 | `hel908-full-flow.spec.ts` | Orphan → PASS → globbed in |
| 10 | `hel908-step-card-split.spec.ts` | Orphan → PASS → globbed in |
| 11 | `hel908-tail-attach.spec.ts` | Orphan → FAIL → quarantined (HEL-962) |
| 12 | `hel908-trunk-reorder-drag.spec.ts` | Orphan → PASS → globbed in |
| 13 | `hel908-trunk-reorder-order.spec.ts` | Orphan → PASS → globbed in |
| 14 | `hel909-output-picker-panel-sheet.spec.ts` | Orphan → FAIL → quarantined (HEL-963) |

11 orphans total: 6 pass, 5 fail. None flaked between the two samples taken
of the 6 passers.

## Per-spec detail

### PASS (recommend: glob in, task 3)

| Spec | Run 1 | Run 2 | Notes |
|------|-------|-------|-------|
| `auth-cookie-migration.spec.ts` | 8/8 passed (17.9s) | 8/8 passed (17.0s) | Stable |
| `hel773-top-anchored-mobile-nav-sheet.spec.ts` | 11/11 passed (43.4s) | 11/11 passed (39.6s) | Stable |
| `hel908-full-flow.spec.ts` | 1/1 passed (5.3s) | 1/1 passed (5.7s) | Stable |
| `hel908-step-card-split.spec.ts` | 1/1 passed (3.4s) | 1/1 passed (3.6s) | Stable |
| `hel908-trunk-reorder-drag.spec.ts` | 1/1 passed (3.6s) | 1/1 passed (3.2s) | Stable |
| `hel908-trunk-reorder-order.spec.ts` | 1/1 passed (2.7s) | 1/1 passed (2.5s) | Stable |

### FAIL (recommend: quarantine via `testIgnore`, one follow-up ticket per root-cause group)

| Spec | Verdict | Observed error |
|------|---------|-----------------|
| `hel665-message-composer.spec.ts` | 1/1 failed | `getByLabel("Message")` not found at `/chat` — `expect(input).toBeVisible()` times out after 5000ms. Registration/login succeed; the composer's accessible-name lookup fails. |
| `hel666-single-assistant-entry.spec.ts` | 2/2 failed | Same symptom as above: `getByLabel("Message")` not found at `/chat` (both test cases in the file hit this at their first interaction with the composer). |
| `hel716-panel-detail-tall-viewport-footer.spec.ts` | 1/1 failed | Setup-phase `POST` to create the panel returns `400`, expected `201` (`expect(panelRes.status()).toBe(201)` fails before the test's actual UI assertions run). |
| `hel908-tail-attach.spec.ts` | 4/4 failed | `getByRole('button', { name: 'Add tail step' })` resolves to 0 elements, expected 2, in the first test; all four tests in the file fail (each depends on the same tail-attach affordance). |
| `hel909-output-picker-panel-sheet.spec.ts` | 4/4 failed | Panel-placement flow: after using the OutputPicker to place an Output, `.react-grid-item` (or `.mobile-panel-stack`) containing "Untitled Panel" never becomes visible — all four tests in the file fail at this or the equivalent assertion. |

## Root-cause grouping (task 2.1)

- **Group 1 — `hel665-message-composer.spec.ts` + `hel666-single-assistant-entry.spec.ts`.** Both fail on the identical symptom (`getByLabel("Message")` not found at `/chat`, immediately after a fresh register/login) at the first interaction with the message composer. Treated as one shared root cause, filed as **one** follow-up ticket. Note: `ANTHROPIC_API_KEY` IS present in this worktree's `backend/.env` (contrary to what the specs' own header comments might suggest as the likely blocker), so the failure is not simply "no live API key" — the composer's accessible name/visibility itself appears to have regressed or moved, which is exactly the kind of finding this ticket is scoped to report, not fix.
- **Group 2 — `hel716-panel-detail-tall-viewport-footer.spec.ts`.** Distinct symptom (400 on panel-creation `POST` in test setup, before the file's actual footer-visibility assertions ever run) — no shared cause with Group 1 or 3. Filed as its own follow-up ticket.
- **Group 3 — `hel908-tail-attach.spec.ts`.** Distinct symptom ("Add tail step" affordance not found — locator count 0 vs. expected 2). No shared cause established with Group 4 despite both being HEL-908-family specs; the symptoms are different UI affordances. Filed as its own follow-up ticket.
- **Group 4 — `hel909-output-picker-panel-sheet.spec.ts`.** Distinct symptom (placed panel never appears in the grid/stack). Not conflated with Group 2's panel-creation 400 — `hel909` places panels through the picker's own UI flow rather than a direct API call, and the failure text does not indicate a 400. Filed as its own follow-up ticket.

Four follow-up tickets total (2.2): one shared for Group 1, one each for Groups 2, 3, 4. **Ticket filing status:** all four are now filed — HEL-960 (Group 1, shared), HEL-961 (Group 2), HEL-962 (Group 3), HEL-963 (Group 4).

## `testIgnore` entry audit (task 4.4)

All five quarantine entries in `playwright.config.ts` carry a comment naming
their follow-up ticket (HEL-960/961/962/963 — real, filed Linear ids, not
placeholders), and the pre-existing `**/*.regression.spec.ts` entry's comment
names the on-disk-source-mutation reason. No `testIgnore` entry is without a
reason.

## Whole-suite run (task 7, design.md D7)

The exact committed-glob invocation (`npx playwright test`, no arguments) was
run once as a whole suite after tasks 3/4/6 landed — one process, one worker
group, `fullyParallel: false`, `retries: 0`, against the shared dev backend
and Postgres, exactly as CI will run it. **39 tests passed, 0 failed.**
Wall-clock: **~50s** (Playwright-reported `39 passed (49.7s)`; shell `real
0m50.173s`) — this replaces design.md's Risks-section estimate ("2 specs to
up to 12"); the actual measured number for the resulting 8 wired files
(2 pre-existing + 6 newly globbed) is under a minute. Nothing was red only in
the combined run, so no additional quarantine entries were needed beyond the
five from task 1/4. See `final-whole-suite-run.log` (persisted).
