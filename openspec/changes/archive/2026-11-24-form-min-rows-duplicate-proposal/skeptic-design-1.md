## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD a6ac494b47f756d38520e17b4fb5aeab898ace6b (planning artifacts uncommitted in the change dir).

### What I verified (with evidence)

- **Compact-counter predicate parity.** Client `compactCounter.ts`: `config?.fields?.length === 1 && config.fields[0].control === "counter"`.
  Backend: `FormPanelConfig(dataSourceId, fields: Vector[FormFieldSpec], submit)`, `FormFieldSpec.control: String`,
  `FormPanelConfig.Empty` has `fields = Vector.empty` (FormPanel.scala:200-207). Planned D1 `fields.size == 1 &&
  fields.head.control == "counter"` is equivalent; a missing config decodes to `Empty` (0 fields), which is not a counter on
  both sides. The D1 unit table covers zero fields, one counter, one non-counter, two fields with a counter, and Empty.
- **Overlap-rule parity.** Client `isSpaceBelowFree` (panelGridConfig.ts:100-115): it excludes the target by panelId and uses
  half-open overlap on columns `[x, x+w)` and rows `[y+h, y+rows)`. `liftResizedForm` (120-131) lifts only a non-counter form
  with `h < 5` when that space is free, and moves nothing else. D1/D3 specify the same arithmetic and the same no-move
  outcome. The client checks the FULL breakpoint. The backend checks only `currentAuthored`. That is still sound, because
  `buildLayout` places unauthored items at `bottom` (computed after the lift), so they cannot be in the lifted region. In
  both target paths the layout holds only the built panels: proposal apply creates a fresh dashboard
  (DashboardProposalService.createAll), and contents replace swaps every panel (`replaceContents`). Including earlier lifts
  in `currentAuthored` makes multi-form cases deterministic and overlap-free.
- **Reflow carries the lift.** `LayoutReflow.reflow` keeps `h = max(1, s.h)` (LayoutReflow.scala:24), so a lifted lg height
  reaches md/sm/xs and stays valid by construction.
- **Duplicate "always free" in every breakpoint.** `CreatePlacement.append` starts each breakpoint at
  `max(y+h)` over `LayoutPolicy.stored(layout, bp)`, which is the full stored breakpoint (LayoutPolicy.scala:44-49). It
  places one item at x=0. Raising its h only extends downward into empty rows, so no overlap and nothing moves. All three
  `duplicateSizes` branches (stored item, scaled lg, kind default) go through the final `at(bp)`. Applying `max(minH, h)`
  there floors every breakpoint, and the kind default is already 5 (`ContentDefault`).
- **Path enumeration.** I grepped every `DashboardLayoutItem(` constructor, every `insertAndAppend`/`CreatePlacement.append`/
  `forNewPanel` use, and every `buildLayout`/`duplicateSizes` caller:
  - single/batch create and patch-set create/preview use `forNewPanel`, which gives 5.
  - `AutoLayoutService` uses `PanelPacker` with a Form minH of 5.
  - duplicate: `PanelMutationRepository.duplicate`, the only `duplicateSizes` caller.
  - `buildLayout` has exactly two callers: `DashboardProposalService.applyLayout` and `DashboardContentsService.buildAndReplace`.
  - `DashboardSnapshotRepository` handles both import and dashboard duplicate, and both are guarded.

  No creating or placing path is missing.
- **AC coverage.**
  - Red-first per path: tasks 1.3 (duplicate), 1.5 (proposal apply) and 1.6 (contents), plus the 1.7 commit of the red run.
  - Compact counter unchanged on both paths: 1.2, 1.3, 1.4, 1.5 and 1.6.
  - Import guard: 3.1. The dashboard duplicate guard (3.2) follows the owner ruling.
  - Guards are labelled GUARD and shown red by a recorded mutation (D4). Mutation evidence for each new test: 4.1.
- **Contradictions and placeholders.** None found. The proposal, design, tasks and spec delta agree. The spec delta keeps the
  "not bumped on load" and resize scenarios, and the scope matches the owner rulings.

### Verdict: CONFIRM

### Non-blocking notes

- Two backend layout writes are not in the design.md table: the patch-set dashboard `layout` patch, and the patch-set undo
  `RestorePriorStored` restore (PatchSetUndoRestorers.scala:65). Both edit or restore a saved layout. Neither creates or
  places a new panel, so they belong with the client layout PATCH and import, not with this ticket. The executor should
  name them as out of scope in files-modified.md so the enumeration is visibly complete.
- D2 computes `minH` from the `panel` that the service read before the transaction. `PanelMutationRepository.duplicate`
  re-reads `source` inside the transaction, so a config PATCH landing in between could change counter-ness. The race is
  negligible because the type is locked. Deriving `minH` from the in-transaction row would be tighter, at the executor's
  discretion.
- The import guard mutation in D4 names `DashboardSnapshotRepository`'s remap. Import uses `remapLayoutItem` (around
  line 142) and dashboard duplicate uses `remapItems` (around line 38). Each guard's mutation has to target its own remap,
  or the guard will not go red.
