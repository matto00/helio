## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/panel-modal-appearance-probe/HEL-1615`.
  HEAD is 68829c1c677f31c38dd695cfb06ecff0690a6a7e (main). The only untracked path is this change dir.
- Read ticket.md, proposal.md, design.md, tasks.md and specs/panel-detail-modal/spec.md. Then checked each claim
  against the live tree:
  - `PanelDetailModal.tsx:141-177`: `handleEditSubmit` always builds `{background, color, transparency:
    clampTransparency(transparency/100)}` with no `chart`, and adds `title` only when it changed. Confirmed.
  - `usePanelDetailEditState.ts:35`: transparency is seeded as `Math.round(clampTransparency(t) * 100)`, so a stored
    0.555 is seeded as 56 and saved as 0.56. The round-trip loss is real in the code, and Decision 2a addresses it.
  - `panelsSlice.ts:120-135`: the pending entry is a shallow spread and the local item is `{...panel, ...fields}`
    (the appearance object is replaced). `:140-147`: `clearSentPendingPanelUpdates` clears by JSON equality.
    `:338-341`: `updatePanelsBatch.fulfilled` replaces each item with the server copy (the healing path). Confirmed.
  - `panelsSlice.ts:528-549`: `buildBatchRequest` already passes a title-only item through. Confirmed.
  - `types/panel.ts:410-428`: `PanelUpdateFields.appearance` and `PanelBatchItem.appearance` are currently the full
    `PanelAppearance` type. The type change planned in 2a is needed. `schemas/panels/panel-appearance-patch.schema.json`
    exists.
  - Backend: `PanelAppearance.applyPatch` (`PanelAppearance.scala:69-83`) keeps the stored chart when `chart` is
    absent and merges field by field otherwise. `PanelServiceHelpers.scala:38` and the batch path both use
    `applyPatchJson`. The plan's "server already merges" premise holds.
  - The only callers of `accumulatePanelUpdate` are the modal and `usePanelTitleEditing.ts:37` (title only). No caller
    relies on replace semantics to drop `chart`, so the reducer merge breaks no other path.
- Prior change requests, rechecked:
  - Design-1 CR1: option (a) was chosen and recorded (2a). The probe seeds 0.555, and there are a task (3.2) and a spec
    scenario for it. Addressed.
  - Design-1 CR2: the healing claim was corrected in Context. The probe and the guards read state before and after the
    flush (Decision 1b, C1, tasks 1.2/4.1/4.2). The spec scenario now says "before the pending batch is flushed".
    Addressed.
  - Design-2 CR1: the pending payload is now the merged union (Decision 2). There are a task (3.4) and a two-save spec
    scenario, and the clearSent check is planned. Addressed.
  - Design-2 CR2: "2a depends on Decision 2" is stated, and task 3.4 is gated "client loss OR 3.2 ships". Addressed.
  - Design-2 CR3: the HEL-322 sentinel cases are re-expressed per 2b, and task 3.3 labels this as an intended test
    change. Addressed.
  - Design-2 CR4: the `Partial<PanelAppearance>` patch type is in 2a and task 3.2. Addressed.
  - Both design-2 non-blocking notes (compare against the seeded integer; skip the dispatch when nothing changed) were
    folded into 2a.
- Placeholders, contradictions and scope: no TODO/TBD. Every branch of the probe outcome has a concrete task. The
  server-loss branch escalates before changing semantics. The scope matches the ticket ACs: AC1 → tasks 1.x, AC2 →
  3.x/4.x red-first plus mutation, AC3 → the guard path. There is no API or schema change, so no contract delta is
  needed.

### Verdict: CONFIRM

### Non-blocking notes

- The existing requirement "Save persists appearance and closes the modal" (base spec :66-73) says Save "MUST dispatch
  the appearance update". After 2a, a save with no changes dispatches nothing, and a title-only save sends no
  appearance. The scenario wording ("modifies appearance values") still holds, but consider a MODIFIED delta that
  aligns the requirement text with "only changed fields are sent".
- Other tests may pin today's full-appearance pending shape for a title-only save (`panelsSlice.test.ts`,
  `PanelDetailModal.test.tsx:350`, `PanelGrid*.test.tsx`). Any that change should carry the same intended-change
  rationale as 2b, not be quietly edited.
- The modal never sends `null`. The Risks bullet allows limiting the reducer merge to what the modal sends. If so, say
  explicitly that `chart: null` is not mirrored locally, so a later caller does not assume it is.
