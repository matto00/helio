## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: `GET /api/audit-events` route with pagination + filters (resourceType/resourceId/action/source/from/to), schema (`schemas/audit/audit-event-response.schema.json`) + openspec spec deltas (`specs/audit-query-api`, `specs/audit-events-ui`), frontend read-only list view reachable from Settings, Jest tests for the slice/thunk, `sbt compile test` / `npm test` green (verified independently below).
- No AC silently reinterpreted. Design.md's Decisions 6/6a/6b (no "MCP" label, actor-as-source not raw UUID, first-page-only v1) are explicit, ticket-consistent narrowings of "minimal frontend surface," not scope drift.
- All `tasks.md` items are marked `[x]` and match what's actually implemented (verified 1.1–5.4 against the diff).
- No scope creep found — diff is confined to the audit route/repo/UI/schema/spec files plus the required `ApiRoutes`/`store.ts`/`SettingsPage.tsx`/`renderWithStore.tsx` wiring.
- No regressions to existing behavior: `ApiRoutesSpec` (229 tests) and the full backend suite (3458 tests) pass; `PaginationProtocol.scala`'s diff is additive.
- API contract: schema + openspec spec added per convention; `npm run check:schemas` passes (67 protocols checked, in sync).
- Planning artifacts (design.md, tasks.md) reflect the final implemented behavior — cross-checked field-by-field against the diff.

### Phase 2: Code Review — FAIL

Ran independently (not trusting the executor's own reports):

- `sbt compile` — success.
- `sbt test` (full suite) — 3458 tests, all green, 220 suites.
- Targeted re-run of `AuditEventRepositorySpec` / `AuditEventRoutesSpec` / `ApiRoutesSpec` — 229/229 green.
- `npm run lint` — clean (zero warnings).
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` (frontend) — 2846/2846 tests, 259 suites, green.
- `npm run check:schemas` — in sync.
- `npm run check:openspec` — clean ("openspec/ is clean").

**Security (primary focus, adversarial pass):**

1. `AuditEventRepository.findPaged` (`backend/.../infrastructure/persistence/audit/AuditEventRepository.scala:91-115`) uses `ctx.withUserContext(callerUserId.value)` for the read — never `withSystemContext`. Confirmed by reading the actual code, not the comments. PASS.
2. `AuditEventRoutes` (`backend/.../api/routes/audit/AuditEventRoutes.scala`) parses no `actorUserId`/user-identity filter from the request at all — `user.id` (from `AuthenticatedUser`, resolved by `AuthDirectives`) is the only value ever passed as `callerUserId`. PASS.
3. Sort order `ORDER BY created_at DESC, id DESC` is genuinely implemented (`.sortBy(t => (t.createdAt.desc, t.id.desc))`, line 104), not just described in design.md. PASS.
4. UI never renders "MCP" as a distinguishable source (`actorLabel.ts` renders `mcp` generically as `You (mcp)`, never inferred from `pat`) and never renders a raw `actorUserId` (the response type doesn't even carry `actorUserId` to the table — only `source`/`actorTokenId`). Verified live in the browser: actor column showed "You (browser)", source column showed `ui` (lowercase wire value), no UUID anywhere. PASS.
5. **Tenant-isolation integration test (tasks.md 1.3) — does not actually prove what its own comment claims.** `AuditEventRepositorySpec`'s `"findPaged" should "let the app pool see only the calling user's own rows, never another user's, independent of the app-level actor filter's own contribution"` (lines 225-252) is bound to the real non-BYPASSRLS `helio_app_test` two-role harness (good — this part is genuine, unlike `AuditEventRoutesSpec` which correctly documents itself as *not* RLS-genuine). However, in `findPaged` the app-level defense-in-depth filter is *always* `actorUserId === callerUuid` — i.e., it is structurally identical to the RLS context user on every call (there is no `actorUserId` filter parameter that could diverge from `callerUserId`, unlike `findByActor`, whose sibling test at line 189 *can* construct that divergence because `findByActor(callerUserId, actorUserId)` takes both independently). Because of this, mentally substituting `ctx.withSystemContext` for `ctx.withUserContext(callerUserId.value)` inside `findPaged` **would not change this test's outcome at all** — the app-level `.filter(_.actorUserId === callerUuid)` clause alone already excludes `idB` regardless of whether RLS is active. The test's own comment (lines 233-243) acknowledges this ("if the app-level filter were hypothetically removed — RLS is the actual backstop") but never actually removes it, so the assertion is not independent of the app-level filter's contribution — the exact property the skeptic's round-1 finding required. This is the same vacuity concern the skeptic already flagged for the route-level test, now reappearing one layer down for the very test written to close it.
   - **This is a real, closeable gap**, not a nitpick: a future refactor that silently weakens/drops `withUserContext`'s RLS context (design.md's own stated risk in "Risks / Trade-offs") would not be caught by this suite, contrary to what tasks.md 1.3 and the test's own docstring claim.
   - Fix: add a test that can actually diverge the RLS context from the app-level filter — e.g., a raw-SQL probe on the app-pool connection (mirroring the existing `"prove the RLS context user is the caller, not the filter argument"` pattern for `findByActor`) that runs `SET LOCAL app.current_user_id = <userB>` and then executes `SELECT ... FROM audit_events WHERE actor_user_id = <userA>` directly (bypassing `findPaged`'s Scala-level filter entirely) to show RLS still returns empty; or add a temporary/parametrized variant of the query construction that can omit the app-level filter under a test-only hook, and show RLS alone still empty. Either approach breaks the "app filter and RLS context are always identical" structural coupling that currently makes this test unable to fail red for the scenario it claims to guard.

**Design-standard [mechanical] finding:**

- `AuditHistorySection.tsx` (lines 25-40) hand-rolls its empty state as a raw `<p className="audit-history-section__empty">No audit events yet.</p>` instead of the shared `EmptyState` component (`frontend/src/shared/ui/EmptyState.tsx`). This violates DESIGN.md §7 ("**Empty:** render `EmptyState` — never render nothing") and §6 ("Use these; do not hand-roll equivalents. **[mechanical]**"). This is not a style nit against an ambiguous precedent — the *same Settings page*, one section up, already does this correctly: `AgentMemoryList.tsx:57-66` wraps its "No memory stored yet" empty case in `<EmptyState variant="main" icon={faBrain} title="..." description="..." />`. `AuditHistorySection` should follow that exact adjacent precedent instead of inlining a bespoke paragraph.
  - The loading state (`<p className="audit-history-section__loading">`) is not flagged — it matches the established `MfaSecuritySection.tsx:87` per-section-gate loading pattern (F-047) already used elsewhere on this same page, so it is consistent with existing precedent rather than a fresh deviation.

**DRY / Readable / Modular / Type safety / No dead code / No over-engineering:** no issues found. `AuditEventFilters`, `AuditSource.fromString`/`asString`, and the repository's row-mapping helpers are reused/composed cleanly; no untyped escape hatches; no leftover TODO/FIXME; the frontend's `actionLabels.ts` static map with raw-string fallback is an appropriately minimal solution, not a premature abstraction.

**Error handling:** route returns 400 on malformed `from`/`to`/`source`, 401 via the existing `AuthDirectives` wrapper (verified in `ApiRoutesSpec`); frontend slice models `idle/loading/succeeded/failed` and the UI surfaces the error state (`role="alert"`) rather than swallowing it.

**Tests meaningful:** repository/route/slice tests each exercise a real code path and would catch a real regression, with the one exception noted above (item 5) where the specific assertion cannot distinguish RLS-active from RLS-bypassed given `findPaged`'s current signature.

### Phase 3: UI Review — PASS

Dev servers started via `scripts/concertino/start-servers.sh` (from the repo's canonical copy, since this worktree's `scripts/concertino/` is missing several newer scripts including `emit-event.sh`/`next-report-number.sh` — non-blocking, environmental staleness, worked around by invoking the main worktree's copies where the worktree's own were absent) and confirmed healthy via `assert-phase.sh servers` (`PASS servers`).

- **Happy path:** navigated Settings → Audit history; initially empty ("No audit events yet."); created a PAT (an audited action) and reloaded — the row appeared correctly: Action "Created personal access token", Resource "api_token (06197d6a-...)", Actor "You (browser)", Source "ui", timestamp formatted via `toLocaleString()`. Reachable from the account/Settings area per AC.
- **Unhappy paths:** error state renders as a visible `role="alert"` message (code-reviewed; not independently forced via a network-failure repro, but the pattern matches the rest of the settings page and is exercised in `AuditHistorySection.test.tsx`).
- **Loading/empty/error states present** — see Phase 2 finding on the empty state's non-compliant markup (still functionally present, not silently missing).
- **No console errors** observed during navigation, PAT creation, dashboard creation, or settings load (checked via `browser_console_messages` at `error` level — 0 errors each time).
- **Entry points:** reachable via the single specified path (Settings page), consistent with ticket scope (no other entry point required).
- **Accessible names / keyboard:** native `<table>`/`<th>`/`<td>` structure with proper column headers; loading/error states carry `aria-label`/`role="alert"`; no icon-only controls added by this change.
- **Breakpoints:** 1440, 768, and 375 (used in place of "0" as a concrete narrow-mobile width) all render without layout breakage; the audit table correctly becomes horizontally scrollable (`overflow-x: auto`, confirmed `scrollWidth` 451px vs `clientWidth` 327px at 375px) rather than overflowing the page.

### Overall: FAIL

### Change Requests

1. **`backend/src/test/scala/com/helio/infrastructure/persistence/audit/AuditEventRepositorySpec.scala:224-252`** — the `findPaged` tenant-isolation test cannot currently fail red if `ctx.withUserContext` were swapped for `ctx.withSystemContext`, because `findPaged`'s app-level defense-in-depth filter is always identical to the RLS context user (`callerUserId`), so the app-level filter alone already produces the asserted result. Add a test that can genuinely diverge RLS enforcement from the app-level filter — e.g., a raw-SQL probe on the `helio_app_test`-role connection (mirroring `findByActor`'s existing `"prove the RLS context user is the caller, not the filter argument"` test's divergence trick) that demonstrates rows are hidden by RLS even when queried independently of `findPaged`'s Scala-level `actorUserId` clause. Update the test's docstring/comment once it genuinely establishes this, rather than asserting a guarantee ("independent of the app-level actor filter's own contribution") the current test does not actually provide.
2. **`frontend/src/features/audit/ui/AuditHistorySection.tsx:25-40`** — replace the hand-rolled `<p className="audit-history-section__empty">No audit events yet.</p>` empty state with the shared `EmptyState` component (`frontend/src/shared/ui/EmptyState.tsx`), per DESIGN.md §6/§7 and the direct, same-page precedent at `frontend/src/features/settings/ui/AgentMemoryList.tsx:57-66`.

### Non-blocking Suggestions

- `AuditEventTable.tsx` renders both a derived "Actor" column (`actorLabel(event.source)`) and a raw "Source" column (`event.source`) side by side, which is slightly redundant for a v1 table (design judgment — deferred to skeptic, not a mechanical issue).
