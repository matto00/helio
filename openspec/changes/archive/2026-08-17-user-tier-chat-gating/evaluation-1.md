## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

- **AC #1 not fully met end-to-end** ("A `free`-tier user gets a clear, non-generic error ... the
  frontend surfaces it as 'request access' rather than a raw failure"). The backend half is correct
  (`GET /api/assistant-conversations` → `403 {"code":"TIER_FORBIDDEN","message":"Chat access is
  limited during this rollout. Contact the workspace owner to request access."}`, live-verified).
  The frontend half is incomplete: `frontend/src/shared/chrome/SidebarBody.tsx:81-82` still contains
  a THIRD, pre-existing `fetchConversations()` dispatch site (`else if (section === "chat" &&
  conversations.status === "idle") { void dispatch(fetchConversations()); }`) that this ticket never
  gated on tier. This file is absent from `files-modified.md` and from design.md D9 / tasks.md 5.3,
  even though `ChatPage.tsx`'s own doc comment explicitly names it ("The list itself renders in the
  desktop sidebar via `SidebarBody.tsx`'s `chat` branch, not here"). Live-reproduced (see Phase 3):
  a fresh `free`-tier user landing on `/chat` sees a raw "Failed to load conversations." message in
  BOTH the sidebar and the main content area — never the CTA-less "Chat access is limited" `EmptyState`
  that `ActiveConversationPanel.tsx` correctly implements. This directly violates the
  `tier-gated-assistant-access` spec's own scenario: "no raw error message, toast of the raw payload,
  or generic failure state is shown."
- **Task 5.3 marked done but incomplete against its own stated scope.** Tasks.md 5.3 says "guard the
  `fetchConversations` dispatch on free tier" — the diff guards `ChatPage.tsx`'s and
  `QuickLauncherOverlay.tsx`'s own dispatches, but misses the sidebar's, so the checkbox overstates
  what was actually delivered.
- **Planning artifacts no longer match the implemented behavior.** design.md D9 states as a design
  invariant: "The `fetchConversations` dispatch is guarded on `tier === "free"` so the locked state
  never races a 403 into the list-error branch." The shipped code does not uphold this invariant for
  the sidebar's own list-fetch effect, and design.md was not revised to acknowledge the gap.
- All other ACs are addressed: AC #2 (beta daily cap + limit-reached notice) live-verified working
  correctly end-to-end (see Phase 3). AC #3 (owner unlimited, verified against the real allowlist
  config) live-verified working correctly end-to-end (see Phase 3).
- No scope creep observed; no unrelated changes found in the diff.
- No regression to unrelated existing behavior — `beta`/`owner` chat flows, non-chat sidebar
  sections, and every other exercised surface behave correctly.
- API contracts/schemas updated appropriately (`TierErrorResponse`, `tier` on the shared user JSON
  format) and consistently applied across register/login/OAuth/`/me`.

### Phase 2: Code Review — PASS

Gates (freshly re-run by the evaluator in `WORKTREE_PATH`, `CLEAN_WORKTREE` not set):

- `npm run lint` — clean (zero warnings).
- `npm run format:check` — clean.
- `npm test` — 186 + 1872 tests passed (helio-mcp + frontend suites), 0 failures.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size warning only, unrelated
  to this change).
- `cd backend && sbt test` — 3141 tests passed, 0 failed, 0 canceled. Migration log confirms Flyway
  applies V1..V86 then **V88** directly (V87 correctly absent from this worktree, reserved for
  HEL-698 — confirmed main now also has `V87__assistant_conversation_idempotency_key.sql` merged
  since this worktree branched, and this diff's V88 does not collide or renumber).

Code-quality review (CONTRIBUTING.md, DESIGN.md — no [mechanical] violations found):

- No inline FQNs introduced (all new imports are top-of-file; `check:scala-quality`'s rule is
  respected throughout the reviewed diff).
- `UserTier` is deliberately declared AFTER `PanelType` in `model.scala` to avoid colliding with
  `scripts/check-schema-drift.mjs`'s first-`fromString`-occurrence heuristic — verified the claim
  against the script itself; accurate.
- File sizes stay well under the ~250-line soft budget for every new/modified file.
- `AssistantDailyUsageRepository` correctly routes through `DbContext.withUserContext` (never raw
  `db.run`), and V88 gives `assistant_daily_usage` full `ENABLE`/`FORCE ROW LEVEL SECURITY` + an
  owner policy, with `RlsPolicyGuardSpec.rlsTables` updated — matches CONTRIBUTING.md's "Adding a new
  ACL'd table" checklist item-for-item, and matches the skeptic's design-gate CR1 resolution.
  RLS cross-user isolation is independently re-verified by `AssistantDailyUsageRepositorySpec`'s two
  dedicated RLS specs (real Postgres, non-BYPASSRLS role).
- Beta-cap enforcement (`INSERT ... ON CONFLICT ... WHERE message_count < :limit RETURNING`) is a
  single atomic statement; the concurrency test (15 parallel increments against `limit = 5`) confirms
  the count never exceeds the cap.
- `AssistantTelemetrySpec.scala`'s second, previously-unaccounted `AssistantConversationRoutes`
  constructor call site (design-gate skeptic CR2) is updated correctly.
- DRY / readable / modular: `ChatAccessService`/`ChatAccessError`/`UserTierConfig` are small,
  single-purpose, well-documented units; no unnecessary duplication found.
- Type safety: no untyped escape hatches; `UserTier`/`ChatAccessError` are closed ADTs.
- Error handling: `guard`/`checkConverseCap` fail closed (`Left(TierForbidden)`) for an unresolvable
  user id rather than throwing; converse's `assistantServiceOpt` 503-unavailable check and the tier
  gate/cap check compose correctly (tier gate is outermost, so a `free` user is denied before the
  503/model-availability check is ever reached — verified in the diff and confirmed live).
- Tests are meaningful and exercise real regressions: `AssistantConversationRoutesSpec`'s new "Tier
  gating" block asserts 403 with nothing persisted, 429 with exactly the pre-cap turn count
  persisted and zero model calls for the denied attempt, and owner bypass with no
  `assistant_daily_usage` row written — all of it live-verified matching the actual HTTP behavior in
  Phase 3.
- No dead code / no leftover TODO/FIXME found in the diff.
- No over-engineering: the tier gate is a single directive wrapping the whole route family, not a
  bespoke per-endpoint mechanism.
- Deploy plumbing (`infra/deploy-backend.sh`, `infra/.env.deploy.example`, `CLAUDE.md`'s env table)
  is complete and consistent with design.md D10.

### Phase 3: UI Review — FAIL

Dev servers started via the canonical script and confirmed healthy (`assert-phase.sh servers` → PASS).
Backend was restarted once with `HELIO_OWNER_EMAILS=mattheworr018@gmail.com` and
`HELIO_BETA_DAILY_MESSAGE_LIMIT=2` added to the worktree's `backend/.env` (gitignored, not part of the
diff) specifically to exercise task 6.8's unverified end-to-end claim per the orchestrator's
run-specific instructions — flagging this transparently since it changes the running config from what
the executor's session used. **Servers are left running** (backend + frontend) for the skeptic's final
gate, with this config still in place.

- **Happy path (owner, unlimited, past the beta cap) — PASS, live-verified.** Registered
  `mattheworr018@gmail.com` fresh; `GET /api/auth/me` returned `tier: "owner"` immediately (allowlist
  applied at signup, D4). Sent 3 converse messages in one conversation against a `HELIO_BETA_DAILY_MESSAGE_LIMIT=2`
  config — all 3 succeeded with real model responses, confirming `owner` genuinely ignores the cap
  (AC #3 fully satisfied against the real allowlist mechanism, not a unit-test default).
- **Happy path (beta, capped) — PASS, live-verified.** Promoted a fresh signup to `beta` via direct
  DB update (by design, no admin surface this pass). Messages 1 and 2 succeeded normally; message 3
  returned `429` and the composer rendered the exact expected notice — "Daily chat limit reached.
  Your conversation history is still here — the limit resets at the start of the next UTC day." —
  with the existing 4-message transcript still visible, matching design.md D9 precisely. Beta-at-cap
  could still list/read conversations normally (verified via reload).
- **Unhappy path (free tier) — FAIL, live-verified, reproduced cleanly from multiple fresh sessions.**
  A `free`-tier user (the default for a fresh, non-allowlisted signup) landing on `/chat` — via direct
  navigation, via the "Browse all conversations" link from the quick launcher, and on a hard page
  reload — sees a raw **"Failed to load conversations."** message in both the sidebar and the main
  content pane, not the CTA-less "Chat access is limited" `EmptyState`. Root cause: root-caused to
  `SidebarBody.tsx`'s own ungated `fetchConversations()` dispatch (see Phase 1). The **quick-launcher
  entry point alone** (opened while the left sidebar's active section is NOT "chat", e.g. from the
  Dashboards page) correctly shows the CTA-less `EmptyState` — confirming `ActiveConversationPanel.tsx`'s
  own tier check is implemented correctly and the defect is isolated to the one missed call site.
- Loading states: present and correct (`Loading conversations…`) for the surfaces that were gated
  correctly.
- Console errors: only the expected `403`/`401` network-log entries for denied/unauthenticated
  requests (standard browser behavior for any non-2xx fetch, not a JS exception); no unhandled
  exceptions observed in any tested flow.
- Entry points: `/chat` direct nav, quick launcher ("Open assistant"), and the quick launcher's
  "Browse all conversations →" link were all exercised; the defect reproduces on 2 of the 3
  (direct `/chat` nav and the quick-launcher's own "browse" link, since both land the sidebar on the
  "chat" section), not the quick launcher's own inline panel.
- Interactive elements: composer textbox and Send button have accessible names ("Message"/"Send");
  keyboard Enter-to-submit was attempted but did not submit (Send button had to be clicked
  explicitly) — not blocking for this ticket's scope (pre-existing `MessageComposer` behavior, not
  touched by this diff) but noted as a non-blocking observation below.
- Breakpoints (1440 / 1100 / 768 / 0(375)): no layout breakage at any width, including the mobile
  bottom-nav layout — the free-tier raw-error defect reproduces identically at every width (a
  content-correctness bug, not a responsive-layout bug).

### Overall: FAIL

### Change Requests

1. **Gate `SidebarBody.tsx`'s `fetchConversations()` dispatch on `free` tier, matching
   `ChatPage.tsx`/`QuickLauncherOverlay.tsx`'s own guard.**
   `frontend/src/shared/chrome/SidebarBody.tsx:81-82` (inside the `useEffect` that also fetches
   sources/pipelines/dataTypes/metrics) currently reads:
   ```
   } else if (section === "chat" && conversations.status === "idle") {
     void dispatch(fetchConversations());
   ```
   Add the same `currentUser?.tier === "free"` guard used in `ChatPage.tsx`/`QuickLauncherOverlay.tsx`
   (`state.auth.currentUser` is already read from the same Redux store) so a free-tier user's mere
   presence on the "chat" section never fires this fetch. Additionally, decide what the sidebar
   itself should render for a `free`-tier user in the "chat" section (today it falls through to
   `SidebarItemList`'s raw `error` prop even after the fetch is gated, since `conversations.status`
   would then stay `"idle"` with an empty list) — likely a locked/disabled state or simply hiding the
   chat list section, consistent with `ActiveConversationPanel`'s own CTA-less messaging. Update
   `files-modified.md`, design.md D9, and tasks.md 5.3 to name this file explicitly, mirroring how
   design.md D7 was revised at the design gate to explicitly name `AssistantTelemetrySpec.scala`'s
   second call site once it was found.
2. **Re-verify task 6.8's local end-to-end claim after the fix**, specifically the free-tier
   "request-access" scenario from a fresh `/chat` navigation and from the sidebar's own chat section
   (not only the quick-launcher path, which already passes) — this is the exact scenario 6.8's own
   file-note (see `files-modified.md`'s "Note on task 6.8") already flagged as unverified-by-the-
   executor's-session; this evaluation cycle supplies that verification and found the gap.

### Non-blocking Suggestions

- `MessageComposer`'s Enter-to-submit did not trigger a send in manual testing (the Send button had
  to be clicked explicitly) — pre-existing behavior, not touched by this diff, but worth a quick
  look in a follow-up if it's meant to work.
- Consider whether `frontend/src/shared/chrome/SidebarBody.tsx`'s "chat" branch should also react to
  `TIER_FORBIDDEN`/`CHAT_LIMIT_REACHED` semantics the same way `MessageComposer` does, for
  consistency, once Change Request 1 is addressed.
