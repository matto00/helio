# HEL-1248: Extend owner-id guard to image-upload 404 and connector-completion public routes

## Description

HEL-1216's generic `OwnerIdGuard` walks every PublicDashboardRoutes endpoint, but `GET /api/uploads/image/:id` (404 body) and `GET/POST /api/connectors/completion` (bad-token / refusal bodies) were audited by reading code only and not exercised, since they carry no owner-bearing data today. Add anonymous calls for those to `PublicRouteOwnerIdLeakSpec` so "every public route" is literally true and a future field there is caught.

origin_kind: followup
origin_ticket: HEL-1216

## Acceptance Criteria (from the ticket plus the driver brief)

- Enumerate every route reachable without authentication today (optional-auth and no-auth routes, share-token routes included) and compare with what `PublicRouteOwnerIdLeakSpec` exercises; list every further unexercised route.
- Each newly covered route gets an anonymous call in the guard spec (success where applicable, and the 404 / refusal / bad-token bodies), checked by `OwnerIdGuard`.
- A mutation shows the guard catches a leak on each newly covered route (temporarily add the owner id to that route's body: the spec goes red; revert).
- Prefer a structural check that fails when a new public route is added without coverage, if the route table makes that feasible; otherwise state why not.
- Do not change any route's behaviour unless a test finds a real owner-id leak; a real leak is a security finding, fixed and called out prominently.
- Backend tests only; no migration; no frontend change.
