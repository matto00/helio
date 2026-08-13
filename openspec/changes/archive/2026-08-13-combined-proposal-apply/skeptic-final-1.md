## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established (not trusting evaluation-1.md's narrative):**
- `git diff main...HEAD --stat` — 30 files, 1986 insertions / 2 deletions. Confirms `files-modified.md`'s claim.
- Read `ticket.md`'s 6 acceptance criteria in full, and traced each to code/tests below.

**AC1 — single request creates source+pipeline+run+dashboard+panels atomically, panel binds via resolved symbolic ref:**
`backend/src/main/scala/com/helio/services/CombinedProposalService.scala:43-69` (`apply`) sequences `validateOutputRefPositions` → `pipelineProposalService.apply` → `resolveOutputRefs` → `dashboardProposalService.apply`. Exercised end-to-end by `CombinedApplyProposalSpec.scala` (happy path asserts all 5 resource-table counts incremented by exactly the right delta, and the created panel's `config.dataTypeId` equals the pipeline's real `outputDataTypeId`; mixed-binding case proves a sentinel-bound panel and a pre-existing-type-bound panel coexist correctly). Independently re-ran this spec (see gate re-runs below) — passes.

**AC2 — dashboard-phase failure rolls back pipeline+source, verified by test:**
`CombinedProposalService.apply`'s `Left(err) => pipelineProposalService.rollback(pipelineResp, user).map(_ => Left(err))` branch (line 66). `CombinedApplyProposalRollbackSpec.scala` posts a proposal whose pipeline phase succeeds (inline static source) but whose dashboard phase fails (invalid `chartType`), then asserts `allCounts()` (sum of all 6 resource tables) is byte-identical to before the call. Independently re-ran — passes.

**AC3 — reuses both services, no duplicated create/rollback logic, RLS+V41 throughout:**
Read all of `CombinedProposalService.scala` — zero repository/DB imports, zero raw SQL; every write flows through `pipelineProposalService`/`dashboardProposalService`. `CombinedApplyProposalSpecBase.scala:101-111` constructs `DbContext` from two **non-superuser** roles (`helio_app_test`/`helio_privileged`, `SET ROLE` via `connectionInitSql`) — genuine RLS enforcement, not the BYPASSRLS-superuser pattern this codebase has previously shipped bugs under (see prior HEL-286 incident). `validateDataTypeBinding` in `ProposalPanelSupport.scala:110-116` (unmodified, called via `DashboardProposalService.apply`) still rejects any binding to a non-pipeline-output type — V41's invariant is enforced unchanged.

**AC4 — dangling/unresolved ref is a 400 that creates nothing — THE CORE PRECEDENCE CLAIM, independently re-traced:**
Read the real `ProposalPanelSupport.bindingCandidate` (`ProposalPanelSupport.scala:150-158`):
```scala
private def bindingCandidate(panel: ProposalPanel): Option[String] =
  panel.dataTypeId.orElse(nonFlatConfigDataTypeId(panel))
private def nonFlatConfigDataTypeId(panel: ProposalPanel): Option[String] =
  if (DashboardProposalService.DataPanelKinds.contains(panel.`type`)) None
  else panel.config.flatMap(_.fields.get("dataTypeId")).collect { case JsString(s) if s.nonEmpty => s }
```
`Option.orElse`'s argument is call-by-name — `nonFlatConfigDataTypeId` is only *evaluated* (hence `config.dataTypeId` only ever consulted) when `panel.dataTypeId` is `None`, never merely "≠ some value."

Read `CombinedProposalService`'s mirror (`CombinedProposalService.scala:84-97`):
```scala
private def flatIsBlessed(panel: ProposalPanel): Boolean =
  panel.dataTypeId.contains(OutputRefSentinel)
private def configIsBlessed(panel: ProposalPanel): Boolean =
  !DashboardProposalService.DataPanelKinds.contains(panel.`type`) &&
    panel.dataTypeId.isEmpty &&
    panel.config.exists(_.fields.get("dataTypeId").contains(JsString(OutputRefSentinel)))
```
This is an **exact** match to the real precedence: `flatIsBlessed` fires regardless of kind (matching `bindingCandidate` checking the flat field unconditionally first); `configIsBlessed` requires BOTH `panel.type` outside `DataPanelKinds` AND `panel.dataTypeId.isEmpty` (true absence) — not "not the sentinel." The two predicates are mutually exclusive by construction (one requires `dataTypeId` non-empty, the other requires it empty), so `clearBlessedSlot`'s if/else-if exactly reproduces `orElse`'s short-circuit — never an independent-booleans check.

Verified `validateOutputRefPositions` (lines 118-128): for each panel, `clearBlessedSlot` removes the ONE legitimate occurrence (if any), re-serializes to JSON via the real `DashboardProposalProtocol.proposalPanelFormat`, and rejects if the sentinel string still appears anywhere — catching a kind-mismatched slot, a flat-shadowed `config.dataTypeId`, or a duplicate elsewhere (e.g. `fieldMapping`) as one unified check, not three special cases that could disagree.

Traced this against all 4 `CombinedApplyProposalDanglingRefSpec.scala` cases by hand:
1. "Bad Field Mapping" (sentinel in `fieldMapping`, no blessed slot at all) → neither predicate fires → unchanged panel → sentinel still found → rejected. Correct.
2. "Bad Kind Mismatch" (`chart` panel, sentinel in `config.dataTypeId`) → `chart ∈ DataPanelKinds` → `configIsBlessed` false → unchanged → rejected. Correct (this is exactly round-1's caught bug).
3. "Bad Duplicate" (`text` panel, sentinel in both `config.dataTypeId` AND `fieldMapping`) → `configIsBlessed` true (text ∉ DataPanelKinds, flat absent) → config slot cleared → but `fieldMapping` occurrence remains → still found → rejected. Correct.
4. "Bad Shadowed" (`text` panel, flat `dataTypeId` = a real pre-existing id, `config.dataTypeId` = sentinel) → `flatIsBlessed` false (flat holds a real id, not the sentinel) → `configIsBlessed` false (`dataTypeId.isEmpty` is false — flat is set) → unchanged → sentinel in config still found → rejected. Correct (this is exactly round-2's caught bug — the "not merely not-equal" fix).

`resolveOutputRefs` (lines 135-141) uses the identical two predicates for substitution, only run after `validateOutputRefPositions` already guarantees at most one legitimate occurrence exists — an unconditional, unambiguous substitution.

**AC5 — MCP tool + `sbt test` + MCP tests green:** independently re-run below (not trusted from evaluation-1.md).

**AC6 — backward-compat, additive:**
`git diff main...HEAD -- backend/.../DashboardProposalService.scala backend/.../ProposalPanelSupport.scala backend/.../DashboardProposalProtocol.scala backend/.../PipelineProposalProtocol.scala` → **empty diff**, all four files byte-for-byte untouched. `git diff main...HEAD -- backend/.../PipelineProposalService.scala` shows the new `rollback` method appended after `inlineName` with **zero removed lines** (confirmed by reading the diff directly — only `+` lines, one `@@` hunk). Read `rollback`'s body: composes exclusively through `pipelineService.delete` → `dataTypeService.delete` → (if `response.source` defined) `dataTypeRepo.findBySourceId` (a read, issued before any delete in this fresh invocation — safe per D4's own reasoning, unlike `apply`'s internal rollback which the file's own D5 doc-comment warns against calling that query post-delete) → `dataSourceService.delete` → companion `dataTypeService.delete`s. Never a raw repository write call. `CombinedApplyProposalRegressionSpec.scala` proves both standalone paths (`POST /api/dashboards/apply-proposal`, `POST /api/pipelines/apply-proposal`) behave unchanged, including that the literal sentinel string carries no special meaning on either standalone path (treated as an ordinary not-found id).

**Gate re-runs (fresh, in `WORKTREE_PATH`, not trusting evaluator's pasted output):**
- `npm run lint` → clean, exit 0.
- `npm run format:check` → clean, exit 0.
- `npm run check:scala-quality` → clean (86 pre-existing informational warnings, none in new files).
- `npm run check:schemas` → in sync (39 protocols, 32 files).
- `npm run check:openspec` → only flag is "not archived" (expected mid-workflow).
- `cd backend && sbt "testOnly com.helio.api.CombinedApplyProposalSpec com.helio.api.CombinedApplyProposalDanglingRefSpec com.helio.api.CombinedApplyProposalRollbackSpec com.helio.api.CombinedApplyProposalRegressionSpec"` → **11/11 pass**.
- `cd backend && sbt test` (full suite) → **2512 tests, 152 suites, 0 failures** — matches evaluation-1.md's claimed count exactly.
- `npm --prefix frontend test` → **148 suites / 1506 tests passed** (frontend untouched by this ticket) — matches evaluation-1.md exactly.
- `cd helio-mcp && npx jest` from root → **6 suites / 130 tests passed**. (Note: running `npx jest` from *inside* `helio-mcp/` after `npm run build` picked up stale compiled `dist/*.test.js` files and failed with 12 spurious suite failures — confirmed this is a pre-existing, gitignored-artifact issue unrelated to this diff, by `rm -rf helio-mcp/dist` and re-running clean from root: 6/6 pass, matching evaluation-1.md. Not a defect in this change.)
- `cd helio-mcp && npm run typecheck && npm run build` → both clean.
- Live route check: started servers (`start-servers.sh` → both READY; `assert-phase.sh servers` → PASS), then `curl -X POST http://localhost:8726/api/proposals/apply` with no session cookie → `401`, confirming the route is live, mounted inside the `authenticateSession`/`authenticatedUser` block (verified in `ApiRoutes.scala:380`, alongside every sibling proposal route), and auth-gated exactly like every other proposal-apply endpoint.

**Route wiring / response shape sanity:**
- `ApiRoutes.scala` diff: `combinedProposalService` constructed by composing the already-built `pipelineProposalService`/`proposalService` (no new repo wiring); `CombinedProposalRoutes` mounted under a brand-new `pathPrefix("proposals")` inside the authenticated route tree — matches design.md D6.
- `DuplicateDashboardResponse` (used verbatim in `CombinedProposalApplyResponse`) confirmed, by reading `DashboardProposalRoutes.scala:34`, to be the exact same response type `POST /api/dashboards/apply-proposal` already returns — design.md D5's claim holds.
- `tasks.md`: 28/28 items checked, 0 unchecked (`grep -c '^\- \[x\]'` = 28, `'^\- \[ \]'` = 0).

### Verdict: CONFIRM

This is a backend + MCP-only change (no `frontend/**` files touched — confirmed via `git diff --stat`), so the DESIGN.md/UI-judgment portion of my mandate has no surface to exercise; the ticket's own Out-of-Scope explicitly defers the in-app UI to HEL-341. All 6 acceptance criteria trace to real, independently-verified code and passing tests. The core risk this ticket carried after 3 rounds of design-gate skepticism — getting the "blessed slot" precedence to genuinely match `ProposalPanelSupport.bindingCandidate`'s real `Option.orElse` short-circuit rather than an approximation — checks out exactly on inspection of the real implementation, not just the design doc's narrative, and every one of the three previously-caught bug classes (kind-mismatch, duplicate, flat-shadowed-config) has a corresponding passing regression test that would fail if the logic regressed. `PipelineProposalService.rollback` is genuinely additive (zero removed lines, appended, composes only through existing service methods). All gates pass on independent re-run with counts matching the evaluator's report exactly.

### Non-blocking notes

- This worktree's `scripts/concertino/` directory (gitignored, `concertino sync`-generated) was stale — missing `next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` that the main checkout already has. I copied those three scripts in from the main checkout to complete this review per protocol (they are self-contained and resolve the git root dynamically, so this is safe and outside the reviewed diff) — worth a `concertino sync` re-run against this worktree, or noting as a `setup-worktree.sh` gap, so a future review doesn't have to repeat this.
