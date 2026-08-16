## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Central scrutiny item — Decision 4's "one of at least seven `PanelResponse.fromDomain` call
sites populates `dataAsOf`" claim.** Verified directly against the real code, not taken on
faith:

```
grep -rn "PanelResponse.fromDomain" backend/src/main --include="*.scala"
```

Found 24 call sites across `DashboardSnapshotRoutes.scala`, `DashboardRoutes.scala`,
`PatchSetUndoService.scala` (x2), `PatchSetApplyRollback.scala` (x2), `DashboardProposalRoutes.scala`,
`PanelRoutes.scala` (x5), `DashboardContentsRoutes.scala`, `PublicDashboardRoutes.scala` (x2),
`PatchSetApplyResolvers.scala` (x2), `BoundPanelService.scala`, `PatchSetUndoConflictCheck.scala`,
`PatchSetApplyForward.scala` (x2), `PatchSetPreviewProjection.scala` (x2), `CombinedProposalService.scala`.
Confirmed `PanelProtocol.scala:112`: `def fromDomain(panel: Panel, dataAsOf: Option[String] = None)`
— single-arg calls default to `None`. Of the 24 call sites, **exactly one**
(`PublicDashboardRoutes.scala:55`, the public/shared-dashboard route) passes a real second argument
(`instantOpt.map(_.toString)`); its own fallback branch at line 57 defaults to `None` too. Every other
call site — including `DashboardRoutes.scala:62` (the authenticated dashboard-editing route the design
doc calls out) — passes zero args. **The claim is verified true, and actually understated** (design.md
says "at least seven"; the real count of never-populated sites is ~23). Decision 4's rejection of
piggybacking is well-grounded.

Also verified the supporting sub-claims Decision 4 depends on:
- `findLastRunAtByOutputDataTypeId` (`PipelineRepository.scala:302`) is system-context with a doc
  comment stating the ACL gate is enforced by the caller — confirmed verbatim.
- `PipelineRunRepository` holds `runsTable`/`pipelinesTable` as private vals (lines 27-28) — confirmed,
  supports Decision 5's placement claim.
- `dataTypeService.findById`/`listRows` both call the same `dataTypeRepo.findByIdOwned(id, user)` ACL
  check (`DataTypeService.scala:27-50`) — confirmed, supports Decision 7's "mirrors /rows's ACL" claim.
- `RunHistoryModal.tsx`'s current expand-toggle condition is exactly
  `run.status === "failed" && run.errorLog` (line 67) with the expanded body rendering only `errorLog`
  (line 78-80) — confirmed, matches Decision 10's before/after description precisely.
- DESIGN.md tokens `--app-warning`/`--app-error` (+ `-surface` variants) exist in both light and dark
  theme blocks in `frontend/src/theme/theme.css` — confirmed.
- `AssertionResult.severity` is constrained to exactly `"warn"`/`"error"` (`AssertStep.scala:120`,
  `SupportedSeverities: Vector("warn", "error")`) — confirmed, so the `warnFailed`/`errorFailed` split
  has no third-category ambiguity.
- Decision 3's claim that blocked runs reuse status `"failed"` (no dedicated `"blocked"` status) —
  confirmed via `PipelineRunService.scala`'s `onBlockedRun` doc comment: "terminal status `"failed"`
  with a real, structured `errorLog`."

**Blocking finding — dry runs are not excluded from the "latest run" lookup (Decision 5 / task 1.3).**
Reading `PipelineRunService.onDryRunSuccess` (`PipelineRunService.scala:352-370`) and the `V84` migration
comment (`pipeline_run_assertions` "persists one row per rule evaluated... succeeded, failed (partial
results), **or a successful dry run**") confirms dry runs persist real rows into
`pipeline_run_assertions`, FK'd to a `pipeline_runs` row with `status = "dry_run"` in the *same* table
real runs live in (`PipelineRunRepository.scala:306`, `class PipelineRunTable... "pipeline_runs"`). The
existing codebase already has an established, load-bearing convention for excluding dry runs from
"real run" queries: `deleteOldRunsInternal` (`PipelineRunRepository.scala:155-166`) explicitly filters
`.filter(r => r.pipelineId === pid && r.status =!= "dry_run")` before computing retention, precisely
because dry runs are a separate concern from a pipeline's real run history for that purpose. Design.md
Decision 5 and task 1.3 describe the new `findLatestRunIdByOutputDataTypeIdInternal` as joining
`pipelines`/`pipeline_runs` "sorted by `started_at desc`, `.headOption`" with **no such filter** — see
below under Change Requests.

**Traced every AC:**
1. Run History pass/fail-by-severity summary — covered by capability 1 (`run-history-assertion-summary`
   spec, tasks 1.1/1.4/2.1/2.2). Sound, no gaps.
2. Panel badge for invalid/blocked DataType — covered by capability 2, but see Change Request 1 below
   (dry-run leak breaks this AC's actual correctness, not just its wording).
3. `PipelineRunRecord` + schema additive — covered (task 1.1/1.7); confirmed `PipelineRunRecord`
   currently has 9 fields / `jsonFormat9` (`PipelineProtocol.scala:43-53,92`), room for a 10th field is
   not a spray-json arity problem.
4. DESIGN.md/lint/test — covered (Decision 9, task 3.7).

**Scope / contract check:** confirmed `openspec/specs/pipeline-run-provenance/spec.md` and
`openspec/specs/pipeline-run-status-ui/spec.md` (the two existing specs closest to this ticket's surface)
only assert specific fields/behaviors (`triggerSource`, SSE status semantics) and don't enumerate
`PipelineRunRecord`'s full field list — so proposal.md's "Modified Capabilities: none" is defensible;
nothing existing is contradicted by an additive field. No missing contract update found.

### Verdict: REFUTE

The design is well-researched and its central architectural bet (Decision 4, the piece I was asked to
scrutinize hardest) checks out completely — the frontend plan is sound and closely mirrors existing
patterns (`condition:`-based thunk dedup precedent in `panelThunks.ts`/`dashboardsSlice.ts`,
`panel-grid-card__footer`/`__type-badge` BEM precedent). But there is one concrete, evidence-backed
correctness gap in the panel-badge capability that would ship a wrong signal on exactly the feature this
ticket exists to deliver, and none of the planned tests (tasks 3.2/3.3) would catch it because the gap
isn't named anywhere in the design.

### Change Requests

1. **`findLatestRunIdByOutputDataTypeIdInternal` (design.md Decision 5, tasks.md 1.3) must exclude dry
   runs.** As written, "joins `pipelines`/`pipeline_runs`... sorted by `started_at desc`, `.headOption`"
   with no status filter will pick up a `status = "dry_run"` row as the "latest run" whenever a user
   submits a dry run after the last real run — which is a normal, expected user action (e.g. testing a
   new assert rule before committing to a real run). Dry runs persist real assertion rows
   (`pipeline_run_assertions`, confirmed via `PipelineRunService.onDryRunSuccess` +
   the V84 migration's own comment) but never write the DataType's schema/rows
   (`onDryRunSuccess` never calls `onRunSuccess`/the schema-upsert path). Picking a dry run as "latest"
   for the invalid-badge computation means a panel can flip to "invalid data" purely because someone
   previewed an assert rule against the pipeline, without the panel's actual bound data changing at
   all — directly undermining the ticket's own stated purpose ("closing the trust loop"). Required
   revision: add `.filter(r => r.status =!= "dry_run")` (or equivalent), mirroring the exact precedent
   already established at `PipelineRunRepository.scala:158`
   (`deleteOldRunsInternal`'s `r.status =!= "dry_run"` filter). Also revise:
   - `panel-assertion-invalid-badge/spec.md`'s Requirement text — "a latest run (regardless of terminal
     status)" is ambiguous on this exact point (a competent implementer could plausibly read "regardless
     of terminal status" as *including* `dry_run`, since `dry_run` is itself one of `PipelineRunRecord`'s
     status literals). Reword to something like "a latest non-dry-run run (regardless of terminal status
     — succeeded/failed, including blocked)" and add a scenario: "A DataType whose most recent activity
     is a dry run reports the *prior real run's* status, not the dry run's."
   - tasks.md 3.2/3.3 — add a case to the repository/service test plan that inserts a dry run more recent
     than the last real run and asserts it is not selected / does not flip `invalid`.

### Non-blocking notes

- Decision 2 describes `history()`'s per-run assertion fetch as "bounded... sequential" — `Future.traverse`
  over up to 10 run ids actually fires the futures concurrently, not sequentially. This doesn't change
  the bound (still ≤10 DB calls) or the correctness of the plan, just imprecise wording; worth tightening
  before an implementer copies the word "sequential" into a comment that would then be wrong.
- The per-DataType assertion-status fetch dedupes per distinct `dataTypeId` (good — addresses the
  same-DataType-many-panels case explicitly called out in the Goals), but a dashboard with many panels
  bound to *distinct* DataTypes will still fire one concurrent request per distinct DataType on mount.
  That's a reasonable, bounded trade-off given the ticket's own explicit non-goal ("no need... to
  introduce [a bulk read]"), just flagging it's not literally zero fan-out.
