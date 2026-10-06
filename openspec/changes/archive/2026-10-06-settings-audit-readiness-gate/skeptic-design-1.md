## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `b16bfa1b3a74905eefc0208a01793efa047909c5` (branch `task/settings-audit-readiness-gate/HEL-1336`, == main; only the untracked change dir differs).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/settings-audit-readiness-gate/HEL-1336`.
- **The inventory is complete.** I ran a case-insensitive `settings` grep over `e2e/**/*.ts|*.mjs`, excluding the panel-settings dialog strings. `/settings` route hits:
  - `hel813-mobile-touch-target-floor.spec.ts:145,173`
  - `hel813-mobile-touch-target-floor.regression.spec.ts:194`
  - the two out-of-scope guards (`focus-presence-guard.spec.ts:193,233`, `state-surface-contrast-guard.spec.ts:591`)

  Every other hit is a comment. I also looked for specs that reach `/settings` by navigation rather than `goto`:
  - The only in-app navigation to `/settings` is in `SidebarBody.tsx:192` and `ActiveConversationPanel.tsx:110`, both labelled "Request access in Settings". No e2e spec references that label, because the grep above would have matched "Settings".
  - The palette specs (`hel503`, `hel510`, `hel516`, `hel519`) fill only resource names, "theme" and "?". None navigates to Settings.
  - `hel520-focus-presence-guard.regression.spec.ts` navigates only to `/login` and `/pipelines/:id`.
  - No spec imports a route list from the guard specs.

  The inventory table matches the tree.
- **Premise:**
  - `AuditHistorySection.tsx` dispatches `fetchAuditEvents()` on mount and renders loading, then failed (`role="alert"`), then empty (`EmptyState`), then `AuditEventTable`, as described.
  - `SettingsPage.tsx:136-139` places it in the last `<section className="settings-page__section">` with an `<h2>Audit history</h2>`.
  - Sections are siblings under `.settings-page__sections`, not nested. A `section` that has the "Audit history" heading therefore resolves to exactly one element, so there is no strict-mode ambiguity.
- **D1 "first sort button visible means all are present" holds.**
  - `AuditEventTable.tsx`'s `HEADER_COLUMNS` is a static 5-entry module constant passed whole to `SortableTable`. No column is conditional, so every `SortableTh` (`shared/ui/SortableTh.tsx:34`, `.sortable-th__btn`) commits in the same render as the table.
  - I found no `@media`/`display:none` in `AuditEventTable.css` or `AuditHistorySection.css` that would hide the table at 430/768 px.
- **D2 "red on empty/error" is sound for e2e users.**
  - `AuthService.scala:132` calls `audit(Some(createdUser.id), "auth.register")` after the user and session are committed.
  - The UI login also writes `auth.login` (line 181).
  - The settled state for every e2e user is therefore the table, and a timeout on the empty or error state is a correct loud failure.
  - The expect timeout is Playwright's default of 5 s. `playwright.config.ts` sets only `timeout: 30_000` and has no `expect.timeout`, so a helper with no timeout literal inherits sane defaults.
- **D3 regression-harness exclusion is justified by its decisive reason.**
  - `regression.spec.ts:30` sets `test.skip(!process.env.HEL813_REGRESSION)`.
  - `playwright.config.ts:42` has `testIgnore "**/*.regression.spec.ts"`.
  - The `ci.yml:396-415` comment records the exclusion.
  - Case A (l.186-215) rewrites `TOAST_CSS` on disk. A 2-worker `--repeat-each 10` run of it would race two workers on one file, so the driver's "repeat on each touched spec" would be invalid by construction if it were touched. The exclusion is recorded, not omitted silently.
- **No assertion or timeout changes.**
  - D4 adds one helper call after each `page.goto("/settings")` (spec l.145, l.173). No existing `expect`, selector, viewport or `setTimeout` changes, and the helper carries no timeout literal.
  - None of the protected files (`ci.yml`, `playwright.config.ts`, `.gitignore`, `frontend/package-lock.json`, the two guard specs) is in the planned file set.
- **D5 probe:**
  - The route `GET /api/audit-events` exists (`features/audit/types/auditEvent.ts:24`), so `**/api/audit-events*` matches.
  - The deterministic-delay RED, the GREEN, and the mutation step together meet the driver's "prove needed and prove it fixes it" constraint for a count.
  - Keeping the probe out of the commit is consistent with HEL-1288's CI-time work.
- **AC coverage:**
  - Inventory: design table plus task 1.3.
  - Helper in `e2e/support/` used in the measuring specs: tasks 2.1/2.2.
  - No assertion or timeout change: task 2.2 verify.
  - `--repeat-each 10` at 2 workers: task 3.4.
  - Driver constraints (ports, `nice`, id-based cleanup, scratch prefix): tasks 1.2, 3.x, 4.1.
  - No uncovered AC. No scope beyond the ticket.

### Verdict: CONFIRM

### Non-blocking notes

1. **D3 contains a rationale that is internally inconsistent.** Its first argument is that `.toast__close` is `position: fixed` and so cannot be displaced by the late table. That applies equally to hel813 surface 3, which this change *does* gate. It also nearly applies to surface 2: the Preferences swatch row sits above the audit section, and content appended below cannot shift it. Say plainly that the two hel813 call sites are AC-mandated *defensive* gates (the ticket says "use it in those specs"), not fixes for an observed partial-page measurement. Rest D3 on its decisive reason, the on-disk mutation race and CI exclusion. Otherwise the final gate may read the inclusion of surface 3 and the exclusion of Case A as contradictory.
2. **D5 GREEN on the population metric (b) may fail for reasons unrelated to this helper.** Preferences, Agent memory, MFA, Personal access tokens and Beta access each fetch independently and can settle *after* the audit table. "After helper == full settled count" for the whole-`main` interactive population is therefore not guaranteed by an audit-only gate. Three things follow:
   - Define "full settled count" independently of the helper, for example after every section loader is gone plus the audit response, never by calling the helper itself (that would be tautological).
   - If metric (b) diverges, record it as a scope finding rather than widening the helper silently.
   - Metric (a), sort-button count, is the clean proof.
3. **The delay used in the deterministic RED must stay below the default 5 s expect timeout.** Otherwise the GREEN arm times out inside the helper.
4. **Make the probe source and logs durable.** Pass the probe source and the `hel1336-probe-*`/`hel1336-repeat-*` logs through `persist-evidence.sh` and cite the `ref=` paths in `files-modified.md`, so the final gate can re-run and read them rather than taking them on report.
5. When PR #774 / HEL-1330 lands, the guard specs' inline `toHaveCount(5)` gate becomes a natural consumer of this helper. Worth a line in the PR body; out of scope here.
