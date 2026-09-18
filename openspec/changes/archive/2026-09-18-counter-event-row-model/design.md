## Context

The `form` panel submit path (HEL-1087) already appends one row per submit through
`DataSourceRepository.appendBuiltRow`, which builds the row via a `FormSubmission.buildRow`-shaped closure, run
under `lockSource` so a concurrent schema change (or concurrent append) can never race the build. `dataset_rows`
already carries a `seq BIGINT` monotonically assigned per source under that same lock (`V106__dataset_rows.sql`).
`FormFieldSpec` already has a `step: Option[Double]` field (anticipating the counter's step size, owned by
HEL-1088) but no `counter` control. No occurred_at/delta concept exists anywhere in the codebase today.

An `aggregate` pipeline op with a `sum` function already exists (`PipelineAnalyzeService.inferAggregate`), so
"running total derivable by pipeline" requires no new pipeline capability — only a dataset whose declared schema
exposes `delta` as a summable numeric column.

## Goals / Non-Goals

**Goals:**
- A `counter` control that appends `{occurred_at, delta, value}`, `occurred_at` always server-assigned.
- No code path in this ticket computes or persists an authoritative running total.
- Ordering survives same-millisecond collisions via the existing `seq` tie-breaker — no new column.
- Prove (not merely assert) that a sequence of rapid increments/decrements yields one row per submission, and that
  an `aggregate`/`sum` step over `delta` reproduces the true total independent of any stored `value`.

**Non-Goals:**
- The compact `+`/`-`/step-size UI chrome (HEL-1088) — this ticket makes `counter` a legal `FormFieldSpec.control`
  and defines its wire/row contract; it does not render one.
- Materializing a server-computed running `value` snapshot. Considered and rejected (see Decision 2) — the AC's
  "MAY be recorded as a convenience snapshot" is satisfied by leaving `value` a passthrough of whatever (if
  anything) the client sends, never a server-computed read of prior rows.
- A new `PanelKind` (spec Decision 4 — counter is a `form` panel configuration, not a sibling kind).

## Decisions

### Decision 1 — `counter` is a new `FormFieldSpec.control`, numeric-only

Added to `FormFieldSpec.ValidControls` and `FormFieldSpec.FittingControls` for `IntegerType`/`FloatType` only (a
counter field's declared dataset column must be numeric — it does not make sense against `StringType` etc.).
`FormSubmission.buildRow` gains a `counter`-specific branch parallel to its existing `file`/`select` branches.

### Decision 2 — `value` is never server-computed from prior rows; `occurred_at` is always server-assigned

**Alternative considered:** read the dataset's prior rows for the same source *inside* the existing `lockSource`
critical section (`appendBuiltRowAction` already reads `existingRows` right after calling `build`) and compute a
running-total snapshot for `value` before insert.

**Rejected because:** it re-introduces exactly the failure mode the ticket exists to prevent. A server-computed
running `value`, even if labelled "snapshot," becomes indistinguishable from a stored authoritative total the
moment any reader (a panel, a pipeline default sort) prefers it over summing `delta` — and it adds real complexity
(the `build` closure signature does not currently see `existingRows`; `appendBuiltRowAction` calls `build` BEFORE
reading them, at line 669 vs 672 of `DataSourceRepository.scala`, so wiring this through means reordering a
lock-held read path for a value whose only sanctioned use is disposable UI hinting).

**Decision:** `value` is a plain pass-through field like any other configured field — if the client (i.e. HEL-1088's
UI, optionally) sends a `value`, it is stored verbatim as an inert snapshot; if omitted, the cell is `JsNull`. No
server logic ever reads it back as authoritative. `occurred_at`, by contrast, MUST always be server-assigned
(`Instant.now()` at build time, inside the lock) — a client-supplied value for that field is ignored outright
(D3, form-panel-submit delta spec) since a spoofable timestamp would corrupt ordering, which this ticket's AC
explicitly protects.

### Decision 3 — ordering tie-break reuses `dataset_rows.seq`, no new column

`seq` is already assigned monotonically per `data_source_id` inside the same `lockSource` critical section the
counter's insert runs under (`insertAppendedRowsAction`, `maxExistingSeq + 1 + idx`). Two rows with millisecond-
identical `occurred_at` are already guaranteed distinct, gapless `seq` values in submission order — sorting by
`(occurred_at, seq)` is sufficient and requires no schema change.

### Decision 3a — `occurred_at`/`value` are injected by convention-named declared fields, not configured form fields

A counter-configured `form` panel has exactly one `FormFieldSpec` (`control = "counter"`, `sourceField` = the
dataset's delta column, e.g. `"delta"`). The dataset's declared schema additionally carries two sibling columns
literally named `occurred_at` and `value` (chosen by whoever declares the dataset's schema — same mechanism as any
other declared field name; this ticket does not enforce the literal string, it looks them up by name if present).
`FormSubmission.buildRow`, when the config contains a `counter`-control field, injects: `occurred_at` = server
`Instant.now()` for any declared field literally named `occurred_at`; `value` = the raw supplied `values("value")`
if the client sent one (pass-through, Decision 2) else `JsNull`, for any declared field literally named `value`.
Both injected fields are excluded from the normal "unconfigured declared field must be optional" rule (D3/vii-viii
in `FormSubmission.buildRow`'s existing code) specifically when a counter field is present — this is the one
special case this ticket adds to that method.

**Failure mode: the bound dataset doesn't declare `occurred_at`/`value`.** `FormSchemaConsistency.check` (the
existing author-time/write-time consistency gate, enforced both server-side in `PanelService` and mirrored
client-side by HEL-1084's `computeFormIssues`) is extended with a `counter`-specific rule: when `config.fields`
contains a `control == "counter"` entry, the bound dataset's declaration MUST also contain fields literally named
`occurred_at` (type `TimestampType`) and `value` (numeric, and `required` must be `false`/absent — a nullable
snapshot can never be a required column). Violating either is a same-shaped `Left(message)` as every other
consistency violation this object already reports — this closes the "silently breaks the row-shape guarantee"
gap: a counter field can never be saved bound to a dataset that can't structurally support the AC's row shape.

Also extends the fitting-controls check that `FormSchemaConsistency.checkControlFitness` already runs for the
`counter` field's own `sourceField`/`delta` column — that check already exists structurally (Decision 1) and needs
no separate extension.

### Decision 4 — no migration needed

`dataset_rows` (V106) already stores an arbitrary positional JSONB row against whatever schema a source declares.
A counter-configured dataset simply declares three fields (`occurred_at: timestamp`, `delta: integer|float`,
`value: integer|float`, nullable) through the existing dataset-schema declaration mechanism (`dataset-schema-api`)
— no new table, column, or migration is required by this ticket.

## Risks / Trade-offs

- Leaving `value` a client pass-through (Decision 2) means a client that never sends `value` gets an always-null
  snapshot column — acceptable per the AC's own "MAY", and strictly safer than the rejected alternative.
- `occurred_at` precision is JVM/Postgres `timestamptz` (microsecond) but ordering correctness depends on `seq`,
  not on sub-millisecond timestamp precision — this is a deliberate simplification per Decision 3, not a gap.
