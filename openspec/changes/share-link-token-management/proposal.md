## Why

Dashboard sharing today is a single coarse public-viewer grant: it is all-or-nothing, it never expires, and the
only way to withdraw it is to delete the grant entirely. There is no per-link identity, so a URL that leaks
cannot be individually revoked and its exposure cannot be time-boxed. HEL-593 (embeddable iframe view) is
blocked on having a revocable, expiring, unguessable token to embed, and shipping an embed on top of the current
coarse grant would widen the blast radius of a leaked link rather than narrow it.

## What Changes

- Introduce a **share token** per shared dashboard: opaque, CSPRNG-generated, unguessable, with an optional
  expiry and a revoked flag. Persisted by a new Flyway migration (V101 at time of writing; re-derived from the
  tree at write time, never copied from ticket text).
- Add a service covering create / list / revoke and token validation.
- Extend the sharing authorization path (`AclDirective` / `PublicDashboardRoutes`) so a valid, unexpired,
  unrevoked token authorizes public read. This **adds** an authorization path; the existing public-viewer grant
  path is unchanged and is not removed.
- Denial is a **security property, not a behaviour**: expired, revoked, and nonexistent tokens MUST be
  indistinguishable to the caller in status, body, and timing, or the endpoint becomes an existence oracle for
  private dashboards. The shape to match already exists — `404` with `ErrorResponse(notFoundMessage)`, identical
  to the resource-does-not-exist arm. No new denial shape is invented.
- Add owner-only management routes (create / list / revoke) to the authenticated route tree.
- Define the contract in `schemas/` and the OpenAPI document under `openspec/`.
- Add a share-management UI on a dashboard: create link, show URL, set and show expiry, revoke, copy-to-clipboard;
  accessible and responsive per DESIGN.md.

## Capabilities

### New Capabilities
- `share-link-tokens`: the share-token model, CSPRNG generation, storage at rest, expiry/revocation semantics,
  and the validation predicate — including the indistinguishability requirement across expired/revoked/absent.
- `share-link-management-api`: owner-only create/list/revoke endpoints and their request/response contract.
- `share-link-management-ui`: the dashboard-level UI for minting, inspecting, copying, expiring and revoking links.

### Modified Capabilities
- `acl-enforcement`: `authorizeResourceWithSharing` gains a token-bearing authorization path alongside the
  existing public-viewer grant path, with an explicitly non-discriminating denial.
- `public-dashboards`: public dashboard reads may additionally be authorized by presenting a valid share token.

## Impact

- Backend: `com.helio.api.http.AclDirective`, `com.helio.api.routes.dashboards.PublicDashboardRoutes`, `ApiRoutes`
  wiring, a new repository + Slick table, a new service, `JsonProtocols`, one new Flyway migration with RLS
  policies consistent with the sibling sharing-aware tables.
- Contract: `schemas/`, OpenAPI under `openspec/`.
- Frontend: a new Redux slice + service, and a share-management surface on the dashboard.
- Testing: ScalaTest over create/validate/expire/revoke plus the indistinguishability property; Jest over the UI.
  Any RLS-dependent assertion must run on two genuinely distinct pools with a fixture-liveness assertion —
  `DbContext(db, db)` makes such assertions vacuous.

## Non-goals

- The embeddable iframe view (HEL-593). This change only makes its token available; no embed route, no
  `X-Frame-Options`/CSP frame-ancestors work, no embed-specific rendering.
- Rendered PDF/PNG export (HEL-596/601).
- Replacing or deprecating the existing coarse public-viewer grant.
- Per-token scoping beyond the dashboard (no per-panel or per-output tokens), and no token rotation UX.
