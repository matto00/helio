## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 506c224423f3777f8090ef1f6705a501f9bd303e. The change dir is untracked and no code has changed yet.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/output-editor-footer-overflow/HEL-1752`.
- **Evidence screenshot** (`.concertino/runs/HEL-1733/evidence/.concertino/scratch/HEL-1733/sk-phone-dark-confirm-delete.png`, viewed):
  - The confirm button is squeezed to about 125px at the footer's left edge.
  - "Confirm / delete / (removes / from 1" spills above and below the 32px box, and "dashboard)" is cut off.
  - Cancel and Save share the same row.
  - At 375px the inner footer div fills the footer width, so Delete's `margin-right:auto` takes effect there.
  - All of this matches the root cause in design.md.
- **Live tree vs design.md Context**:
  - `OutputEditorSheet.css:90-94` has the footer rule with no `flex-wrap`, and `:100-102` has `.output-editor-sheet__delete { margin-right:auto }`.
  - `Modal.css:203-217` sets `.ui-modal-btn` to `inline-flex`, `height: var(--control-md)` and `padding: 0 var(--space-4)`. It sets no line-height.
  - `Modal.css:79-81` sets `.ui-modal--lg` to `min(720px, 100vw - 32px)`, which is 343px at 375. `Modal.css:198` sets the footer padding to `var(--space-3) var(--space-5)`, so the content width is 303px, as design.md now states.
  - `OutputEditorSheet.tsx:292` uses `size="lg"`.
  - `Modal.css:272-288`: the mobile block only adds `position:relative` and the 44px `::after` strip. It sets no height, so the sheet-scoped selector (0,2,0) wins.
- **Decision 2 arithmetic, checked against `theme.css`**:
  - `--text-sm` is 14px (`:109`), `--space-1` is 4px (`:127`) and `--control-md` is 32px (`:140`).
  - Body `line-height:1.5` (`:533`) reaches buttons through `button { font: inherit }` (`:540-546`), so one line is 21px.
  - `box-sizing:border-box` is global (`:510`). All three variants have a 1px border (`Modal.css` secondary, primary transparent, danger).
  - So a single-line button is 21 + 8 + 2 = 31px. `min-height:32px` holds it at 32px, unchanged from today. A two-line button is 52px.
- **Flex behaviour**:
  - With `flex-wrap: wrap`, the confirm's max-content width is about 41 chars x ~7px + 34 = ~320px, more than the 303px line. It therefore takes a line of its own.
  - It then shrinks to 303px. Its min-content is the longest word, so it can shrink that far. The label wraps to two lines inside about 269px.
  - Cancel and Save drop to line 2, right-aligned by `justify-content:flex-end`.
  - On desktop the row fits, so wrap is a no-op. This matches Decisions 1, 2 and 5.
- **Round-1 change requests, re-checked against the artifacts as they stand**:
  1. Padding token is pinned. Decision 2 and task 2.1 name `padding-block: var(--space-1)` and show the arithmetic. Task 1.1 asserts that single-line height equals the computed `--control-md` (at 1280, and for Cancel/Save at 375). Task 1.2 adds the `--space-2` mutation. Addressed.
  2. Desktop arrangement is measured, not assumed. Task 1.0 measures on the running app before any CSS change. Decision 5, ticket AC 4 and the spec's "Desktop footer unchanged" scenario now encode the measured relation, and moving Delete to the far left is called out of scope. Addressed.
  3. Create-mode wrap and the DESIGN.md §5 exception are covered:
     - The Risks section lists the acceptable arrangements as invariants, and task 3.1 judges both themes against them.
     - Decision 6 records the scoped exception to §5 ("all at `--control-sm/md` height") and §3, with no 44px inflation. That is consistent with the DESIGN.md text at lines 296-325 and 505-506.
     - Addressed.
  4. Affected-spec list is complete. Task 3.2 now lists hel1733, hel1510, hel908, hel1390 and hel1744, and all five exist in `e2e/`. Addressed.
  5. Attribution is corrected. Decision 2 attributes keep-the-count to ticket.md AC 3 / C16, not to an owner. Addressed.
  - The round-1 non-blocking note is also taken up: task 1.1 asserts the exact confirm text "Confirm delete (removes from 1 dashboard)".
- **Mutation soundness (reasoned from CSS, to be proven at execution)**:
  - Removing `flex-wrap` brings back the squeeze, so there are more than 2 lines and the text spills. Red.
  - Removing `height:auto` keeps the 32px box under a 52px label, so `scrollHeight > clientHeight` and the range rect falls outside the box. Red.
  - Raising the padding to `--space-2` makes single-line buttons 39px instead of `--control-md`. Red.
  - The unmodified CSS is red on the confirm containment check. The RED-first evidence is achievable.
- **Scope / AC coverage**:
  - AC1 is covered by the confirm scenario plus tasks 1.1, 2.1 and 3.1.
  - AC2 is covered by the add-tail scenario plus task 1.1.
  - AC3 is covered by the exact-text assertion.
  - AC4 is covered by tasks 1.0 and 1.1 at 1280.
  - The CSS stays scoped to the sheet, so global `.ui-modal-btn` is untouched (C16). No API or schema change, so no contract delta is needed.
- **Placeholders**: I found no TODO, TBD or deferred blocking decision.

### Verdict: CONFIRM

### Non-blocking notes

- design.md's Decisions are numbered 1, 2, 5, 6, 3, 4 in reading order. Renumbering would help, but nothing references them by number in a way that becomes ambiguous.
- The CSS rule from task 2.1 should carry a short comment pointing at the DESIGN.md §5 exception (Decision 6). Otherwise a future reader will find a sheet-local `height:auto` on a `ui-modal-btn` with no reason given.
- The `scrollHeight <= clientHeight` check only catches overflow in the positive (downward) direction. The vertically centred label spills both ways, so the range-rect containment assertion is the real guard and must not be dropped.
- If HEL-1757's e2e font turns out narrow enough that the confirm fits one 303px line, the two-line path goes unexercised in e2e. The `height:auto` mutation would then not go red. If that happens, record it in the mutation log rather than treating it as a defect.
