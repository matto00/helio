## Why

`PanelCreationModal` and `PanelDetailModal` each hand-roll their own `<dialog>` lifecycle
(`showModal`/`close`, backdrop-click, Escape/cancel handling, and — for the creation modal — a
manual Tab-wrap focus trap) instead of using the shared `Modal` primitive. This causes subtly
divergent animation/backdrop/focus-trap behavior from every other modal in the app, and the
duplicated lifecycle code is a maintenance and consistency liability. `Modal` currently only
supports `sm`/`md`/`lg`, which doesn't cover these two wizard/detail-scale surfaces.

## What Changes

- Extend `Modal`'s size scale with `xl` and `full` presets, sized to match the two target
  surfaces' current footprints (no unexpected resize).
- Unify `Modal`'s three dismiss vectors (close button, backdrop click, Escape) into a single
  "close requested" signal via `onClose`, and stop `Modal` from eagerly closing the native
  `<dialog>` itself before that signal is handled. This is required infrastructure so a
  consumer can veto a close attempt (e.g. an unsaved-changes guard) — both target modals already
  do this today via hand-rolled code, and migrating them must not regress it.
- Add an optional `headerActions` slot to `Modal` (mirroring the existing `footer` slot) so
  `PanelDetailModal`'s persistent "Edit" button and "Unsaved changes" badge keep their current
  header position.
- Add an optional `titleKey` prop to `Modal` so a per-step wizard can refocus (and, via
  `aria-live`, re-announce) its title `<h2>` on demand without a ref into `Modal`'s internals —
  opt-in, no-op for every consumer that doesn't pass it.
- Migrate `PanelCreationModal` onto `Modal` (`size="lg"`, matching its current 720px width),
  passing the per-step heading dynamically as `Modal`'s own `title` (mirroring
  `AddSourceModal.tsx`'s existing per-step-dynamic-title pattern), keeping only the "Step N of M"
  eyebrow body-owned, and deleting its now-redundant manual focus trap.
- Migrate `PanelDetailModal` onto `Modal` (`size` toggling `"full"` in view mode / `"md"` in
  edit mode, matching current pixel dimensions), retiring `usePanelDetailModalLifecycle`'s
  dialog-ref-scoped listeners in favor of the unified `onClose` handler, and relocating the `E`
  edit-mode keyboard shortcut to a document-scoped listener.
- Remove every hand-rolled `<dialog>` element outside `shared/ui/Modal.tsx`.

## Capabilities

### New Capabilities

- `modal-size-scale`: `Modal`'s size prop supports `sm`/`md`/`lg`/`xl`/`full`, with `xl`/`full`
  sized for wizard/detail-scale content.

### Modified Capabilities

- `panel-detail-modal`: unifying `Modal`'s three dismiss vectors (Decision 2) means the close
  (✕) button can no longer be distinguished from Escape/backdrop click inside a shared `onClose`
  callback, so its previously-distinct "always closes outright from edit mode" behavior could not
  survive the migration — it now returns to view mode instead, matching Escape/backdrop/Cancel
  (both in the clean case and after confirming the discard warning). See the spec delta at
  `specs/panel-detail-modal/spec.md` (MODIFIED: "Modal dismisses on Escape, backdrop click, and
  Cancel"). This was not anticipated at proposal time — caught during implementation by a
  fresh-run test failure, not guessed — and is the one behavior change this migration was unable
  to avoid; see Non-goals below.

(`modal-dismiss-interactions`, `panel-detail-keyboard-shortcuts`, and
`panel-detail-modal-css-structure` remain unmodified — all three specify externally-observable
behavior that this change preserves exactly; only the implementation providing it moves onto
`Modal`.)

## Non-goals

- No change to either modal's business logic (panel creation flow, panel field editing, save
  persistence, or discard-warning triggering conditions — *what* counts as dirty and *when* a
  warning shows are unchanged). The one exception, not a business-logic change but a direct,
  unavoidable consequence of Decision 2: `PanelDetailModal`'s post-dismiss *destination* is now
  unified across all of its `Modal`-owned dismiss vectors (see Modified Capabilities above) —
  the close (✕) button no longer closes the modal outright from edit mode, it returns to view
  mode like Escape/backdrop/Cancel already did.
- No visual redesign — footprints, spacing, and animation timing stay pixel-equivalent.
- No change to any other existing `Modal` consumer's behavior.

## Impact

- `frontend/src/shared/ui/Modal.tsx`, `Modal.css`, `Modal.test.tsx` (size scale, close-request
  unification, `headerActions` slot).
- `frontend/src/features/panels/ui/PanelCreationModal.tsx`, `PanelCreationModal.css` (migration).
- `frontend/src/features/panels/ui/PanelDetailModal.tsx`, `PanelDetailModal*.css`,
  `frontend/src/features/panels/hooks/usePanelDetailModalLifecycle.ts` (migration; hook likely
  retired or slimmed).
- Associated test files for all of the above.
