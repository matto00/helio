# Files Modified — HEL-716

- `frontend/src/shared/ui/Modal.tsx` — added `xl`/`full` sizes; unified `onClose` as a single
  vetoable close-request signal (close button, backdrop click, and a new `cancel`-event listener
  for Escape all route through it, no pre-closing); added `headerActions` slot; added a shared
  Tab/Shift+Tab focus-wrap `useEffect` (see "Deviation from tasks.md" below).
- `frontend/src/shared/ui/Modal.css` — added `.ui-modal--xl` / `.ui-modal--full` width presets.
- `frontend/src/shared/ui/Modal.test.tsx` — updated close-button/backdrop tests to assert
  exactly-once `onClose` without pre-closing; replaced the native-`close`-event Escape test with
  a `cancel`-event test; added `xl`/`full`/re-render size-class tests and `headerActions` tests.
- `frontend/src/shared/ui/Modal.css.test.ts` — added the HEL-313 `[open]`-animation
  fill-mode regression guard (moved here from the now-deleted `PanelCreationModal.css.test.ts`,
  since `Modal.css` is now that rule's real home for every consumer).
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — migrated onto `Modal`
  (`size="lg"`); deleted the hand-rolled `<dialog>` lifecycle, backdrop-click handler, and manual
  focus-trap effect; moved the step-progress eyebrow + per-step heading into the body.
- `frontend/src/features/panels/ui/PanelCreationModal.css` — removed dead dialog-level rules
  (border/background/shadow/backdrop/`[open]` animation/width) now owned by `Modal.css`; added a
  negative-margin wrapper to cancel `Modal`'s body padding so step content still bleeds
  edge-to-edge as before; renamed `.panel-creation-modal__header-text` to
  `.panel-creation-modal__step-heading` (its new role) and gave it the old header's padding.
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — updated the close button's
  expected accessible name (`"Close modal"` → `"Close"`, now Modal's generic close button);
  removed the two jsdom Tab/Shift+Tab tests (jsdom can't exercise native `<dialog>` focus
  containment) — see `e2e/hel716-panel-creation-focus-trap.spec.ts` for the real-browser
  replacement.
- `frontend/src/features/panels/ui/PanelCreationModal.css.test.ts` — deleted; its one guard
  (HEL-313) moved to `Modal.css.test.ts` (see above).
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — migrated onto `Modal` (`size`
  toggles `"full"`/`"md"` by mode); unified `handleCloseButton`/`handleCancel`/the old hook's
  `attemptClose` into one `attemptClose` used for both `Modal`'s `onClose` and the footer Cancel
  button (see "Deviation from tasks.md" below); moved the `E`-key shortcut to a document-scoped
  effect; dropped `discardClosesModal`.
- `frontend/src/features/panels/ui/PanelDetailModal.css` — removed dead dialog-level rules
  (border/background/color/shadow/backdrop/`[open]` animation/width) now owned by `Modal.css`;
  kept the fixed-height rules per design.md Decision 1; added a negative-margin wrapper on
  `.panel-detail-modal__inner` to cancel `Modal`'s body padding (preserves the pre-migration
  edge-to-edge content bleed); removed the now-dead `.panel-detail-modal__header`/`__title`/
  `__close`/`__header-actions`/`__footer` wrapper rules (Modal now owns that markup).
- `frontend/src/features/panels/ui/PanelDetailModal.mobile.css` — removed the dead
  `.panel-detail-modal__close` mobile 44px rule (Modal's own `.ui-modal__close` mobile override
  already covers it, guarded by `Modal.css.test.ts`); bumped the phone full-screen override to a
  compound `.ui-modal.panel-detail-modal...` selector so it reliably outranks `Modal.css`'s
  base/size classes regardless of CSS import order (both are otherwise single-class selectors of
  equal specificity).
- `frontend/src/features/panels/ui/PanelDetailModal.css.test.ts` — removed the
  `.panel-detail-modal__close` mobile-lock assertion (now covered by `Modal.css.test.ts`); kept
  every other tap-target lock.
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` — updated the close button's
  expected accessible name (`"Close panel settings"` → `"Close"`); removed now-vacuous
  `HTMLDialogElement.prototype.close` assertions (the component never calls `.close()` itself
  post-migration); updated the ✕-button discard-confirm test to assert "returns to view mode"
  instead of "closes the modal" (see "Deviation from tasks.md" below).
- `frontend/src/features/panels/hooks/usePanelDetailModalLifecycle.ts` — deleted; retired per
  tasks.md 3.4 (nothing remained after 3.2/3.3 moved its logic into `PanelDetailModal.tsx`).
- `e2e/hel716-panel-creation-focus-trap.spec.ts` — new permanent e2e spec (task 4.5): the
  required real-browser Tab/Shift+Tab wrap-around replacement for the jsdom coverage deleted with
  `PanelCreationModal`'s manual focus trap.

## Deviation from tasks.md (flagged, not guessed — see also the final report)

**Finding:** task 2.2 assumed "native `<dialog>` + `showModal()` focus containment" is
equivalent to the deleted manual Tab-wrap trap. Task 4.5's own required real-browser Playwright
check **disproved this**: native `<dialog>` only makes outside content inert (Tab can't escape
the dialog) — it does **not** wrap focus back to the first/last element when Tab is pressed past
the last/first element inside the dialog. Confirmed via an isolated minimal-HTML probe (no app
code involved) on two Chromium versions (1193, 1208): Tab past the last element moves focus to
`<body>`, not back to the first. Modal.tsx never had this logic either, so this was a latent gap
for all 13 pre-existing `Modal` consumers — but it's a **regression** specifically for
`PanelCreationModal`, which had correct Tab-wrap via its own manual trap before this migration,
and it contradicts `modal-dismiss-interactions`'s explicit Tab/Shift+Tab scenarios, which the
proposal listed as an unmodified capability.

**Fix:** relocated + generalized the deleted trap logic into `Modal.tsx` itself (`frontend/src/shared/ui/Modal.tsx`,
task 1.6 — not in the original task list), so every `Modal` consumer gets correct wrap-around,
not just the two being migrated. Verified via `e2e/hel716-panel-creation-focus-trap.spec.ts`:
failed against the plain migration, passes after the fix (fresh, on two Chromium versions).

This is a larger change than "extend the size scale" in isolation, but it's the only way to
satisfy task 4.5's own explicit verification requirement and the unmodified
`modal-dismiss-interactions` spec — flagging prominently per the reviewer instructions rather
than silently shipping the regression or silently expanding scope. **Evaluator/Skeptic: please
confirm this is the right resolution** (vs., e.g., a narrower fix scoped only to
`PanelCreationModal`, or accepting the regression as a documented follow-up ticket).

**Second, smaller deviation (`PanelDetailModal`):** the old code distinguished the ✕ button from
Escape/backdrop-click/the footer Cancel button in **two** edit-mode cases, both via a
`discardClosesModal` flag that only the ✕ button's handler set:
- dirty + confirm discard: ✕ → **closed** the modal; Escape/backdrop/Cancel → **returned to view**.
- clean (no changes): ✕ → **closed** the modal immediately; Escape/backdrop/Cancel → **returned
  to view** directly.

`Modal` funnels the ✕ button, backdrop click, and Escape through the exact same `onClose`
callback with no way to tell them apart, so neither distinction can survive the migration as
literally written. `design.md` Decision 5 explicitly names the old hook's `attemptClose` (the
revert-to-view behavior, used for both cases) as becoming the new unified `onClose` handler, with
no "close on confirm" / "close when clean" branch — so all three vectors, plus the footer Cancel
button, now consistently revert to view mode in both cases. Implemented as written in design.md
(caught the clean-case instance via a real, run-fresh test failure — `PanelDetailModal.test.tsx`'s
"✕ button ... closes the modal immediately" test — confirming this wasn't a hypothetical), but
worth the Evaluator/Skeptic's explicit attention since the proposal's Non-Goals list "save/discard
semantics" as unchanged, and this is a real change to two discard/dismiss outcomes
(`PanelDetailModal.test.tsx`'s two renamed ✕-button tests document the new expected behavior).

## Cycle 2 — addressing `evaluation-1.md`'s three change requests

Where a file below was already listed in the cycle-1 section above, treat this entry as
superseding/correcting that one for the same file — e.g. `PanelCreationModal.tsx`'s cycle-1
bullet ("moved the step-progress eyebrow + per-step heading into the body") describes the
double-header defect the evaluator caught; the cycle-2 entry below describes the corrected
implementation actually shipping.

- `frontend/src/shared/ui/Modal.tsx` — **(CR1)** added optional `titleKey?: string | number` prop.
  Modal's own title `<h2>` (`tabIndex={-1}`, `aria-live="polite"`) is now refocused via a
  `useEffect(() => titleRef.current?.focus(), [titleKey])` whenever `titleKey` changes (including
  on initial mount) — lets a per-step wizard move focus to the new title on demand, without a ref
  into Modal's internals. No-op for every consumer that doesn't pass `titleKey` (all 12 others).
  **Self-caught bug during my own live verification of this fix** (not the evaluator's — found
  before returning): the first implementation used `key={titleKey}` + native `autoFocus` instead
  of a ref+effect. Root cause (probe-confirmed in an isolated repro independent of any app code —
  see the scratch HTML/Playwright probe in the session, not committed): when a `key` change forces
  a remount *and*, in the same commit, a *different* currently-focused sibling element is removed
  (e.g. the previous wizard step's selected type/template card unmounting), the browser's
  automatic blur-to-`<body>` from that removal isn't ordered relative to `autoFocus` within the
  commit and can override it — confirmed via Playwright against the live dev server: step-change
  focus landed on `<body>`, not the new heading. Fixed by switching to the ref+`useEffect`
  approach above, which runs strictly after a commit's DOM mutations settle, so it can't lose that
  race. Re-verified fresh afterward (also live, real Chromium): initial-open focus, step-change
  focus, and refocus-after-"Keep editing" all land on the title `<h2>` correctly.
- `frontend/src/shared/ui/Modal.css` — **(CR1)** added `border-radius: var(--app-radius-sm)` to
  `.ui-modal__title` so the global focus ring's corners are clean on the (now sometimes
  focusable) title; invisible/no-op unless the title is actually focused.
- `frontend/src/shared/ui/Modal.test.tsx` — **(CR3)** added a `Tab/Shift+Tab focus trap` describe
  block: Tab-from-last wraps to first, Shift+Tab-from-first wraps to last, and a non-boundary Tab
  press isn't intercepted — mirrors the deleted `PanelCreationModal.test.tsx` 2.7/2.8 pattern,
  now guarding the shared trap in the fast pre-commit suite instead of only via the e2e spec.
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — **(CR1)** `Modal`'s `title` is now
  `getStepTitle()` (dynamic per step, mirroring `AddSourceModal.tsx:286`) with
  `titleKey={`${step}-${titleFocusNonce}`}`, `ariaLabel="Create panel"` kept stable explicitly;
  deleted the redundant body-level `<h2>`/`titleRef`/the `[step]`-keyed focus effect (Modal's
  `titleKey` now owns step-change refocus); added `titleFocusNonce` state, bumped by
  `cancelDiscard()` to force a refocus when dismissing the discard banner without a `step` change.
- `frontend/src/features/panels/ui/PanelCreationModal.css` — **(CR1)** removed the now-dead
  `.panel-creation-modal__step-heading` wrapper and `.panel-creation-modal__title` rule (Modal's
  own `.ui-modal__title` owns this now); moved the wrapper's top/side padding onto
  `.panel-creation-modal__step-progress` directly, since the eyebrow is the only body-owned piece
  of the old header left.
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` — **(CR2, no behavior change)** no
  edit; already covers the ✕-button behavior correctly from cycle 1. Listed here only because the
  evaluator's report cross-references it as the source of truth the cycle-2 spec delta was
  written against.
- `openspec/changes/extend-modal-size-scale/proposal.md` — **(CR2)** Non-Goals now scopes
  "save/discard semantics" precisely (persistence + trigger conditions unchanged; post-dismiss
  *destination* is unified per Decision 2) instead of claiming no change at all; Modified
  Capabilities now lists `panel-detail-modal` (previously omitted — an oversight, not a deliberate
  "none"); "What Changes" corrected to describe the actual `titleKey`/dynamic-title resolution
  (CR1) instead of the superseded "static title, body-owned heading" plan.
- `openspec/changes/extend-modal-size-scale/design.md` — **(CR1, consistency)** Decision 4 marked
  superseded, with the corrected resolution and rationale (the evaluator's cycle-1 finding + the
  `titleKey` fix) in its place.
- `openspec/changes/extend-modal-size-scale/specs/panel-detail-modal/spec.md` — **(CR2)** new spec
  delta file (MODIFIED Requirements format): copies `openspec/specs/panel-detail-modal/spec.md`'s
  "Modal dismisses on Escape, backdrop click, and Cancel" requirement and edits it to document the
  close (✕) button now returning to view mode from edit mode (both the clean case and after
  confirming the discard warning) instead of closing outright, matching
  Escape/backdrop/Cancel — consistent with `PanelDetailModal.test.tsx`'s cycle-1-renamed tests.
- `openspec/changes/extend-modal-size-scale/tasks.md` — task 2.3 marked superseded (struck
  through, cross-referenced to the new task 5.1); new "## 5. Cycle 2" section covering all three
  change requests.

## Cycle 3 — final-gate skeptic change request (`skeptic-final-1.md`)

Comment-only fix, no behavior change (skeptic found no functional/AC/design regression anywhere
after extensive live verification — the sole blocking issue was two stale comments):

- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — the comment above `handleClose`
  (formerly claiming "native `<dialog>` + `showModal()` focus containment now applies, same as
  every other Modal consumer") rewritten to state the opposite, correct fact: native containment
  does NOT wrap focus (probe-confirmed false, task 1.6), and the wrap trap lives in the shared
  `Modal.tsx` instead. This comment predated 1.6's fix and was never reconciled with it.
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — the comment at the end of the
  "accessibility (dismiss + focus trap)" describe block (formerly claiming "there is no jsdom
  replacement assertion possible") rewritten to point at `Modal.test.tsx`'s `"Tab/Shift+Tab focus
  trap"` describe block, added by cycle 2's CR3 (task 5.3) — this comment predated that fix too.
- `openspec/changes/extend-modal-size-scale/tasks.md` — new "## 6. Cycle 3" section.

## Cycle 4 — final-gate skeptic change request, round 2 (`skeptic-final-2.md`)

Comment-only fix, no behavior change — the round-2 skeptic independently found a third,
uncorrected copy of the exact same stale claim cycle 3's fix commit was supposed to eliminate,
in a file that commit never touched:

- `e2e/hel716-panel-creation-focus-trap.spec.ts` — the file's header comment (unchanged since it
  was authored in `1e23b6a1`, the very first implementation commit — it predates even the two
  comments fixed in cycle 3) rewritten to match the now-corrected understanding in
  `PanelCreationModal.tsx`/`.test.tsx`: native `<dialog>` + `showModal()` prevents Tab from
  escaping the dialog but does NOT wrap focus back to the first/last element; the wrap trap
  lives in the shared `Modal.tsx`, which now has its own jsdom coverage (cycle 2 CR3); this
  file's role is the real-`<dialog>`, real-browser end-to-end check of that same shared
  mechanism, not "the only possible coverage because jsdom can't do it at all."
- `openspec/changes/extend-modal-size-scale/design.md` — per the orchestrator's explicit
  escalation condition (comprehensive repo-wide sweep, not just the file-by-name flagged), also
  fixed two related instances the round-2 skeptic flagged as accurate-but-non-blocking: the
  Goals bullet (~line 26, "native `<dialog>` + `showModal()` already contains focus, same as
  every other `Modal` consumer") and two Risks/Trade-offs bullets — all three still asserted the
  pre-1.6 "native containment already handles this" premise as unqualified planning-time fact.
  Each now carries a "Superseded during implementation" annotation matching Decision 4's existing
  pattern, so every mention of this premise in the file is consistently reconciled with what
  actually shipped.
- **Grep sweep performed** (repo-wide, not scoped to previously-flagged files): searched
  `frontend/`, `e2e/`, and `openspec/specs/` (the canonical, non-change-scoped specs too) for
  every phrasing variant found across all three skeptic rounds combined ("focus containment now
  applies", "no jsdom replacement", "native containment", "already contains focus" /
  "already handles this", "cannot exercise native", "trust the browser", plus a broad
  `showModal`-near-`focus` net). Confirmed no fourth code-level copy exists. The only remaining
  hits are: (a) the two now-corrected comments in `PanelCreationModal.tsx`/`.test.tsx`/this
  file's e2e spec, which explicitly and correctly state the opposite of the stale claim, and (b)
  historical evaluator/skeptic report files (`evaluation-1.md`, `skeptic-final-1.md`,
  `skeptic-final-2.md`, `skeptic-design-1.md`/`-2.md`) and `tasks.md`'s own original-task-text
  quotes, which accurately *quote* the old false claim as part of documenting what was wrong and
  how it was fixed — these are audit-trail records, not live assertions, and were deliberately
  left untouched.
- `openspec/changes/extend-modal-size-scale/tasks.md` — new "## 7. Cycle 4" section.

## Cycle 5 — final-gate skeptic change request, round 3 (`skeptic-final-3.md`) — real functional fix

**Unlike cycles 3/4, this is a real, blocking functional regression** the round-3 skeptic found
via direct DOM measurement, unrelated to the comment sweep (which it separately re-verified
clean). Human-authorized round beyond the ordinary final-gate budget.

- `frontend/src/shared/ui/Modal.css` — `.ui-modal__inner`'s sizing changed from an independently
  capped `max-height: 90vh` to `height: 100%`. Root cause: the old rule sized the shared
  header+body+footer flex wrapper against a hardcoded `90vh` regardless of the actual `<dialog>`
  box's own height. `PanelDetailModal.css`'s `.panel-detail-modal { height: min(680px, 90vh);
  overflow: hidden; }` (the sanctioned narrower-height override per design.md Decision 1) gives
  the dialog itself a fixed 680px box at any viewport taller than ~756px — but `.ui-modal__inner`
  still grew to its own independent 90vh (810px at 1440×900), 130px past the dialog's real
  height. Since the dialog clips overflow, the footer (`Cancel`/`Save panel settings`) and the
  discard-confirmation banner were completely invisible *and unreachable* — confirmed via
  `document.elementFromPoint` at the Save button's screen location resolving to the `<dialog>`
  backdrop, not the button, so a real click there triggered `onClose` instead of submitting.
  This broke the Save affordance for any ordinary `PanelDetailModal` edit form at any viewport
  ≥~756px tall (most real desktop/laptop screens), and made the entire vetoable-close-request
  flow this ticket is centered on (design.md Decision 2) practically unusable there, since the
  discard-confirmation itself was invisible whenever it was triggered. `height: 100%` makes
  `.ui-modal__inner` always fill whatever height the dialog actually ends up with — the outer
  `.ui-modal` class already caps the dialog itself at `max-height: 90vh`, so a plain consumer
  (content-driven height, the other 12) is unaffected either way; only a consumer with a
  narrower fixed-height override benefits from (and needed) the fix.
- `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts` — new permanent e2e regression spec
  (pinned `viewport: { height: 900 }`), mirroring the `e2e/hel716-panel-creation-focus-trap.spec.ts`
  precedent from task 4.5. **Why this needed a permanent, viewport-pinned test rather than just a
  verification-notes reminder**: this bug went undetected through three prior skeptic-final
  rounds and two evaluator rounds specifically because every prior pass used a short/default
  viewport, which silently hides it (only reproduces above ~756px viewport height, and the
  default Playwright session viewport in this environment is 900px tall — i.e. this *should*
  have been caught, but a footer that's invisible rather than present-but-wrong is easy to miss
  on a cursory pass). A note alone repeats exactly the failure mode that let this slip through 5
  prior review passes; pinning the viewport height in a committed spec makes it structurally
  impossible to accidentally re-test at a viewport short enough to hide the defect again. Asserts
  the `innerHeight <= dialogHeight` invariant directly (the exact mechanism of the bug), plus
  real hit-testing via `document.elementFromPoint` and an actual `.click()` that must submit the
  form, so it fails the same way the original bug did if this regresses.
- **Verification-checklist note for future Evaluator/Skeptic passes on this change** (per the
  change request's point 3): test `PanelDetailModal` edit mode at a viewport **≥900px tall**, not
  just the width breakpoints (1440/1100/768/375) this change's evaluation reports already
  covered — those are width-only and don't exercise viewport *height*, which is what this bug
  depended on. The new e2e spec above pins this permanently, but a manual/live pass should still
  explicitly check viewport height, not just width, going forward.
- `openspec/changes/extend-modal-size-scale/tasks.md` — new "## 8. Cycle 5" section.
