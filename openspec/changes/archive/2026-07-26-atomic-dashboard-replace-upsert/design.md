## Context

`helio-news` currently: (1) lists ALL dashboards and linear-scans for a name match (`ensure_dashboard`),
falling back to create; (2) deletes every panel one-by-one to empty a board (`clear_dashboard_panels`);
(3) rebuilds panel-by-panel. Steps 2-3 have no transactional boundary — a mid-rebuild failure leaves a
half-empty board live. This app enforces Postgres RLS + strict owner scoping (V36 policies) and a strict
`source → pipeline → type → panel` binding rule (V41, enforced by `PanelService.rejectCompanionBinding`).
The existing atomic-multi-panel-create precedent is `DashboardSnapshotRepository.importSnapshot`
(single `.transactionally` DBIO: insert dashboard row, insert all panel rows) and
`DashboardProposalService` (service-composed panel-by-panel create with pre-validation + delete-whole-
dashboard-on-failure rollback — NOT real DB atomicity, and unsuitable here since the target dashboard
already exists and must never be destroyed on a mid-rebuild failure).

## Goals / Non-Goals

**Goals:** atomic all-or-nothing panel-set replace on an EXISTING dashboard; idempotent owner-scoped
get-or-create-by-name; V41 + RLS enforced identically to `POST /api/panels`; MCP surface for both.

**Non-Goals:** data-source/pipeline/DataType teardown (HEL-366); panel-id-preserving diff/merge (HEL-368);
rebuild scheduling (HEL-340); optimistic concurrency / versioned writes.

## Decisions

**D1 — Atomicity boundary: repository-layer single DB transaction, not service-composed rollback.**
`DashboardProposalService`'s pattern (create dashboard, create panels one at a time, delete the whole new
dashboard on any failure) is safe only because the dashboard is BRAND NEW — deleting it destroys nothing a
user already had. Replace-contents mutates an EXISTING dashboard, so "rollback" must be a real Postgres
transaction. New `DashboardContentsOps` trait (mixed into `DashboardRepository`, mirroring
`DashboardSnapshotOps`) adds `replaceContents(dashboardId, newPanels: Vector[Panel], layout: Option[DashboardLayout])`:
one `.transactionally` DBIO — `panelTable.filter(_.dashboardId === id).delete andThen insert(newPanelRows) andThen
(layout-update if given)` — via `ctx.withSystemContext` (caller already ACL-checked, same privilege pattern as
`importSnapshot`/`duplicate`). All panel *validation* (structure, V41 binding) happens in the SERVICE layer
BEFORE this call, with zero DB writes, so a bad payload never reaches the transaction (satisfies the 400/
no-partial-write acceptance criterion). `PanelService.create` is refactored (behavior-preserving) to extract a
`buildForCreate` step — construct-and-validate-without-inserting — so the replace path reuses the identical
config-decode/appearance-resolve/`rejectCompanionBinding` logic per panel, sequentially, before the transaction.

**D2 — Wire shape: reuse `ProposalPanel`/`ProposalPanelLayout` verbatim** (not a new panel DTO) for the
`panels` array in `PUT /api/dashboards/:id/contents`. It already carries embedded per-panel layout (no
pre-existing panel id needed, since ids are minted fresh — full replace, per Non-Goals) and its
validation/construction logic (`validatePanel`, `buildCreateRequest`, `buildDataConfig`) is extracted from
`DashboardProposalService` into a shared object so both callers stay behavior-identical to today's
apply-proposal path. Response reuses `DuplicateDashboardResponse` (dashboard + panels), matching apply-
proposal/import per the acceptance criterion. Because new panel ids are minted before the transaction, the
service must build the id-remapped `DashboardLayout` (mapping each `ProposalPanel.layout` onto its freshly
minted panel id) BEFORE calling `replaceContents` — mirrors `DashboardProposalService.applyLayout`'s id-remap,
done pre-transaction here instead of via a follow-up PATCH (task 2.2 spells this out explicitly).

**D3 — Identity semantics: name-based, owner-scoped, APP-LEVEL check-then-insert — no new DB constraint.**
*(Revised after design-gate round 1 REFUTE — see below.)* The ticket's AC is explicit ("get-or-create-by-
name... no duplicate dashboards created on repeated calls") and matches `helio-news`'s actual
`ensure_dashboard(name)` usage, so name stays the key. Names are NOT unique today and this design deliberately
does **not** add a uniqueness constraint: `DashboardRepository.findByNameOwned(name, ownerId)` matches
case-insensitively (`lower(trim(name))`, consistent with `RequestValidation.normalizeDashboardName`) and is
always owner-scoped (`WHERE owner_id = :caller`) — never global, closing the cross-tenant leak class called
out in the brief (precedent: HEL-384 design-gate catch). `POST /api/dashboards` gains an opt-in
`ifExists: "return"` field: when set, look up first and return the match (200) if found, else create (201);
when absent, behavior is **byte-for-byte unchanged** — no lookup, no new failure mode, exactly as today.
*Rejected alternative — a hard `UNIQUE INDEX ON dashboards (owner_id, lower(name))`*: round-1 design review
found this breaks three already-shipped, unrelated code paths that all currently allow same-owner name
collisions by design: `DashboardSnapshotRepository.duplicate` names every copy identically
(`"${name} (copy)"` — a second duplicate of the same dashboard is a guaranteed collision),
`DashboardRepository.updateName` (rename) has no collision check today, and plain `POST /api/dashboards`
(no `ifExists`) must keep creating unconditionally per this change's own "omitting ifExists is unchanged"
requirement. A schema-wide constraint cannot distinguish "this insert came through the new opt-in path" from
these three pre-existing paths, so enforcing it at the DB level would need new violation-handling (and new
test coverage) bolted onto `duplicate`/`updateName`/plain-create — unrelated, already-shipped features this
ticket has no business touching. App-level check-then-insert, scoped only to the new `ifExists` branch,
avoids all three regressions and needs no migration at all.

**D4 — Concurrency, named explicitly per the design-gate brief:**
- *Get-or-create race* (two concurrent `ifExists: "return"` calls, same owner+name, neither sees an existing
  row yet): WITHOUT a DB constraint, both can insert — this is a real, accepted race for v1, not eliminated.
  Named explicitly rather than silently possible: `helio-news`'s actual usage is one serial HTTP call per
  rebuild (no concurrent overlapping rebuilds of the same board), so this is the correct risk/complexity
  trade-off for now. A future need for hard concurrency-safety would be better served by a dedicated
  client-supplied external-id + partial-unique-index model (nullable column, trivially safe migration since
  existing rows would all be NULL) rather than retrofitting a constraint onto the mutable, human-editable
  `name` field — noted as a follow-up path, not built here.
- *Overlapping replace-contents on the same dashboard*: the two transactions' `DELETE ... WHERE dashboard_id`
  serialize on Postgres row locks (no interleaved half-applied state is possible), and last-committing writer
  wins — the other caller's payload is silently superseded (still returns 200 from its own perspective). This
  is accepted for v1 (helio-news runs rebuilds serially); named here rather than engineered around.

## Risks / Trade-offs

- [Concurrent get-or-create race can create two same-named dashboards] → accepted for v1 per D4; no DB
  constraint is added specifically to avoid regressing `duplicate`/`updateName`/plain-create (D3). Real usage
  is serial, not concurrent. Follow-up path (external-id key) noted if this changes.
- [`PanelService.create` refactor touches a hot path] → behavior-preserving extraction only (same validation
  order, same error messages); covered by existing `PanelService` tests plus new ones for the shared builder.
- [Last-writer-wins on overlapping replace-contents] → named in D4; a versioned-write follow-up is out of
  scope for v1.

## Planner Notes

Self-approved: reusing `ProposalPanel` instead of a new DTO (D2); extracting shared panel-construction logic
out of `DashboardProposalService`/`PanelService` as a behavior-preserving refactor (D1/D2); dropping the
per-owner unique index in favor of app-level check-then-insert (D3, revised post design-gate round 1 — see
rationale above) so `duplicate`/`updateName`/plain-create stay completely unchanged. All are implementation-
detail choices within the ticket's stated scope, not new capabilities or breaking changes.
