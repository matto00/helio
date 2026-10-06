## Context

See proposal.md — Why. `SettingsPage.tsx` renders sections in order Appearance → Preferences → Agent memory → Security →
Personal access tokens → Beta access → Audit history. `AuditHistorySection.tsx` dispatches `fetchAuditEvents()` on
mount and renders, in order: a "Loading audit history…" `<p>` (status idle/loading) → then exactly one of
an error `<p role="alert">`, an `EmptyState` (zero events), or `AuditEventTable` (a `SortableTable` with 5
`SortableTh` columns, each a `.sortable-th__btn`). Every e2e user is created via `POST /api/auth/register`, which
writes an `auth.register` audit event (`AuthService.scala:132`), so on e2e flows the settled state is the table.

## Inventory (grep `/settings` and "Settings" across `e2e/*.ts`, `e2e/support/*.ts` on main `b16bfa1b3`)

| Spec | /settings use | Measures/counts? | Action |
| --- | --- | --- | --- |
| `focus-presence-guard.spec.ts` | population count | counts | OUT OF SCOPE (PR #774 / HEL-1330) |
| `state-surface-contrast-guard.spec.ts` | population count | counts | OUT OF SCOPE (PR #774 / HEL-1330) |
| `hel813-mobile-touch-target-floor.spec.ts` surface 2 (l.145) | swatch row, icon btn | measures boxes | gate |
| `hel813-mobile-touch-target-floor.spec.ts` surface 3 (l.173) | toast close | measures box | gate |
| `hel813-mobile-touch-target-floor.regression.spec.ts` Case A (l.194) | toast close | measures box | NOT touched (D3) |

All other `settings` hits are panel-settings dialogs ("Save panel settings", "Orders settings") or comments, not the
`/settings` route. No non-guard spec counts a population on `/settings`. The executor re-runs this grep in the
worktree and records the raw output as evidence; any additional hit found there is added to this table before code.

## Decisions

**D1 — Helper shape.** `e2e/support/settingsReady.ts` exports `waitForSettingsAuditTable(page: Page): Promise<void>`.
It scopes to the `<section>` whose heading is "Audit history" and waits (web-first `expect`, default timeout, no
timeout literal) for that section's `table` to be visible and for its first `thead .sortable-th__btn` to be visible.
Rationale: the table and all its header cells are committed in a single React render, so "first sort button visible"
implies all are present; this avoids hard-coding the column count 5 (PR #774's inline gate does `toHaveCount(5)`,
which breaks silently-to-loudly when a column is added). Alternative rejected: `waitForLoadState("networkidle")` —
indirect, slow, and blind to a render that follows the response. Alternative rejected: waiting for the loading `<p>` to
disappear — passes on the error/empty branches, i.e. on a page that is not the measured one.

**D2 — Fail, don't pass, on non-table states.** If the section settles to empty/error the helper times out. A readiness
gate that accepted those would let a measurement run against a different page shape; e2e users always have the
`auth.register` event, so a non-table state is itself a defect worth a red.

**D3 — Regression harness not touched.** Decisive reason: it mutates tracked CSS on disk and is excluded from CI by
three layers; running it at `--repeat-each 10` with 2 workers would race two workers on the same file mutation, so the
required repeat run would be invalid by construction. Recorded as inventoried-and-excluded, not silently omitted. Note:
the two hel813 call sites (D4) are AC-mandated *defensive* gates, not fixes for an observed partial-page measurement —
surface 3's `.toast__close` is `position: fixed` and surface 2's swatch row sits above the audit section, so neither is
known to be displaced by the late table today.

**D4 — Call sites.** In `hel813-mobile-touch-target-floor.spec.ts`, call the helper on the line immediately after each
`await page.goto("/settings");` (surfaces 2 and 3), before any interaction. No assertion, selector, viewport or timeout
in those tests changes.

**D5 — Proof is a scratch probe, not a committed spec.** HEL-1288 is cutting e2e CI time; a committed demo spec would add
cost for no gating value. The probe lives in the session scratchpad (own scratch Playwright config, `testDir` there,
`baseURL` `http://localhost:6768`, workers ≤ 2, `nice -n 19`), never in the commit. It registers its own user, UI-logs
in, calls `isolateLivePage`, `goto("/settings")`, waits for the Appearance heading, then records
(a) `main .sortable-th__btn` count and (b) a `main` interactive-element count, immediately, then again after
`waitForSettingsAuditTable`. Evidence required:
- RED (natural): ≥ 10 iterations un-delayed; report the distribution of at-heading counts vs full counts.
- RED (deterministic): `page.route("**/api/audit-events*")` delaying the response by a fixed amount; at-heading count
  of sort buttons must be 0 and population strictly lower than full.
- GREEN: with the helper, the count equals the full settled count in every iteration (delayed and un-delayed).
- MUTATION: helper body with its waits removed → the delayed probe's "after helper == full" check goes red.

**D6 — Repeat run.** `nice -n 19 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts --repeat-each 10
--workers 2` with `DEV_PORT=6768`, full log kept in scratchpad as `hel1336-repeat-*.log`. Every throwaway user it creates
(the spec logs `[HEL-1300 e2e] throwaway user: <email>`) is resolved to its exact id and deleted by id afterwards.

## Risks / Trade-offs

- [Helper coupled to `.sortable-th__btn` class / "Audit history" heading] → both are what PR #774 already keys on; a
  rename fails loudly (timeout), never silently.
- [Adds ~audit-fetch latency to 4 CI tests] → hundreds of ms total.
- [Shared dev DB residue from 120+ throwaway users] → recorded by id and deleted by id (D6).

## Planner Notes

- Self-approved: `skip_specs: true` (test tooling, no behaviour change); scratch-only probe (D5); regression harness
  excluded (D3). The driver asked for `--repeat-each 10` "on each touched spec"; D3 means only one spec file is touched.
