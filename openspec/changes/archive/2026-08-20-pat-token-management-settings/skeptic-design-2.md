## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read all planning artifacts fresh from disk: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/settings-api-tokens-ui/spec.md`, `workflow-state.md` (confirms
  `SKEPTIC_CYCLE: 1`, `LAST_SKEPTIC_VERDICT: REFUTE (design gate round 1, ...) — revised
  design.md/tasks.md, re-running round 2`, i.e. this is genuinely round 2, not a relabeled
  round 1). Read round 1's own report (`skeptic-design-1.md`) as a claim to re-verify, not
  as fact.
- **Change request 1 (blank-name guard had no owner) — confirmed resolved, not just
  reworded.** `design.md`'s new "Blank-name guard" bullet explicitly names the
  `MfaSecuritySection.tsx:170,228` precedent and states the create form's submit button is
  `disabled` whenever the trimmed name is empty, demoting the backend's own
  `req.name.isBlank` check to defense-in-depth. Verified the cited precedent is real by
  reading `frontend/src/features/settings/ui/MfaSecuritySection.tsx` directly — lines 170
  and 228 both read `disabled={... || reauthCode.trim() === ""}`, exactly as claimed.
  `tasks.md` task 3.1 now cites this decision by name ("submit button `disabled` when the
  trimmed name is empty ... design.md 'Blank-name guard'"), and task 4.3's test list now
  explicitly includes "blank name leaves submit disabled and sends no request" — directly
  covering `specs/settings-api-tokens-ui/spec.md`'s "Blank name is rejected before
  submission" scenario, which previously had no owner anywhere in the plan.
- **Change request 2 (list-append timing contradiction) — confirmed resolved, not just
  reworded.** `design.md`'s "Shown-once reveal" bullet now states unambiguously that
  `createApiTokenThunk.fulfilled` does two things "in the same reducer, atomically": (1)
  sets `createdToken`, and (2) appends the response's metadata to `items` — "immediately,
  as an outcome of creation itself, not of a later action." It further states the "Done"
  button's `dismissCreatedApiToken` reducer "does **not** touch `items`, since that update
  already happened at create time." This now matches `tasks.md` task 2.2 exactly ("create
  appends to `items` client-side and sets `createdToken`" — one action, both effects) and
  removes the prior "once dismissed" language that risked the token not appearing in the
  list until the user clicked "Done," which would have failed
  `specs/settings-api-tokens-ui/spec.md`'s "Newly created token is shown once" scenario
  (raw value shown *and* "the token also appears in the list with its metadata" as an
  outcome of the create event itself).
- **Re-verified ground-truth claims independently** (not trusting round 1's report as
  fact): read `backend/src/main/scala/com/helio/api/protocols/ApiTokenProtocol.scala` —
  `CreateApiTokenResponse`/`ApiTokenResponse` field shapes (`lastUsedAt`/`expiresAt:
  Option[String]`, `scopedPipelineIds: Option[Seq[String]] = None`) match design.md's
  claims exactly. Read `frontend/src/features/settings/state/settingsSlice.ts` — confirmed
  the `preferences`/`agentMemory`/`mfa`/`betaAccess` sibling-sub-tree convention and the
  per-id `deleteStatus`/`deleteError` shape design.md proposes to mirror for `apiTokens`.
  Read `frontend/src/shared/ui/ConfirmInline.tsx` — props (`label`, `onConfirm`,
  `onCancel`, `confirmAriaLabel`) match what design.md assumes. Read
  `frontend/src/features/settings/ui/SettingsPage.tsx` — confirmed the fetch-on-mount
  `useEffect` pattern (`dispatch(fetchPreferences())`, `dispatch(fetchAgentMemory())`) the
  design proposes to extend with `fetchApiTokens`.
- Checked every spec scenario against tasks.md's test list (4.1-4.4): list render + empty
  state, shown-once reveal + dismiss-keeps-list-entry, blank-name-disabled, revoke
  confirm/cancel — all six spec scenarios now have an explicit owning test. No scenario is
  uncovered.
- No new contradictions, placeholders, or scope drift introduced by the revision; Non-goals
  (no expiration/scoping UI, no backend changes) are unchanged and still accurately reflect
  the ticket's AC surface.

### Verdict: CONFIRM

Both round-1 change requests are substantively resolved against the actual artifact text
(not superficially reworded), and independent re-verification against the real codebase
confirms design.md's factual claims still hold. The plan is sound: every AC and every spec
scenario traces to an explicit task and test, the two artifacts (design.md/tasks.md) now
agree on list-append timing, and reuse choices are grounded in real files.

### Non-blocking notes

- (Carried from round 1, still true, still non-blocking) `apiTokenService.ts`'s design
  could state the `?? null` normalization for `lastUsedAt`/`expiresAt` slightly more
  explicitly as a one-line acknowledgment of the recurring spray-json `Option`-omission
  gotcha, though design.md's Types-module bullet already does mention it in passing
  ("apiTokenService.ts's listApiTokens/createApiToken normalize lastUsedAt/expiresAt to `??
  null` at the service boundary, same pattern") — this is adequately captured; flagging
  only as a nice-to-have for extra explicitness in tasks.md 1.2, which already references
  it too.
