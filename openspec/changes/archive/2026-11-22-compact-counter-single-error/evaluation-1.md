## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 28562242817205b68eb352b07c7ce41bad47c1f0 (base d350dd7ae9fb0a5f790cbb8c169a5b8cc6ea4fe4, resolved live).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (a test that fails on current code): the two new `FormPanelView.test.tsx` HEL-1818 tests fail on the base. `red-run.txt` records exactly those 2 failing out of 35. The hook refused a red commit, so the run was recorded instead, which tasks.md 1.1 allows. Mutation evidence: mutation-a (prop pass reverted) fails the same 2. mutation-b (`setAlertText(message)` dropped) fails 6, including both HEL-1818 tests.
- AC2 (renders and announces in light and dark, at 390 and 1440 px): checked in the running app and by the new e2e. See Phase 3.
- C1 (owner ruling form-alert-B) is honoured:
  - The alert `<p>` gets a `useId()` id (`FormPanelView.tsx:68,400`).
  - `FormFieldControl` withholds the error from `FormField` only when `errorDescriptionId` is set and an error exists (`FormFieldControl.tsx:78-85,103`).
  - `aria-invalid` is kept, `aria-describedby` points at the alert, and the caption id is still appended.
  - The multi-field branch is untouched.
- C2: `e2e/hel1791-compact-counter-stack-height.spec.ts` does not appear in the diff (0 hits). It still passes (6/6) on this commit.
- Tasks: all checked, and each matches the diff.
- Spec delta: adds the single-rendering paragraph and three scenarios, and the code implements them.
- Scope: no backend, schema or CSS change, and no scope creep.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates, run fresh by me in WORKTREE_PATH:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test`, root suite (3 workers) | 73 suites, 645 tests passed |
| `npm test`, frontend suite (3 workers) | 919 suites, 10600 tests passed |
| `check:e2e-evidence-paths` | clean |
| `check:e2e-user-cleanup` | clean |
| `check:e2e-types` | clean |

Review notes:
- The mechanism is minimal and does what design D2 says. The prop has no effect while `error` is null.
- The compact branch's `values.errors` can only be set by `handleImmediateStep` (`FormPanelView.tsx:270-274`), which sets the alert text in the same step. So in steady state the control can never point at an empty alert. The only exception is the in-flight window the owner accepted in design.md's Risks section.
- Tests are meaningful: text count, the set of role=alert elements, the computed accessible description, the repeated-rejection empty-then-refill, and the multi-field per-field error assertion (`FormPanelView.test.tsx:221`). The mutation runs show they would catch a regression.
- No `any`, dead code or TODO.

### Phase 3: UI Review — PASS
Issues: none.

Run in the running app (ports 7250/10157, lane DB) as a throwaway user. The dashboard had a compact counter with `helpText` (the D3 case) and a two-field form. Each submit was answered with a 400 and `fieldErrors` by an in-page XHR stub.

Compact counter:
- Results were identical in dark at 1440 and 390, and in light at 390 and 1440:
  - The message appears once in the panel, and once in the whole document (no toast duplicate).
  - Exactly 1 role=alert element holds it, which is `.form-panel-view__alert`.
  - There are 0 `.ui-form-field__error` elements.
  - The spinbutton has `aria-invalid="true"`, and its `aria-describedby` resolves to "delta must be positive".
  - The status region stays mounted.
  - There is no horizontal overflow at 390.
- Repeated rejections (four clicks in a row) each re-filled the alert, still once.
- D3: the hint "Tap to count widgets" stays visible under the control while the message shows in the alert. The control's description is the alert, not the hint, as design D3 says.

Multi-field form: unchanged. The form alert summary "Quantity: quantity expected integer" and the field's own `.ui-form-field__error` both render. Quantity is `aria-invalid` and described by its own field error.

Console: 0 errors.

Keyboard and accessible names: both step buttons are named ("Increase/Decrease Widgets by 5"), and the spinbutton is named "Widgets".

E2E, run by me with 2 workers:

| Spec | Result |
|---|---|
| hel1818 (light/dark x 390/1440) | 4/4 passed |
| hel1791 | 6/6 passed |
| hel1169 + hel1088 + hel1095 | 9/9 passed |

Evidence (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/.concertino/scratch/HEL-1818/eval-dark-1440.png
- /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/.concertino/scratch/HEL-1818/eval-dark-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/.concertino/scratch/HEL-1818/eval-light-390.png
- /home/matt/Development/helio/.concertino/runs/HEL-1818/evidence/.concertino/scratch/HEL-1818/eval-light-1440.png

Every claim above rests on DOM measurements recorded in this report, not on screenshot ordering.

Cleanup:
- The dashboard and both sources were deleted by id through the API (204).
- The user (a6b40c9a-1309-4f09-a22c-699471dc9b85) was deleted by exact id+email with the repo's `buildUserDeleteSql`. A recount returned 0.
- Servers were stopped with stop-servers.sh.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `FormPanelView.tsx` is 467 lines, above CONTRIBUTING's ~400-line "propose a split" threshold. That predates this change, which adds 3 lines. Mention it in the PR body (HEL-1618/1819 may be natural places to split).
- Observed but outside this change: at a breakpoint change (1440 to 390) the panel remounts and a shown rejection state is dropped. This is behaviour on main, not caused by this diff.
