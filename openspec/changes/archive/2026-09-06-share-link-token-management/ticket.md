# HEL-590: Share-link token management (create, expiry, revoke)

## Description

Public read access to a dashboard's panels exists via `PublicDashboardRoutes`
(`backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala`),
gated by `AclDirective.authorizeResourceWithSharing`
(`backend/src/main/scala/com/helio/api/http/AclDirective.scala`), which grants a
public Viewer when a public-viewer grant exists. Sharing today is a coarse grant
with no per-link token, no expiry, and no revoke. To support embeds and shared
links safely, we need explicit, revocable share tokens.

NOTE: the two paths above are CORRECTED from the ticket text, which named
`api/AclDirective.scala` and `api/routes/PublicDashboardRoutes.scala`. Both are
stale. Use the corrected paths. See `premise-validation.md` evidence.

## Scope

* Backend: a share-token model — a token per shared dashboard (opaque,
  unguessable), with optional expiry and a revoked flag, persisted via a Flyway
  migration in `backend/src/main/resources/db/migration/`. A service for
  create/list/revoke and token validation.
* Integrate token validation into the sharing authorization path (extend
  `AclDirective`/`PublicDashboardRoutes` so a valid, unexpired, unrevoked token
  authorizes public read). No inline FQNs in Scala (CONTRIBUTING.md).
* Management routes (create/list/revoke) wired into the authenticated route
  tree; owner-only. Contract in `schemas/` + `openspec/` (CLAUDE.md).
* Frontend: share-management UI on a dashboard (create link, show URL, set/show
  expiry, revoke), copy-to-clipboard, accessible + responsive per DESIGN.md.

## Migration number

The migration for this change is **V101**. The ticket text says "main at V59" —
that is stale by forty versions. Latest on main is
`V100__zero_root_guard_rls_independent.sql` (commit c9e3c051). Re-derive the
number from the tree before writing the file; another run may land first. Never
copy a migration number from ticket text.

Flyway checksums the entire migration file including comments, and
`validateOnMigrate` defaults true. A number collision, or any post-hoc edit to
an already-applied migration, is a boot failure. Never edit an applied
migration; add a new one.

## Shared-database hazard

Every worktree on this machine shares one Postgres instance. A migration applied
from this worktree lands in the shared `flyway_schema_history` and can break an
unrelated run's dev-server gate. If an inconsistent-history state appears early,
diagnose it before assuming this change's own migration is at fault.

## RLS / superuser masking trap

Flyway migrates as bare `helio`, which has no BYPASSRLS. Local dev, CI, and
prod-dump replay all connect as a superuser, which masks RLS failures
completely. This has already caused a production incident (three failed deploys,
v0.7.x) and was the subject of HEL-974, merged as c9e3c051.

Concretely: a test spec that constructs `DbContext(db, db)` hands the SAME
superuser connection to both pools, so any test asserting an RLS-dependent
property passes vacuously. If any part of verification depends on RLS
behaviour, prove the harness uses two genuinely distinct pools AND add a
fixture-liveness assertion, or the gates certify nothing.

## The security property that matters most

Expiry/revocation is a SECURITY PROPERTY, not merely behaviour:

**An expired, revoked, or nonexistent share token must be indistinguishable from
one another to the caller.**

If a revoked token returns a different status, body, or timing than a token that
never existed, the endpoint becomes an existence oracle for private dashboards.

The denial shape to match already exists and has been read — do not invent a new
one. In `AclDirective.authorizeResourceWithSharing`, the anonymous-caller-with-
no-public-grant arm completes `StatusCodes.NotFound` with
`ErrorResponse(notFoundMessage)`, byte-identical to the resource-does-not-exist
arm. Match that exactly for all three of expired / revoked / nonexistent.

Token generation MUST be cryptographically random and unguessable: a CSPRNG
(e.g. `java.security.SecureRandom`), not `Random`, not a UUIDv4-as-secret
without justification, and never a sequential or derived id. The token must be
stored and compared in a way that does not itself leak (consider hashing at
rest); comparison must not be short-circuiting in a way that leaks by timing.

## Evidence standard

Before accepting any test as proof:
* Confirm the red arm can actually fire. A mutation that cannot go red is an
  instruction to weaken the assertion until it passes.
* Confirm the failure isolates to the intended step. A mutation that turns CI
  red at `npm run lint` before the gate runs proves the lint gate works and
  nothing else.
* Where two mutations produce the same observation, that is one axis wearing two
  labels, not two independent checks.

Validating that the ticket's stated facts are individually true is NOT the same
as confirming the mechanism they are supposed to imply.

## Acceptance criteria

* An owner can mint a share link, optionally set expiry, and revoke it;
  revoked/expired links stop authorizing access immediately.
* Valid tokens authorize public read through the sharing path; invalid ones are
  denied consistently, with no resource leak and no existence oracle: expired,
  revoked, and nonexistent tokens are indistinguishable in status, body, and
  timing.
* Only the owner can manage tokens.
* Schema/OpenAPI updated; backend covered by ScalaTest (create/validate/expire/
  revoke); frontend UI covered by Jest.
* Token generation uses a CSPRNG.

## Out of scope

* The embeddable iframe view (HEL-593, which this gates — consumes these
  tokens). Do not build toward it beyond not painting the design into a corner.
* Rendered PDF/PNG export (HEL-596/601).

## Binding standards

CONTRIBUTING.md (note especially: no inline fully-qualified names in Scala),
CLAUDE.md's API-contract rules, DESIGN.md for all frontend work.
