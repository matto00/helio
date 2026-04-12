## 1. Backend: GET /api/auth/me

- [x] 1.1 Add `GET /api/auth/me` route to `ApiRoutes.scala` — protected by the existing session middleware, returns the current user from the resolved session
- [x] 1.2 Add a JSON formatter for the `User` response type in `JsonProtocols.scala` if one does not already exist
- [x] 1.3 Write a ScalaTest scenario for `GET /api/auth/me` with a valid token, an expired token, and a missing token

## 2. Frontend: Auth Service

- [x] 2.1 Create `frontend/src/services/authService.ts` with functions: `loginRequest`, `registerRequest`, `logoutRequest`, `getMeRequest`
- [x] 2.2 Update `httpClient.ts` to export a `setAuthToken(token: string | null)` helper that sets or removes `Authorization: Bearer <token>` from `httpClient.defaults.headers.common`
- [x] 2.3 Add a response interceptor to `httpClient.ts` that catches 401 responses, dispatches `clearAuth`, and navigates to `/login` — skipping the redirect if the request URL is `/api/auth/me`

## 3. Frontend: Auth Slice

- [x] 3.1 Create `frontend/src/features/auth/authSlice.ts` with state shape `{ currentUser: User | null, token: string | null, status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated' }`
- [x] 3.2 Implement `setAuth` and `clearAuth` actions; `setAuth` calls `setAuthToken` and writes to `sessionStorage`; `clearAuth` calls `setAuthToken(null)` and removes from `sessionStorage`
- [x] 3.3 Implement `rehydrateAuth` thunk: reads token from `sessionStorage`, calls `getMeRequest`, dispatches `setAuth` on success or `clearAuth` on 401/error
- [x] 3.4 Implement `login` thunk: calls `loginRequest`, dispatches `setAuth` on success, rejects with error message on failure
- [x] 3.5 Implement `register` thunk: calls `registerRequest`, dispatches `setAuth` on success, rejects with error message on failure
- [x] 3.6 Implement `logout` thunk: calls `logoutRequest` with current token (fire-and-forget on error), always dispatches `clearAuth`
- [x] 3.7 Register `authReducer` in `store.ts`

## 4. Frontend: Auth Types

- [x] 4.1 Add `User` type to `frontend/src/types/models.ts` with fields `{ id: string, email: string, displayName: string | null, createdAt: string }`
- [x] 4.2 Add `AuthResponse` type `{ token: string, expiresAt: string, user: User }`

## 5. Frontend: Protected Routing

- [x] 5.1 Create `frontend/src/components/ProtectedRoute.tsx` — renders `<Outlet />` when authenticated, spinner when loading/idle, `<Navigate to="/login" replace />` when unauthenticated
- [x] 5.2 Create `frontend/src/components/PublicOnlyRoute.tsx` — redirects to `/` when `auth.status` is `'authenticated'`, otherwise renders `<Outlet />`
- [x] 5.3 Update `App.tsx` (or router config) to wrap `/` and `/sources` inside `ProtectedRoute`, and wrap `/login` and `/register` inside `PublicOnlyRoute`
- [x] 5.4 Dispatch `rehydrateAuth()` in the app root (e.g., in `main.tsx` before mounting or via a `useEffect` in `App.tsx`) so auth status is known before the first render

## 6. Frontend: Login Page

- [x] 6.1 Create `frontend/src/features/auth/LoginPage.tsx` with email and password inputs, a submit button, and a "Continue with Google" placeholder button
- [x] 6.2 Wire the form to dispatch the `login` thunk; show an inline error message on rejection; disable the submit button while `auth.status === 'loading'`
- [x] 6.3 Add a link to `/register` on the login page
- [x] 6.4 Add basic CSS for the login page layout (centered card)

## 7. Frontend: Registration Page

- [x] 7.1 Create `frontend/src/features/auth/RegisterPage.tsx` with email, password, and optional display name inputs
- [x] 7.2 Add client-side validation: password must be at least 8 characters (show inline error before submitting)
- [x] 7.3 Wire the form to dispatch the `register` thunk; show inline error on rejection; disable submit while loading
- [x] 7.4 Add a link to `/login` on the registration page

## 8. Frontend: Header Logout

- [x] 8.1 Add a logout button to the `App.tsx` header, visible only when `auth.status === 'authenticated'`
- [x] 8.2 Wire the button to dispatch the `logout` thunk; navigate to `/login` on completion

## 9. Tests

- [x] 9.1 Write unit tests for `authSlice`: `setAuth`, `clearAuth`, `rehydrateAuth` (valid token, expired token, no token), `login` (success, failure), `logout`
- [x] 9.2 Write a unit test for the 401 Axios interceptor: verify `clearAuth` is dispatched and navigation to `/login` occurs on a 401, and that `GET /api/auth/me` 401 does not cause an additional navigation call
- [x] 9.3 Write unit tests for `ProtectedRoute`: renders children when authenticated, redirects when unauthenticated, shows loading when idle
