## Context

HEL-821/822/536 shipped the Connector entity, encrypted-credential storage, and dependent-aware
deletion — all backend, no UI. HEL-824 builds the UI. Planning surfaced a real gap: HEL-821's
design.md explicitly deferred credential rotation ("not-yet-built operation... noted as a
follow-up finding"), but HEL-824's own acceptance criteria require rotation to work,
demonstrated. **Escalated to the human 2026-08-27; resolved: build it now, minimally scoped, as
part of this ticket** (not a separate spinoff) — see Decision 1.

Rotation is not an edge case: it's the ordinary credential lifecycle. Combined with HEL-822's now
-real `dependentCount` deletion guard, its absence produces an unrecoverable state — an expired or
leaked key can't be updated, and the Connector can't be deleted while sources depend on it. The
user's only escape is deleting every dependent source first. This finding was also already on
HEL-821's own triage list ("credential rotation UX"), so it's known-missing scope, not invented.

Both flagged backend risks from the run brief were independently re-verified against the current
tree and confirmed already fixed on main (HEL-822 cycle 2): `implicit` is server-owned on both
POST and PATCH (`ConnectorEntityService.withServerOwnedImplicit`), and no-auth Connector creation
is supported (`cred.isEmpty && authType != "none"` carve-out in `create`). No further work needed
on either.

## Goals / Non-Goals

**Goals:** Connectors CRUD UI (list/create/edit/delete), a working, minimally-scoped credential
rotation path (backend + UI), implicit-Connector presentation, dependent-aware delete UX,
connection-test reuse, touch-target coverage, a reusable credential-entry component for HEL-829.

**Non-Goals:** REST source form parity / retiring the dual-support create path (HEL-827),
request/response body shaping (HEL-826), agent/MCP surface (HEL-828), source authoring against a
Connector (HEL-820 child 6), in-chat credential capture (HEL-829 — only the reusable component is
in scope here), SQL/S3/GCS/BigQuery/Sheets connector kinds (v1.9, form must not hardcode REST but
does not need to render other kinds' fields yet), a general rework of the existing non-secret
`PATCH` (rotation stays a dedicated operation, per Decision 1).

## Decision 1: Credential rotation is a dedicated write-only endpoint, minimally scoped

`PUT /api/connectors/:id/credential` — accepts `{ "credential": "<new value>" }` only. Kept
**separate** from the existing `PATCH /api/connectors/:id` (which continues to reject any
credential/secret field, unchanged) rather than adding a credential field to the general update:
rotating a secret and renaming a Connector are different operations with different blast
radii — a credential riding along in a general-purpose PATCH body is materially easier to leak
into a log, an audit-event payload, or an agent request accidentally.

**Persistence approach — mirror `create`'s existing pattern, in the SAME layer `create` lives
in** (skeptic design-round-1 CR2: `create`'s two-step-plus-compensation orchestration lives in
`ConnectorRepository.create`, not the service — `ConnectorEntityService` has no
`ConnectorCredentialRepository` dependency today and its scaladoc states it "Never calls
`ConnectorCredentialRepository.decryptForUse`"; `ConnectorRepository`'s own scaladoc states it is
where "the actual encrypted-secret lifecycle" is delegated. Rotation follows that boundary rather
than crossing it). So: **`ConnectorRepository.rotateCredential(id, newPlaintext, credentialName,
user): Future[Either[ConnectorRotationError, Connector]]`** — `ConnectorRepository`'s existing
constructor already takes a `ConnectorCredentialRepository` (`create`/`delete` already use it),
so no new dependency needs wiring anywhere. In this repository method:
1. `credentialRepo.create(ownerId, credentialName, newPlaintext)` — mints a NEW credential row,
   encrypted via `EncryptedSecretBackend.encrypt` exactly as Connector creation does. Fails
   closed (no row written) on `MasterKeyError.NoKeyConfigured` or any other backend error —
   consistent with HEL-536.
2. Scoped by `findByIdOwned` first (not-found for another user's Connector id, matching
   `update`/`delete`), updates `credential_id` on the `connectors` row (under
   `withUserContext`) to point at the new credential id.
3. Best-effort delete the OLD credential row via `credentialRepo.delete`, mirroring `create`'s own
   existing compensation pattern for its analogous two-step write: if step 2 fails, compensate by
   deleting the just-created new row (never leave the connector pointing at nothing); if step 3
   (old-row cleanup) fails, the orphaned old row is inert — nothing references it — and is an
   accepted gap identical to `create`'s own documented one, not a new risk introduced here.

`ConnectorEntityService.rotateCredential(id, newCredentialPlaintext, user)` stays thin, matching
every other method in that class: validates the new value is non-empty (see the non-blocking note
below for the `authType: "none"` case), delegates straight to
`connectorRepo.rotateCredential(...)`, maps the result to `ServiceError`. No new
`ConnectorCredentialRepository` dependency is added to the service — it stays exactly as decoupled
from the credential-encryption layer as it is today.

**Wiring:** no change needed at `ApiRoutes.scala:449`'s `ConnectorEntityService` construction or
`ConnectorEntityRoutesSpec.scala:92`'s test double — the service's constructor signature is
unchanged by this decision. `ConnectorRepository.update`'s comment ("rotation is a distinct,
not-yet-built operation") is corrected to reference `rotateCredential` instead of describing
rotation as unbuilt.

This reuses `ConnectorCredentialRepository.create`/`delete` verbatim — no new write path to the
credential store, no new encryption call site to review. The **old credential is deleted, not
retired-in-place** — there is no "previous credential" concept anywhere in this system, and
keeping a stale encrypted row around serves no purpose (nothing can ever read it back) while
adding a real cleanup obligation. This resolves the run brief's "decide what happens to the OLD
credential" question explicitly.

## Decision 1b: Dependent sources are exposed proactively, not just on a blocked delete

Skeptic design-round-1 CR1: the ticket is explicit that showing dependents "is the main reason
the page earns its place over a modal," but the original plan only surfaced them reactively (on
a 409), and even that was hedged on a backend field that does not exist —
`ConnectorEntityService.delete`'s 409 today carries a fixed string
(`"ConnectorHasDependents: this Connector is still referenced by a dependent resource"`), no
count, no ids, and no read path exposes `DataSourceRepository.countRestSourcesReferencing` at
all.

**Chosen:** add a `dependentCount: Int` field to `ConnectorMeta`, computed via
`countRestSourcesReferencing` at `findAll`/`findById` time (both already resolve through
`ConnectorEntityService`, which already receives a `dependentCount: ConnectorId => Future[Int]`
collaborator for the delete guard — reuse that same collaborator for the read paths rather than
adding a second count mechanism). This makes dependent count part of every list row and the
detail view, proactively, matching the ticket's own framing — not gated behind an attempted
delete. A full dependent-source list (names/ids) is **not** added — the count alone tells the
user whether deletion is currently possible and roughly how many things reference the Connector;
enumerating the actual dependent sources is deferred as a natural next step but not required by
this ticket's acceptance criteria, which ask only that dependents be "visible," not itemized.
`tasks.md` 3.7's "if the backend response carries it" hedge is removed — the backend response now
always carries it.

## Decision 2: Implicit Connectors are shown, badged, not hidden

Hiding implicit Connectors would mean a user who deletes their last dependent source and later
wants to delete the (now dependent-free) implicit Connector has no way to find it. Hiding also
contradicts the "make it legible, not confusing" instruction — an invisible row that nonetheless
blocks other operations (e.g. still shows up as "1 Connector" in some future count) is worse than
a visible, explained one. **Chosen: visible, badged** ("Auto-created" or equivalent, using
`StatusChip`), same row shape as a user-created Connector, so its dependents/rotate/delete
affordances all work identically — an implicit Connector is a real Connector, just one the user
didn't explicitly name. Non-goal: preventing edits to an implicit Connector's non-secret fields —
nothing in the ticket or HEL-822 restricts that, so it is not restricted here either.

## Decision 3: Credential-entry component is shared between create and rotate

A single `ConnectorCredentialField` component (or similarly named, under
`features/connectors/ui/`) renders the auth-type selector + credential input, used by both the
create form and the "Replace credential" rotation action. This is the reusability HEL-829 needs
(run brief: "keep the credential-entry component reusable rather than welded into the page") —
built here as a standalone component with its own props (`authType`, `onChange`, `submitLabel`),
not a page-specific inline form, so HEL-829 can mount it inside a chat-driven flow later without
extracting it retroactively.

## Decision 3b: Connection-test payload and where it's offered

Skeptic design-round-1 CR3: `SourceService.testRest` accepts **exactly one of `connectorId` or
`url`** and **rejects any `auth` field outright** ("auth lives on the referenced Connector") — the
obvious "send baseUrl + the auth just typed" call is a 400, and since a saved credential is never
readable client-side, there's no client-side fallback for it either.

**Chosen:** connection-test is offered **only for an already-saved Connector** — from the list row
or the edit modal — never inline during the create form, before the Connector exists. The call
posts `{ type: "rest_api", config: { connectorId: "<id>" } }` to `POST /api/sources/test`
(`TestConnectionAffordance`'s existing props already accept a payload-builder callback; this is a
new payload variant, not a new component). The create form has no test action — a user tests
immediately after creating, from the list, which is one extra click but requires no new backend
capability (an ephemeral pre-save `url`-only test path was considered and rejected: it would
silently drop the auth type of `api_key`/`bearer` Connectors, meaning a test could pass for a form
that ultimately produces an unauthenticated request, which is worse than not offering it).

## Decision 4: DESIGN.md / shared-primitives inventory for this page

Reuse existing `shared/ui/` primitives directly — no `PageShell`/`PageHeader`/`PageStatus`
(HEL-725, not yet built, `relatedTo` not a dependency): `EmptyState` (empty list), `FormField` +
`TextField` + `Select` (create/edit forms), `Modal` (create/edit/rotate dialogs — mirrors
`AddSourceModal`'s existing two-step-modal precedent on `/sources`), `ConfirmInline` (delete
confirmation, mirrors `ApiTokensSection`'s revoke-confirm), `StatusChip` (implicit badge),
`DataGrid` or a plain table (list — `DataGrid` if it fits the row shape without contortion,
otherwise a plain table styled per DESIGN.md tokens, mirroring `SourcesPage`'s own table). No
literal px, no ad-hoc colors — DESIGN.md tokens throughout, verified by the evaluator's Phase 3
UI Review (explicitly in play per the run brief — this is the epic's first frontend ticket).

## Decision 5: Touch-target sweep addition

Add a new `surface 7` test to `e2e/hel813-mobile-touch-target-floor.spec.ts` (not a separate
file, to keep the existing sweep's single-source-of-truth shape) covering `/connectors`: list-row
action buttons (edit/rotate/delete), the "Add connector" CTA (or `EmptyState`'s CTA when the list
is empty), and the create/edit modal's interactive controls, at 430px and 768px, mirroring
surface 4/5's registration + navigation + `sweepSurface` pattern.

## Risks / Trade-offs

- Scoping rotation into this ticket widens it beyond "pure frontend," per the escalation
  resolution — accepted trade-off, made explicitly rather than silently.
- The old-credential-row cleanup on rotation is best-effort (matches `create`'s existing,
  already-accepted gap) — an orphaned row on rare failure is inert, not a security or correctness
  issue, and is not being newly introduced by this decision.
- `RewrapConnectorCredentialsJob`/`rewrapAllBelow` (master-key rotation, distinct from a single
  Connector's credential rotation) is untouched by this change — no interaction between the two
  rotation concepts.
- Rotating a Connector whose `authType` is `"none"` (a legitimately-empty stored credential) is
  handled by the same non-empty-new-value validation as any other rotation — the UI simply does
  not offer a "Replace credential" action for a no-auth Connector (there is nothing to replace);
  if the user later changes the auth type to `bearer`/`api_key` via the edit form, they set a
  credential through the ordinary rotation path at that point, not a separate first-time-set flow.

## Migration Plan

Additive only — new route, new repository/service methods, new frontend page. No existing
behavior changes for any current caller of `/api/connectors`. No new database table or RLS
policy (reuses `connectors`/`connector_credentials`), so no `RlsPolicyGuardSpec` allowlist change
is needed.

## Open Questions

None outstanding — the one open question (rotation scope) was resolved via escalation before this
document was written.
