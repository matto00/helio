## Run rules (driver brief; see ticket.md)

- Red first: write each item's test, run it on the unfixed code, record the red output, then fix.
- jest/Playwright at most 2 workers under `nice -n 19`; full Playwright suite under the e2e flock; `timeout: 600000`.
- Scratch + screenshots: `/home/matt/Development/helio/.concertino/scratch/HEL-1668/`; Playwright `--trace retain-on-failure`.
- Never kill/pkill/pgrep/killall; stop servers only with `scripts/concertino/stop-servers.sh`.
- Do not touch `frontend/src/app/App.tsx`, `e2e/hel1579-*`, `e2e/support/apiRequestCounter.ts` (HEL-1620); keep hover values (HEL-1669).
- Delete created test users/pipelines by exact id.

## Standing Constraints

- [C1] After the toast portal re-targets into or out of a modal, every toast message (deferred race-window ones AND newly pushed ones) is held until the new live regions have been connected and empty for the double-rAF ready flag; none is inserted earlier.
- [C2] When moving :hover fill selectors into @media (hover: hover), preserve the relative source order of equal-specificity rules (notably PipelineSpine.css:189, :344, :356) so cascade results on hover-capable devices are unchanged.

### Frontend

## 1. Step deep link (D1)

- [x] 1.1 Extract the `?step=` id-or-render-key resolver from `hooks/useStepSelection.ts` into a shared pure function
- [x] 1.2 `PipelineDetailPage` captures the initial `?step=` at mount and marks it consumed at the first steps load in any layout; phone opens it only if phone at that load
- [x] 1.3 Derive `?step=` from the open step id in one replace-sync effect, gated until the deep link is consumed (all open/close/removal/id-swap paths), preserving other params

## 2. Toasts above modals (D2)

- [x] 2.1 Track an open-order stack of modal dialogs (MutationObserver on `open`, `:modal` guarded for jsdom)
- [x] 2.2 `ToastViewport` portals visual stack + live regions into the most recently opened modal, else `document.body`
- [x] 2.3 On re-target commit empty regions first; after a full frame (rAF inside rAF) insert toasts committed < 100 ms before the re-target
- [x] 2.4 Focus moves to the dialog's first focusable when a focused toast is removed inside a modal
- [x] 2.5 Per-toast deadline + entered flag (module map by id) so a remount neither restarts the timer nor replays the entrance; a mid-exit toast completes

## 3. Escape scoping (D3)

- [x] 3.1 `usePortalPopover` Escape handler calls `preventDefault()` only (no `stopPropagation()`) when it closes the panel

## 4. Schema panel placement (D4)

- [x] 4.1 Add opt-in `place(panel, triggerRect)` to `usePortalPopover` (layout effect after mount + on resize, hidden until placed); non-opting consumers unchanged
- [x] 4.2 Declare `--schema-panel-max-width/-max-height/-edge-margin` on the panel class, use them in its CSS, read them in `place`; delete the px constants
- [x] 4.3 `place`: measured width clamp, `scrollHeight` vs cap, above-if-fits rule, below-room ends at the rendered `.bottom-nav` outside a dialog

## 5. Hover gating (D5)

- [x] 5.1 Move only the `:hover` fill selectors into `@media (hover: hover)` (split mixed rules), values unchanged; leave the D5 reveal allowlist units (:207, :326-330, compact block :459-486 whole) ungated
- [x] 5.2 The hel1582 hover-contrast test (and HEL-1669's Dry run hover test) run in a non-touch, hover-capable 375x812 context because hover fills now apply only on hover-capable pointers (driver lifted the do-not-edit rule for this change; HEL-1669 merged first, so its ungated light `.mobile-pill` hover rule is gated here, values untouched)

## 6. Copy (D6)

- [x] 6.1 Export the rendered label text from `SourceSampleLabel`; `SpineSourceCard` omits its kind meta only when that text starts with the kind label
- [x] 6.2 `SpineOutputs`: "from <subtitle>" / "from the pipeline's source"; update existing tests asserting "off …"
- [x] 6.3 `SpineLastRunMeta`: the row count is complete or absent (never cut), relative time never shrinks; title unchanged; the header meta keeps `min-width: 15ch` and is hidden at a page container <= 685px (was 600px); the phone source-card label takes a top margin when the kind meta is omitted (expander tiling)

### Tests

## 7. Tests (each red on origin/main before its fix, except 7.7 which is a mutation-proven guard)

- [x] 7.1 Jest: resolver + phone URL sync (open, close, removal-close, id swap, unknown id, desktop→phone no sheet, `outputId` preserved)
- [x] 7.2 Jest: `usePortalPopover` Escape prevents default without stopping propagation; `place` math (short panel above, tall panel roomier side); non-opting consumers' tests green
- [x] 7.3 Jest: CSS-source guard — every `:hover` gated or on the reasoned reveal allowlist; no mixed gated/non-hover selector lists
- [x] 7.4 Jest: source card "Static" once in loaded, truncated, loading, unavailable states; Output card "from …"; last-run spans
- [x] 7.5 e2e `hel1668-*`: deep link (incl. desktop→phone resize opens none), toast above sheet (visible, dismiss clickable, region-before-message ordering proven by DOM check + rAF frame counter, gap >= 2, single-rAF mutation fails, not over sheet controls), Escape scoping (schema panel in sheet + ActionsMenu in a Modal), sticky hover (`hasTouch`+`isMobile`), compact spine at 1024×800 touch: tapped (selected) row tones identical to origin/main in light+dark and menu opens, toast timer not restarted on re-target, long row count (phone + desktop 1000/1280) — at 375, 390, 768, light and dark, screenshots in scratch
- [x] 7.6 e2e: pinned-fixture schema panel above at 1280×800 and 1000×800 (trigger top recorded, red on origin/main); tall-content roomier side; phone below-placement clears the bottom nav at 375 and 768, light and dark
- [x] 7.7 e2e: editor phone sample refresh at 375 and 768, both themes; mutation-proven
- [x] 7.8 Re-run hel1582, hel1608, hel1648 and toast specs green; full gates (lint, typecheck, jest) green
