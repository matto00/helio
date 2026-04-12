## Context

The backend now enforces `Authorization: Bearer <token>` on all dashboard and panel routes (see `request-authentication` spec). The session middleware validates tokens against `user_sessions`. The frontend currently has no auth state and no login/register UI — all API calls will fail with 401 unless auth is wired up.

Session tokens are stored in Redux after login and sent via `Authorization` header on every request. There is no HttpOnly cookie mechanism on the backend; the token is returned in the JSON response body and must be persisted client-side.

## Goals / Non-Goals

**Goals:**
- Track auth state in Redux (`authSlice`) so any component can react to authentication status
- Rehydrate the session on app load via `GET /api/auth/me` (avoids requiring re-login after refresh)
- Gate all app routes behind a `ProtectedRoute` wrapper; redirect to `/login` if unauthenticated
- Provide `/login` and `/register` pages
- Add a logout button to the app header
- Handle any `401` response globally — clear auth and redirect to `/login`

**Non-Goals:**
- Google OAuth integration (button renders as placeholder only)
- "Remember me" / persistent token storage (sessionStorage only in this change)
- Multi-tab auth synchronisation via storage events
- Backend implementation of `GET /api/auth/me` (tracked separately; this change consumes it)

## Decisions

### Token storage: sessionStorage (not localStorage)

**Decision**: Store the bearer token in Redux state (in-memory) and persist it to `sessionStorage` for page-refresh rehydration.

**Rationale**: `localStorage` persists indefinitely and is accessible across tabs, which is a larger XSS attack surface. `sessionStorage` is tab-scoped and cleared when the tab closes, which is acceptable for a developer dashboard tool. A future change can move to HttpOnly cookies when the backend supports it.

**Alternative considered**: HttpOnly cookie set by the backend — preferred long-term but requires backend changes outside this ticket's scope.

### Session rehydration: `GET /api/auth/me`

**Decision**: On app load, call `GET /api/auth/me` with the stored token. If it returns the user, the session is valid. If it returns 401, the token is stale and the user is redirected to login.

**Rationale**: The token's `expiresAt` field could be checked client-side, but clock skew and server-side revocation (logout from another tab) are not handled that way. A server round-trip is the authoritative check.

### Global 401 handling: Axios response interceptor on `httpClient`

**Decision**: Add a single response interceptor to the shared `httpClient` instance that catches 401s, dispatches `clearAuth`, and navigates to `/login`.

**Rationale**: Centralises auth error handling. Avoids duplicating error checks in every thunk. The interceptor needs access to the Redux store and the React Router history — both are singletons that can be imported directly. The interceptor must skip the dispatch/redirect if the failing request was itself `GET /api/auth/me` (to avoid a redirect loop during initial rehydration).

**Alternative considered**: Handling 401 in each thunk's `catch` block — rejected because it's duplicative and easy to miss.

### ProtectedRoute: redirect-on-render

**Decision**: `ProtectedRoute` reads `auth.status` from Redux. When `idle` or `loading`, it renders a loading spinner. When `unauthenticated`, it renders `<Navigate to="/login" replace />`. When `authenticated`, it renders `<Outlet />`.

**Rationale**: Consistent with React Router v6 patterns used elsewhere in the app. Avoids HOC wrapping.

### Auth token sent via Axios default header

**Decision**: When the user logs in or rehydration succeeds, set `httpClient.defaults.headers.common['Authorization'] = \`Bearer ${token}\``. On logout or 401, delete the header.

**Rationale**: All existing service calls (`dashboardService`, `panelService`, etc.) use `httpClient`. Setting the default header once means no changes to any individual service.

## Risks / Trade-offs

- **Token in sessionStorage is readable by JS** → Mitigated by the app's CSP (future concern); acceptable for current threat model
- **Interceptor needs store reference at module load time** → The store is a singleton created before `main.tsx` mounts React, so importing it directly is safe
- **`GET /api/auth/me` not yet on the backend** → The thunk will handle a `404` or network error by treating the user as unauthenticated; login flow still works

## Migration Plan

1. Implement `authSlice`, `authService`, and `ProtectedRoute` — no visual change until routing is updated
2. Update `App.tsx` and `main.tsx` routing to wrap existing routes with `ProtectedRoute` and add `/login`, `/register`
3. Wire the Axios interceptor in `httpClient.ts`
4. Test: login → see dashboard, refresh → stay logged in, logout → redirect to login, 401 from any API call → redirect to login
5. No data migration required; no backend schema changes
