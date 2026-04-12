## Context

The backend (HEL-32) exposes two OAuth endpoints:

- `GET /api/auth/google` — redirects the browser to the Google consent screen.
- `GET /api/auth/google/callback` — receives the authorization code from Google, exchanges it, and returns `200 OK` with `{ token, expiresAt, user }` as JSON.

The critical implementation detail is that the callback **returns JSON, not a server-side redirect**. When Google finishes the OAuth flow it redirects the browser to the callback URL. The backend processes the code and responds with JSON. The browser (now at `/api/auth/google/callback?code=…`) receives this JSON as the page body — so a dedicated frontend route at `/auth/callback` cannot intercept this response via fetch; instead, the frontend must redirect the browser to a frontend route that reads the backend's response using a `fetch`/axios call.

**The correct flow therefore is:**

1. User clicks "Continue with Google" on `/login` → browser navigates to `GET /api/auth/google`.
2. Backend 302-redirects the browser to Google's consent screen.
3. User authenticates; Google 302-redirects the browser to `GOOGLE_REDIRECT_URI` (set to the backend callback URL, e.g. `http://localhost:8080/api/auth/google/callback?code=…`).
4. Backend receives the code, exchanges it, and returns `200 OK` with the JSON `AuthResponse` body directly to the browser.
5. The browser renders that JSON. A frontend route at `/auth/callback` **cannot** catch this — the redirect goes to the backend URL, not a frontend URL.

**Resolution:** `GOOGLE_REDIRECT_URI` in the backend `.env` should be set so that the backend callback ultimately issues a redirect to a frontend page (e.g. `/auth/callback`) carrying the token in the URL fragment or query string. However, that would require a backend change. The cleaner approach that matches the existing backend behavior (returns JSON directly) is to configure `GOOGLE_REDIRECT_URI` to a **frontend** URL (e.g. `http://localhost:5173/auth/callback`), and have the backend proxy-aware Vite dev server forward `GET /auth/callback` calls to the backend. But that path is also complex.

**Chosen approach (no backend change):** Configure `GOOGLE_REDIRECT_URI` to point to the backend callback URL as it does today, but have the backend callback **redirect to the frontend** after success/failure. Since this is a backend change, and the ticket says "no backend changes", we use an alternative:

The backend callback at `/api/auth/google/callback` returns JSON. The frontend must set `GOOGLE_REDIRECT_URI` to a route that the Vite proxy does **not** handle — a dedicated frontend SPA route `/auth/callback`. Vite's proxy only proxies `/api/*` and `/health`. A request to `/auth/callback?code=…` stays in the SPA. This means the frontend's `/auth/callback` component must call the backend's callback endpoint **programmatically** via axios, forwarding the `code` and `state` query params.

**Final flow:**

1. User clicks "Continue with Google" → browser navigates to `GET /api/auth/google` (proxied to backend).
2. Backend redirects to Google (302).
3. Google redirects to `GOOGLE_REDIRECT_URI` = `http://localhost:5173/auth/callback?code=…` (the frontend SPA route).
4. React Router renders `<OAuthCallbackPage />` which reads `code` (and optional `error`) from the URL.
5. If `error` is present → navigate to `/login?error=oauth_failed`.
6. If `code` is present → component calls `GET /api/auth/google/callback?code=…&state=…` via axios.
7. On 200 → dispatch `setAuth`, navigate to `/`.
8. On error → navigate to `/login?error=oauth_failed`.

This requires `GOOGLE_REDIRECT_URI` to be `http://localhost:5173/auth/callback` in dev and the production equivalent in prod. This is a **configuration** change to `.env`, not a backend code change.

## Goals / Non-Goals

**Goals:**

- Wire up the Google login button to initiate the OAuth flow.
- Handle the OAuth callback in the SPA (`/auth/callback`) by programmatically calling the backend callback endpoint.
- Dispatch `setAuth` on success; navigate to `/login?error=oauth_failed` on failure.
- Surface a user-friendly error message on the login page when `?error=oauth_failed` is present.
- Display user avatar and display name in the app header post-login.
- Extend the `User` type with `avatarUrl: string | null`.

**Non-Goals:**

- Changes to the Scala backend code.
- Persisting the originally-requested URL for post-login redirect (redirect to `/` always).
- Server-side session cookies (existing token-in-sessionStorage model is unchanged).

## Decisions

### D1: Frontend handles callback via programmatic fetch, not page-level redirect

**Decision:** `GOOGLE_REDIRECT_URI` points to the frontend SPA at `/auth/callback`. The `OAuthCallbackPage` component calls `GET /api/auth/google/callback?code=…` via axios rather than relying on the browser to land on a backend-rendered response.

**Alternatives considered:**

- *Backend returns JSON directly (current behavior assumed by ticket)*: Would require the browser to land on the backend URL, rendering JSON — no SPA can intercept this. Not viable without a backend redirect.
- *Backend redirects to frontend with token in fragment/query*: Clean pattern, but requires a backend code change outside this ticket's scope.

**Rationale:** This keeps all changes frontend-only and works with the existing backend behavior by treating the backend callback as a regular API endpoint callable from the SPA.

### D2: Error query param on `/login` drives error display

**Decision:** OAuth failure (either an `error` param on the callback, or a failed backend call from `OAuthCallbackPage`) redirects to `/login?error=oauth_failed`. `LoginPage` reads this query param on mount and renders an error message.

**Alternatives considered:**

- Redux error state for OAuth failure: Would require the login page to watch a transient error flag; messier state lifecycle.
- Separate `/login/error` route: Unnecessary complexity.

**Rationale:** Query params are the idiomatic way to pass transient intent across SPA navigation without Redux state.

### D3: `avatarUrl` added to `User` type; backend already returns it

**Decision:** Add `avatarUrl: string | null` to the `User` interface in `models.ts`. The backend's `AuthResponse` already includes `avatarUrl` in the user object (per the `google-oauth-login` spec). The field will be `null` for email/password users.

**Rationale:** No backend changes needed; the field is already present in the JSON for Google users.

### D4: Avatar display in header is a simple `<img>` with initials fallback

**Decision:** When `currentUser.avatarUrl` is non-null, render a small circular `<img>`. Otherwise show the first letter of `displayName` or email in a styled `<span>`. This avoids an external avatar library.

## Risks / Trade-offs

- **`GOOGLE_REDIRECT_URI` misconfiguration** → OAuth will fail silently or with a Google error page. Mitigation: document the required env var value in the backend `.env.example` and in this change's notes.
- **`OAuthCallbackPage` double-fires in StrictMode** → React 18 StrictMode double-invokes effects; the `code` exchange will be called twice, and Google's OAuth codes are single-use. Mitigation: use a `useRef` guard to ensure the exchange call fires only once per code value.
- **Null `avatarUrl` for existing email/password users** → The header must safely handle `null`. Mitigation: initials fallback per D4.
- **Public `/auth/callback` route must be outside `ProtectedRoute`** → If it lands inside the protected wrapper, unauthenticated users will be redirected to `/login` before the callback can complete. Mitigation: explicitly place the route in the public section of `App.tsx`.
