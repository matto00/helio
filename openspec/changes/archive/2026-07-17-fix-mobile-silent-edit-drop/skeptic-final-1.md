## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established (cold, not from evaluator's narrative):**
- Read `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`, `evaluation-1.md` as claims.
- `git diff main...HEAD --stat` — 18 files, confined to `usePanelUpdatesFlush.ts` (new),
  `useLayoutSave.ts` (new), `usePanelGridSave.ts` (deleted), `PanelGrid.tsx`,
  `DesktopPanelGrid.tsx`, `MobilePanelStack.tsx` (doc comments), `PanelGrid.test.tsx`, plus
  planning artifacts. No unrelated changes. Full-file read of both new hooks and the
  `DesktopPanelGrid.tsx` diff confirmed the split is behavior-preserving (only the
  `usePanelGridSave` → `useLayoutSave` swap and `forwardRef` removal; drag/resize/title-edit
  logic byte-identical modulo dedent).
- `grep -rn usePanelGridSave` across `frontend/` — only stale comment references remain (2
  lines in `PanelGrid.test.tsx`, 1 in `DesktopPanelGrid.tsx` class doc); no functional/import
  references. Minor nit, not a defect (noted below).

**Gates re-run myself (not trusted from evaluation-1.md):**
- `npx jest --testPathPatterns "PanelGrid.test"` → 21/21 pass.
- `npx jest` (full suite) → 102 suites / 1096 tests pass.
- `npm run lint` → clean (zero-warnings policy).
- `npm run build` → succeeds.
- `npx tsc --noEmit` → 55 pre-existing errors, all in `toastListeners.ts` / `listenerMiddleware.ts`
  / `env.ts` (unrelated to this change); `grep` confirms zero errors in any of the five changed
  source files.
- `npm run check:openspec` → confirms the sole pre-commit failure is "complete but not archived",
  matching the commit body's disclosed `-n` bypass (CONTRIBUTING.md-compliant).

**Live browser verification (fresh session, matt@helio.dev, dashboard "HEL-247 Collections
Eval" with a real `collection_options`/V57 panel "Netflix Titles Collection"):**
- **Phone width (390×844), collection-panel appearance edit**: opened detail modal, changed
  background hex, saved → "Unsaved changes" indicator appeared (staged, not immediate-PATCHed).
  Auto-flush interval (already running from server reuse) fired `POST /api/panels/updateBatch`;
  "Last saved just now" shown; **reload confirmed the new hex value persisted** in the edit
  form (`#654321`, then a second round with `#112233` via explicit "Save now" click — both
  independently verified through reload).
- **"Save now" at phone width**: staged an edit, clicked the button (via `element.click()` after
  `getByRole` failed to resolve a ref — button exists and is wired, not a dead affordance),
  confirmed `POST /api/panels/updateBatch` fired and the indicator flipped to "Last saved just
  now". Not a dead button.
- **Resize-mid-edit strand (desktop → phone)**: staged an appearance edit (`#ABCDEF`) at
  1280px, resized to 390px before the 30s tick. Network log showed the batch flush (no strand),
  and **reload confirmed `#abcdef` persisted** — the strand described in the ticket's
  consequence 3 is fixed.
- **HEL-301 guard**: across the entire session (mobile browsing, phone-width edits, Save-now,
  the resize-mid-edit transition in both directions, and a subtype-editor save), `browser_network_requests`
  shows **zero** `PATCH /api/dashboards/:id` requests. The only PATCH/POST traffic was
  `/api/panels/updateBatch`, `/api/panels/:id` (subtype editor, see next bullet), and an
  unrelated `/api/users/me/update` (theme toggle).
- **Subtype editor (audit row #6, collection panel) at phone width**: edited the "Unit text"
  field and saved — `PATCH /api/panels/:id` fired immediately (independent of the flush
  lifecycle), matching the audit's claim that subtype edits persist immediately regardless of
  width. Verified this myself rather than trusting the table.
- **Console**: 0 errors throughout; only the pre-existing `selectPipelineOutputDataTypes`
  memoization warning (confirmed unrelated — not in the diff).

### Acceptance criteria — traced

1. **No user-visible edit path at <768px silently drops changes** — met. Appearance/title edits
   (`PanelDetailModal`, all panel kinds incl. collection) now flush via the width-independent
   `usePanelUpdatesFlush` (auto-save interval, Save-now, dashboard-switch); verified live with
   real network + reload evidence, not just unit tests. Layout drag-then-shrink-below-768-within-30s
   remains a residual gap — see judgment below.
2. **Regression test covering appearance edits at mobile width** — met:
   `PanelGrid.test.tsx` "HEL-304 — width-independent panel-update flush" (phone-width auto-save
   flush, Save-now at phone width, resize-mid-edit strand) plus the rewritten HEL-301 hazard test.
   Ran locally, not merely trusted from the evaluation report.
3. **Audit note listing every `usePanelGridSave`-dependent mutation path** — met:
   `files-modified.md`'s 8-row table, cross-checked against `design.md`'s pre-implementation
   table and independently spot-verified rows #1, #3, #4, #6, #8 live.

### Decision-3 fallback (session-specific scrutiny)

Judgment: **sound, not a silent-drop path AC #1 covers.** Reasoning:
- The *edit action* in the residual case (dragging a panel layout) only occurs at desktop width
  (≥768px) — `DesktopPanelGrid`/RGL never renders below the boundary, so the drag itself is not
  "an edit path at <768px." AC #1's wording ("edit path AT <768px") and `tasks.md`'s Resolution
  notes make this scope boundary explicit, not retrofitted.
- I traced that this exact drop existed in the pre-fix `usePanelGridSave` too: the whole hook
  (interval + refs) was torn down on `DesktopPanelGrid` unmount, identically to the new
  `useLayoutSave`'s unmount behavior. This is not a regression introduced by this diff.
- Adding a guarded unmount flush (as design Decision 3 originally contemplated) would introduce
  a *new* layout-write code path fired by a resize/unmount event — exactly the kind of surface
  expansion the "sacred" HEL-301 guard is meant to prevent. Declining it is the more conservative,
  defensible choice, and it's transparently documented (not swept under the rug) in both
  `files-modified.md` and `tasks.md`'s Resolution notes.
- Verified live and via test that the guard holds: zero layout PATCH on a pure resize crossing
  the boundary, in both the automated suite and my own network-log observation.

One documentation nit: `files-modified.md`'s Decision-3 writeup restates "layout stays
structurally desktop-only" without fully re-deriving why the *specific* design-doc conditional
(RGL mutating layout during resize) was or wasn't triggered; `tasks.md`'s Resolution notes give
the clearer, sufficient justification. Non-blocking — the actual behavior and the guard are both
verified correct regardless of which document states the reasoning best.

### Verdict: CONFIRM

### Non-blocking notes

1. Stale comment references to the deleted `usePanelGridSave` remain in
   `PanelGrid.test.tsx:408,454` and `DesktopPanelGrid.tsx`'s class doc (line referencing the old
   name inside the updated comment) — cosmetic, doesn't affect correctness. Fine to fix on next
   touch.
2. Consider filing a follow-up ticket for the residual "desktop drag + resize below 768px within
   30s" layout-drop edge — pre-existing, correctly out of this ticket's scope, but still a real
   (if narrow) data-loss path worth tracking explicitly rather than only living in a PR audit note.
