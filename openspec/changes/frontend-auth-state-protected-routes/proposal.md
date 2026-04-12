## Why

The backend now enforces token-based authentication on all `/api/dashboards` and `/api/panels` routes, but the frontend has no concept of auth state. Without this change users see unauthenticated request failures with no recovery path, and there is no UI for login, registration, or logout.

## What Changes

- Add `authSlice` to the Redux store tracking `currentUser` and `status` (`idle | loading | authenticated | unauthenticated`)
- Add a `GET /api/auth/me` thunk that rehydrates auth state on app load from the active session cookie
- Add a `ProtectedRoute` wrapper component that redirects to `/login` when the user is unauthenticated
- Add a `/login` page with email/password form and a Google login button (Google OAuth is a placeholder — button renders but does not connect to a provider in this change)
- Add a `/register` page with email, password, and display name fields
- Add a logout button in the app header that calls `POST /api/auth/logout` and clears auth state
- Add a global Axios interceptor that catches `401` responses, clears auth state, and redirects to `/login`

## Capabilities

### New Capabilities

- `frontend-auth-state`: Redux slice and session rehydration — tracks `currentUser`, `status`, and exposes login/register/logout thunks
- `frontend-protected-routes`: Route-level auth guard and login/register pages
- `frontend-auth-ui`: Login page, registration page, and header logout button

### Modified Capabilities

- `request-authentication`: Frontend must now send the `Authorization: Bearer <token>` header on all API requests and handle `401` responses globally

## Impact

- **Frontend**: new Redux slice, new pages (`/login`, `/register`), updated React Router config, updated Axios service layer
- **API**: consumes existing `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, and new `GET /api/auth/me` endpoint
- **Backend**: `GET /api/auth/me` must be implemented (returns the authenticated user from the current session token)
- **No new external dependencies**: React Router and Axios are already in use; no new packages required
