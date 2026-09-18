# HEL-1089: Counter event-row model: append `{occurred_at, delta, value}`

## Description

A counter click **appends an event row, it does not mutate a value.** This is what makes time-series and metric Outputs work off the same dataset for free, and keeps every write an append.

Per the v0.8 design spec (`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`, Decision 5, Epic 2): "Input/counter" is a configuration of the existing `form` panel — one numeric field with an increment affordance, not a sibling PanelKind. A counter click appends `{occurred_at, delta, value}` to the bound dataset source, through the same submit path HEL-1087 already wired (`POST /api/panels/:id/submit` → `FormSubmission.buildRow` → `DatasetRowValidator`).

This ticket owns the **data model and append-semantics half**: the row shape, the delta/running-value computation, and the append-not-mutate guarantee. It does not own the compact `+`/`-` chrome UI (sibling ticket HEL-1088).

## Acceptance Criteria

- A sequence of increments and decrements produces **one row each** — no coalescing, no lost events under rapid/concurrent clicks.
- Each appended row has the shape `{occurred_at, delta, value}`:
  - `occurred_at`: a timestamp identifying when the event occurred, with enough precision/tie-breaking that two events in the same millisecond remain distinguishable and correctly orderable.
  - `delta`: the signed increment/decrement amount for this event (e.g. `+1`, `-1`, or a configured step).
  - `value`: MAY be recorded as a convenience snapshot of the running total at that point, but is **never the source of truth** — the running total must be independently **derivable from the `delta` sequence by pipeline** (e.g. a running-sum/aggregate step), not read back as stored authoritative state.
- A time-series Output over the dataset renders the append sequence.
- No stored/mutated running-total column or row is written or updated in place — every counter interaction is an INSERT, never an UPDATE, of the counter's event stream.

## Non-Goals

- The compact `+`/`-`/step-size UI chrome (HEL-1088).
- A new sibling `PanelKind` — this reuses the existing `form` PanelKind's submit path.
