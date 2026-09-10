## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
Re-derived cold from the current artifacts and the real source files, not from the orchestrator's
description of what it changed.

- **Round-2 CR1 (keep the `padding-right` calc assertion) — FIXED, on a rationale that holds.**
  design.md now carries a "**D4 correction (skeptic-design-2.md CR1)**" block stating the
  `~1493` assertion is KEPT, and correctly re-states why the original rationale failed (D2 rejects
  the *label's* stacked `calc(100% - var(--space-9))`, not the `<th>`'s `padding-right`, which D2
  keeps "exactly as-is" as the single source of truth). tasks.md 4.1 now opens with
  "KEEP the `padding-right` calc-value assertion (~line 1493) unchanged" and scopes the edit to
  "update ONLY the row-height regex". No residual "remove the padding-right assertion" text survives
  anywhere in design.md or tasks.md.
- **The kept assertion is real and stays true.** `DataGrid.test.tsx:1486-1494` is the
  `STATIC SOURCE: the header <th> reserves padding-right...` test, asserting
  `/padding-right:\s*calc\(var\(--space-3\) \+ var\(--space-9\)\)/` against the
  `.ui-data-grid--normal ... th.ui-data-grid__th--pin-reserve` rule. That rule is present verbatim
  at `DataGrid.css:418-420` and tasks.md 1.2 explicitly leaves the padding-right rules unchanged —
  so the assertion is not volatile under this change.
- **The one assertion that must change is correctly identified.** `DataGrid.test.tsx:1536` asserts
  `/\.ui-data-grid__table thead th\s*{\s*min-height:\s*48px/`, and `DataGrid.css:635` is
  `min-height: 48px;` inside the `@media (max-width: 430px), (pointer: coarse)` block. Task 1.3
  changes that one declaration to `height: 48px`, and task 4.1 updates exactly that regex while
  keeping the sibling `.ui-data-grid__pin-toggle-btn { min-height: 44px }` co-location assertion at
  :1535 unchanged. The two edits are consistent with each other and with ground truth.
- **Non-blocking note 1 (D1's `min-width: 0` rationale) — FIXED.** D1(c) now reads "belt-and-braces
  for its own shrink-to-fit `inline-flex` sizing ... this one on the button is not a flex-item
  minimum-size fix (the button's parent is a `table-cell`, not a flex container ...)", and names the
  `.sortable-th__label` declaration as the load-bearing one. That matches reality: `SortableTh.tsx:33`
  renders the button directly inside `<th>`.
- **Non-blocking note 2 (vacuous-overlap risk) — FIXED.** tasks.md 3.2 now requires asserting the
  truncating header's `scrollWidth > clientWidth` as an explicit precondition *before* the
  `labelUnderPinIcon === 0` check, naming fixture drift as the failure mode it guards.
- **No regression from round 2's clean items.** Re-checked each: D1's target is still the
  `<span>{children}</span>` at `SortableTh.tsx:35` (still unclassed on disk, so task 1.1 is still
  needed); D2 still specifies `max-width: 100%` with no `calc()`; D5/task 3.1 still cite the hel910
  register-then-API-seed pattern, ≥3 columns pinned through the real toggle UI, both themes, and the
  fine-pointer control assertion (3.4); D6's stash is still path-scoped to the two source files;
  D7's selector still mirrors the existing per-density `--pin-reserve` selector shape. Tasks 1.1-5.3
  still trace to D1-D7 and to both spec scenarios; nothing in the goals/non-goals or the spec delta
  moved.
- Worktree is at base `3baa1ebf` with only the untracked change dir present (`git status
  --porcelain`), i.e. no code has been pre-written ahead of the gate.

### Verdict: CONFIRM

Round-2's single change request is fixed with a rationale that survives contact with D2, both
non-blocking notes are addressed, and nothing round 2 had verified clean has drifted.

### Non-blocking notes
- The Risks/Trade-offs bullet still reads "Deleting/narrowing the two CSS-only Jest tests could look
  like reduced coverage". After the D4 correction, nothing is deleted and only one regex *value* is
  updated, so that bullet now overstates the risk it is mitigating. Cosmetic staleness in a
  superseded section; D4 + task 4.1 are unambiguous and govern.
- `DataGrid.css:626`'s explanatory comment says "`min-height: 48px` (44px control + a small ...)".
  When task 1.3 flips the declaration to `height`, that comment sentence becomes stale by one word;
  worth updating in the same edit.
