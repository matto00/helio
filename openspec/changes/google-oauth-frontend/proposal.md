## Why

The "Continue with Google" button on the login page is currently rendered but disabled — users have no way to complete a Google OAuth login. HEL-32 (backend) has shipped the callback endpoint that returns a JSON `AuthResponse`, so the frontend can now wire up the full round-trip.

## What Changes

- The "Continue with Google" button on `/login` becomes functional: clicking it navigates the browser to `GET /api/auth/google`.
- A new `/auth/callback` route is added to handle the browser redirect that Google issues after the backend processes the authorization code. The page reads the JSON response body, dispatches `setAuth`, stores the token in `sessionStorage`, and navigates to `/`.
- OAuth errors (`/login?error=oauth_failed`) surface a visible, user-friendly message on the login page instead of a silent failure.
- The app header gains a user avatar and display name (drawn from `auth.currentUser`) when the user is authenticated. The `User` model is extended with `avatarUrl` to carry the Google profile picture URL.
- The `frontend-auth-ui` spec is updated to reflect the Google button becoming functional and the new header user identity display.
- The `frontend-auth-state` spec is updated to reflect the `avatarUrl` field on `User` and the new `handleOAuthCallback` thunk.

## Capabilities

### New Capabilities

- `google-oauth-callback-page`: A `/auth/callback` React route that completes the OAuth flow by reading the backend JSON response and dispatching `setAuth`, then redirecting to `/`.
- `oauth-error-display`: Display of a user-friendly error message on `/login` when an `error` query parameter is present (e.g. `?error=oauth_failed`).
- `header-user-identity`: Avatar image and display name shown in the app header when the user is authenticated.

### Modified Capabilities

- `frontend-auth-ui`: Google login button changes from disabled/non-functional to active (redirects to `/api/auth/google`). Header gains user identity display.
- `frontend-auth-state`: `User` type gains `avatarUrl: string | null`. New `handleOAuthCallback` thunk parses the callback response and dispatches `setAuth`.

## Impact

- **`frontend/src/types/models.ts`** — `User` interface gains `avatarUrl: string | null`.
- **`frontend/src/features/auth/authSlice.ts`** — new `handleOAuthCallback` thunk.
- **`frontend/src/features/auth/LoginPage.tsx`** — Google button enabled; reads `?error` query param and renders error message.
- **`frontend/src/app/App.tsx`** — adds `/auth/callback` route (public, outside `ProtectedRoute`).
- **New `frontend/src/features/auth/OAuthCallbackPage.tsx`** — callback handler component.
- **`frontend/src/app/App.tsx` (AppShell)** — header shows avatar + display name when authenticated.
- **No new npm dependencies** — uses existing React Router, Redux, and the `User` type already in the store.
- **No backend changes** — the backend API contract (JSON `AuthResponse` from `/api/auth/google/callback`) is already shipped.
