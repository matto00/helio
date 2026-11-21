## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD ebfeb6af76fdb594e072e46458d660c423a1db63. The planning artifacts are untracked in the change dir.
The owner rulings of 2026-11-20 were not reopened.

### What I verified (with evidence)

**Round-4 checklist**

1. **CR1 (reference wording without `describe`): ADDRESSED.**
   - D6 "Wording" says the refusal is NOT built with `SourceReferences.describe`, and that `describe` stays unchanged
     for the direct-delete 409.
   - The refusal is built from `findReferences`' result with `PatchSetUndoBoundPanels.nameList`:
     - `pipeline "<name>"`;
     - `"<title>" on dashboard "<name>"`;
     - overflow past `NameCap` is counted;
     - the hidden counts are counted;
     - no id.
   - The proposal's "What Changes" also says "HEL-1792 `nameList`" and "no ids appear". Task 3.2 says "nameList reference
     wording".
   - Feasibility, checked against the code:
     - `nameList(ids, describeOne: String => Future[Option[String]], unreadableNoun)` is generic
       (PatchSetUndoBoundPanels.scala:112-124).
     - `SourceReferences` carries `VisiblePipelineRef.name`, `VisiblePanelRef.title`/`dashboardName` and the
       `hiddenPipelineCount`/`hiddenPanelCount` counts (DataSourceReferenceRepository.scala:143-160). So every part D6
       names can be built with no extra lookup.
     - `DataSourceRepository.findReferences(id, user)` exists (DataSourceRepository.scala:297).
     - `describe` does print ids (`(${p.id}; ...)` and `(${p.id}) on dashboard ... (${p.dashboardId})`, :167-171). So the
       D8 describe-swap mutation genuinely goes red against a no-id assertion.
2. **CR2 (spec no-id rule and THEN clause): ADDRESSED.**
   - The requirement now says: "No id of a referencing pipeline, panel, dashboard or the source SHALL appear in the
     message."
   - The later-pipeline scenario's THEN now says "containing that pipeline's name and not its id".
3. **CR3 (D8 assertion and mutation): ADDRESSED.**
   - D8 asserts that every reference-refusal message contains the visible name and none of the pipeline, panel,
     dashboard or source ids.
   - The mutations list "swap the D6 wording for `describe` (the no-id assertion must go red)".

**Round-4 non-blocking note (Phase-2 backstop text): ADDRESSED.**
- D7 maps any `DataSourceDeleteError` that carries a conflict to a fixed phrase: "the data source gained a use during
  the undo; nothing further was undone".
- Ground truth: both conflict constructions in `delete` are reference conflicts (DataSourceService.scala:645, and the
  race path at :664). So "gained a use" is accurate for every conflict case.
- This matters because the failure reason is logged at ERROR (PatchSetUndoService.scala:105). The mapping keeps
  `describe`'s ids out of that log line.
- The arm being changed is still the one-liner at PatchSetUndoService.scala:126, consistent with D1's "a few lines".

**Earlier rounds** (round 1 CR1-5, round 2 CR1-2, round 3 CR1-3) remain addressed in the current text. I re-checked
the following:
- **D1 wiring:** the arm is still at PatchSetUndoConflictCheck.scala:83, with `checkDataSource`. The HEL-1795 call is
  inside `guarded` (:62).
- **D3:** detection is by `created_at`, not seq.
- **D2:** `T` is the stored `data_sources.created_at`.
- **D4:** the fallback scope is stated.
- **Task 5.1:** the D9 follow-up goes through triage.
- **No same-set excusal:** `PatchSetRefs` only names earlier `output` creates (PatchSetRefs.scala:8-13).

**New-defect sweep: none blocking.** I checked the following:
- **Tasks against D1-D8:** every task maps to a design decision, with no orphan task and no uncovered scenario.
- **Spec against design:** the delete-does-not-block scenario is scoped to journaled applies, which matches D4's
  accepted over-refusal.
- **Contract:** there is no wire change, so no schema delta is needed.

### Verdict: CONFIRM

### Non-blocking notes
- **D6 hidden-count phrase.** D6 says "you cannot see". `describe` and `DataSourceDeleteError` say "you cannot access".
  Either is fine; pick one in the implementation and assert it.
- **Spec bullet qualifier.** The spec's reference bullet no longer carries the redundant "that the same patch set did
  not create" qualifier. It now states the impossibility directly. That is fine.
- **Visible names in logs.** If the Phase-1 409 message is logged at INFO or above anywhere, it contains visible
  pipeline and panel names. HEL-1720/1792 already accept that (they are resource names, not user names), so this is
  consistent.
