## Why

A compact counter form card (one `counter` field) renders its always-mounted `role="alert"` and `role="status"`
paragraphs as flex items of `.form-panel-view__compact-counter`, a column with `gap: var(--space-4)`. Even when empty
(zero height) each one still claims a 16 px gap slot, so the phone panel stack shows a band of blank space under the
counter/caption. HEL-1791 made the card size to its content, which exposed the gap.

## What Changes

- While a compact counter's alert/status region is empty it takes no space in the card's layout (no gap slot); when it
  holds a message it renders in flow exactly as today.
- Both regions stay mounted with their roles at all times (no conditional mount, not `display: none`, not
  `visibility: hidden`), so a later message is still announced.
- The HEL-1791 e2e spec gains a red-first blank-space assertion and a message-visible test; per-kind heights are
  recorded before and after.

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-panel-rendering`: the compact counter layout reserves no space for empty live regions.

## Impact

- `frontend/src/features/panels/ui/form/CounterControl.css` (compact layout rule), possibly a jest CSS guard.
- `e2e/hel1791-compact-counter-stack-height.spec.ts` (extended, not a new heavy spec).
- Frontend only; no API, schema or migration change.

## Non-goals

- The standard (multi-field) form layout's live regions (`.form-panel-view__fields`, 12 px gap). Its height is one of
  the "other panel kinds" that must not change here.
- Any change to message text, timing or the live regions' markup.
