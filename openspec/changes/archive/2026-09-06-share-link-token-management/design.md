## Context

See proposal.md — Why. Constraints that actually shape the approach, all verified against the tree:

- `AclDirective` (`backend/src/main/scala/com/helio/api/http/AclDirective.scala`) is `class AclDirective(permissionRepo:
  ResourcePermissionRepository, registry: ResourceTypeRegistry)`. Its `authorizeResourceWithSharing` resolves the owner,
  then branches on `userOpt`; the anonymous branch consults `permissionRepo.hasPublicViewerGrant` and otherwise completes
  `404` with `ErrorResponse(notFoundMessage)` — byte-identical to the resource-absent arm. That is the denial shape to reuse.
- `PublicDashboardRoutes` (`.../api/routes/dashboards/PublicDashboardRoutes.scala`) receives a pre-resolved
  `userOpt: Option[AuthenticatedUser]` from `authDirectives.optionalAuthenticate` in `ApiRoutes.scala` and discards the
  returned `ResourceAccess`. `requireCsrfHeader` passes GETs unconditionally, so anonymous token GETs are unaffected.
- Owner-only management is done in the **service** via `AccessChecker.requireOwnerOnly(...)` returning
  `Either[ServiceError, ResourceAccess]`, completed through `ServiceResponse.run`; `PermissionService` is the template.
- `DbContext(db, privilegedDb)` exposes `withUserContext(userId)` (RLS-enforced app pool) and `withSystemContext`
  (BYPASSRLS). Most route specs build `new DbContext(db, db)`; RLS-asserting specs build two genuinely distinct pools.
- There is **no OpenAPI document**. `openspec/specs/<capability>/spec.md` is the durable contract; `schemas/**.schema.json`
  carries wire shapes and is gated by `scripts/check-schema-drift.mjs`, which matches a schema `title` to a Scala case
  class of the same name and diffs property names against its constructor parameters.
- `ApiTokensSection.tsx` is the existing shown-once-secret precedent (reveal + copy + Toast); `PipelineShareDialog.tsx`
  is the existing share-dialog shape. `Modal`, `ConfirmInline`, `StatusChip`, `EmptyState`, `Toast` are the primitives.

## Goals / Non-Goals

**Goals:**
- Add a token-bearing authorization path to sharing without altering the existing public-viewer grant path.
- Make expired / revoked / nonexistent / wrong-resource tokens indistinguishable to the caller.
- Keep the minted secret unrecoverable after creation.
- Leave HEL-593 (embed) able to consume the token without redesign.

**Non-Goals:**
- Rate-limiting or brute-force lockout on token presentation (see Risks; entropy is the control).
- Replacing the coarse public-viewer grant, per-panel tokens, token rotation, or an embed route.

## Decisions

**D1 — Transport: a `token` query parameter on the public read routes.** The share URL itself must carry the credential;
an iframe (HEL-593) cannot attach a request header. So the token arrives as `?token=<secret>` on the existing
`GET /api/dashboards/:id/panels` and `.../panels/:panelId/rows`. *Alternative rejected:* a custom header — unusable from a
plain link or iframe, which is the entire point. *Consequence accepted:* URLs carrying secrets land in browser history and
referrer headers; that is inherent to any share-link feature and is why expiry + revocation exist.

**D2 — Store a SHA-256 hash of the token, never the token.** The table holds `token_hash` (unique, indexed); lookup is by
hash of the presented value. This means (a) a database read never discloses a working credential, and (b) there is no
secret-to-secret comparison in application code at all, so the timing-safe-compare question is designed away rather than
answered. *Alternative rejected:* bcrypt/argon2 — those defend low-entropy human passwords; a 256-bit CSPRNG token is not
brute-forceable, and a per-request KDF would add cost to every anonymous read. *Alternative rejected:* plaintext at rest —
turns any read of the table into credential disclosure.

**D3 — Generation: `java.security.SecureRandom`, 32 bytes, base64url, no padding.** Matches existing precedent
(`ApiTokenService`, `AuthService`, `MfaService` all hold a `private val rng = new SecureRandom()`). 256 bits, well above the
128-bit floor the spec sets. Never a UUID, never `scala.util.Random`, never derived from the dashboard id or a timestamp.

**D4 — One validation predicate, one denial.** A `ShareTokenValidator` trait exposes
`authorizes(resourceType, resourceId, token): Future[Boolean]`. Every failure mode — unknown hash, revoked, expired,
bound to a different resource — returns `false` from the *same* call, and the directive funnels `false` into the *existing*
`complete(StatusCodes.NotFound, ErrorResponse(notFoundMessage))` line already used for "anonymous, no public grant". There is
deliberately no separate error type, no distinct status, and no distinct message anywhere in the token path — the
indistinguishability property is enforced by there being only one exit, not by three exits that happen to agree today.

**D5 — Token is a fallback authorization consulted whenever grant-based resolution denies.** The token must NOT be
confined to the anonymous branch. `authorizeResourceWithSharing` branches on `userOpt` first, so a logged-in non-grantee
falls into `complete(StatusCodes.Forbidden, ...)` and would never reach a token check placed in the anonymous arm — a share
link opened by any recipient who happens to hold a Helio session would break with a 403, and a second denial shape would
become reachable with a *valid* token, contradicting D4. Instead: resolve grant-based access exactly as today (owner →
`Owner`; grantee → `Editor`/`Viewer`); only when that resolution **denies** — the authenticated-no-grant 403 arm and the
anonymous-no-public-grant 404 arm alike — consult the token, granting `Viewer` if it is valid and otherwise completing the
denial that arm would have produced anyway. This preserves every existing outcome for every existing caller, keeps an
Editor grantee at `Editor` rather than demoting them to `Viewer`, and makes a valid token work regardless of session state.
`AclDirective`'s constructor gains the validator and `authorizeResourceWithSharing` gains a trailing
`shareToken: Option[String] = None`, so the two existing call sites compile unchanged. *Alternative rejected:* a second
directive method — would duplicate owner-resolution and denial logic, and duplicated denial logic is exactly how two arms
drift apart.

**D6 — Pools are assigned per method, deliberately.** Anonymous token validation has no `app.current_user_id` to set, so
`findActiveByHash` reads through `withSystemContext` (the BYPASSRLS pool), exactly as
`ResourcePermissionRepository.hasPublicViewerGrant` already does, carrying the inline justification comment `DbContext`
requires for privileged reads. Every owner-facing method — `insert`, `findByDashboard`, `revoke` — goes through
`withUserContext(userId)` instead, even though `requireOwnerOnly` has already checked ownership in the service. That
redundancy is the point: it means the RLS policy on `share_tokens` is actually exercised by shipped code, so the two-pool
spec in task 6.7 asserts a property the product depends on rather than one no path ever takes. RLS is therefore
defence-in-depth on the owner paths and explicitly **not** the boundary on the anonymous path — there the boundary is the
hash lookup plus the resource binding. Stated plainly so no reviewer or test mistakes one for the other.

**D7 — Migration V101, owner-only RLS (the V92 idiom).** `share_tokens` is keyed by `user_id` (the owner) plus
`dashboard_id`, with `ENABLE`/`FORCE ROW LEVEL SECURITY` and a `USING (user_id = current_setting('app.current_user_id')::uuid)`
policy, following `V92__connector_credentials.sql`. **Re-derive the number from the tree immediately before writing the
file** — it was V101 when this was planned (main at V100, `c9e3c051`) and another run may land first. Never edit an applied
migration: Flyway checksums the whole file including comments and `validateOnMigrate` defaults true.

**D8 — Frontend: a `DashboardShareDialog` built on `Modal`.** Structure follows `PipelineShareDialog`; the shown-once
secret handling follows `ApiTokensSection` (display once, copy via `navigator.clipboard` in try/catch, `Toast` on both
outcomes, explicit "cannot be shown again" copy). The shareable URL is composed **client-side** from `window.location.origin` (the
existing precedent in `ImagePanel.tsx`); the backend returns only the token secret, because no public/frontend base-URL
config exists in the backend today and deriving one from the request `Host` is wrong in production, where the frontend is
`helioapp.dev` and the backend a distinct Cloud Run host. Adding an env var for this is deliberately out of scope. Token
state renders as a `StatusChip` (Active / Expired / Revoked) with a
text label, never colour alone. Revoke uses `ConfirmInline` — Helio never uses `window.confirm` — with the Danger button
style reserved for the final confirm. Redux slice + service follow the `dashboardsSlice` / `dashboardService` idiom.

## Risks / Trade-offs

- **Anonymous requests are not rate-limited** (`RATE_LIMIT_*` keys on session or PAT id; the no-credential case is the
  tracked gap HEL-837) → a token endpoint is therefore online-guessable in principle. Mitigation: 256-bit entropy makes
  guessing infeasible by many orders of magnitude; this is the control, and D3 is what makes it load-bearing. Not solved
  here, and deliberately not worked around with a bespoke limiter that would diverge from HEL-837's eventual fix.
- **Timing is scoped to status and body, not wall-clock.** Two axes exist. The narrow one — an absent hash versus a
  present-but-revoked hash — is mitigated structurally: the same single indexed query runs in both cases and every state
  check happens in memory afterwards, so no failure path takes an extra query, branch, or round-trip. The dominant one is
  **not** mitigated and is stated honestly rather than papered over: an absent dashboard id short-circuits at
  `ownerResolver` after one query, while an invalid token against an existing private dashboard runs ownerResolver, then
  grant resolution, then the token lookup — three. Equalising that would mean issuing compensating dummy queries on the
  short path, which adds cost and complexity to every anonymous read to close a channel that is already largely
  pre-existing on the no-token path. Accepted as a named residual risk; the spec requirement is correspondingly worded to
  cover status and body, and this asymmetry is recorded rather than silently asserted away. If it is ever to be closed it
  belongs in its own ticket alongside the anonymous rate-limiting gap (HEL-837), not bolted on here.
- **Secrets in URLs** (D1) → mitigation: expiry and revocation are the designed response; the UI states the link is
  sensitive. Inherent to share links, not introduced by this design.
- **RLS assertions can pass vacuously.** `new DbContext(db, db)` hands the same superuser pool to both slots, so any
  RLS-dependent assertion written that way proves nothing — this masked a real defect through local, CI, and prod-dump
  replay and caused three failed v0.7.x deploys (HEL-974). Mitigation: the share-token RLS spec constructs two genuinely
  distinct pools *and* asserts fixture liveness (the app pool must be positively shown to be RLS-enforced — e.g. it can read
  its own row and cannot read another owner's — so a misconfigured fixture fails loudly instead of passing empty).
- **Shared Postgres across worktrees** → a migration applied here lands in the shared `flyway_schema_history`. If an
  inconsistent-history error appears, diagnose it before assuming this migration is at fault.
- **Schema-drift gate is strict**: every new `*.schema.json` `title` must match a Scala case class name with 1:1 property
  names, or be added to the script's `SKIP` set. A composed response shape will fail the gate unless handled deliberately.

## Planner Notes

Self-approved: query-param transport (D1), SHA-256-at-rest (D2), the token-as-fallback ordering and defaulted-parameter
signature change (D5), the per-method pool assignment (D6). None introduces an external dependency, a breaking API change, or scope beyond the
ticket; `authorizeResourceWithSharing`'s existing behaviour is preserved for every current caller.

Corrected from the ticket text: `AclDirective` is under `api/http/`, `PublicDashboardRoutes` under
`api/routes/dashboards/`, and the migration is V101, not V60. There is no OpenAPI file — the contract is
`openspec/specs/**` plus `schemas/**`. See the premise-validation evidence for the full check.
