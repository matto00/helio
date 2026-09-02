## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/public-dashboards/spec.md`, `specs/dashboard-export-import/spec.md`.
- **(b) Gap A dependency claim — FALSE.**
  `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala:35-41`:
  `final class DashboardService(dashboardRepo: DashboardRepository, accessChecker: AccessChecker,
  auditService: AuditService = null)`. There is **no `outputRepo`**. Design Decision 5 Gap A says
  the call is "at the repository layer both services already depend on" — it isn't.
  `grep -rn "new DashboardService(" backend/src` → 17 construction sites (1 prod
  `ApiRoutes.scala:242` + 16 test fixtures) that a new constructor param touches.
  `OutputRepository.findByIdOwned` does exist (`OutputRepository.scala:132`).
- **(c) Gap B reuse — real integration difficulty, hand-waved.**
  `PanelService.buildForCreate` (`PanelService.scala:177-179`) is
  `(dashboardId: DashboardId, request: CreatePanelRequest, user: AuthenticatedUser)` — import has
  `DashboardSnapshotPanelEntry`, and design.md names the wrong adapter type
  ("`CreateDashboardInput`-shaped"). More importantly `DashboardService` holds no `PanelService`
  either (same constructor above), and `DashboardSnapshotRepository.importSnapshot(payload,
  ownerId)` (`DashboardSnapshotRepository.scala:129-175`) **constructs the panels itself** (mints
  `PanelId`s, builds the `snapshotId → PanelId` `idMap` that the layout remap depends on) — so
  "route each imported panel's construction through `buildForCreate`" implies a repository
  signature change (accept pre-built panels) plus an id-minting/remap reconciliation that no task
  mentions. Also note `rejectMissingOutput` (`PanelService.scala:474-486`) treats a `null`
  `outputRepo` as *pass* — copying that nullable convention into `DashboardService` would make the
  new import check silently vacuous in the 16 fixtures.
- **(a) Decision 6 allowlist vs. task 7.2 / AC 6 — still contradictory and still unsatisfiable.**
  design.md Decision 6 allowlists (i) `db/migration`, (ii) `openspec/changes/**`, (iii)
  `HEL-NNN`-prefixed historical comments. `tasks.md` 7.2's exit condition and `ticket.md` AC 6
  both still say only "outside `backend/src/main/resources/db/migration/` and git history".
  And even the wider allowlist doesn't hold: `grep -rn "/metrics" backend/src frontend/src docs
  README.md CLAUDE.md` → 16 hits, of which several are **live code, not comments**:
  `frontend/src/shared/chrome/sections.test.ts:110-114`
  (`expect(sections.some((s) => s.path === "/metrics")).toBe(false)`),
  `backend/src/test/.../ApiRoutesSpec.scala:3427-3428`
  (`Get("/api/metrics") ~> ... NotFound`), `frontend/src/shared/ui/StatusChip.tsx:19` (prose
  "pipelines/metrics/panels"). These are exactly the regression guards proving the routes are
  gone; a literal zero-hit gate forces the executor to delete them or fail its own AC.
- **(d) §3.5 schema task is incomplete and contradicts §3.2.**
  `grep -rln "dataTypeId\|DataTypeId\|metricId" schemas/` → **5** files, not the 2 design
  Decision 6(e) / task 3.5 name. The omitted `schemas/workspace/workspace-context.schema.json`
  carries **live required wire fields** (`leftDataTypeId`, `rightDataTypeId` at lines 222-232;
  `outputDataTypeId` at 347/365) — precisely the fields task 3.2 renames on
  `WorkspaceContextProtocol`. Renaming the protocol without the schema breaks `check:schemas`
  drift and leaves §7.2 non-zero. (`schemas/panels/panel.schema.json:113` and
  `schemas/pipelines/pipeline-analyze-proposal-response.schema.json:5` are `HEL-NNN`-prefixed
  historical *descriptions*; the allowlist as written covers "comments", not JSON `description`
  strings — needs one word of clarification.)
- **(e) CR7 from round 2 was NOT fixed.** `grep -rn DuplicateDashboardResponse
  openspec/changes/public-dashboards-export-docs-sweep/` returns only the round-2 skeptic report.
  The baseline `openspec/specs/dashboard-export-import/spec.md:26` contains "The response SHALL
  contain the new dashboard and its panels, matching the shape of `DuplicateDashboardResponse`."
  — the MODIFIED requirement in this change still drops it (and it is a live shape:
  `DashboardSnapshotRoutes.scala:38` returns `DuplicateDashboardResponse`).
- Cross-checked counts cited in design Decision 6: `openspec/specs` = 19 files / 47 `dataTypeId`
  occurrences (matches); helio-mcp per-file hits present as described.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 5 Gap A + `tasks.md` 2.1 — correct the false dependency claim and add
   the wiring.** `DashboardService` has no `OutputRepository`
   (`DashboardService.scala:35-41`). State that an `outputRepo` collaborator must be **added to
   the constructor and threaded through `ApiRoutes.scala:242` and the 16 test fixtures**
   (enumerated by `grep -rn "new DashboardService(" backend/src`). Decide explicitly whether it is
   required (non-nullable) or follows `PanelService`'s nullable-optional convention — and if
   nullable, say why a `null` fixture silently skipping the new import validation is acceptable,
   or require at least one fixture wired with a real `outputRepo` so the check is not vacuous.
2. **`design.md` Decision 5 Gap B + `tasks.md` 2.2 — address the actual integration shape.**
   `buildForCreate` takes a `CreatePanelRequest` (`PanelService.scala:177-181`), not a
   `DashboardSnapshotPanelEntry`; fix the wrong type name ("`CreateDashboardInput`-shaped").
   Then state how validated construction reaches the repository, given
   `DashboardSnapshotRepository.importSnapshot` currently mints `PanelId`s and builds the
   `snapshotId → PanelId` `idMap` the layout remap consumes (`DashboardSnapshotRepository.scala:
   129-175`): either the repo gains an overload accepting pre-built panels (name it as a task), or
   the validation logic is extracted into a request-shape-agnostic helper called before the repo
   write. Also name how `DashboardService` obtains that helper/`PanelService` — it holds neither
   today.
3. **`tasks.md` 7.2 and `ticket.md` AC 6 — restate the exit condition to match design Decision 6's
   allowlist**, which they currently contradict (they still say "db/migration and git history"
   only). Reference Decision 6 explicitly rather than restating a narrower rule.
4. **Extend the Decision 6 allowlist to cover negative-assertion regression tests.** Live,
   valuable code contains the swept strings by construction:
   `frontend/src/shared/chrome/sections.test.ts:110-114`,
   `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:3427-3428`, plus incidental prose
   like `frontend/src/shared/ui/StatusChip.tsx:19`. Add an explicit allowlist class ("a test that
   asserts the retired route/identifier is *absent*") and say the executor must not delete these
   to make the grep clean. Also extend clause (iii) to cover `HEL-NNN`-prefixed JSON `description`
   strings, not just code comments (`schemas/panels/panel.schema.json:113`,
   `schemas/pipelines/pipeline-analyze-proposal-response.schema.json:5`).
5. **`tasks.md` 3.5 + `design.md` Decision 6(e) — the schema list is wrong (3 of 5 files
   missing).** `grep -rln "dataTypeId\|DataTypeId\|metricId" schemas/` yields
   `schemas/authoring/combined-proposal.schema.json`,
   `schemas/dashboards/dashboard-proposal.schema.json`,
   **`schemas/workspace/workspace-context.schema.json`**, `schemas/panels/panel.schema.json`,
   `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`. `workspace-context.schema.json`
   carries the live required fields `leftDataTypeId`/`rightDataTypeId`/`outputDataTypeId` (lines
   222-232, 347/365) that task 3.2 renames on `WorkspaceContextProtocol` — omitting it guarantees
   a schema/protocol drift failure. Add it (and triage the other two against CR4's clarified
   allowlist), and replace the hardcoded "2 files" with a re-grep instruction as §3.6 already does.
6. **`specs/dashboard-export-import/spec.md` — CR7 from round 2 is still open.** The MODIFIED
   "Import dashboard endpoint" requirement still omits the baseline clause "The response SHALL
   contain the new dashboard and its panels, matching the shape of `DuplicateDashboardResponse`."
   (`openspec/specs/dashboard-export-import/spec.md:26`). A MODIFIED requirement replaces the
   original wholesale, so this silently deletes a normative clause that live code satisfies
   (`DashboardSnapshotRoutes.scala:38`). Restore it verbatim.

### Non-blocking notes

- Decision 6's advice to "cite the live `grep` command in the PR rather than a hardcoded number"
  is good; §3.5 is the one place a hardcoded enumeration survived (CR5) — worth applying the same
  rule everywhere numbers appear.
- Everything else re-checked this round held up: the `public-dashboards` spec's three scenarios all
  now have covering tasks (1.2 explicitly names the empty-rows-not-500 scenario, closing round-2
  CR8), §2.3/§3.6 schema-and-spec gates are coherent, and Decision 8's click-counting helper
  definition is unambiguous enough for two implementers to agree.
