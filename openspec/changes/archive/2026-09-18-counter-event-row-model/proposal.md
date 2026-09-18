## Why

The `form` panel's submit path (HEL-1087) appends whatever `{sourceField: value}` map the client sends, one column
per configured field. A counter (design spec Decision 4/5) is a configuration of that same panel, but its write is
conceptually different: a click must append an **event**, `{occurred_at, delta, value}`, never mutate a stored
total. Nothing in the shipped submit path today distinguishes "the user typed a value" from "the user recorded a
delta", so a counter built on it today could accidentally shipped a stored running total.

## What Changes

- Add `"counter"` to `FormFieldSpec.ValidControls`/`FittingControls` (Integer/Float), a numeric-only control.
- `FormSubmission.buildRow` gains counter-specific submit semantics: the client sends only a signed `delta`; the
  server sets `occurred_at` (never client-supplied — closes a spoofed-ordering hole) and computes `value` as a
  best-effort convenience snapshot of the running total, computed from the dataset's own prior rows under the same
  append lock `DataSourceRepository.appendBuiltRow` already takes — never read back as authoritative afterward.
- A counter-configured dataset field declares three columns: `occurred_at` (timestamp), `delta` (integer/float),
  `value` (integer/float, nullable) — declared like any other dataset schema, no new declaration mechanism.
- Ordering for same-millisecond events relies on the existing `dataset_rows.seq` monotonic tie-breaker
  (`V106__dataset_rows.sql`) — already assigned per-append under the same lock; no new column needed.
- Verify (not build — already shipped) that an `aggregate`/`sum` pipeline step run over `delta` reproduces the
  running total independently of the stored `value` snapshot, satisfying "derivable by pipeline, not stored".

## Capabilities

### New Capabilities
- `counter-event-row-model`: the append-only `{occurred_at, delta, value}` row contract for a counter-configured
  form field, and the guarantee that the running total is pipeline-derivable rather than stored/mutated.

### Modified Capabilities
- `form-panel-submit`: submit-time contract gains the `counter` control's delta-only request shape and
  server-computed `occurred_at`/`value`.

## Impact

- Backend: `FormFieldSpec` (control enum), `FormSubmission.buildRow` (counter branch), `DataSourceRepository`
  (read last `value`/append under lock — reuses the existing append-lock method, no new locking primitive).
- No new migration: `dataset_rows` and its `seq` tie-breaker already exist (V106).
- Frontend: none in this ticket — the compact `+`/`-` counter chrome is HEL-1088's scope. This ticket only needs the
  `counter` control to be a legal, round-trippable `FormFieldSpec.control` value so HEL-1088 has something to build
  the chrome against.

## Non-goals

- The `+`/`-`/step-size UI chrome (HEL-1088).
- A new sibling `PanelKind` (spec Decision 4 — counter stays a `form` panel configuration).
