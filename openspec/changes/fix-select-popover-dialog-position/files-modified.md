## Files modified

- `frontend/src/features/panels/ui/PanelCreationModal.css` — root-cause fix: changed
  `.panel-creation-modal[open]`'s entrance-animation fill mode from `both` to `backwards`
  (mirroring the shipped `Modal.css` fix, commit `d7fb3816`), so the dialog no longer retains a
  `transform` at rest and stops being a containing block for the portalled `position: fixed`
  chart-type `Select` popover.
- `frontend/src/features/panels/ui/PanelCreationModal.css.test.ts` — new regression test: a
  static CSS-source assertion (mirrors `shared/chrome/ActionsMenu.css.test.ts`) that
  `.panel-creation-modal[open]`'s animation uses `backwards` (not `both`/`forwards`), and that
  the `to` keyframe still resolves to `transform: none` (resting-state visual parity). Confirmed
  to fail against the pre-fix CSS and pass against the post-fix CSS.

## Root cause (systematic-debugging Iron Law)

- **Root cause:** `.panel-creation-modal[open]` (`PanelCreationModal.css`) ran its entrance
  animation with `animation-fill-mode: both`, which keeps the animation's final `transform`
  keyframe applied after the animation ends; a non-`none` `transform` on the `<dialog>` makes it
  a containing block for `position: fixed` descendants, so the portalled chart-type `Select`
  popover's viewport-computed fixed coordinates resolved against the dialog's box instead of the
  viewport — displacing it by the dialog's origin (~283px at 390×844, per the ticket).
- **Probe:** minimal standalone HTML/CSS repro (dialog + `.fixed-panel` portal target,
  `showModal()`, `animation-fill-mode` templated in) driven headlessly via Playwright Chromium at
  a 390×844 viewport, reading `getComputedStyle(dialog).transform` and the panel's
  `getBoundingClientRect()` after the animation settles, for both `fillMode=both` and
  `fillMode=backwards`.
- **Probe output:**
  ```
  fillMode=both:      {"dialogTransform":"matrix(1, 0, 0, 1, 0, 0)","panelTop":481,"panelLeft":21}
  fillMode=backwards: {"dialogTransform":"none","panelTop":100,"panelLeft":20}
  ```
  With `both`, the dialog's computed `transform` is non-`none` at rest and the fixed-position
  panel is displaced from its intended `top:100/left:20` coordinates. With `backwards`, the
  dialog's `transform` resolves to `none` and the panel lands exactly at its intended
  coordinates — confirming the hypothesis and confirming the fix removes the containing block.

## Audit (task 1.2)

Checked every `<dialog>` and every `Select`/`usePortalPopover` call site for the same
lingering-transform condition:

- `PanelCreationModal.css` — **afflicted** (fixed above).
- `Modal.css` (shared `<Modal>` primitive, used by `AddSourceModal`, `CreatePipelineModal`,
  `PipelineShareDialog`, etc.) — already `backwards` since commit `d7fb3816`; unaffected.
- `PanelDetailModal.css` / `.sections.css` / `.appearance.css` / `.binding.css` / `.mobile.css` —
  no `animation`/`[open]` rule at all (no entrance-animation transform); unaffected regardless of
  the `Select`-heavy editors it hosts.
- `ActionsMenu.tsx`, `UserMenu.tsx`, `DashboardAppearanceEditor.tsx` (the other
  `usePortalPopover` consumers) — all `createPortal(..., document.body)` unconditionally; never
  portal into a `<dialog>`, so the containing-block condition doesn't apply.
- `Select.tsx` (`shared/ui/Select.tsx:51`) — the only conditional portal target:
  `triggerRef.current.closest("dialog[open]") ?? document.body`. Every dialog it could resolve to
  is covered by the three bullets above.

Result matches the design doc's prediction exactly: only `PanelCreationModal.css` was afflicted.
