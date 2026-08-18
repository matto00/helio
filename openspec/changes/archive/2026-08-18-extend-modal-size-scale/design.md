## Context

`Modal` (`frontend/src/shared/ui/Modal.tsx`) is a native-`<dialog>`-based primitive with sizes
`sm`(420px)/`md`(540px)/`lg`(720px), a fixed header (title/description + close button), body,
and optional footer. 13 existing consumers all render it with `open` hardcoded `true` and rely
on the *parent* unmounting them to close — `onClose` is just a "please unmount me" notification.

`PanelCreationModal.css` already comments "720px mirrors Modal's `lg` size token" — it's already
numerically equivalent to `lg`. `PanelDetailModal.css` has two widths: `540px`/`680px` (edit
mode, the un-modified `.panel-detail-modal` class — already ≈ `md`'s 540px) and `1200px`/`900px`
(`.panel-detail-modal--view`, applied when `modalMode === "view"`) — the latter has no existing
token and needs a new `full` size.

Both modals hand-roll: `showModal()` on mount, a backdrop-click handler, a `cancel`-event
`preventDefault()` (Escape interception) gated on dirty/mode state, and (creation modal only) a
manual Tab-wrap focus trap. `Modal` today has none of the `cancel`-interception — Escape just
closes the native dialog immediately, calling `onClose` unconditionally — so it cannot currently
support a vetoable "unsaved changes" guard, which both modals require.

## Goals / Non-Goals

**Goals:**
- Extend `Modal`'s size scale to cover both modals' current footprints, pixel-equivalent.
- Make `Modal`'s `onClose` a uniform, vetoable "close requested" signal across all three dismiss
  vectors, so a consumer can show a discard-confirmation instead of closing.
- Retire every hand-rolled `<dialog>` outside `Modal.tsx`, including the creation modal's manual
  focus trap (native `<dialog>` + `showModal()` already contains focus, same as every other
  `Modal` consumer — none of which hand-roll a trap). **Superseded during implementation — see
  Decision 4 and tasks.md 1.6:** native containment prevents Tab from *escaping* the dialog, but
  does not *wrap* focus back to the first/last element (probe-confirmed false on two Chromium
  versions). The trap was relocated and generalized into `Modal.tsx` itself, not dropped.

**Non-Goals:**
- No change to panel creation/edit business logic, save/discard semantics, or visual design.
- No change to any other `Modal` consumer's behavior — the `onClose` semantics change is
  observationally a no-op for them (see Decisions).

## Decisions

**1. Size scale: add `xl` (960px) and `full` (1200px) — width only, matching every existing
size preset.** Only `full` is consumed today (`PanelDetailModal` view mode); `xl` is added per
the ticket's explicit ask for scale headroom. Both follow the existing
`min(<px>, calc(100vw - 32px))` pattern. Like every existing `sm`/`md`/`lg` preset, `xl`/`full`
are **width-only** — `Modal.css` has no per-size height rule today (only a blanket
`.ui-modal { max-height: 90vh }` cap; actual height is otherwise content-driven shrink-wrap), and
this change does not add one. Giving `Modal`'s size classes a fixed height would be a materially
bigger change than "extend the size scale" and would silently change every other existing `Modal`
consumer's height behavior from content-driven to fixed — directly contradicting the stated
Non-Goal below.

`PanelDetailModal` passes `size={modalMode === "view" ? "full" : "md"}` for width — a plain prop,
no new state needed, since `Modal` isn't remounted across re-renders (only the `size` class
changes on the persistent `<dialog>`) — **and separately keeps its own fixed-height CSS**, scoped
via `Modal`'s existing `className` prop (e.g. `className="panel-detail-modal"` /
`"panel-detail-modal--view"`), layered on top of `Modal`'s width-only size class exactly as
`className` already composes with `size` today (`Modal.tsx`'s `dialogClass` joins
`ui-modal`, `ui-modal--<size>`, and `className`). `PanelDetailModal.css` keeps (does not delete)
its `height: min(680px, 90vh)` / `height: min(88vh, 900px)` rules, scoped to those two classes,
as the fixed-height owner for this one consumer — every other `Modal` consumer is unaffected,
since none of them currently set a component-scoped height class. `PanelCreationModal` has no
per-mode height concern (a single `lg`-equivalent width, content-driven height, matching every
plain `Modal` consumer already) and needs no such override.

**2. Unify `onClose` as a vetoable close-request signal.** Change `Modal`'s close-button and
backdrop-click handlers to call `onClose()` directly instead of first calling
`dialogRef.current?.close()`; add a `cancel`-event listener that calls `preventDefault()` then
`onClose()` (currently absent — Escape isn't intercepted at all). Actual closing is now driven
solely by (a) the existing `[open]`-keyed effect, or (b) the consumer unmounting `Modal` in
response to `onClose`. This is backward-compatible: all 13 existing consumers already just
flip a boolean / unmount on `onClose`, calling `onClose` once instead of the current
button/backdrop-click double-fire (explicit call + the native "close" event both firing it) is
strictly safer, not a behavior change. Alternative considered: keep `Modal` eagerly self-closing
and have the two modals wrap it with their own cancel-intercepting listener — rejected, since
that's exactly the hand-rolled-outside-`Modal.tsx` lifecycle code the ticket asks to remove.

**3. Add `headerActions?: ReactNode` slot, rendered before the close button.** Mirrors the
existing `footer` slot (optional, renders nothing when omitted — no-op for existing consumers).
Needed so `PanelDetailModal`'s "Edit" button + "Unsaved changes" badge keep their current header
position. Alternative considered: move them into the body — rejected, since it visibly relocates
a persistent, always-available action, which reads as a design regression relative to today.

**4. (Superseded during implementation — see the executor's cycle-2 change request response.)**
The original plan was to move the creation wizard's step-progress eyebrow + dynamic step heading
into the body wholesale, keeping `Modal`'s header generic with no new prop needed. The evaluator
(cycle 1) caught that this produces a new, previously-invisible, visibly-stacked double heading —
`Modal`'s required `title` prop was passed the static string `"Create panel"`, rendered as a real
visible `<h2>` directly above the wizard's own per-step heading. **Resolution:** the per-step
title is now passed dynamically as `Modal`'s `title` prop instead (mirroring
`AddSourceModal.tsx`'s existing per-step-dynamic-title pattern for `Modal`-based wizards), and
only the "Step N of M" eyebrow stays body-owned (wizard-step-specific chrome `Modal`'s generic
header has no slot for). This *does* need one new, narrowly-scoped `Modal` prop after all:
optional `titleKey?: string | number`. A `useEffect` inside `Modal` (`[titleKey]`-keyed) calls
`.focus()` on `Modal`'s own title `<h2>` (`tabIndex={-1}`, `aria-live="polite"`) whenever
`titleKey` changes, restoring the original `titleRef`/`aria-live`/focus-on-step-change behavior
(plus refocus-after-dismissing-the-discard-banner) without exposing a ref into `Modal`'s
internals. Opt-in and a no-op for every other `Modal` consumer (`titleKey` omitted → effect
no-ops, unchanged behavior). A first attempt used `key={titleKey}` + native `autoFocus` instead
of this ref+effect — self-caught (during the executor's own live verification, before returning)
as unreliable: an isolated repro showed it loses a race against the browser's automatic
blur-to-`<body>` whenever a *different* focused sibling (e.g. the previous step's selected card)
unmounts in the same commit. The explicit `useEffect` runs strictly after a commit's DOM
mutations settle, so it can't lose that race.

**5. `usePanelDetailModalLifecycle` retires its dialog-ref-scoped listeners; `attemptClose`
becomes the `onClose` handler passed to `Modal`.** The `E`-key shortcut (unrelated to close
semantics) moves to a `document`-scoped `keydown` listener, gated on the component's mounted
lifetime (equivalent today, since focus is always trapped inside the open dialog).

## Risks / Trade-offs

- [Escape/backdrop double-notification today, if any consumer's `onClose` isn't idempotent] →
  Verified: all 13 consumers' `onClose` either sets boolean state or unmounts; both are
  idempotent. No consumer inspects call count.
- [Pixel-drift during CSS migration, especially `PanelDetailModal`'s two file-size-budget /
  pixel-identical constraints (`panel-detail-modal-css-structure` spec)] → Executor must keep
  each split CSS file ≤400 lines and verify `PanelDetailModal.css.test.ts`'s mobile 44px
  tap-target locks still pass; Evaluator/Skeptic take before/after screenshots.
- [Native `<dialog>` focus-wrap behavior may differ subtly from the deleted manual trap in an
  older engine] → **Superseded during implementation — see tasks.md 1.6:** this risk assumed
  native containment already wraps focus and was only asking "how closely." Task 4.5's own
  required Playwright check (below) disproved the premise entirely — native containment does
  not wrap focus back to the first/last element in *any* tested engine (probe-confirmed on two
  Chromium versions; it falls through to `<body>`), not just "differs subtly." Fixed by
  relocating the trap into `Modal.tsx` rather than relying on native behavior at all.
- [Deleting `PanelCreationModal`'s manual Tab-wrap trap removes `modal-dismiss-interactions`'s
  only automated regression coverage for its Tab/Shift+Tab wrap-around scenarios — jsdom stubs
  `showModal` and cannot exercise native `<dialog>` focus containment, so there is no jsdom
  replacement test possible] → Not purely accepted by analogy: the final-gate Skeptic (and the
  Evaluator's UI-review pass) MUST manually verify, via Playwright against the running dev
  server, that Tab from the last focusable element wraps to the first (and Shift+Tab from the
  first wraps to the last) inside the migrated `PanelCreationModal`, and record that check in
  its report. This real-browser check is the migration's replacement for the deleted jsdom
  assertions; tasks.md 4.2/4.5 make it an explicit, non-optional step rather than an implicit
  "trust the browser" assumption. **Superseded during implementation — see tasks.md 1.6/5.3:**
  the Playwright check did exactly what it was designed to do — it disproved "native containment
  handles this" (see the risk above), which is what led to relocating the trap into `Modal.tsx`.
  That shared trap then got its own jsdom coverage after all (cycle 2 CR3, task 5.3,
  `Modal.test.tsx`'s `"Tab/Shift+Tab focus trap"` describe block) — it's plain JS `keydown`
  handling once it's no longer relying on native behavior, so jsdom coverage is fully possible;
  "no jsdom replacement test possible" was only ever true under the (incorrect) native-containment
  premise.

## Planner Notes

- Chose `xl`=960px/`full`=1200px as round, `lg`(720)-relative steps; exact values aren't
  contractually significant beyond matching `PanelDetailModal`'s existing 1200px `--view` width
  — self-approved, no external dependency or breaking change involved.
- Chose not to add spec deltas for `modal-dismiss-interactions` / `panel-detail-keyboard-
  shortcuts` / `panel-detail-modal-css-structure`: their requirements describe externally
  observable behavior this change preserves exactly; only the implementation moves.
