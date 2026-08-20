## 1. Frontend: types + service

- [x] 1.1 Add `frontend/src/features/settings/types/apiToken.ts` (`ApiTokenResponse`,
      `CreateApiTokenRequest`, `CreateApiTokenResponse`) matching `ApiTokenProtocol.scala`
- [x] 1.2 Add `frontend/src/features/settings/services/apiTokenService.ts`
      (`listApiTokens`, `createApiToken`, `revokeApiToken` over `/api/tokens`; normalize
      `lastUsedAt`/`expiresAt` `undefined` -> `null` at the service boundary, per
      `settingsService.ts`'s existing spray-json `Option`-omission pattern)

## 2. Frontend: state

- [x] 2.1 Add `apiTokens` sub-tree to `settingsSlice.ts`'s `SettingsState`
      (`items`, `status`/`error`, `createStatus`/`createError`, `createdToken`,
      `revokeStatus`/`revokeError` keyed by id)
- [x] 2.2 Add `fetchApiTokens`, `createApiTokenThunk`, `revokeApiTokenThunk` thunks +
      extraReducers (list refetch semantics per design.md; create appends to `items`
      client-side and sets `createdToken`; revoke removes from `items` client-side)
- [x] 2.3 Add `dismissCreatedApiToken` reducer clearing `createdToken`

## 3. Frontend: UI

- [x] 3.1 Add `frontend/src/features/settings/ui/ApiTokensSection.tsx` + `.css`: list
      (name/created/last-used), empty state, create form (name `TextField`, submit
      button `disabled` when the trimmed name is empty — matches
      `MfaSecuritySection.tsx`'s re-auth-form blank-guard precedent, design.md
      "Blank-name guard"), per-row `ConfirmInline` revoke
- [x] 3.2 Add the shown-once reveal panel (raw token, copy-to-clipboard via
      `navigator.clipboard.writeText` + toast, "Done" button dispatching
      `dismissCreatedApiToken`)
- [x] 3.3 Wire `<ApiTokensSection />` into `SettingsPage.tsx` as a new "Personal access
      tokens" section, fetch-on-mount via `fetchApiTokens` in the page's existing
      `useEffect`, own loading/error gate independent of other sections

## 4. Tests

- [x] 4.1 `apiTokenService.test.ts` — request/response shape for list/create/revoke
- [x] 4.2 `settingsSlice.test.ts` additions — `apiTokens` reducers/thunks (fetch, create
      incl. `createdToken` set, dismiss, revoke incl. list removal)
- [x] 4.3 `ApiTokensSection.test.tsx` — list render, empty state, create + shown-once
      reveal + dismiss removes reveal but keeps list entry, revoke confirm/cancel flow,
      blank name leaves submit disabled and sends no request
- [x] 4.4 `SettingsPage.test.tsx` — new section renders and fetches on mount
