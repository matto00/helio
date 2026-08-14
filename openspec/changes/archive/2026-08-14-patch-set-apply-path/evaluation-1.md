## Evaluation Report — Cycle 1 (evaluation-1.md)

### Environment note
Diffed against `origin/main` (9c9aa73c), not this worktree's local `main` ref (stale at
`e77bf716`'s ancestor chain — it predates HEL-328/627/403 which are already merged into
`origin/main`). `git diff main...HEAD` would have incorrectly included three already-merged
tickets' changes; `git diff origin/main...HEAD` gives the correct 15-file, 4,129-insertion scope
for this ticket alone. All review below uses that correct scope.

This worktree's `scripts/concertino/` (gitignored, force-tracked subset only) is missing
`next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` — same gap `skeptic-design-8.md`
already flagged. Invoked the main checkout's copies against this worktree's change directory
(path-argument based, no cross-repo state) rather than guessing a fallback filename.

### Phase 1: Spec Review — PASS
Issues: none.

- All 6 ticket.md ACs addressed explicitly: atomic apply + rollback (7.2/7.3), full pre-validation
  before any mutation (7.4/7.9), exclusive reuse of existing per-resource services (verified by
  reading `PatchSetApplyForward.scala`/`PatchSetApplyRollback.scala` against
  `PanelService`/`DashboardService`/`DataSourceService`/`DataTypeService`/`PipelineService`'s real
  method signatures — no direct repository writes anywhere), prior-state emission in the shared
  per-kind response shape (7.10, D4a), `sbt test` green (independently re-run, see Phase 2), and
  backward-compat (the diff touches zero existing route/request/response shapes — confirmed via
  `git diff origin/main...HEAD --name-only`, exactly the 15 files ticket.md's own Impact list
  names).
- The HEL-403 carried-over follow-up (delete-op `patch` field) is resolved per design.md D6:
  `Edit.read` now raises a `deserializationError` when `op == "delete"` and `"patch"` is present,
  gated correctly (`op == "delete"` only — verified `create`/`update` paths are untouched by the
  new check), covered by `PatchSetProtocolSpec.scala`'s new test (task 7.1).
- No AC silently reinterpreted. design.md's 8 rounds of adversarial review are reflected faithfully
  in the implementation — verified every lettered decision (D1–D6, D2a, D3a, D4a, D4b) against the
  actual code, not just the prose:
  - D1's per-kind support matrix matches `PatchSetApplyResolvers.resolveEdit`'s dispatch exactly
    (dataType/pipelineStep create rejected; dataSource create restricted to `static`; dashboard
    create rejects `ifExists`).
  - D2/D2a's per-op ACL rules were cross-checked line-by-line against the real service methods:
    `DashboardService.update` (sharing-aware `findById` + `accessChecker`) vs. `.delete`
    (owner-only, no `accessChecker`) — the resolvers correctly split these into
    `resolveDashboardUpdate`/`resolveDashboardDelete` with genuinely different logic, matching
    `DashboardService.scala:86-142` exactly. `PipelineService.updateStep`/`deleteStep`'s
    `findByIdShared` + owner-or-`findGrantRole("editor")` pattern is mirrored exactly in
    `authorizeEditorOrOwnerOnPipeline`. `PipelineRepository.create`'s
    `dataSourceRepo.findByIdOwned(sourceDataSourceId, ...)` check (line 212) is mirrored exactly in
    `resolvePipelineCreate`.
  - D2a's embedded-reference checks (`rejectCompanionBinding`/`rejectUnresolvableMetric` mirrored
    from `PanelService.scala:483-524`, Join/Union/Lookup `DataSource` checks mirrored from
    `PipelineService.scala:568-597`) are byte-for-byte equivalent to the real implementations —
    confirmed by reading both side by side.
  - D3a's identity-loss documentation matches the code: `PanelService.delete` genuinely never
    touches dashboard `layout` (confirmed by reading the method), so the "layout entry for the old
    id is NOT repointed" claim is accurate, not aspirational.
  - D4a's pipeline exception (second `findSummaryById` read for the joined `PipelineSummary`, since
    `findByIdOwned`'s bare `Pipeline` lacks `sourceDataSourceName`/`outputDataTypeName`) is
    implemented exactly as documented in `resolvePipelineUpdate`/`resolvePipelineDelete`, and tested
    field-for-field in test 7.10d.
- **Task 7.9's rejectCompanionBinding direction was specifically verified**, per the orchestrator's
  flag: `PatchSetApplyServiceSpec.scala` contains BOTH directions —
  `"reject a panel-update edit binding to an owned companion DataType (7.9b)"` (rejects) AND
  `"accept (not reject) a panel-update edit whose dataTypeId is foreign-owned (7.9b negative)"`
  (asserts `Right`/`"applied"`, i.e. accepted). This is the CORRECT direction per
  `PanelService.scala:483-500`'s own documented pass-through-on-unresolved behavior — the test does
  not assert the opposite. The executor's disclosed debugging note (switching from a nonexistent
  `dataTypeId`, which hit the `panels_type_id_fkey` FK constraint instead of exercising the
  pass-through path, to a real cross-owner-seeded `DataType`) is reflected in the test's own inline
  comment and is the correct fix — a nonexistent id would never reach the pass-through logic being
  tested.
- No unnecessary changes outside ticket scope: `git diff origin/main...HEAD --name-only` matches
  ticket.md's Impact list exactly (14 backend files + 1 schema file); no unrelated refactors.
- No regressions to existing behavior: full `sbt test` suite (2648/2648) passes, including every
  existing `PatchSetProtocolSpec` case unaffected by the new delete-patch check (gated to
  `op == "delete"` only).
- Schema/protocol updated together: `schemas/patch-set-apply-response.schema.json` added in the
  same change as `PatchSetApplyProtocol.scala`; `check-schema-drift.mjs` confirms sync.
- Planning artifacts (tasks.md: 25/25 `[x]`) match the final implementation; `files-modified.md`
  accurately lists every touched file.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates re-run fresh (not trusted from the executor's report), in `WORKTREE_PATH`
(`CLEAN_WORKTREE` was not set — non-`slow` speed):**
- `cd backend && sbt test`: **2648/2648 passed**, 0 failed, 0 canceled — matches the executor's
  reported count exactly, independently reproduced.
- `node scripts/check-schema-drift.mjs`: clean (45 schemas checked across 36 protocol files; 7
  panel-type-enum surfaces checked).
- `node scripts/check-scala-quality.mjs`: clean (no inline-FQN violations) — 93 file-size soft
  warnings total, all informational per CONTRIBUTING.md, including
  `PatchSetApplyResolvers.scala` (690 lines) and `PatchSetApplyServiceSpec.scala` (605 lines);
  matches the executor's own disclosure.
- `node scripts/check-openspec-hygiene.mjs`: reports only the disclosed, expected
  "complete (25/25) but not archived" state — matches the executor's disclosed pre-commit `-n`
  bypass, which is itself disclosed in the commit body per CONTRIBUTING.md's AI-collaborator rule.
- `sbt Test/compile`: zero warnings, zero errors on a clean compile — confirms no unused imports
  slipped past the (no `-Xfatal-warnings`) build config.
- No frontend files changed (`git diff --name-only origin/main...HEAD` is 100% `backend/**` +
  one `schemas/**` file) — frontend gates (lint/format:check/test/build) correctly not applicable.

**Canonical standards compliance (CONTRIBUTING.md, backend-only — DESIGN.md not applicable, no
`frontend/**` changes):**
- **Imports & Qualifiers [mechanical]**: clean — `check-scala-quality.mjs` found zero inline-FQN
  violations across all 14 new/modified backend files.
- **File-size soft budgets [mechanical, informational-only]**: `PatchSetApplyResolvers.scala` at
  690 lines is well over the ~250-line soft budget (and past the ~400-line "propose a split"
  threshold). Per CONTRIBUTING.md this is explicitly informational, not a gate failure, and the
  executor already disclosed it as a flagged follow-up rather than a silent gap — appropriately
  deferred given regression risk this late in an already-8-round-reviewed change. Not a blocker,
  but see Non-blocking Suggestions.
- **ACL triad (`findByIdInternal`/`findByIdOwned`/`findById`)**: correctly chosen per kind/op,
  matching CONTRIBUTING.md's table exactly (verified against real source in Phase 1 above).
  `findByIdInternal` callsites in `PatchSetApplyResolvers.scala` (panel, pipelineStep) don't carry
  an inline per-callsite "why this is safe" comment, but this matches the existing convention in
  `PanelService.scala`/`PipelineService.scala` themselves (which also rely on class/method-level
  documentation rather than a comment at every individual call site) — not a new violation
  introduced by this ticket, so not flagged as a gate failure.
- **DRY**: no duplicated mutation logic — forward-apply and rollback exclusively call existing
  service methods; embedded-reference checks mirror (not reimplement) `PanelService`/
  `PipelineService`'s private logic via the same repo lookups.
- **Readable**: clear naming (`ResolvedEdit`/`ResolvedAction`/`PatchSetApplyContext`/
  `PatchSetApplyServices`), no magic values, per-kind dispatch is a straightforward pattern match.
- **Modular**: the ticket's single conceptual service is correctly split across
  `PatchSetApplyTypes`/`PatchSetApplyServiceJson`/`PatchSetApplyResolvers`/`PatchSetApplyForward`/
  `PatchSetApplyRollback`/`PatchSetApplyService` — each with a single, stated responsibility
  (pre-validation / forward-apply / rollback / orchestration), which is itself the disclosed
  mitigation for the file-size overage above.
- **Type safety**: no untyped escape hatches; `ResolvedAction` is a real sealed-trait ADT, not
  stringly-typed dispatch beyond the initial `(kind, op)` match.
- **Security**: every mutation path is pre-validated against the SAME access rule its real
  service enforces (verified line-by-line in Phase 1); `metricRepo`'s nullable-optional wiring
  mirrors the existing `PanelService`/`DashboardProposalService`/`DashboardContentsService`
  convention exactly, not a new pattern.
- **Error handling**: rollback failures are caught (`NonFatal`), logged, and marked
  `unrecoverable` — never thrown past the original failure, matching D3/task 5.3 exactly.
- **Tests meaningful**: 7.1–7.12 all present and each asserts on real DB state (via
  `panelRepo.findByIdInternal`/`dashboardRepo.findByIdInternal`/etc., not just the response shape)
  — these tests would catch a real regression in the ACL/rollback/prior-state logic.
- **No dead code**: no leftover TODO/FIXME in any new file; clean compile with zero warnings.
- **No over-engineering**: no premature abstractions — the 6-file split is proportionate to the
  design's genuinely large per-kind/per-op matrix (6 kinds × 3 ops), not speculative.
- **Behavior-preserving**: `PatchSetProtocol.scala`'s one change is additive/tightening only (a
  previously-silently-accepted shape is now rejected) — no existing accepted shape is now
  rejected, confirmed by the full existing `PatchSetProtocolSpec` suite still passing unmodified.

### Phase 3: UI Review — N/A
No `frontend/**` files changed. `ApiRoutes.scala`'s change is purely additive route-composition
(mounts a new `PatchSetRoutes` under a brand-new `patch-sets` path prefix; zero existing routes
modified). `schemas/patch-set-apply-response.schema.json` is a new schema with zero frontend
consumers — confirmed via `grep -rn "patch-sets\|PatchSet" frontend/` (zero matches); nothing in
the frontend currently calls `POST /api/patch-sets/apply` (this ticket's own Non-Goals explicitly
defer NL authoring / diff-preview / undo to sibling tickets). There is no UI surface to exercise.

### Overall: PASS

### Non-blocking Suggestions
- `PatchSetApplyResolvers.scala` (690 lines) is well past CONTRIBUTING.md's ~400-line
  "propose a split" threshold. The executor's disclosed rationale (regression risk this late,
  after 8 rounds of design review) is reasonable for this cycle, but a follow-up ticket to split
  it — e.g. per-kind resolver files (`PanelResolvers`/`DashboardResolvers`/etc.) alongside a
  shared-helpers file — would bring it back under budget without touching this ticket's
  already-reviewed logic.
