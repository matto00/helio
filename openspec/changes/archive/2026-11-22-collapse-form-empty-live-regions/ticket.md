# HEL-1819: Multi-field form card: empty alert/status live regions take 12 px gap slots each (24 px of blank space)

## Description

Follow-up of HEL-1804 (PR #1220, merged as 787a283e9). HEL-1804 removed the blank space the compact counter's empty
live regions left: while a region is empty it is `position: absolute` inside a `position: relative` layout, so it
takes no gap slot. The region stays mounted with its role, and returns to the normal flow when a message arrives. See
`frontend/src/features/panels/ui/form/CounterControl.css`.

The multi-field form has the same problem. In `.form-panel-view__fields`, the empty `.form-panel-view__alert` and
`.form-panel-view__status` regions each take a 12 px gap slot, so a standard form card is 24 px taller than its
content.

Do:

- Apply the same pattern to the multi-field form. Keep both regions mounted with their roles, and don't change
  `display` or `visibility`.
- Extend `e2e/hel1791-compact-counter-stack-height.spec.ts` (or its per-kind height checks) rather than adding a heavy
  new spec. (Driver sequencing: HEL-1826 is editing that spec; only edit it after HEL-1826 merges, else put the
  height check in a small new spec and say so in the PR.)

## Scope addition (owner ruling 2026-11-23, Linear comment on HEL-1819, from HEL-1818's final review, PR #1238)

After a rejected compact counter step, a later click can fail with no server response while its reconciliation fetch
succeeds. The control then stays `aria-invalid="true"` and red, with no visible text and an empty description, until
a later success clears it. The stale invalid state comes from HEL-1169: a failure with no response never clears the
field error. Before HEL-1818 the old error text stayed visible; now the form alert carries the message, so nothing is
shown.

Fix: clear the field's error (`values.setExternalErrors`) when reconciliation succeeds.

## Acceptance criteria

- [ ] A test that fails on the current code: no blank gap below the last field while the regions are empty, at 390,
      768 and 1100 px (sidebar open), light and dark.
- [ ] Status and alert messages still render and are announced.
- [ ] Other panel kinds keep their height, including the compact counter.
- [ ] (Scope addition) A test that fails first: a rejection, then a no-response failure, then a successful reconcile
      leaves the control not `aria-invalid` and not red.
