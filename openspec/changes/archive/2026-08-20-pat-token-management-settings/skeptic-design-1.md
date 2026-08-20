## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/settings-api-tokens-ui/spec.md`, `workflow-state.md` (confirms this is round 1,
  `SKEPTIC_CYCLE: 0`).
- **Backend contract claims are accurate, not hypothetical.** Read
  `backend/src/main/scala/com/helio/api/routes/ApiTokenRoutes.scala`,
  `backend/src/main/scala/com/helio/api/protocols/ApiTokenProtocol.scala`,
  `backend/src/main/scala/com/helio/api/RequestValidation.scala` (lines 122-142,
  `validateCreateApiTokenRequest`), and the three schema files
  (`schemas/api-token.schema.json`, `create-api-token-request.schema.json`,
  `create-api-token-response.schema.json`). `POST/GET /api/tokens` and
  `DELETE /api/tokens/:id` exist, are fully implemented, and are mounted inside the
  authenticated route tree (`ApiRoutes.scala:606`,
  `apiTokenServiceOpt.fold(reject: Route)(svc => new ApiTokenRoutes(svc, authenticatedUser).routes)`).
  `CreateApiTokenResponse`/`ApiTokenResponse` field names match what design.md claims
  exactly (`lastUsedAt`/`expiresAt: Option[String]`, `scopedPipelineIds` optional and
  correctly scoped out of this UI). No backend changes are needed — proposal's claim is
  correct.
- **Reuse claims verified against real files, not assumed.** Read
  `frontend/src/features/settings/state/settingsSlice.ts` (full file — confirms the
  `preferences`/`agentMemory`/`mfa`/`betaAccess` sibling-sub-tree convention, the
  per-id `deleteStatus`/`deleteError` shape, `extractErrorMessage` helper, and the
  `dismissMfaBackupCodes`-style "shown once, cleared by a dismiss reducer" pattern the
  design proposes to mirror for `createdToken`); `frontend/src/features/settings/ui/AgentMemoryList.tsx`
  (per-row `ConfirmInline` + list-level `ConfirmInline`, exactly as design.md
  describes); `frontend/src/features/settings/ui/MfaSecuritySection.tsx` (the
  `navigator.clipboard.writeText` + `pushToast` copy pattern design.md cites, and the
  `disabled={... || value.trim() === ""}` blank-guard precedent already used twice in
  this same feature for MFA re-auth forms); `frontend/src/features/settings/services/settingsService.ts`
  and `frontend/src/features/auth/services/authService.ts` (confirms the
  `authService.ts`-not-`settingsService.ts` precedent for a route-prefix-distinct
  sub-feature, and the spray-json `Option`-omission normalization pattern this
  codebase has repeatedly needed); `frontend/src/shared/ui/{ConfirmInline,TextField}.tsx`
  (both support the props design.md assumes: `label`/`onConfirm`/`onCancel`/
  `confirmAriaLabel` on `ConfirmInline`, `mono`/`readOnly`-via-spread on `TextField`).
  Every concrete file/pattern reference in design.md checks out against the actual
  codebase — this is not hand-waved or hallucinated.
- Confirmed `frontend/src/features/settings/ui/SettingsPage.tsx` for the fetch-on-mount
  and per-section loading/error gate (F-047) pattern the design proposes to extend.

### Verdict: REFUTE

The grounding is solid and the conventions chosen are correct, but the plan has two
concrete gaps between the spec delta (the authoritative AC surface) and what
design.md/tasks.md actually commit to building and testing.

### Change Requests

1. **AC scenario "Blank name is rejected before submission" has no owner in the plan.**
   `specs/settings-api-tokens-ui/spec.md:32-34` requires: "WHEN a user attempts to
   submit the create form with a blank name THEN the create action is not submitted
   and no request is sent." Neither `design.md`'s Decisions section nor `tasks.md`
   mentions this behavior anywhere. Task 3.1 only says "create form (name `TextField`)"
   with no validation/disabled-submit decision recorded, and task 4.3's test list
   ("list render, empty state, create + shown-once reveal + dismiss removes reveal but
   keeps list entry, revoke confirm/cancel flow") does not include a blank-name test.
   This is a real AC left uncovered by any task, not an obvious implementer inference
   — the codebase's own precedent for this exact guard
   (`MfaSecuritySection.tsx:170,228`, `disabled={... || reauthCode.trim() === ""}`)
   should be named explicitly in design.md and tasks.md 3.1/4.3 should be updated to
   include it, so it isn't dropped during implementation.

2. **design.md's list-append timing contradicts tasks.md and risks violating the spec
   scenario it exists to satisfy.** `design.md`'s Decisions section states: "The list
   is refetched (or the new metadata appended client-side from the create response,
   minus the token) **once dismissed**" (emphasis on the actual wording) — i.e., the
   list update is described as happening when the user clicks "Done," not at creation
   success. But `tasks.md` task 2.2 says the append happens as part of
   `createApiTokenThunk`'s own reducer ("create appends to `items` client-side and
   sets `createdToken`" — one action, both effects). This matters because
   `specs/settings-api-tokens-ui/spec.md:23-26` requires, as the outcome of the
   *create* event itself (not a subsequent dismiss): "the raw token value is shown
   along with a copy action, **and the token also appears in the list with its
   metadata**." If an implementer follows design.md's literal "once dismissed"
   phrasing over tasks.md's, the token would not appear in the list until the user
   clicks "Done," failing this scenario for as long as the reveal panel is open.
   Revise design.md's wording to state unambiguously that the client-side list append
   happens in `createApiTokenThunk.fulfilled` (immediately on creation success,
   alongside setting `createdToken`), independent of `dismissCreatedApiToken` — matching
   what tasks.md 2.2 already (correctly) specifies — so the two artifacts don't send
   the implementer two different signals.

### Non-blocking notes

- The `apiTokenService.ts` design doesn't call out the spray-json `Option`-omission
  normalization this codebase has hit repeatedly (`settingsService.ts`'s
  `normalizePreferences`/`normalizeMemoryEntry`, called out in project memory as a
  recurring bug pattern) for `lastUsedAt`/`expiresAt`. In practice a `?? null`/`??
  "Never used"` at the display layer likely absorbs `undefined` the same as `null`, so
  this probably isn't a functional gap, but it's worth a one-line acknowledgment in
  design.md so the executor doesn't have to rediscover the gotcha from scratch.
