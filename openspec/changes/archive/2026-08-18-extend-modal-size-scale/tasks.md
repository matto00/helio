## 1. Frontend: Modal primitive

- [x] 1.1 Add `xl` (960px) and `full` (1200px) to `ModalSize` in `Modal.tsx`, and matching
      `.ui-modal--xl` / `.ui-modal--full` rules in `Modal.css` following the existing
      `min(<px>, calc(100vw - 32px))` pattern.
- [x] 1.2 Add optional `headerActions?: ReactNode` prop; render it in `ui-modal__header`,
      between `ui-modal__header-text` and the close button, before the close button.
- [x] 1.3 Change the close-button and backdrop-click handlers to call `onClose()` only —
      remove the `dialogRef.current?.close()` calls from both paths.
- [x] 1.4 Add a `cancel` event listener on the dialog (mirrors the existing effect pattern) that
      calls `e.preventDefault()` then `onClose()`, so Escape no longer closes the dialog before
      the consumer's `onClose` handler runs.
- [x] 1.5 Verify the `[open]`-keyed effect is still the sole place that calls
      `showModal()`/`close()` imperatively.
- [x] 1.6 (Added by executor — see files-modified.md "Deviation from tasks.md" note) Add a
      shared Tab/Shift+Tab focus-wrap `useEffect` to `Modal.tsx` itself. Probe-confirmed (two
      Chromium versions) that native `<dialog>` + `showModal()` does NOT wrap focus back to the
      first/last element — it only prevents Tab from escaping to outside content, falling back
      to `<body>` past the last element. This contradicted task 2.2's "native containment now
      applies" premise and `modal-dismiss-interactions`'s explicit Tab/Shift+Tab wrap scenarios
      (listed as an unmodified capability). Fixed at the shared `Modal` level so every consumer
      gets correct wrap-around, not just the two in scope.

## 2. Frontend: PanelCreationModal migration

- [x] 2.1 Replace the hand-rolled `<dialog>` (showModal effect, backdrop-click handler, cancel
      interception, manual Tab-wrap focus-trap effect) with `<Modal open size="lg"
      onClose={handleDismiss} ...>`, keeping `handleDismiss`'s existing dirty-check /
      discard-confirm logic unchanged.
- [x] 2.2 Delete the manual focus-trap `useEffect` and the `FOCUSABLE_SELECTORS` constant from
      `PanelCreationModal.tsx` — done, but native `<dialog>` + `showModal()` focus containment
      alone turned out NOT to be equivalent (see 1.6): the trap logic was relocated and
      generalized into `Modal.tsx` rather than dropped, so every consumer (not just this one)
      gets correct Tab/Shift+Tab wrap.
- [x] 2.3 ~~Move the step-progress eyebrow (`Step N of M`) and the per-step `<h2>` heading
      (including `titleRef`, `tabIndex={-1}`, `aria-live="polite"`, and the focus-on-step-change
      effect) from the old custom header into the top of `Modal`'s `children`.~~ **Superseded in
      cycle 2 (evaluator change request #1)** — this produced a new, previously-invisible
      double-heading (`Modal`'s required `title` prop was passed a static `"Create panel"`,
      stacked directly above the wizard's own per-step heading). See cycle-2 task 5.1 below for
      the corrected implementation.
- [x] 2.4 Keep the discard-confirm banner (`isShowingDiscardConfirm`) rendered inside `children`,
      unchanged.
- [x] 2.5 Update `PanelCreationModal.css`: remove now-dead `<dialog>`-level rules (border,
      background, shadow, `[open]` animation — now owned by `Modal.css`'s `lg` size), keep the
      step/eyebrow/discard-confirm rules, re-scoped if their selectors assumed the old header
      structure.

## 3. Frontend: PanelDetailModal migration

- [x] 3.1 Replace the hand-rolled `<dialog>` with `<Modal open size={modalMode === "view" ?
      "full" : "md"} title={panel.title} headerActions={<...Edit button + Unsaved badge...>}
      onClose={<refactored attemptClose, see 3.2>} footer={modalMode === "edit" ? <...> :
      undefined} ...>`.
- [x] 3.2 Refactor `usePanelDetailModalLifecycle`'s `attemptClose` function into the `onClose`
      handler passed to `Modal` (view mode → close; edit mode + dirty → show discard warning;
      edit mode + clean → revert to view mode). Remove the hook's `dialogRef`, `cancel`, and
      `click` DOM-listener wiring — `Modal` now owns those dismiss vectors.
- [x] 3.3 Move the `E`-key edit-mode shortcut listener to `document`, gated on the component's
      mounted lifetime; keep its existing focus-target guard (input/textarea/select) and
      view-mode-only condition unchanged.
- [x] 3.4 Retire `usePanelDetailModalLifecycle.ts` if nothing remains in it after 3.2/3.3;
      otherwise slim it to only the surviving keyboard-shortcut logic. — Retired (deleted); its
      close-vetoing `attemptClose` logic is now inlined in `PanelDetailModal.tsx` (task 3.2), and
      the `E`-key listener moved to a plain `useEffect` there too (task 3.3).
- [x] 3.5 Update `PanelDetailModal.css` / `PanelDetailModal.*.css`: remove now-dead
      `<dialog>`-level rules that `Modal.css`'s `md`/`full` size classes now own (border,
      background, shadow, backdrop, `[open]` animation, and **width**) for both the base and
      `--view` classes — but KEEP each class's `height` rule (`min(680px, 90vh)` base /
      `min(88vh, 900px)` view): `Modal`'s size presets are width-only (no size owns a height),
      so `PanelDetailModal` keeps its own fixed-height CSS, applied via `Modal`'s `className`
      prop (`"panel-detail-modal"` / `"panel-detail-modal--view"`) layered on top of the
      width-only size class. Keep every file at or under the ~400-line budget per
      `panel-detail-modal-css-structure`.

## 4. Tests

- [x] 4.1 Update `Modal.test.tsx`: add cases for `xl`/`full` size classes, `headerActions`
      rendering (present/absent), and the unified close-request semantics (Escape/backdrop/close
      button each call `onClose` without the dialog auto-closing first).
- [x] 4.2 Update `PanelCreationModal.test.tsx` and `PanelCreationModal.css.test.ts` for the new
      structure; remove/replace any assertions tied to the deleted manual focus-trap effect. —
      The HEL-313 `[open]`-animation regression guard in `PanelCreationModal.css.test.ts` no
      longer had a rule to test (moved to `Modal.css.test.ts`, since `Modal.css` is now its real
      home); the file had no other tests, so it was deleted.
- [x] 4.3 Update `PanelDetailModal.test.tsx` and sibling `PanelDetailModal.*.test.tsx` files,
      plus `PanelDetailModal.css.test.ts`, for the new structure — keep the mobile ≥44px
      tap-target CSS-lock assertions passing per `panel-detail-modal-css-structure`.
- [x] 4.4 Run the full frontend suite (`npm test`) and confirm no regressions in other `Modal`
      consumers' tests. — See verification gates in the executor's return summary.
- [x] 4.5 Deleting `PanelCreationModal`'s manual Tab-wrap trap removes jsdom's only automated
      coverage of `modal-dismiss-interactions`'s Tab/Shift+Tab wrap-around scenarios (jsdom
      cannot exercise native `<dialog>` focus containment). As a required real-browser
      replacement, manually verify via Playwright against the running dev server that Tab from
      the last focusable element in the open `PanelCreationModal` wraps to the first, and
      Shift+Tab from the first wraps to the last — record the result in the executor's own
      verification notes so the Evaluator/Skeptic can confirm it at their own passes. — Done: a
      new `e2e/hel716-panel-creation-focus-trap.spec.ts` performs exactly this check against the
      running dev server. It FAILED against the plain migration (native containment doesn't
      wrap — see 1.6), which is the "factually wrong plan" finding that led to 1.6's fix; after
      that fix it PASSES (confirmed fresh, twice, on two Chromium versions — 1193 and 1208).
      Kept as a permanent regression spec (`npm run e2e`, not a pre-commit gate), same as the
      other `e2e/hel*` specs.

## 5. Cycle 2 — evaluator change requests (`evaluation-1.md`)

- [x] 5.1 (CR1) Fix `PanelCreationModal`'s duplicate visible header. `Modal.tsx` gains an
      optional `titleKey?: string | number` prop: when provided, a `useEffect` refocuses Modal's
      own title `<h2>` (`tabIndex={-1}`, `aria-live="polite"`) every time it changes (including on
      initial mount) — restores focus-on-step-change / refocus-after-dismissing-the-discard-banner
      without a ref into `Modal`'s internals. No-op for every consumer that doesn't pass
      `titleKey`. `PanelCreationModal.tsx` now passes `title={getStepTitle()}` and
      `titleKey={`${step}-${titleFocusNonce}`}` directly to `Modal` (mirroring
      `AddSourceModal.tsx:286`'s per-step-dynamic-title pattern) instead of a static `"Create
      panel"`; the redundant body-level `<h2>`/`titleRef` are deleted, keeping only the "Step N
      of M" eyebrow in the body. `titleFocusNonce` is a new bit of state bumped by
      `cancelDiscard()` to force a refocus when `step` itself hasn't changed. **Self-caught
      follow-up bug** (found during my own live-verification of this fix, before returning): a
      first attempt used `key`+native `autoFocus` instead of the ref+`useEffect` above — root-cause
      probe (isolated repro) showed that approach loses a race against the browser's
      blur-to-`<body>` when a different focused sibling unmounts in the same commit (the previous
      step's selected card). See `files-modified.md`'s `Modal.tsx` entry for the full root
      cause/probe/fix.
- [x] 5.2 (CR2) Update planning artifacts for `PanelDetailModal`'s unified dismiss-vector
      behavior (no code change — the behavior itself was already correct, per the evaluator's own
      assessment): (a) `proposal.md`'s Non-Goals and Modified Capabilities now scope
      "save/discard semantics" precisely and list `panel-detail-modal` as modified; (b) a
      MODIFIED-requirements spec delta at `specs/panel-detail-modal/spec.md` documents the close
      (✕) button now returning to view mode (matching Escape/backdrop/Cancel) instead of closing
      outright. Also updated `design.md` Decision 4, superseded by 5.1's resolution.
- [x] 5.3 (CR3) Add jsdom coverage for `Modal.tsx`'s shared Tab/Shift+Tab focus-trap effect (task
      1.6) in `Modal.test.tsx` — it's hand-rolled JS `keydown` handling, not native `<dialog>`
      behavior, so it's fully testable via `fireEvent.keyDown` + `document.activeElement` (the
      same technique the deleted `PanelCreationModal.test.tsx` 2.7/2.8 tests already proved).
      Three cases added: Tab-from-last wraps to first, Shift+Tab-from-first wraps to last, and Tab
      from a non-boundary element doesn't get intercepted.

## 6. Cycle 3 — final-gate skeptic change request (`skeptic-final-1.md`)

- [x] 6.1 Fix two stale/incorrect code comments that pre-dated task 1.6's fix and cycle 2's
      CR3 fix and were never reconciled with them — no behavior change, comments only:
      - `PanelCreationModal.tsx:212-215` claimed "native `<dialog>` + `showModal()` focus
        containment now applies, same as every other Modal consumer" — false (this is the exact
        premise 1.6 probe-confirmed false). Rewritten to state containment does NOT wrap focus
        and the trap now lives in the shared `Modal.tsx`.
      - `PanelCreationModal.test.tsx:1165-1173` claimed "there is no jsdom replacement assertion
        possible" — false as of 5.3 (CR3), which added exactly that to `Modal.test.tsx`.
        Rewritten to point at it.

## 7. Cycle 4 — final-gate skeptic change request, round 2 (`skeptic-final-2.md`)

- [x] 7.1 Fix a third, uncorrected copy of the exact same stale claim, missed by cycle 3's
      sweep: `e2e/hel716-panel-creation-focus-trap.spec.ts:5-13`'s header comment (a file
      cycle 3's fix commit never touched, even though both comments it did fix now explicitly
      point readers toward this exact file as the real-browser coverage). Rewritten to match:
      native containment does NOT wrap focus (only prevents escaping the dialog); the trap lives
      in the shared `Modal.tsx`, which now has its own jsdom coverage too (cycle 2 CR3); this
      file's role is a real-`<dialog>`, real-browser end-to-end check of that same shared
      mechanism, not "the only possible coverage."
- [x] 7.2 Per the escalation's explicit condition, ran a genuinely comprehensive repo-wide grep
      sweep (not scoped to files already flagged by name) for every phrasing variant of the
      claim across the whole repo — `frontend/`, `e2e/`, `openspec/specs/` (canonical specs,
      not just this change's deltas) — confirmed no fourth code-level copy exists. Also found
      and fixed two non-blocking instances the round-2 skeptic explicitly flagged but didn't
      require: `design.md`'s Goals bullet (line ~26) and two Risks/Trade-offs bullets, which
      still asserted the pre-1.6 "native containment already handles this" framing as
      unqualified planning-time fact — both now carry a "Superseded during implementation" note
      matching Decision 4's existing pattern, for full consistency. (Historical evaluator/skeptic
      report files that *quote* the old stale text as part of documenting what was wrong and
      what was fixed — `evaluation-1.md`, `skeptic-final-1.md`, `skeptic-final-2.md`,
      `skeptic-design-1.md`, and this file's own task 6.1/4.5 entries — are accurate audit-trail
      records, not live assertions about current behavior, and were deliberately left as-is.)

## 8. Cycle 5 — final-gate skeptic change request, round 3 (`skeptic-final-3.md`) — real functional fix

Human-authorized round beyond the ordinary final-gate budget. Unlike cycles 3/4 (comment-only),
this one is a real, blocking functional regression, unrelated to the comment sweep (which the
round-3 skeptic separately re-verified clean).

- [x] 8.1 **(Blocking)** Fix `.ui-modal__inner`'s sizing in `Modal.css`: `.ui-modal__inner` used
      to size itself independently up to a hardcoded `max-height: 90vh`, regardless of the
      actual `<dialog>` box's own height. `PanelDetailModal.css`'s
      `.panel-detail-modal { height: min(680px, 90vh); overflow: hidden; }` gives the dialog a
      narrower fixed height at any viewport taller than ~756px (`90vh > 680px`) — but
      `.ui-modal__inner` still grew to its own independent `90vh` (measured 810px at 1440×900 by
      the skeptic — 130px taller than the dialog's real 680px box). Since the dialog clips
      overflow, everything past the 680px cut line — the footer (`Cancel`/`Save panel settings`)
      and, once shown, the discard-confirmation banner — was invisible *and unreachable*
      (`document.elementFromPoint` at the Save button's on-screen location resolved to the
      `<dialog>` backdrop, not the button; a real click there triggered `onClose` instead of
      submitting). This broke Save for any ordinary panel edit form at any viewport ≥~756px tall
      — most real desktop/laptop screens — and made the entire vetoable-close-request flow this
      ticket is centered on (design.md Decision 2) practically unusable for `PanelDetailModal`,
      since the discard-confirmation itself was invisible. **Fix**: `.ui-modal__inner`'s
      `max-height: 90vh` → `height: 100%`. The outer `.ui-modal` class already caps the dialog
      itself at `max-height: 90vh`, so `.ui-modal__inner` now always fills whatever height the
      dialog actually ends up with — its own independent 90vh, or a narrower consumer override.
- [x] 8.2 Re-verified live at a 1440×900 viewport (not the short default that hid the bug),
      fresh, per the change request's three explicit checks — all confirmed via direct
      measurement + `document.elementFromPoint` + a real button `.click()`, not just visual
      inspection:
      (a) `PanelDetailModal` edit mode: `innerHeight` (678px) now `<=` `dialogHeight` (680px,
      previously 810px vs 680px); Save button visible, hit-tests to the button itself, and a
      real click submits the form (returns to view mode). Screenshot confirms both the footer
      and the discard-confirm banner render inside the 680px box.
      (b) Discard-confirmation banner (triggered via Escape while dirty) visible with no
      scrolling, hit-tests to the banner itself.
      (c) `PanelDetailModal` view mode (`height: min(88vh, 900px)` ≈ 780px at this viewport) and
      `PanelCreationModal` (content-driven, ~525px, well under the 810px cap) both unaffected —
      `innerHeight <= dialogHeight` holds for both, no visual regression in either screenshot.
- [x] 8.3 Added a permanent e2e regression spec,
      `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts` (pinned `viewport: { height: 900 }`,
      mirroring task 4.5's `e2e/hel716-panel-creation-focus-trap.spec.ts` precedent) — this bug
      went undetected through 3 skeptic rounds specifically because every prior pass used a
      short/default viewport, which silently hides it; a permanent, tall-viewport-pinned spec is
      the reliable way to make sure it can't regress silently again, per the change request's
      point 3 ("add this viewport-height scenario ... to your own verification notes going
      forward ... call out in files-modified.md"). Asserts the `innerHeight <= dialogHeight`
      invariant directly, plus real hit-testing and a real click-to-submit, so it fails the same
      way the original bug did if it ever regresses.
