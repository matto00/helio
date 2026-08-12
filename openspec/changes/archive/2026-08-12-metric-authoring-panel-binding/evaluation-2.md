## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS

Issues: none. No change from cycle 1's PASS — commit f91fa854 is a scoped bugfix + regression tests
responding to evaluation-1.md's single change request; it does not touch any AC-relevant behavior beyond
fixing it. All 4 ACs remain addressed exactly as verified in cycle 1.

### Phase 2: Code Review — PASS

**Fresh gate run** (all commands run independently in `WORKTREE_PATH`):
- `npm run lint` → 0 warnings, clean.
- `npm run format:check` → clean.
- `npm test` → 112/112 (helio-mcp) + **1492/1492** (frontend, up from 1485 — the 2 new test files added
  7 tests) passing.
- `npm --prefix frontend run build` → succeeds (PWA precache 15 entries / 2248.42 KiB).

No `backend/**` files changed (`git diff --name-only main...HEAD` confirms), so `sbt test` not required.

**Change request 1 (evaluation-1.md) — verified fixed:**

`frontend/src/features/metrics/ui/AllowedDimensionsPicker.tsx` now has a `handleTriggerKeyDown` handler
wired to the trigger button's `onKeyDown` (lines ~45-57, `onKeyDown={handleTriggerKeyDown}` at ~line 71):
on `Escape` while `isOpen`, calls `event.preventDefault()` then `close()` — an exact mirror of
`Select.tsx`'s own `handleKeyDown` Escape branch, closing the parity gap design.md D3 called for. Diff
between 46609605 and f91fa854 is minimal and fully scoped to the fix + its tests (106-line new
`AllowedDimensionsPicker.test.tsx`, 93-line new `CreateMetricModal.test.tsx`, 17-line component change,
handoff-doc updates) — no drive-by changes.

The new tests are genuinely diagnostic, not false-comfort:
- `AllowedDimensionsPicker.test.tsx` correctly identifies that jsdom does not implement native `<dialog>`
  Escape-to-close at all (probed directly, documented in the file header and in `files-modified.md`'s
  root-cause note), so it asserts on `fireEvent.keyDown`'s return value (`false` iff `preventDefault()`
  was called) — the actual mechanism a real browser uses to stop the event reaching the dialog. The
  executor verified this assertion fails without the fix and passes with it (documented, not just
  claimed).
- `CreateMetricModal.test.tsx` is honestly scoped as an "integration shape" smoke test — its own header
  comment explains it cannot catch the native-dialog-dismissal regression in jsdom, and exists to catch a
  different failure mode (an errant `onClose` call from the picker itself).
- This is a good example of the systematic-debugging law in practice: probe-confirmed root cause, a
  regression test that actually catches the class of bug being fixed (verified by reverting and
  re-running), not merely "the happy path still passes."

**Non-blocking suggestions carried forward from cycle 1** (still non-blocking, unchanged since neither was
in scope for this fix commit):
- DESIGN.md spacing-token literal-px values in `MetricEditorForm.css`/`MetricsPage.css`/
  `MetricDetailPage.css` — still mirror pre-existing `PipelinesPage.css`/`CreatePipelineModal.css`/
  `AddSourceModal.css` precedent; candidate for a follow-up repo-wide token-alignment ticket, not this
  ticket's scope.
- `BindingEditor.tsx` (520 lines) / `MetricEditorForm.tsx` (323 lines) file-size soft budgets — untouched
  by this cycle's commit; still worth a split-proposal note in the eventual PR description per
  CONTRIBUTING.md.

### Phase 3: UI Review — PASS

Servers reused (already healthy) via `scripts/concertino/start-servers.sh` /
`scripts/concertino/assert-phase.sh servers` → `PASS servers`.

**Re-reproduced the exact cycle-1 failing scenario live, to confirm the fix holds in the running app (not
just in the unit test):**

1. Opened "Create metric" from `/metrics`.
2. Filled the name field (`Cycle2 Escape Repro`) and selected DataType `Netflix Data`.
3. Opened "Allowed dimensions" and confirmed via `document.activeElement` evaluation that focus was on
   the picker's trigger button (`aria-label="Allowed dimensions"`) — the identical setup that caused the
   cycle-1 failure.
4. Pressed Escape.
5. **Result: only the Allowed-dimensions popover closed.** The "Create metric" dialog remained open, with
   the name field still showing `Cycle2 Escape Repro` and the DataType still `Netflix Data` — confirmed via
   accessibility snapshot immediately after the keypress. This is the exact opposite of cycle 1's
   observed behavior (entire modal closing, all data discarded).

**Full happy-path re-verification** (beyond just the Escape fix):
- Continued the same form: selected measure field `rating`, submitted "Create metric" → succeeded,
  navigated to the new metric's detail page (`/metrics/586b62cb-...`), which rendered correctly (name,
  read-only DataType, measure field, aggregation, deprecate toggle all present and correct).
- Deleted the test metric via the detail page's inline delete-confirm flow → succeeded, navigated back to
  `/metrics`, list correctly shows only the pre-existing `Eval Test Metric` again (test metric fully
  cleaned up, no orphan data left).
- **0 console errors** across the entire re-verification session (checked after every interaction).

**Checklist:**

- [x] Happy path works end-to-end (create → measure field → submit → detail → delete, all confirmed live).
- [x] Unhappy path (the specific one that failed cycle 1 — Escape mid-authoring) now handled gracefully:
      contains to the popover, no data loss.
- [x] No console errors during any tested flow.
- [x] Feature reachable from all relevant entry points (nav/sidebar/breadcrumb — unchanged from cycle 1,
      not re-tested exhaustively since this cycle's diff doesn't touch nav wiring).
- [x] Interactive elements have accessible names and keyboard support — the specific gap flagged in cycle
      1 (Escape not contained) is now closed.
- Breakpoints not re-tested this cycle (no layout/CSS changes in this diff; cycle 1 already confirmed
  1440/1100/768/375 clean).

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- (carried forward, unchanged, non-blocking) DESIGN.md spacing-token literal-px values in the three
  metrics CSS files mirror pre-existing debt elsewhere in the codebase — consider a follow-up repo-wide
  token-alignment ticket.
- (carried forward, unchanged, non-blocking) `BindingEditor.tsx`/`MetricEditorForm.tsx` are past/near
  CONTRIBUTING.md's file-size soft budgets — flag a split proposal in the eventual PR description.
