## Evaluation Report — Cycle 5, addresses skeptic-final-3 (evaluation-5.md)

Reviewed HEAD `28bbefe42d2ede813d397f6679247ae0a695950a`.

- **origin/main:** freshly fetched; it is still `c5cc7eeee`, which this branch already contains via merge `8b19c277a`. `git merge-tree` against it shows no conflicts.
- **V134:** still free; main's newest migration is V133.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/eval-evidence-c5/`

### Gates (my own runs)

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, check:schemas, check:tokens, check:scala-quality + selftest, check:openspec, check:spec-structure, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths | PASS. The scala guard scripts are byte-identical to main's HEL-1386 versions. |
| `npm test` (3 workers, nice 19) | PASS: 7229/7229 (matches the claim) |
| build + `check:landing-build` | PASS |
| Full Playwright suite | PASS: **293 passed** in 13.1 min (matches the claim) |
| `sbt testFull` | Not re-run; justified. `git diff 776b53aee HEAD -- backend` is empty, and the merged main range `613487433..c5cc7eeee` touches no backend files. My cycle-4 full run on 776b53aee was 8128 passed, 0 failed. |

### Phase 1: Spec Review — PASS

- **skeptic-final-3 CR1 (confirm placement): fixed.**
  - The confirm, the 409 notice and the error banner now render through a `rowExtra` prop on `PipelineListTable` and `SourceListTable`. Each is a full-width `<tr>` directly below the clicked row, with `colSpan` 7/6 and 6/5, which matches each table's column count.
  - The row's own Delete stays where it is.
  - The focus contract is unchanged.
- **CR2 (button style): fixed.** Both `__delete-btn` rules are now token-for-token the `.agent-memory-list-table__delete-btn` recipe (`AgentMemoryList.css:105-124`): subtle hairline and muted text at rest; on hover, a 60% error border, `--app-error-surface` and error text. The 44px expander is unchanged.
- The owner ruling and the canonical spec still hold: Delete appears on overview rows only, and the 409 notice now renders below its row.

### Phase 2: Code Review — PASS

- **`rowDeleteFocus.neighbourDeleteLabel`** now skips rows without a Delete button. This is the inserted confirm row, and it is skipped in both directions.
- **Table rendering.** Each table row is now wrapped in a keyed `Fragment`. The extra row is not a child of the clickable pipeline row, so clicks inside the confirm cannot trigger row navigation. Verified live: a double-click stayed on `/pipelines`.
- **Error state.** It is now keyed by id, so a refusal renders under the right row.
- **Tests.** Regression tests cover double-click targeting and the last-row scroll. The executor added two new e2e cases, and both are green in the full run.
- **Tokens.** Tokens only; nothing outside the scope.

### Phase 3: UI Review — PASS

Verified in the running app, in both themes, at 1280 and 375, against a 30-source list:

1. **Double-click.**
   - On `/sources` (1280, dark), a real double-click on "Delete C5 Src 10" left exactly one confirm, "Confirm delete C5 Src 10", rendered directly below that row. The row's `top` was 436 before and 436 after.
   - On `/pipelines` (1280, dark), a double-click on "Delete C5 Pipe B" gave the confirm for C5 Pipe B. The row stayed at top 210, the confirm rendered below it, and the URL stayed `/pipelines` (`pipelines-1280-dark-dblclick-confirm.png`).
   - At 375 (light), a double-click on "Delete C5 Src 12" gave the confirm for that row. The row's top, left and `scrollLeft`, and `.app-content` `scrollTop`, were all unchanged. The confirm group sits in view, from x 22 to 333 (`sources-375-light-dblclick-confirm.png`).
2. **Last row of a long list.**
   - I scrolled the list to the bottom (`scrollTop` 634) and clicked Delete on the last row: `scrollTop` stayed 634 and the row's top stayed 752. The confirm opened in view below it, at y 794–819 of 850, with focus on it.
   - Confirming the delete moved focus to the neighbour "Delete C5 Src 01" at the same y (752). `scrollTop` only clamped by the removed row's height. There was no jump.
3. **409 below its row.** Using the keyboard on "C5 Src 05" (referenced by 3 pipelines):
   - The confirm showed the HEL-1258 warning.
   - Confirming returned 409, and the HEL-989 notice rendered as the very next table row under C5 Src 05, listing C5 Pipe A, B and C.
   - The row stayed in place (top 584 before and after), and focus returned to "Delete C5 Src 05" (`:focus-visible`). Evidence: `sources-1280-dark-409-below-row.png`.
4. **Focus.**
   - Enter on Delete moves focus into the confirm group.
   - Cancel returns focus to the row's Delete.
   - A successful delete moves focus to the neighbour's Delete (`:focus-visible`).
   - A refusal returns focus to the row's Delete.
5. **Hover tone, judged against the HEL-866 guard and the sibling tables.** Measured in light theme from computed colours.
   - On hover the pointer is over the row, so the row paints its own hover background, white (255,255,255). That white row is the backdrop the guard resolves. Against it, the hover wash (10% error over white) measures **1.169**, above the guard's 1.1 floor.
   - The executor's 1.049 figure (I measured 1.044) compares the wash against the row's *resting* background, (244,242,237). That is not the backdrop when the pointer is on the button.
   - Hover also changes two other channels: the border goes from 1.25 to 2.89 against white, and the text from muted to error. Text contrast is 5.73 at rest and 5.41 on hover, both above AA.
   - The recipe is identical to the shipped `AgentMemoryList` and `ApiTokensSection` row actions.
   - The full `state-surface-contrast-guard` run passed in both themes.
   - Accepted.
6. **No regression from cycles 1–4.** The full Playwright suite (293) is green. That includes `hel1574-shell-rail.spec.ts` (rail, list, folders, phone shell, detail pages without Delete) and the contrast and touch-floor guards.

### Overall: PASS

### Non-blocking Suggestions
- At 375 the Sources table's existing column crowding remains: "Unused" overlaps the wrapped "1 minute ago" text. skeptic-final-3 already noted this as mostly pre-existing, and HEL-1582 owns it.
- After a real double-click, the second mousedown re-focuses the row's Delete button instead of leaving focus in the confirm. That is expected native behaviour, and it is harmless.
- `rowDeleteFocus` still identifies rows by accessible name, so two items with the same name would focus the first one (carried from skeptic-final-3).
