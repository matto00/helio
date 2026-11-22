## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 68829c1c677f31c38dd695cfb06ecff0690a6a7e (change dir untracked). Artifacts: ticket.md, proposal.md,
design.md, tasks.md, specs/panel-detail-modal/spec.md, skeptic-design-1.md, workflow-state.md.

### What I verified (with evidence)

- **Round-1 CR1 was addressed.** design.md Decision 2a picks option (a): send only changed appearance keys. Task 3.2 and
  the 0.555 spec scenario cover it. The cause is real: `usePanelDetailEditState.ts:35` rounds transparency to a whole
  percent, and `PanelDetailModal.tsx:147-151` always sends all three scalar fields.
- **Round-1 CR2 was addressed.** The Context bullet now cites `updatePanelsBatch.fulfilled` healing the state
  (`panelsSlice.ts:338-341`, confirmed). Decision 1(b), standing constraint C1, tasks 1.2/4.1/4.2 and the spec scenario
  all read state "before the pending batch is flushed". The chart type must differ from the Output's config and from
  `line` (round-1 note), and task 1.2 includes the OutputControlsEditor save.
- **The wire accepts a partial or title-only item.** `PanelBatchItem` (`PanelProtocol.scala:101-107`) has an optional
  `appearance`, and `PanelMutationRepository.scala:99-117` applies title and appearance independently.
  `schemas/panels/update-panels-batch-request.schema.json:35-36` references `panel-appearance-patch.schema.json`, so no
  contract delta is needed.
- **Only one caller sends appearance through the accumulator.** A grep of the non-test callers finds only
  `PanelDetailModal.tsx:153` (appearance) and `usePanelTitleEditing.ts:37` (title only).
- **New defect introduced by Decision 2a: the pending appearance is still replaced, not merged.**
  `panelsSlice.ts:124-127` sets `pendingPanelUpdates[id] = {...pending, ...fields}`, a shallow spread. The plan says
  "the PENDING/wire payload stays the partial patch" (Decision 2) and does not change this line. Today this is harmless,
  because the modal always sends the full scalar triple. Under 2a it loses data. Example: save the modal with only the
  background changed (pending is `{appearance:{background}}`), then reopen and save with only the color changed, all
  before the 30 s flush. Pending becomes `{appearance:{color}}`, so the server never receives the background edit. The
  locally merged item shows both edits until `updatePanelsBatch.fulfilled` swaps in the server copy, which reverts the
  background. That is the same silent-loss class this ticket exists to close, and it is now caused by the fix.
- **Decision 2a cannot ship without Decision 2.** Each one is conditional on its own probe outcome ("if the client-state
  loss is real" / "if the probe confirms the transparency loss"). With 2a alone, the unchanged local spread
  `{...panel, ...fields}` (`panelsSlice.ts:131-133`) would set `panel.appearance` to e.g. `{color}`. That drops
  `background` and `transparency` from a type that declares them required (`types/panel.ts:59-64`).
- **Contradiction with the HEL-322 sentinel test.** Decision 2a says "The HEL-322 sentinel test must stay green (an
  untouched sentinel is now simply not sent)". But `PanelDetailModal.appearanceSentinel.test.tsx:76-80` and `:98-102`
  make a title-only save and then assert `pending.appearance?.background` is `"transparent"` (and `.color` is
  `"inherit"`). Under 2a, `pending.appearance` is undefined, so those assertions fail. The test cannot stay green
  unchanged. The plan has to say how its intent is re-expressed, otherwise an implementer will edit it ad hoc.
- **Type surface not planned.** `PanelUpdateFields.appearance` and `PanelBatchItem.appearance` are `PanelAppearance`,
  which has required `background`/`color`/`transparency` (`types/panel.ts:410-427`, `59-64`). A partial patch needs a
  patch type (e.g. `Partial<PanelAppearance>`). Task 3.2 does not mention this.

### Verdict: REFUTE

### Change Requests

1. **Merge the pending appearance, not just the local item (Decision 2 / 2a, task 3.2/3.3).** When `fields.appearance`
   is present, `accumulatePanelUpdate` must merge it over the existing `pendingPanelUpdates[id].appearance`
   (`panelsSlice.ts:124-127`). Two modal saves before a flush must send the union of both edits. Correct the Decision 2
   wording "pending/wire payload stays the partial patch" to "the pending payload is the merged union of the staged
   partial patches". Check that `clearSentPendingPanelUpdates` (JSON-equality, `panelsSlice.ts:140-147`) still clears
   correctly. Add a jest case and a spec scenario: background-only save, then color-only save, then flush. The batch
   body must carry both, and after the flush the client keeps both (not reverted by `updatePanelsBatch.fulfilled`).
2. **Make 2a depend on Decision 2's local merge.** State in design.md that if 2a ships, the local-item merge in
   Decision 2 ships with it, whatever the chart-probe outcome. Without it, a partial patch would remove required
   appearance keys from client state.
3. **Fix the HEL-322 contradiction.** Replace "must stay green" with an explicit plan for
   `PanelDetailModal.appearanceSentinel.test.tsx`. On a title-only save, the untouched sentinel is not sent
   (`pending.appearance` is absent, or has no `background`/`color` key). The client panel, and the server after the
   flush, still read `"transparent"`/`"inherit"`. The hex-edit cases (`:105-121` onward) stay as they are. List this in
   the tasks as an intended test change with this rationale, not as a fixture tweak to make tests pass.
4. **Plan the patch type.** Add to task 3.2 that `PanelUpdateFields.appearance` / `PanelBatchItem.appearance` become a
   partial-appearance patch type (matching `panel-appearance-patch.schema.json`), and `PanelAppearance` stays the
   full stored shape.

### Non-blocking notes

- Decision 2a compares against the seeded value. Compare transparency on the seeded whole-percent integer, not on
  `stored * 100`, or an untouched 0.555 counts as "changed".
- If the save has no title change, no appearance change and no dirty subtype, the plan would still dispatch an empty
  `fields` object. That creates a batch item with only an `id`. Consider skipping the dispatch.
