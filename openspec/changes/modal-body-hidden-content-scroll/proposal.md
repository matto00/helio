## Why

A `position: absolute` descendant of the shared modal's scrolling body (`.sr-only` text, visually hidden inputs) with
no positioned ancestor inside the body resolves its containing block to the fixed `<dialog>`. It escapes the body's
scroll clip and stretches the dialog's own scroll extent into blank space (HEL-1763 measured 1490 vs 729 px). HEL-1763
fixed only the Output editor's groups; every other modal, and any new hidden element outside an editor group, is
still exposed.

## What Changes

- An inventory of every modal/sheet built on the shared `Modal` (and sheet/drawer scroll containers outside it),
  listing each absolutely positioned descendant of its scrolling body with measured scrollHeight vs content height,
  persisted as evidence.
- A fix chosen from that inventory: one shared rule in `Modal.css` making the scrolling body the containing block for
  its absolute descendants, unless the inventory finds a child intentionally anchored to the dialog, in which case a
  per-modal fix plus guard.
- An e2e guard that fails when a modal's dialog or body scroll extent exceeds its content, at phone and desktop widths
  in light and dark, plus a static unit guard on the shared rule.

## Capabilities

### New Capabilities

- `modal-body-scroll-extent`: a modal's scroll extent is bounded by its visible content; hidden absolutely positioned
  content inside the body never adds blank scroll.

### Modified Capabilities

(none)

## Non-goals

- Changing popover/menu/select positioning strategy (portals, `position: fixed`).
- Visual redesign of any modal; footer layout; chart preview sizing.
- Removing HEL-1763's `.output-editor-sheet__group` rule (kept; it becomes redundant but harmless).

## Impact

Frontend CSS only (`frontend/src/shared/ui/Modal.css`, possibly per-modal CSS), a new e2e spec, a unit test. No
backend, API, schema or migration change.
