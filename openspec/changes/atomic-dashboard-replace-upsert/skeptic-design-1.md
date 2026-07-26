## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, both spec deltas
  (`specs/dashboard-contents-replace/spec.md`, `specs/dashboard-get-or-create/spec.md`),
  `tasks.md`, `workflow-state.md`.

- **D1 (atomicity boundary)** — verified against real code:
  - `DashboardSnapshotRepository.importSnapshot` (backend/src/main/scala/com/helio/infrastructure/DashboardSnapshotRepository.scala:135-205)
    really does use a single `.transactionally` DBIO via `ctx.withSystemContext`, matching the design's claim.
  - `DashboardProposalService.createAll` (backend/src/main/scala/com/helio/services/DashboardProposalService.scala:140-155)
    really does "create dashboard, create panels one-by-one, delete the whole new dashboard on failure" —
    confirms the design's claim that this pattern is unsuitable for an existing dashboard, and D1 explicitly
    avoids reusing it in favor of a real repository-layer transaction. This decision is sound and well justified.
  - `DashboardService.update`'s owner-or-editor-grantee ACL pattern (DashboardService.scala:97-119) is the
    precedent D1/tasks 3.2 say replace-contents' ACL check mirrors — confirmed real.

- **D3 (identity semantics) — claims checked against code**:
  - Confirmed no uniqueness constraint exists today on dashboard name: `V1__init.sql` defines `dashboards`
    with only a primary key on `id`, no unique index on name (backend/src/main/resources/db/migration/V1__init.sql:1-9).
    Grepped all migrations through V72 for a dashboards-name unique constraint — none exists. Design's claim is accurate.
  - Confirmed `POST /api/dashboards` currently allows `name: Option[String]` and defaults to
    `RequestValidation.DefaultDashboardName = "Untitled Dashboard"` when absent
    (RequestValidation.scala:27-38; DashboardRoutes.scala:42-47; DashboardService.create, DashboardService.scala:43-54).
  - **Found a concrete, reproducible contradiction (see Change Request 1 below).**

- **Multi-tenancy** — `DashboardRepository.findById` (owner-or-grantee visibility, no existence leak) and
  `findByIdOwned` (DashboardRepository.scala:65-116) confirm the sharing-aware ACL model the design leans on for
  both replace-contents (404 for non-owner/non-grantee) and get-or-create (`WHERE owner_id = :caller`). V36 RLS
  migration (`V36__rls_sharing_aware_tables.sql`) confirms the RLS model the design's `withSystemContext` usage
  is consistent with existing privileged-call precedent (`duplicate`, `importSnapshot`). This item is well
  covered — no cross-tenant ambiguity found.

- **Concurrency (D4)** — both required races are named explicitly (get-or-create unique-index race →
  catch-and-requery; overlapping replace-contents → row-lock serialization, last-committing writer wins,
  explicitly accepted for v1). Satisfies the "at minimum, name the behavior" bar from the ticket.

- **Sibling scope discipline** — pulled the actual Linear tickets HEL-370, HEL-366, HEL-368 via the Linear MCP
  to check against the design's self-approved refactors:
  - HEL-366 (resource tagging/bulk teardown) explicitly excludes panel/dashboard-contents teardown and defers
    it to HEL-363 — the design correctly does not touch data-source/pipeline/DataType teardown.
  - HEL-368 (snapshotId/id reconciliation) is untouched by this design — correct, out of scope.
  - HEL-370 (batch panel-create) itself states "The idempotent-rebuild endpoint may subsume batch-create for
    the full-replace case" — so the `buildForCreate` extraction reused internally by replace-contents is
    explicitly sanctioned by HEL-370's own ticket text, not scope creep.
  - Non-Goals/Decisions correctly state full-replace only, ids minted fresh, no panel-id-preserving diff/merge
    (HEL-368's sibling is untouched).
  No sibling absorption found.

### Verdict: REFUTE

### Change Requests

1. **D3's migration (`CREATE UNIQUE INDEX ON dashboards (owner_id, lower(name))`) is unconditional at the DB
   level, but the design and spec only account for its interaction with the NEW `ifExists` create path. It
   directly contradicts other requirements in this same change and breaks already-shipped functionality:**
   - `specs/dashboard-get-or-create/spec.md:23-26` ("Omitting `ifExists` is unchanged" scenario) requires plain
     `POST /api/dashboards` to **always create** a new dashboard, "even if a same-named dashboard already
     exists for that owner." A hard, unconditional per-owner unique index makes this literally impossible once
     a same-name row exists — the raw insert fails with a Postgres unique-violation regardless of whether the
     caller passed `ifExists`. Nothing in `design.md` or `tasks.md` (task 4.2) describes catch/re-query logic
     for this path — only the `ifExists`-race case is handled.
   - The already-shipped `duplicate` endpoint (`DashboardSnapshotRepository.duplicate`,
     backend/src/main/scala/com/helio/infrastructure/DashboardSnapshotRepository.scala:51: `name = s"${sourceDash.name} (copy)"`)
     names every copy identically. **Duplicating the same dashboard a second time for the same owner is a
     guaranteed, deterministic name collision** (both copies are literally `"X (copy)"`). The insert is a raw
     `table += domainToRow(newDash)` (line ~67) with no violation handling. After this migration ships, the
     second `duplicate` of any dashboard would fail with an unhandled `PSQLException`, most likely surfacing as
     a raw 500 — a functional regression in a shipped, unrelated feature that this design does not mention or
     test for.
   - `PATCH /api/dashboards/:id` → `DashboardRepository.updateName` (DashboardRepository.scala:156-163) has the
     same exposure: renaming a dashboard to a name that collides with another dashboard the same owner already
     has would hit the same unhandled constraint violation, breaking today's unrestricted rename behavior.
   - `DashboardProposalService.createAll` (DashboardProposalService.scala:144) creates dashboards via
     `dashboardService.create(CreateDashboardInput(Some(proposal.dashboardName)))` with no `ifExists` — the
     apply-proposal / agentic-rebuild flow this ticket is explicitly motivated by could hit the exact same
     collision on a repeated proposal name.

   **Required revision** — pick one and make it explicit in `design.md` + the specs, with tasks/tests added:
   - (a) Do not add an unconditional hard DB constraint. Keep uniqueness enforcement scoped to the `ifExists`
     opt-in path only (app-level check-then-insert with retry-on-unique-violation confined to that code path),
     and explicitly decide/document what plain-create/duplicate/rename collisions do (continue to be allowed,
     as today) — OR
   - (b) Keep the hard DB constraint, but then `specs/dashboard-get-or-create/spec.md`'s "Omitting ifExists is
     unchanged" scenario must be revised (it can no longer promise unconditional creation on collision), and
     `duplicate` / `updateName` / `DashboardProposalService.createAll` must each get explicit handling for a
     unique-violation (what status code, what user-facing behavior) plus test coverage in `tasks.md` section 7.
   Either way, "byte-for-byte unchanged" is not achievable for the plain-create path once a hard unconditional
   unique constraint exists — the design must own that trade-off explicitly rather than leave it unaddressed.

### Non-blocking notes

- `findByNameOwned` (task 4.1) is described as "normalized-name match" but the unique index is scoped on
  `lower(name)` (case-insensitive). Spec/task text should say explicitly whether the lookup is
  case-insensitive to match the index basis, so get-or-create idempotency actually holds for
  `"AI News"` vs `"ai news"`.
- D1's `replaceContents(dashboardId, newPanels: Vector[Panel], layout: Option[DashboardLayout])` signature
  implies the service must mint panel ids and build the `DashboardLayout` (mapping `ProposalPanel.layout` to
  the newly-minted ids) BEFORE calling the repository, mirroring `DashboardProposalService.applyLayout`'s
  id-remap logic but done pre-transaction. This is coherent but isn't spelled out as its own task in
  `tasks.md` section 3 — worth an explicit sub-bullet under 3.2 so the executor doesn't miss it.
