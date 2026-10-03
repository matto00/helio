# HEL-1002: AccessChecker.requireOwnerOnly returns 403 for a real-but-unowned resource, leaking existence to authenticated callers

## Description

`AccessChecker.requireOwnerOnly` (`backend/src/main/scala/com/helio/api/http/AccessCheckerImpl.scala:24-42`) returns `NotFound` for an absent resource and `Forbidden` for a real resource owned by someone else. The two denial arms are distinguishable, so any authenticated caller can learn whether a resource id exists under another tenant (403 vs 404). `CONTRIBUTING.md` requires existence-not-leaked semantics (cross-user/nonexistent -> 404, never 403). `AclDirective.authorizeResourceWithSharing` already returns 404 with the same body for the anonymous case. `requireAccess` should be reviewed for the same property. HEL-590 shipped a local `ShareTokenService` Forbidden->NotFound mapping that should be removed in favour of the shared fix.

## OWNER RULING (2026-10-03, binding)

- Collapse globally: `requireOwnerOnly` (and `requireAccess` if same property) returns 404 with an identical body for "exists but not yours" and "doesn't exist", across every owner-only route.
- Remove HEL-590's local `ShareTokenService` Forbidden->NotFound mapping.
- Per-route opt-in explicitly rejected.
- Legitimate 403s stay: tier gating (TIER_FORBIDDEN), Viewer-vs-Editor grants on a resource the caller can already see, scoped-PAT confinement to /api/hooks/*. Only "no grant at all" becomes 404.

## Acceptance criteria

- An authenticated caller cannot distinguish a real-but-unowned resource from a nonexistent one on owner-only routes (status and serialized body identical).
- Behaviour matches CONTRIBUTING.md existence-not-leaked semantics.
- Parametrised tests across every owner-only route fail if the two denial arms diverge again (red on main).
- HEL-590's local `ShareTokenService` mapping is removed.
- Frontend code keyed on 403 from these routes is updated; live check in both themes that a stranger's resource URL shows the normal not-found state.
- helio-mcp error mapping checked and updated if it keys on 403.
- `PublicRouteOwnerIdLeakSpec` (HEL-1216) not regressed.
