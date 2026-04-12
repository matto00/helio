## 1. Types & Models

- [x] 1.1 Add `avatarUrl: string | null` to the `User` interface in `frontend/src/types/models.ts`
- [x] 1.2 Verify `AuthResponse` already includes the `user` with `avatarUrl` (no change needed if so)

## 2. Auth Service

- [x] 2.1 Add `oauthCallbackRequest(code: string, state?: string): Promise<AuthResponse>` to `frontend/src/services/authService.ts` — calls `GET /api/auth/google/callback` with code and state as query params

## 3. Auth Slice

- [x] 3.1 Add `handleOAuthCallback` async thunk to `frontend/src/features/auth/authSlice.ts` that calls `oauthCallbackRequest`, dispatches `setAuth` on success, and rejects with an error message on failure
- [x] 3.2 Wire `handleOAuthCallback.pending` / `fulfilled` / `rejected` extra reducers (pending → `'loading'`, fulfilled → `'authenticated'`, rejected → `'unauthenticated'`)

## 4. OAuthCallbackPage Component

- [x] 4.1 Create `frontend/src/features/auth/OAuthCallbackPage.tsx` that reads `code`, `state`, and `error` from `useSearchParams`
- [x] 4.2 On mount: if `error` param present → immediately navigate to `/login?error=oauth_failed`
- [x] 4.3 On mount: if `code` param present → dispatch `handleOAuthCallback({ code, state })`; on fulfilled navigate to `/`; on rejected navigate to `/login?error=oauth_failed`
- [x] 4.4 Add a `useRef` guard so the exchange call fires only once even in React StrictMode double-invoke
- [x] 4.5 Render a loading indicator ("Signing in…") while the exchange is in progress

## 5. Routing

- [x] 5.1 Add `/auth/callback` route in `frontend/src/app/App.tsx`, placed in the public (non-`ProtectedRoute`) section, rendering `<OAuthCallbackPage />`
- [x] 5.2 Confirm the route is NOT inside `<PublicOnlyRoute>` (the callback must be reachable even post-login in edge cases)

## 6. Login Page — Google Button & Error Display

- [x] 6.1 Enable the "Continue with Google" button in `LoginPage.tsx` (remove `disabled` and `title="Coming soon"`)
- [x] 6.2 Wire the button's `onClick` to perform a full browser navigation: `window.location.href = '/api/auth/google'`
- [x] 6.3 Read `error` query param via `useSearchParams` in `LoginPage.tsx`
- [x] 6.4 When `error === 'oauth_failed'`, render a user-friendly error message (e.g. "Google sign-in failed. Please try again.") using the existing `auth-error` CSS class or equivalent

## 7. App Header — User Identity

- [x] 7.1 In `AppShell` (`App.tsx`), read `currentUser` from `useAppSelector(state => state.auth.currentUser)`
- [x] 7.2 When `currentUser` is non-null and `avatarUrl` is non-null, render a circular `<img src={avatarUrl} alt="User avatar" />` in the header controls area
- [x] 7.3 When `currentUser` is non-null and `avatarUrl` is null, render an initials `<span>` (first letter of `displayName ?? email`) styled as a circular badge
- [x] 7.4 Render the display name (`currentUser.displayName ?? currentUser.email`) as a label next to the avatar/initials
- [x] 7.5 Add CSS for `.user-avatar` (circular, ~32px) and `.user-avatar--initials` (background color, centered text) in `App.css`

## 8. Tests

- [x] 8.1 Add unit tests to `authSlice.test.ts` for `handleOAuthCallback` — success and failure cases
- [x] 8.2 Add a test for `OAuthCallbackPage` that mocks `handleOAuthCallback` and verifies: (a) navigates to `/` on success, (b) navigates to `/login?error=oauth_failed` on failure, (c) navigates immediately on `error` query param
- [x] 8.3 Add a test for `LoginPage` verifying the error message renders when `?error=oauth_failed` is in the URL and is absent otherwise

## 9. Verification

- [x] 9.1 Run `npm run lint` — zero warnings
- [x] 9.2 Run `npm run format:check` — no formatting issues
- [x] 9.3 Run `npm test` — all tests pass (133 total)
- [x] 9.4 Manual smoke test: click "Continue with Google" on `/login` and confirm browser navigates to `/api/auth/google` (proxied to backend)
