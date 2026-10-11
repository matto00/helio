## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed cold against worktree HEAD 02dc11abdc28577c8071a61d1e7295eacbdfee1c. The change dir is untracked; the code is
unmodified main. I read ticket.md, proposal.md, design.md, specs/patch-set-undo/spec.md and tasks.md, and treated
skeptic-design-1.md as input, not authority. The owner rulings (B / keep-source-legacy / wire-field-and-toast) are not
re-litigated.

### What I verified (with evidence)

**Round-1 change requests**

1. **CR1 (full result → wire → toast mapping): addressed.**
   - The D4 table maps all five cases. `Removed`→`removed`, `AlreadyGone`→`alreadyGone`,
     `KeptReferenced`→`kept` plus the 409 reason, `Failed`→`kept` plus `REASON_FAILED`, and no helper→`kept` plus
     `REASON_UNAVAILABLE`.
   - Both fixed sentences are quoted as named constants, and D4 forbids exception, id and SQL text in `reason`.
   - D5 renders each kept entry's own `reason` (never a hardcoded "still in use") and names the fallback
     `Kept a data source: <reason>`.
   - Task 4.6a covers Failed/no-helper → `kept` with the fixed reasons. Task 4.8 covers reason rendering, the name
     fallback and multiple kept sources.
   - The spec adds the scenario "A source that could not be removed is reported kept with a fixed reason".
   - Ground truth: `DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err)`
     (DataSourceDeleteError.scala:12-19) makes conflict vs NotFound vs other mechanically distinguishable, so D2's
     classification is implementable without string matching.
   - `referenceConflict` (DataSourceService.scala:~698-717) builds `reason` from visible referencers plus hidden
     counts only. The race path (:679-684) logs only the SQLSTATE and maps to the same conflict shape, so the reason
     is safe to put on the wire.
2. **CR2 (data-source refresh is a new `fetchSources()` dispatch): addressed.**
   - D5 now states plainly that `invalidateAffectedState` handles panels and dashboards only, and instructs extending
     it or `undoPatchSet` to dispatch `fetchSources()`.
   - Ground truth: `invalidateAffectedState` (patchSetsSlice.ts:162) has no data-source path, and its header comment
     (:75-81) defers one. `undoPatchSet` calls it at :265. `fetchSources` exists at sourcesSlice.ts:63.
   - Task 3.3 and test 4.8 assert the dispatch fires on removal and not otherwise.
3. **CR3 (empty journal list): addressed.**
   - D4: the field is omitted for `None` and for an empty journaled list.
   - The new spec scenario "A create with no inline roots reports nothing" pins that the outcome carries no
     `inlineSources` field.
   - Test 4.7 asserts the field is omitted in both cases.

**Fresh review of the whole design**

4. **D2 never-throws contract is grounded.** `InlineSourceCleanup` (services/sources/InlineSourceCleanup.scala) has
   only `deleteCallCreated: Future[Boolean]` today, and it collapses conflict and failure into `false`, as the design
   says. `ImplicitConnectorCleanup.deleteIfAuto` exists and keeps its name and dependents guards. D2 keeps
   `deleteCallCreated`'s contract (rollback, proposal and create-compensation callers at PatchSetApplyRollback.scala:226,
   PipelineProposalService.scala:78 and PipelineCreateWrites.scala:147 are untouched).
5. **D3 undo arm is grounded.**
   - The `("pipeline","create")` arm is at PatchSetUndoService.scala:118 via `restoreCreateUndo` (:143).
   - The walk is in reverse with stop-on-failure (`restoreAll`, :79-98), so step-level edits that could reference the
     inline source are undone before the create arm runs.
   - The status stays `restored`. The pipeline-delete failure path is unchanged.
   - `pipelineService.inlineSourceCleanup` is `private[services]` and may be null (PipelineService.scala:81-83), which
     is why D3's no-helper branch exists.
6. **D1 journal is grounded.**
   - `JournaledEdit` uses `jsonFormat7` (PatchSetApplicationRepository.scala:93/:103). `journalSuccess`
     (PatchSetApplyService.scala:153-168) has the `ResolvedEdit` in scope, so the `PipelineCreate` request roots are
     available for pairing.
   - The position pairing extracted from `deleteInlineRootSources` (PatchSetApplyRollback.scala:209-246) keeps the
     count-mismatch guard, and the journal maps a mismatch to `None` (legacy behaviour). That satisfies C3.
   - spray-json absent-Option-as-None was verified in round 1 (ProductFormats.scala:46/:54-56). Test 4.5 re-pins it
     with a literal legacy row.
7. **Wire.** `EditUndoOutcome` is `jsonFormat4` today (PatchSetUndoProtocol.scala:37), so the move to `jsonFormat5` is
   correct. Task 2.4 updates the schema, whose `additionalProperties: false` would otherwise reject the field (round-1
   finding, not re-contested). The frontend and helio-mcp types are covered in 3.1 and 2.4.
8. **Scope and ACs.**
   - AC1: the decision is recorded (workflow-state OWNER_DECISIONS, answer.json channel).
   - AC2: implemented with red-first tests (C1, 4.1, 4.9).
   - AC3: prod orphans are a non-goal (HEL-1495).
   - No TODO/TBD/placeholders. No contradiction between the proposal, design, spec and tasks.
   - The round-1 Risks additions (dataset-rows cascade, connector list not refreshed) are now present.

### Verdict: CONFIRM

### Non-blocking notes

- **Multi-line toast rendering is not free.** `ToastItem.message` is a `string` (toastsSlice.ts:13). `Toast.tsx:81-82`
  renders it in `<p class="toast__message">`, and `toast.css` (`.toast__message`, :109) sets no `white-space`.
  D5's "separate lines in one toast" therefore will NOT happen if the executor simply joins with `\n`: the lines
  collapse into one run-on line, and a jest string assertion would still pass. The executor must choose a real
  mechanism, such as `white-space: pre-line` on `.toast__message` (harmless for existing single-line messages) or one
  toast per kept source.
  - The final-gate skeptic should screenshot an undo with two kept sources, in both themes.
- **Toast lifetime and intent.** A kept-reason sentence such as "This source is still referenced by pipeline X (id).
  Remove each reference first (…)." will not be read within the default ~4s auto-dismiss under a `success` variant.
  Consider a `warning` variant and/or a longer or sticky `duration` when anything was kept (the Apply toast already
  uses `duration: 0`, PatchSetReviewPage.tsx:104-105).
- **Journal skip case.** On the journal side, D1 does not say what happens when the counts agree but an inline root's
  summary entry has no string `dataSourceId` (rollback skips that source with a warning). The conservative choice,
  and the one implied by "never delete what we cannot pair", is to omit that source from the journaled list. Mirror
  rollback's skip-and-warn.
- **Format declaration order** (round-1 note, now in D4): declare the `JournaledInlineSource` and
  `InlineSourceUndoOutcome` formats before the formats that use them, or they read as `null` at runtime.
