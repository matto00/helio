## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD ebfeb6af76fdb594e072e46458d660c423a1db63. The planning artifacts are untracked in the change dir.
I did not reopen the owner rulings of 2026-11-20.

### Round-2 checklist

1. **CR1 (align tasks 2.2 with D2, pin where T comes from, add sourceUpdatedAt, multi-row test): PARTLY ADDRESSED.**
   - D2 now says `rowsStampedAt` is read back from the database, never from the in-memory `Instant`. Addressed.
   - Task 3.1 lists `sourceUpdatedAt`. Addressed.
   - D8 and the spec have "no later work on a multi-row create succeeds", marked as the T-precision guard. Addressed.
   - **Task 2.2 is unchanged.** It still reads "Journal maxSeq/rowsUpdatedThrough/declaredSchema". That is the
     round-1 shape, which D2 replaced with `JournaledCreatedDataset(rowsStampedAt, declaredSchema)`. This was the
     first bullet of round-2 CR1, word for word, and it is still there. The executor works from tasks.md. See CR 1.
2. **CR2 (inline dataset roots): ADDRESSED via option (b), with one gap.**
   - The proposal's Non-goals name the path. D9 names `PatchSetUndoInlineSources.cleanup`, then
     `InlineSourceCleanup.deleteIfUnreferenced`, then `DataSourceService.delete`, and gives a reason.
   - I checked the reason against the code. `InlineSourceCleanup.scala:129-132` maps a delete conflict to
     `KeptReferenced`, so the pipeline undo still succeeds with the source kept. The "different outcome model"
     reason is real.
   - The disposition (follow-up triage escalation at Delivery, with the id cited in the PR body and the closing
     comment) is explicit in D9 and fits the driver's lane rule.
   - The only tracking for it is a comment line in workflow-state.md (`# PENDING_FOLLOWUP ...`). There is no task in
     tasks.md, so nothing on the checklist makes Delivery do it. See CR 2.

### New findings (verified)

- **D2's chosen read-back of T is racy, and that contradicts D4's own claim.**
  - `createStatic` stamps the source and every row with one `Instant` (DataSourceService.scala:177, 182-183). The
    row insert uses `source.createdAt` for both `created_at` and `updated_at` (DataSourceRepository.scala:386). The
    same transaction writes `data_sources.created_at`, and nothing updates it afterwards.
  - D2 chose `max(created_at)` of the source's `dataset_rows`, read "right after `createStatic` returns". The source
    is committed at that point. D4 itself concedes that it can be listed and written through
    `GET /api/data-sources` before the apply returns.
  - If a row is appended in that window, `max(created_at)` returns the appended row's stamp. That row then reads as
    apply-era (`created_at <= T`), and the undo deletes it silently. That is the exact loss this ticket closes.
  - D4's last sentence says "The journaled path catches such a row, because its `created_at` is later than `T`." That
    is false under D2's read, so the design contradicts itself.
  - Reading the stored `data_sources.created_at` back has neither problem. It is the same stored microsecond value,
    it cannot be moved by a later append, and it exists even for a zero-row create. Round 2 offered it as an
    alternative. See CR 3.
- Confirmed: the `checkOne` arm `("dataSource", "update" | "create")` is at PatchSetUndoConflictCheck.scala:83, so
  D1's wiring point is live. `captureCreatedChildren` runs per edit inside the apply loop and is threaded into
  `journalSuccess` (PatchSetApplyService.scala:138-176, 248-261). That gives D2 a concrete place to journal the new
  field. The `DataSourceCreate` forward arm is at PatchSetApplyForward.scala:70-73.

### Verdict: REFUTE

### Change Requests

1. **tasks.md 2.2:** replace "Journal maxSeq/rowsUpdatedThrough/declaredSchema" with "Journal
   `JournaledCreatedDataset(rowsStampedAt, declaredSchema)` per D2, with `rowsStampedAt` read back from the
   database, for dataSource creates in PatchSetApplyService (never fails apply)". No `maxSeq` or
   `rowsUpdatedThrough` may remain anywhere in the artifacts.
2. **tasks.md:** add a Delivery task. For example: "Raise the D9 inline-dataset-root follow-up through the
   follow-up triage escalation before presenting the PR. Cite the resulting id in the PR body and in the HEL-1796
   closing comment." Without it, the option (b) disposition depends on a comment line in workflow-state.md.
3. **design D2, and D4's last sentence:** take `rowsStampedAt` from the stored `data_sources.created_at` of the
   created source, read back after `createStatic`. Do not use `max(dataset_rows.created_at)`, because an append
   that lands between the commit and the read-back moves it. Then either:
   - keep "`T = None` when zero rows" and say why, or
   - drop the `None` case, since `data_sources.created_at` always exists. Then D3's `T = None` rule applies only to
     a failed read.

   State which one. Add a test, or a probe note in task 1.1, showing that `data_sources.created_at` equals the
   stored `dataset_rows.created_at` for a create. With that change, D4's "the journaled path catches such a row"
   becomes true.

### Non-blocking notes

- The spec's "that the same patch set did not create" qualifier on the reference bullet is still redundant. It is
  harmless.
- On the visible/hidden reference wording, test the visible case. Build a hidden-reference fixture only if one is
  genuinely reachable (carried over from round 2).
