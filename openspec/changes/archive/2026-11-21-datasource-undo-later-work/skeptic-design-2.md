## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD ebfeb6af76fdb594e072e46458d660c423a1db63. The planning artifacts are untracked in the change dir.
I did not reopen the owner rulings of 2026-11-20.

### Round-1 checklist (verified against the artifacts and the code)

1. **Same-set excusal removed: ADDRESSED.**
   - D6 now has no excusal, and its reason cites the resolvers.
   - The spec's excusal bullet is gone. The last sentence of the requirement says no reference is excused. The
     "that the same patch set did not create" qualifier on the reference bullet is redundant but harmless.
   - The pipeline scenario now adds a dashboard and a panel, which gives the partial-undo red.
   - The impossible scenario is replaced by "no later work removes the source and its rows".
   - D8's red list matches.
   - I also checked that `resolveDataSourceUpdate` requires `findByIdOwned` at resolve time
     (PatchSetDataSourceResolvers.scala:35). So a same-set dataSource update cannot touch the created source either.
2. **Wiring point: ADDRESSED.** D1 and task 3.3 put the check in `checkOne`'s `("dataSource", "update" | "create")`
   arm (PatchSetUndoConflictCheck.scala:84), for create only. That arm runs before `guarded`'s early return at :57.
   D8 adds a mutation that moves the check into the else branch.
3. **created_at detection: ADDRESSED IN THE DESIGN, CONTRADICTED BY THE TASKS.**
   - D2 and D3 drop `maxSeq` and use the `created_at`/`updated_at` predicates. The spec has the
     delete-last-then-append scenario, and D8 has the matching mutations.
   - But task 2.2 still says "Journal maxSeq/rowsUpdatedThrough/declaredSchema". That is the round-1 shape, which D2
     replaced with `rowsStampedAt` and `declaredSchema`. See CR 1.
4. **Schema-edit wording: ADDRESSED.** D7 gives no row count when `schemaEdited`, the spec has "A schema edit does
   not claim added rows", and D7 explains the "added or replaced" wording.
5. **Fallback scope: ADDRESSED.**
   - The spec scenario is scoped to journaled applies.
   - D4 states that a lone row delete trips the fallback. I re-checked this: `deleteRow` calls
     `recomputeAfterMutation`, which updates only `data_sources` (DataSourceRepository.scala:873), so other rows'
     `updated_at` is untouched and the journaled path really does let a delete through.
   - D4 states the mid-apply residual (wording nit below).

### New findings (verified)

- **Inline dataset roots are a second path to the same data loss, and the artifacts never mention it.**
  - A patch-set `pipeline` create can make an inline `dataset` root:
    - `PipelineRootWrites.scala:71-73` calls `dataSourceService.createStatic`.
    - `PipelineRootDryRun.scala:41` runs `validateStatic` for the patch-set preview and resolve.
    - `PatchSetApplyService.journaledInlineSources` (:223) journals the inline source.
  - Undoing that pipeline create runs `PatchSetUndoInlineSources.cleanup` and then
    `InlineSourceCleanup.deleteIfUnreferenced`. That function deletes the source through `DataSourceService.delete`
    whenever no references remain. The pipeline itself was just deleted, so there are none.
  - So rows the owner appended to that inline dataset after the apply, and edits to its apply-era rows, are deleted
    by the cascade with no warning. That is the same loss the owner ruled must refuse, reached through the patch set's
    `pipeline` create instead of its `dataSource` create.
  - HEL-1795 covers pipeline-create children (steps and Outputs) only. The proposal's non-goals do not exclude this
    path, and no task covers it. See CR 2.
- **Timestamp precision trap in D2's `T`.**
  - `createStatic` stamps the rows with a JVM `Instant.now()` (DataSourceService.scala:177), inserted as
    `source.createdAt` (DataSourceRepository.scala:385).
  - PostgreSQL `timestamptz` keeps microseconds and rounds to the nearest one. A JDK on Linux can return
    sub-microsecond `Instant`s.
  - If `T` is journaled from the in-memory `DataSource.createdAt`, a stored `created_at` can round up past `T`. Every
    apply-era row would then read as "appended", and every undo would refuse.
  - D2 says the value is "read", but it describes `T` as "the stamp createStatic gives". That reading invites the
    in-memory value. See CR 1.
- Confirmed: `createStatic` uses one stamp for the source and every row. D3's predicates and D5's single aggregate
  query are sound. The `JournaledEdit` format-ordering note is correct.

### Verdict: REFUTE

### Change Requests

1. **tasks.md 2.2 and design D2: align them, and pin where `T` comes from.**
   - Reword task 2.2 to journal `JournaledCreatedDataset(rowsStampedAt, declaredSchema)` as D2 defines it. Remove
     `maxSeq` and `rowsUpdatedThrough`.
   - Task 3.1 should also list `sourceUpdatedAt`, which D5 returns and D4 needs.
   - In D2, state that `rowsStampedAt` is read back from the database, for example `max(created_at)` of the source's
     `dataset_rows` (or the stored `data_sources.created_at`) right after `createStatic`. It must never come from the
     in-memory `Instant`, so that the D3 comparisons run against microsecond values as stored.
   - Add one test assertion: with no later work, an undo of a multi-row create succeeds. The spec scenario already
     exists; the point is that it guards this case.
2. **Address inline dataset roots created by a patch-set `pipeline` create.** Do one of the following:
   - **(a) Cover it.** Journal the same `JournaledCreatedDataset` for each inline dataset root, and run the same
     predicate in Phase 1 for the pipeline-create edit, so the whole undo refuses with a 409. Add a red test for it.
   - **(b) Scope it out explicitly.** Add a proposal non-go or a design note that names the path
     (`PatchSetUndoInlineSources`, then `InlineSourceCleanup.deleteIfUnreferenced`) and gives the reason. Have the
     orchestrator file a follow-up ticket for it, cited in the artifacts.

   Either is acceptable. Leaving it silent is not: it is the ticket's own loss class, and the premise check left it
   unlisted.

### Non-blocking notes

- D4's sentence "The same holds for the journaled path" is wrong in the safe direction. On the journaled path, an
  append made during the apply has `created_at > T`, so it is caught. "Unreachable" is also an overclaim, because the
  committed source is listable through `GET /api/data-sources` before the apply returns. Reword these, though no
  behavior depends on them.
- For the "counting it otherwise" half of the pipeline scenario: ownership checks on roots, secondaries and form
  bindings probably make a reference the undoing user cannot read unreachable. Test the visible case. Do not invent
  a hidden-reference fixture that relies on a privileged insert, unless one is genuinely reachable.
- Phase 2 should reuse D1's single predicate, which the design already states.
