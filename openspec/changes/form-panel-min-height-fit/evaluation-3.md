## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `ea376feae39207dbbe64d09f26d4ac3450dd084e`, base `cba523c030821c709ba227ab8c06a59f9ab913fc` (resolved live).
The spawn guard returned READY.

The cycle-3 delta is one commit, ea376feae. It changes:
- `specs/form-panel-rendering/spec.md`;
- `measurements.md` §4.4;
- `evaluation-2.md`, which is byte-identical to the persisted cycle-2 report.

It changes no `frontend/`, `e2e/`, `backend/` or `schemas/` file (`git diff --stat 3d77f47c3 ea376feae` over those
paths is empty).

### Phase 1: Spec Review — PASS

**Cycle-2 CR1 is resolved.** "Duplicate" is removed from the placements the spec guarantees, and is stated as an
exception (spec.md:11-13): "A duplicate takes its source's stored size, so duplicating a form saved below 5 rows yields
a form of that height". Import and proposal apply remain exceptions, as before.

**Each remaining guaranteed path and each `measurements.md` §4.4 citation, checked line by line against the code:**

| cited | what the line actually is | verdict |
| --- | --- | --- |
| `PanelLifecycleWrites.scala:37` (create) | `defaultSizesFor(panel).flatMap(sizes => panelRepo.insertPlaced(panel, sizes))` | correct |
| `CreatePlacement.scala:21` | `private val ContentHeight = 5` | correct |
| `CreatePlacement.scala:26-30` | `ContentDefault` builds `ItemSize(..., ContentHeight)` per breakpoint | correct |
| `CreatePlacement.scala:43` | `case _ => ContentDefault` (every non-Output kind, `form` included) | correct |
| `PanelBatchWrites.scala:93` (batch create) | `Future.traverse(built)(p => defaultSizesFor(p).map(p -> _))`, then `insertBatchPlaced`. Requests carry no client layout (`CreatePanelRequest` at :80-86 has no layout field) | correct, so batch create gives a form 5 rows |
| `PanelLifecycleWrites.scala:54` (duplicate) | `defaultSizesFor(panel).flatMap(kindDefault => panelRepo.duplicate(...))` | correct |
| `CreatePlacement.scala:94-99` | `duplicateSizes` takes the source's stored `math.max(1, i.h)` | correct, and correctly listed as an exception |
| `dashboardLayout.ts:29`, `:79`, `:199` | `defaultItemHeight = 5`, then `h: defaultItemHeight` at both use sites | correct |
| `PanelPacker.scala:44` | `PanelKind.Form -> ClampBounds(minW = 3, minH = 5, maxH = 24)` | correct |
| `PanelPacker.scala:63` | `val clampedH = math.max(bounds.minH, math.min(bounds.maxH, h))` | correct |
| `AutoLayoutService.scala:136` | `kept ++ PanelPacker.pack(inputs, targetCols)...` | correct |

**The spec wording is consistent with the code:**
- Resize: stops at 5 for a multi-field form and 4 for a compact counter, verified in cycle 1 with tests, mutations and
  live checks.
- The four guaranteed placement paths: each gives at least 5 rows.
- The counter exception: the general minimum of 4 still holds. Placement at 5 and the packer's clamp to 5 both satisfy
  ">= 4".
- The three exceptions: duplicate, import and proposal apply.
- The no-bump and lift-when-free sentences: unchanged, and verified in cycle 1.

All other Phase 1 items are unchanged from cycles 1 and 2 and still pass:
- ACs, tasks, scope and constraints C1-C5;
- the evidence chain;
- the four skeptic-design-5 fold-ins.

The backend gaps (proposal apply, duplicate and optionally import) are follow-up material, as ruled in cycle 1. The PR
body should ask the orchestrator to file one follow-up covering them. That is not a blocker.

### Phase 2: Code Review — PASS

No code changed since cycle 2's gate run, which was green at 3d77f47c3:
- lint, format:check and typecheck: clean;
- full jest: root 645 / 645, frontend 10628 / 10628;
- frontend build: passes.

The source tree for `frontend/`, `e2e/`, `backend/` and `schemas/` is identical at ea376feae. Because Markdown changed,
I re-ran these this cycle:
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run check:openspec`: "openspec/ is clean" (exit 0).

### Phase 3: UI Review — PASS (unchanged)

No rendering or behaviour change since cycle 1. The cycle-1 live re-measure and e2e run stand:
- 1280 px, both themes: the 2-field form at 5 rows hides 0 px, the saved 4-row form is not resized, and the counter
  stays at 4.
- e2e: 30 / 30 green.
- Screenshots: `.concertino/runs/HEL-1618/evidence/eval1-1280-{dark,light}.png`.

### Overall: PASS

### Non-blocking Suggestions

- N1 (cycle 1, procedural): the e2e red-run evidence was committed in the implementation commit rather than before it.
  Its content is consistent with a real red run. Nothing to change.
- Follow-up to file: three backend form placements stay below 5 rows:
  - proposal apply (`ProposalLayoutSupport.scala:38`);
  - duplicate (`CreatePlacement.duplicateSizes`);
  - optionally dashboard import, as an owner call.

  The fix would clamp any form that is not a compact counter to at least 5 rows, mirroring `PanelPacker`.
