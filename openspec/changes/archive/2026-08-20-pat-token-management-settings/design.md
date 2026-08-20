## Context

`/api/tokens` (create/list/revoke) already exists and is fully implemented (`ApiTokenRoutes.scala`,
`ApiTokenService`, HEL-148) — mounted under the authenticated route tree. No frontend surface consumes it
yet. The Settings page (`frontend/src/features/settings/`) already hosts several independent sections
(Preferences, Agent memory, Security/MFA, Beta access), each with its own Redux sub-tree on
`settingsSlice` and its own fetch/loading/error state gated per-section (F-047), following the same shape
repeatedly: a `services/settingsService.ts` HTTP wrapper, thunks in `settingsSlice.ts`, a `<Name>Section.tsx`
component under `ui/`.

## Goals / Non-Goals

**Goals:**
- Add a "Personal access tokens" section that lets a user create a named PAT, see the raw value exactly
  once, list existing tokens with name/created/last-used, and revoke one.
- Reuse every existing convention: `ConfirmInline` for revoke, `TextField`/`FormField` for the name input,
  `InlineError` for errors, per-section own fetch/loading/error state.

**Non-Goals:**
- No expiration or pipeline-scope UI (`expiresInDays`/`scopedPipelineIds` stay unset/`None` from this UI).
- No backend changes.

## Decisions

- **New `apiTokens` sub-tree on `settingsSlice`**, sibling to `preferences`/`agentMemory`/`mfa`/`betaAccess`
  (matches this slice's own documented convention: "one `settingsSlice` holding ... as sibling sub-trees").
  State: `items: ApiTokenResponse[]`, `status`/`error` (list fetch), `createStatus`/`createError`,
  `createdToken: CreateApiTokenResponse | null` (the shown-once reveal, cleared on acknowledgment — same
  pattern as `mfa.backupCodes`/`mfa.enrollment`), `revokeStatus`/`revokeError` keyed by id (matches
  `agentMemory.deleteStatus`/`deleteError`'s per-id shape).
- **New `frontend/src/features/settings/services/apiTokenService.ts`** (not folded into
  `settingsService.ts`) — `listApiTokens`, `createApiToken`, `revokeApiToken`, thin `httpClient` wrappers
  over `/api/tokens`. Kept separate because this is the only settings sub-feature backed by a distinct
  top-level route prefix (`/api/tokens`, not `/api/preferences`/`/api/agent/memory`); MFA's own HTTP calls
  already set this precedent (`authService.ts`, not `settingsService.ts`) for exactly this reason.
- **Types module** `frontend/src/features/settings/types/apiToken.ts`: `ApiTokenResponse`,
  `CreateApiTokenRequest`, `CreateApiTokenResponse` — mirrors `ApiTokenProtocol.scala` field names/shapes
  exactly (`lastUsedAt`/`expiresAt` optional; `scopedPipelineIds` omitted entirely, this UI never sends it).
  spray-json omits an absent `Option` field on the wire rather than serializing `null` (the same
  recurring gotcha `settingsService.ts`'s `normalizePreferences`/`normalizeMemoryEntry` already normalize
  for) — `apiTokenService.ts`'s `listApiTokens`/`createApiToken` normalize `lastUsedAt`/`expiresAt` to
  `?? null` at the service boundary, same pattern, so `ApiTokensSection.tsx` never has to special-case
  `undefined` vs `null`.
- **Shown-once reveal**: on `createApiToken` success, `createApiTokenThunk.fulfilled` does two things in
  the same reducer, atomically: (1) sets `createdToken` (drives the reveal panel — raw token in a mono
  `TextField`-style readonly display, copy-to-clipboard button reusing `MfaSecuritySection`'s
  `navigator.clipboard.writeText` + toast pattern), and (2) appends the response's metadata (everything but
  the raw `token` field) to `items` — client-side, no extra `GET` — so the new token is already present in
  the list underneath the reveal panel, immediately, as an outcome of creation itself, not of a later
  action. The reveal panel's "Done" button dispatches a separate `dismissCreatedApiToken` reducer that
  clears only `createdToken`, closing the reveal and exposing the (already-updated) list underneath —
  it does **not** touch `items`, since that update already happened at create time.
- **Blank-name guard**: matches the two existing MFA re-auth forms in this same feature
  (`MfaSecuritySection.tsx:170,228`, `disabled={... || reauthCode.trim() === ""}`) — the create form's
  submit button is `disabled` whenever the trimmed name is empty, so submitting a blank name never fires
  the thunk and never sends a request. No server round trip is needed to reject this case (the backend's
  own `req.name.isBlank` check in `RequestValidation.validateCreateApiTokenRequest` is defense in depth,
  not the primary guard the UI relies on).
- **Revoke**: per-row `ConfirmInline` (matches `AgentMemoryList` per-row delete exactly), calling
  `revokeApiTokenThunk(id)`; on success the row is removed from `items` client-side (matches
  `deleteAgentMemoryEntryThunk`'s reducer), no refetch needed.
- **Wiring**: `SettingsPage.tsx` gets a new `<section>` ("Personal access tokens") rendering
  `<ApiTokensSection />`, fetch-on-mount via a new `fetchApiTokens` thunk dispatched in the page's existing
  `useEffect`, following the `preferences`/`agentMemory` fetch-on-mount pattern already there (own
  loading/error gate, independent of the other sections per F-047).

## Risks / Trade-offs

- [Risk] A user navigates away before acknowledging the shown-once token, losing it from view (though not
  from the backend — it remains valid, just not re-displayable) → Mitigation: this exactly matches
  `mfa.backupCodes`'s existing shown-once behavior for backup codes; no new risk class introduced, and the
  ticket's own AC only requires it be shown once, not persisted client-side.
- [Risk] Client-side list append after create could drift from server truth if two tabs create tokens
  concurrently → Mitigation: acceptable staleness (matches every other list in this slice, e.g.
  `agentMemory.items`, which never revalidates against concurrent-tab writes either); a manual page refresh
  resolves it.

## Planner Notes

- Self-approved: no expiration/scoping UI (see proposal Non-goals) — the ticket's AC covers create/list/revoke
  only, and both fields are optional on the existing backend contract.
- Self-approved: separate `apiTokenService.ts` rather than extending `settingsService.ts`, following the
  `authService.ts`/MFA precedent already in this codebase for a route-prefix-distinct sub-feature.
