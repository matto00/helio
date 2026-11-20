# HEL-1777: Draft mode: Output schema chips show the saved analysis, not the draft's columns

## Description

While a pipeline draft is open, the "Output schema" chips above the "Rows after step N" grid still show the saved
analysis, but the grid shows the draft. A draft rename makes them disagree: the chips say `region` while the grid
header says `zone`. A renamed column also has no type caption. This was already true on main before HEL-1732.

**Expected:** during a draft, the chips match the grid's columns, names and types, with no extra request (the standing
no-request rule for draft mode).

## Acceptance Criteria

- A test that is red on main: a draft rename shows the new name in the chips.
- The chips use the same draft column order and types as the grid.
- No new network request while editing a draft (hel1631-draft-mode and hel1632-live-output guards stay green).

## Agent notes

- HEL-1732 evidence: `.concertino/runs/HEL-1732/evidence/` in the main checkout; its archived change
  `openspec/changes/archive/2026-11-18-draft-step-schema-column-order/`.
- Related server-side gap: the draft-preview NDJSON `step` line `schema` arrives in hash order (out of scope unless the
  chips cannot be correct without it; then escalate rather than widen).
