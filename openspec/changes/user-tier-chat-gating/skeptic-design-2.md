## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Treated round-1's report (`skeptic-design-1.md`) as a set of claims about what was wrong, and the
current `design.md`/`tasks.md`/`specs/*` as claims about fixes — verified both against ground truth
independently.

- **CR1 (RLS on `assistant_daily_usage`) — fixed, verified against real precedent.** D5 now states
  the table carries "full RLS (`ENABLE` + `FORCE ROW LEVEL SECURITY`, owner policy
  `user_id = current_setting('app.current_user_id')::uuid`)"; tasks.md 1.1/1.5 both encode it,
  including the `RlsPolicyGuardSpec.rlsTables` addition. Re-read the precedent tables myself:
  `V42__api_tokens.sql` (`ALTER TABLE api_tokens ENABLE/FORCE ROW LEVEL SECURITY` +
  `CREATE POLICY api_tokens_owner ... USING (user_id = current_setting('app.current_user_id')::uuid)`)
  and `V80__assistant_conversations.sql` (identical shape, `owner_id`) match D5's stated pattern
  exactly — not just referenced, actually structurally identical. Confirmed `DbContext.withUserContext`
  is a real method (`backend/src/main/scala/com/helio/infrastructure/DbContext.scala:50`, `SET LOCAL
  app.current_user_id` inside a transaction) with live callers doing exactly this pattern
  (`AssistantConversationRepository.scala`, `AgentPreferencesRepository.scala`,
  `PanelRepository.scala:232`) — D5's routing instruction is grounded, not aspirational. `RlsPolicyGuardSpec`
  is a genuine positive allowlist (confirmed again, `rlsTables: Set[String]` at line 53) so the task to
  add `"assistant_daily_usage"` to it is load-bearing, not decorative.
- **CR2 (`AssistantTelemetrySpec.scala:129` unaccounted call site) — fixed, verified line number still
  correct.** `grep -n "new AssistantConversationRoutes("` across `backend/src/test` and `backend/src/main`
  finds exactly three call sites: `AssistantConversationRoutesSpec.scala:209`,
  `AssistantTelemetrySpec.scala:129` (still line 129, still the 3-arg
  `(conversationService, assistantOpt, user)` form — unchanged since round 1, confirms my earlier
  finding wasn't stale), and the real `ApiRoutes.scala:560` construction site. Design.md D7 now says
  explicitly "**Both** test-side constructor call sites are in scope: `AssistantConversationRoutesSpec`
  *and* `AssistantTelemetrySpec.scala:129`, whose telemetry fixtures must use a tier/quota that still
  reaches the model call being measured (owner, or beta far under cap)." Tasks.md 3.4 repeats this by
  name. Resolved.
- **CR3 (unspecified EmptyState CTA) — fixed, and the fix is the better of the two options I offered.**
  D9 now reads "**title/description only, no `cta`**" and tasks.md 5.3 says "title/description only, NO
  `cta`, no composer" — the two artifacts agree (round 1's flagged inconsistency between them is gone).
  Checked this against `EmptyStateCta`/`EmptyStateProps` in `frontend/src/shared/ui/EmptyState.tsx`:
  `cta?: EmptyStateCta` is genuinely optional (`cta !== undefined ? <button.../> : null`), so omitting it
  entirely is a legitimate, already-supported code path — no new prop plumbing needed. Also checked
  `ActiveConversationPanel.tsx`'s own existing `effectiveId === null` branch (lines 68-77): it already
  renders `<EmptyState variant="main" icon={faComments} title=... description=... />` with **no `cta`**
  today, for the sibling "no conversations yet" state. The revised design's cta-less request-access state
  is therefore idiomatic with an existing, adjacent usage in the very same component — not an invented
  pattern.
- **CR4 (no task for AC #3's post-deploy verification) — fixed with a concrete, trackable task.** D10 now
  states AC #3 "closes in two tracked steps: (a) in-run — local end-to-end through the *same* env-var
  mechanism prod uses... (b) post-deploy — an explicit manual verification checklist in the PR body and
  the Linear closing comment." Tasks.md 4.2 makes this a real numbered task with concrete, checkable steps
  ("set `HELIO_OWNER_EMAILS=mattheworr018@gmail.com` on Cloud Run via `.env.deploy`, deploy, log in as that
  account on prod, confirm `/api/auth/me` shows `owner` and converse works past the beta limit") and
  task 6.8 covers the in-run half. This gives AC #3 an actual trackable path rather than an implicit
  assumption, which is what round 1 required — round 1 did not require the verification to already be
  *done* at the design gate (it can't be; nothing is implemented yet), only that it be planned as a
  concrete task, which it now is.
- **Non-blocking notes from round 1 — both addressed.** (a) D9 now explicitly scopes the
  `activeConversation.status === "failed"` raw-string branch out ("explicitly out of scope — with the
  fetch guard a free user never reaches it") rather than leaving it half-specified. (b) D4's ApiRoutes
  constructor language now reads "14-required-arg `ApiRoutes` constructor," matching the earlier
  clarification that the total signature is 33 params (14 required + 19 defaulted).
- **No regression / no new placeholders.** `grep -rn "TODO\|TBD\|FIXME\|figure out later\|placeholder"`
  across `design.md`, `tasks.md`, `proposal.md`, `specs/**/*.md` returns nothing. Confirmed no code has
  been written yet in this worktree (`git status --short` shows only the untracked
  `openspec/changes/user-tier-chat-gating/` dir; `git log` HEAD still matches `main`'s tip
  `0f3eaf1b`) — this is genuinely still the design gate, not execution bleeding through.
- **Cross-checked the 4 spec deltas for internal consistency with design.md/tasks.md.**
  `specs/tier-gated-assistant-access/spec.md`, `specs/user-tier-model/spec.md`,
  `specs/email-password-auth/spec.md`, `specs/google-oauth-login/spec.md`, and
  `specs/request-authentication/spec.md` all match D1/D4/D5/D6/D7/D8/D9's decisions (tier column +
  CHECK, allowlist promote-only semantics, 403 `TIER_FORBIDDEN`/429 `CHAT_LIMIT_REACHED` codes, RLS
  isolation scenario for `assistant_daily_usage`, `tier` riding `/api/auth/me` and register/login/OAuth
  payloads). No contradictions found between spec deltas and design.md.
- **Feasibility spot-check of D9's frontend plumbing** (not previously re-verified in round 1's report
  text, checked fresh here): `authSlice.currentUser: User | null` is a real field
  (`frontend/src/features/auth/state/authSlice.ts:21`) that `User` (adding `tier`) flows into via the
  existing rehydration path; `extractErrorMessage` is a real function in
  `assistantConversationsSlice.ts` that D9 proposes widening for the converse thunk only — grounded, not
  invented.

### Verdict: CONFIRM

All four round-1 change requests are genuinely resolved against ground truth (not merely asserted), both
non-blocking notes are addressed, and I found no new contradictions, ambiguity, scope drift, or missing
contract updates introduced by the revision. The design is sound enough to implement.

### Non-blocking notes

- `specs/tier-gated-assistant-access/spec.md`'s first requirement's scenario prose lists "any sibling
  conversation operations such as rename/pin/delete" as illustrative examples of what the 403 gate
  covers. There is no DELETE endpoint on `AssistantConversationRoutes` (confirmed again:
  `pathPrefix("assistant-conversations")` in `AssistantConversationRoutes.scala` exposes only
  GET/POST list-create, POST `:id/messages`, POST `:id/converse`, GET `:id`, PATCH `:id` — no DELETE).
  This is loose scenario-prose phrasing, not a formal requirement of new delete-gating behavior — the
  authoritative route enumeration lives in design.md D-context ("list/create/get/messages/converse/patch;
  no DELETE") and tasks.md 3.3, both of which are precise. Not blocking, but worth tightening the spec
  wording to "rename/pin" (drop "delete") before archive, so a future reader doesn't infer a DELETE
  endpoint exists.

### Process note

This worktree's `scripts/concertino/` still lacks `next-report-number.sh`/`persist-evidence.sh`/
`emit-event.sh` (same narrower sync round 1 flagged). Invoked all three by absolute path from
`/home/matt/Development/helio/scripts/concertino/...` as round 1 did — verified again these are
pure, argument-driven scripts with no worktree-local state, so this remains safe.
