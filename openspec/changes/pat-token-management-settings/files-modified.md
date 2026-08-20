## Files modified

- `frontend/src/features/settings/types/apiToken.ts` — new `ApiTokenResponse`/`CreateApiTokenRequest`/
  `CreateApiTokenResponse` types mirroring `ApiTokenProtocol.scala`'s wire shapes.
- `frontend/src/features/settings/services/apiTokenService.ts` — new `/api/tokens` HTTP wrapper
  (`listApiTokens`/`createApiToken`/`revokeApiToken`), normalizing spray-json's absent-on-`None`
  `lastUsedAt`/`expiresAt` fields to `null` at the service boundary.
- `frontend/src/features/settings/services/apiTokenService.test.ts` — new: request/response shape +
  `Option`-omission normalization coverage for list/create/revoke.
- `frontend/src/features/settings/state/settingsSlice.ts` — new `apiTokens` sibling sub-tree
  (`items`/`status`/`error`, `createStatus`/`createError`/`createdToken`,
  `revokeStatus`/`revokeError` keyed by id); `fetchApiTokens`/`createApiTokenThunk`/`revokeApiTokenThunk`
  thunks; `dismissCreatedApiToken` reducer. `createApiTokenThunk.fulfilled` sets `createdToken` and
  appends the new token's metadata to `items` in the same reducer, atomically (design.md "Shown-once
  reveal").
- `frontend/src/features/settings/state/settingsSlice.test.ts` — new `apiTokens` reducer/thunk test
  suites (fetch, create incl. atomic `createdToken` + `items` append, dismiss, revoke incl. list
  removal).
- `frontend/src/features/settings/ui/ApiTokensSection.tsx` — new: list (name/created/last-used), empty
  state, create form with a trimmed-name blank-guard (`disabled` submit, matches
  `MfaSecuritySection.tsx`'s re-auth-form precedent), shown-once raw-token reveal panel with
  copy-to-clipboard, per-row `ConfirmInline` revoke.
- `frontend/src/features/settings/ui/ApiTokensSection.css` — new: styles mirroring
  `AgentMemoryList.css`'s card/table treatment and `MfaBackupCodesList.css`'s reveal-panel treatment.
  Cycle 2 (evaluation-1.md CR1): `.api-tokens-list-table__td`'s literal `padding: 8px 10px;` replaced
  with `padding: var(--space-2) var(--space-3);` (DESIGN.md mechanical spacing-token rule; widens
  horizontal padding by 2px, an accepted rounding to the nearest token pair).
- `frontend/src/features/settings/ui/ApiTokensSection.test.tsx` — new: list render, empty state,
  blank-name guard (disabled submit, no request sent), create + shown-once reveal + copy-to-clipboard +
  dismiss (removes reveal, keeps list entry), revoke confirm/cancel flow.
- `frontend/src/features/settings/ui/SettingsPage.tsx` — wires `<ApiTokensSection />` into a new
  "Personal access tokens" `<section>`, dispatching `fetchApiTokens()` in the page's existing
  fetch-on-mount `useEffect`, with its own loading/error gate (F-047 pattern, same as
  Preferences/Agent memory).
- `frontend/src/features/settings/ui/SettingsPage.test.tsx` — new tests: the section renders and
  fetches on mount; a failed fetch shows an error without blanking sibling sections.
- `frontend/src/features/settings/ui/AgentMemoryList.test.tsx` — added the new `apiTokens` sub-tree to
  this test's hand-rolled `SettingsState` preloadedState (required by the now-larger state shape; this
  component never reads/dispatches into it).

## Notes

- Frontend-only change, as scoped by the ticket — no backend modifications. `/api/tokens`
  (create/list/revoke) already existed and is unchanged.
- This worktree's branch carries two pre-existing commits (HEL-757, HEL-758) ahead of `main`'s current
  tip that are unrelated to this change (a known "branch-from-HEAD base noise" artifact from worktree
  setup) — not touched by this work. `git status`/`git diff` against `HEAD` (rather than `main...HEAD`)
  was used to scope this file list and gate selection to the files actually modified in this session.
