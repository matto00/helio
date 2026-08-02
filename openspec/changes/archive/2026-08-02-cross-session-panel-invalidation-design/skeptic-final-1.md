## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Git/branch state clean.** `git log --oneline -5` shows a single commit `286df999`
   "HEL-266 Add design proposal and file spinoff tickets..." on
   `task/design-cross-session-cache-invalidation/HEL-266`. `git diff main...HEAD --stat` touches
   only 8 files, all under `openspec/changes/cross-session-panel-invalidation-design/`. Only
   untracked file is `evaluation-1.md` (the evaluator's own report, legitimately not yet
   committed at this stage). No production code diff exists (confirmed no `frontend/**` or
   `backend/**` paths in the diff).

2. **Spinoff tickets are real, correctly scoped, and linked** — fetched all three fresh via
   `mcp__linear__get_issue` (not trusting the executor/evaluator's claims):
   - **HEL-640** "Cross-tab panel invalidation via BroadcastChannel" — Backlog, scoped to
     candidate B exactly as design.md D1 describes (~30 LOC, `PipelineDetailPage.tsx` dispatch
     site, no ACL/backend changes), `relatedTo: HEL-266`.
   - **HEL-641** "DataTypeId-keyed SSE broadcast for panel row invalidation" — Backlog, scoped to
     candidate A owner-only per D2 (many-to-one `DataTypeRowRegistry`, publish placed after
     `overwriteRows`, disconnect-lifecycle test, `findByIdOwned` ACL reuse), explicitly excludes
     sharing-aware cross-user as non-goal, `relatedTo: HEL-266`.
   - **HEL-642** "Decide: should DataType access become sharing-aware?" — Backlog,
     investigation/decision-only scope (explicitly not an implementation ticket), explicitly
     marked independent-of/prerequisite-to HEL-641, `relatedTo: HEL-266`.
   - Fetched **HEL-266** itself: `relations.relatedTo` includes all three (HEL-640/641/642)
     bidirectionally, plus HEL-242 (parent bug) and HEL-239 (epic). Status is "In Progress"
     (consistent with delivery not yet complete). No contradictions between the three tickets'
     descriptions of what each does/doesn't cover.

3. **design.md's factual codebase claims — spot-checked directly, not trusted from prior
   reports:**
   - `backend/src/main/scala/com/helio/api/routes/PipelineRunRegistry.scala`: confirmed
     `private val refs = new ConcurrentHashMap[String, ActorRef]()` (single ref per key, not a
     set/many-to-one) and `completionMatcher: PartialFunction[Any, CompletionStrategy] = { case
     ActorStatus.Success(_) => CompletionStrategy.draining }` with the inline PR #156 comment.
     Matches design.md's Context exactly.
   - `backend/src/main/scala/com/helio/services/PipelineRunService.scala`: read lines 339-394.
     Line 348 `publish(pidStr, RunStatusEvent("succeeded", ...))` executes synchronously on entry
     to `onRunSuccess`, *before* `rowsUpsert` is even constructed (line 353-354,
     `dataTypeRowRepo.overwriteRows(...)`), which is only awaited later in the `for` comprehension
     at line 386-393. The race design.md describes (client dispatch on `succeeded` racing the DB
     write) is real and the cited line number is accurate.
   - `backend/src/main/scala/com/helio/services/DataTypeService.scala:37-50` (`listRows`): calls
     `dataTypeRepo.findByIdOwned(id, user)` and returns `ServiceError.NotFound` for non-owners —
     confirmed owner-only, matches design.md's HEL-265-closure claim.
   - `backend/src/main/scala/com/helio/services/PanelService.scala:75-94`
     (`resolveBindingsForRead`): calls `dataTypeRepo.findByIdsOwned(typedIds, user)` and applies
     `panel.withBindingCleared` for any `typeId` not in the owned map — confirmed strict-owner-only,
     no sharing-aware path.
   - Searched all backend SQL/Scala for `resource_type` literal values: only `'dashboard'`
     (`V36__rls_sharing_aware_tables.sql`) and `'pipeline'` (`V39__pipeline_sharing_grants.sql`)
     exist; no `'data_type'` value anywhere, and `DataTypeRepository.scala` has no
     `findByIdShared`/`helio_can_access_data_type` analog (only `findByIdOwned` at line 85). This
     directly substantiates design.md's central correction: the cross-user gap, as it exists
     today, is narrower than ticket.md originally assumed — a shared-dashboard viewer who doesn't
     own the bound DataType already gets the binding cleared outright (no data at all,
     independent of any invalidation work), not "stale data." Not an assertion — it's the only
     conclusion the actual `resolveBindingsForRead` code and the actual `resource_permissions`
     schema support.
   - Confirmed HEL-265 commit `300423d1` exists (`git show --stat 300423d1` →
     "HEL-265 CS3: DataType + DataSource ACL enforcement", explicitly lists the
     `findByIdOwned` collapse in `DataTypeService`/`PanelService.resolveSingleBinding`) —
     design.md's citation is accurate.

4. **DoD genuinely satisfied.** `ticket.md` DoD requires: design proposal (proposal.md +
   design.md) — present, both non-placeholder, no TODOs/TBDs found; cost estimates — present in
   design.md Decisions/Risks (B: ~30 LOC low-risk; A: "materially more than a
   `PipelineRunRegistry` copy," itemized as new registry lifecycle + disconnect tests + client
   hook + publish-ordering fix); recommendation — explicit hybrid (D1 now, D2 scoped, D3 defer);
   spinoff tickets — three real, linked, Linear tickets (verified above). `tasks.md`'s 8 items are
   all checked and each checked item traces to real content, not aspirational.

5. **Pre-approved deviations reproduced, not just asserted:**
   - `npx openspec validate cross-session-panel-invalidation-design` → `[ERROR] ... No deltas
     found` — reproduced fresh, matches the expected/accepted deviation for a design-only change.
   - `node scripts/check-openspec-hygiene.mjs` → exits 1 with "change ... is complete (8/8) but
     not archived — run `openspec archive ...`" — reproduced fresh. Cross-checked
     `.husky/pre-commit`'s script order (`lint` → `format:check` → `check:schemas` →
     `check:openspec` → `check:scala-quality` → `test`): `check:openspec` runs before
     `scala-quality`/`test`, consistent with the commit message's claim that lint/format/schemas
     passed before the openspec-hygiene step failed and blocked the commit.

6. **No UI/frontend/backend diff exists** — this ticket is design-only by its own DoD; Section 4
   (UI/design judgment) and the dev-server startup step are correctly out of scope here, per the
   orchestrator's own framing. No code diff to run gates against.

### Verdict: CONFIRM

### Non-blocking notes

- Both non-blocking notes already surfaced by the design-gate skeptic and evaluator
  (`PipelineDetailPage.tsx`'s real path is under `frontend/src/features/pipelines/ui/`, not
  `pages/`; `BoundPanelService.scala:297`'s failure-path `overwriteRows` call is a second call
  site the eventual HEL-641 registry will also fire on) remain valid and are appropriately routed
  to the spinoff tickets rather than blocking this design-only ticket.
- HEL-266 is still "In Progress" in Linear as of this review — expected, since delivery
  (PR + archive) happens after this gate.
