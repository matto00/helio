# HEL-1733 evidence

Red first (design.md D13, D12):
- `e2e-red.txt`: `e2e/hel1733-draft-outputs-shapes.spec.ts` against the unchanged client: every action stops at a disabled control
  ("Save or discard your draft first").
- `backend-red.txt`: `DraftDiffSpec` (a, c) and `DraftSaveApiSpec` (rename of an Output carrying a stored legacy key) fail on the
  unchanged `DraftDiff.planOutputs` (3 failed); (b) is a guard (a NEW unknown key is still a 400) and passes on both.
- `backend-green.txt`: the same specs after the fix (50 passed).

Green: `e2e-green-1.txt` (19 passed, the eight actions in desktop-light and phone-dark, plus one desktop-dark and one phone-light
smoke and a Discard variant); the kept-draft / stale / undo / sheet / stubbed-expand block is 6 more; `e2e-green-alongside.txt`
runs it with hel1631, hel1632, hel1684, hel1685, hel1704 and hel1705 (86 passed, Playwright workers 2).

Guards and their recorded mutations (labelled guards, not red-first):
- `nodeCapabilities.test.ts` against `__fixtures__/nodeCapabilitiesParity.json`: `yAxis: "numeric"` -> `"orderable"` in
  `nodeCapabilities.ts` turns 3 cases red; restored.
- `NodeCapabilitiesParitySpec`: flipping the first `"bindable": true` in the fixture turns the Scala spec red; restored.
- `usePipelineDraft.outputs.test.tsx` (D15 (1)-(8)): disabling the Output-base judgement (`if (false && ...)`) turns (2), (3), (4)
  and (7) red; restored.

Visual check (C12): the `*-draft.png` files here, light and dark, 1280px desktop and 375px phone, taken from the running app.

Cycle 2 (evaluation-1.md):
- `e2e-type-seam-red.txt`: the real-backend type-seam e2e ("the sheet's histogram field follows the DRAFT's column types ...") run
  with `frontend/src` checked out from the base commit: it stops at the disabled "Add output" item ("Save or discard your draft
  first"). Green on this branch: 38 passed with hel1631 (`e2e-green-alongside.txt` still lists the cycle-1 86-test run).
- `LiveOutputColumn.test.tsx` created-Output cases: making `serverOutputId` ignore `isDraftOutput` turns both red; restored.
- `backend-testFull.txt` is now the summary excerpt (9588 succeeded, 0 failed, 5 canceled).
- Screenshots added: `desktop-light-live-output-created.png`, `desktop-light-type-seam.png`.

Cycle 3 (skeptic-final-1.md): the draft hint is its own block at the end of the sheet's header group; `sheet-hint-<viewport>-<theme>-<mode>.png` (desktop/phone x light/dark x create/edit) and the e2e asserting it is in view with a gap >= 8px.
