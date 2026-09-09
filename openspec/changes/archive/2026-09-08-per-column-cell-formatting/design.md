# Design — HEL-469 Per-column cell formatting

## Context

Base `origin/main` @ `9e995f69`. `formatCell` (`DataGrid.tsx:128-132`) renders `—` for null and
stringifies otherwise. `ColumnDef.render(row, value)` (`:31`) exists as a per-column override with
**no table-panel consumer** — the hook is already there.

HEL-448's own comment on `TableOutputConfig.columnSort` names this ticket:

> *HEL-451 (columnFilters), HEL-465 (pinnedColumns) and HEL-469 (columnFormats) should each land as
> their OWN flat sibling here too, never nested inside this field or a shared container.*

Reason: `OutputService.mergeConfig` deep-merges only four hardcoded chart keys, so any nested
container is replaced wholesale on every unrelated patch.

## Decisions

### D1 — Sort reads RAW values, and that is guarded, not observed

The ticket's central AC. Verified true **today**:
- `TableRenderer.tsx:309` — `getValue: (row) => getSortValue(row[col.key])`, the raw row value.
- `DataGrid.tsx:803` — `{col.render ? col.render(row, value) : formatCell(value)}`, the ONLY
  consumer of `render`.

Two separate paths over one raw value, so a `currency` column displaying `$1,234.56` sorts on the
underlying number and `$9.99` cannot sort above it.

**CORRECTION (round 1): "two separate paths" OVERCLAIMS, and the exception is the dangerous one.**
`getSortValue` (`TableRenderer.tsx:97-114`) is separate for primitives — null/number/numeric-string
take the numeric branch, other strings pass through — but its FALLTHROUGH branch at `:130` calls
`formatCell(value)` DELIBERATELY, with HEL-448's own comment: *"so the sort key matches the rendered
cell text — `String({})` collapses every object to the same `[object Object]` tie, while
`formatCell` JSON-stringifies it."*

So sort already routes OBJECT values through a formatter. Two consequences:

1. **HEL-448's stated rationale breaks the moment this ticket lands.** Once a column has a format
   spec, the rendered cell text is `render(row, value)`, not `formatCell(value)` — so "the sort key
   matches the rendered cell text" stops being true. A future contributor restoring that consistency
   would re-point `getSortValue` at the new per-column formatter. **That is precisely the leak this
   ticket exists to prevent, and it would arrive as a tidy-up.**
2. **The currency guard would NOT catch it.** Currency values are numbers, so they take the numeric
   branch at `:115`/`:124` and never reach `:130`. The guard as first specified tests the branch that
   cannot leak and ignores the branch that can — the "check what a condition ADMITS, not only what it
   excludes" failure, again.

**Decision: `getSortValue`'s object branch stays on `formatCell` and is NOT re-pointed at the
per-column formatter.** Sorting must not depend on display formatting; a stable JSON sort key for
object cells is the right behaviour even though it no longer matches the rendered text. The now-stale
half of HEL-448's comment must be corrected in the same change, so the next reader does not
"restore" the broken invariant.

**That establishes the property holds now, not that it will hold.** Routing sort through the
rendered value would look like a simplification, and this component has already produced TWO
numeric-ordering defects — the second introduced by the fix for the first (HEL-448 rounds 3-4). So
the deliverable is a **mutation-failable guard**: a test over a currency column whose formatted text
sorts differently from its raw values (`9.99` vs `1234.56` → `$9.99` vs `$1,234.56`), which goes RED
when `getValue` is pointed at the rendered value. An observation in a report protects nothing.

`TableRenderer` therefore builds `render` per column and **does not touch `sortColumns`**. That
separation is the design, not an implementation detail.

### D1b — The mutation site is the CALL SITE, not inside `getSortValue`

Round 1's guard was still not failable, for a reason worth stating precisely: `getSortValue` takes
only a VALUE, so "point it at the rendered value" is not expressible inside it. **The realistic
tidy-up is at the call site** — `TableRenderer.tsx:309`,
`getValue: (row) => getSortValue(row[col.key])`, re-pointed at the per-column formatter.

Mutating THERE makes the **currency guard genuinely red**: a currency column's raw values are
numbers, so under the mutation they become `"$9.99"` / `"$1,234.56"` strings and sort lexically,
putting `$9.99` above `$1,234.56`. **The fixture was never the problem — the MUTATION was.** That is a distinct failure from a bad
test: the test was sound and the procedure for proving it was not, so the guard would have been
reported as verified while proving nothing. Round 1 diagnosed the wrong half and added an object
guard to compensate for a problem that did not exist where it was thought to be.

**Honest limit on the object guard.** Re-pointing the call site at the formatter changes an OBJECT
cell's sort key only if the formatter's object output differs from `formatCell`'s. D3 defines that
fallback AS `formatCell`, so the two coincide and the object assertion pins the contract but is
**not independently mutation-failable**. Stated rather than papered over: the currency guard proves
the invariant; the object assertion documents the intended contract.

### D1a — The format control lives in the Output editor, and persists via its Save path

Two persistence surfaces exist and the artifacts must name ONE:
- `TableRenderer`'s in-panel minimal patch `updateOutput(outputId, { config: { … } })`, used by
  HEL-448 for sort (a per-interaction write with a debounce and an owner pre-check);
- the Output editor's `buildOutputConfig` (`buildOutputConfig.ts:68-69`), which emits
  `{ fieldMapping, columnOrder }` for a table on Save.

**Decision: the Output editor.** The ticket asks for the control on "the same surface that
configures density/column-order", which is the editor, so `buildOutputConfig` must emit
`columnFormats` and `TableRenderer` only READS the spec and applies it. The in-panel minimal-patch /
debounce / session-local-degrade machinery does NOT apply here, because there is no in-panel format
control to write from — carrying that language over would have specified a write path nothing uses.

**Verified safe, not assumed:** `buildOutputConfig` omits `columnSort` entirely today, and that does
NOT wipe a persisted sort, because `OutputService.mergeConfig` is `existing.fields ++ patch.fields`
— a shallow merge, so an omitted key is left intact. The same property is what makes `columnFormats`
survive an unrelated editor Save, and what makes HEL-448's minimal patch correct. `buildOutputConfig`
must therefore CARRY `columnFormats` through rather than dropping it.

### D2 — A table-specific format vocabulary, aligned with `MetricFormat` where they overlap

`MetricFormat` already ships (HEL-876, `outputConfigTypes.ts:50`):
`"number" | "integer" | "currency" | "percent"`, applied by `formatMetricValue`
(`MetricRenderer.tsx:17-32`).

The domains genuinely differ — a table column can hold a date; a metric can be a percent — so a
shared enum would force each surface to carry values it cannot honour. Decision: a **separate
`TableColumnFormat`**, reusing the SAME NAMES where they overlap (`number`, `currency`) so the two
surfaces do not drift into synonyms, and adding `date` and `text`. Do NOT rename or re-point
`MetricFormat`; do not change `MetricRenderer`.

**Two divergences from the existing formatter, taken deliberately:**

1. `formatMetricValue` hardcodes `currency: "USD"` (`MetricRenderer.tsx:28`). This ticket's spec
   carries an explicit currency code, because a hardcoded USD is simply wrong for any other
   currency and the ticket asks for the option. Whether `MetricRenderer` should follow is
   **HEL-1042** (Medium, parented to HEL-346) — do NOT absorb it.
2. Both existing formatters call `new Intl.NumberFormat(undefined, …)` — inheriting the RUNTIME
   locale (`MetricRenderer.tsx:26-32`, `chartAppearance.ts:61`). See D4: this ticket does not change
   their behaviour, but it must not inherit that hazard in its own TESTS. **HEL-1042** owns both
   divergences, plus the product question of whether formatting is viewer-locale-aware or
   dashboard-authored, and whether locale/timezone pinning belongs in the shared Jest setup rather
   than per-suite. It records that HEL-469 deliberately did not absorb it.

### D3 — Never throw; fall back to the raw string

A value that does not parse as a number/date renders as its raw string, never `—` (which is reserved
for null/undefined by `formatCell`) and never an error.

**The fallback IS `formatCell(value)`, defined explicitly here because D1b depends on it.** Using
`formatCell` keeps an unformattable cell rendering exactly as it does today — including objects,
which it JSON-stringifies rather than collapsing to `[object Object]` — so applying a format spec
can never make a cell WORSE than no spec. Consequence, stated: for object values formatter and
`formatCell` coincide, so the object sort key is unchanged by the leak, which is why D1b's currency
guard rather than the object assertion is what proves the invariant. This is an AC and it is also the honest
behaviour: a column typed `number` whose values are occasionally `"n/a"` should show `n/a`, not
break the row.

Formatting is applied to a value that already exists; it never changes which rows render, so it
cannot interact with pagination or the loaded-row disclosure.

### D3a — Alignment is a HEADER+CELL pair, owner-ruled (supersedes the halted draft)

The halted draft justified `ColumnDef.align` by stating `DataGrid.css:72` (as it then was) hardcodes
`text-align: left` **on the cell**. That was a wrong supporting fact and it would have shipped a
visible defect: right-aligned cells under a still-left-aligned header. Verified against
`a6bde0d3` — the declaration is at **`DataGrid.css:147`**, inside `.ui-data-grid__table thead th`;
`tbody td` has **no** `text-align` at all, so cells inherit.

**Owner ruling: alignment applies to the `th` and the `td` together, or to neither.** This is an
implementation decision, not an open question — do not reopen it, and do not add an `align` field
without wiring both elements in the same change. The mechanism follows the coupling; choosing the
mechanism first is what produced the original defect.

### D3b — Clearing a format must WRITE, not omit

A consequence of D1a that must not be discovered in implementation: because `mergeConfig` is
`existing.fields ++ patch.fields`, **omitting a key leaves the stored value intact** — the same
property that makes the minimal patch safe. Dropping a column's entry would leave the old spec
persisted and the column still formatted after reload.

`buildOutputConfig` emits the whole `columnFormats` object on Save, so a removed entry IS a whole-key
replacement and clears correctly — but that only holds because the editor rewrites the key wholesale,
and it must be ASSERTED rather than assumed.

### D4 — Tests PIN locale and timezone; production does not

`Intl.NumberFormat`/`Intl.DateTimeFormat` vary by runtime locale, and a date renders as a different
calendar day either side of midnight depending on timezone. **A test asserting `"$1,234.56"` passes
in `en-US` and fails elsewhere — a defect wearing a green check**, and CI and a contributor's
machine would legitimately disagree. `frontend/jest.config.cjs` and `src/test/jest.setup.ts`
currently pin NEITHER, so this is live rather than hypothetical.

Tests therefore pass an explicit locale and timezone rather than inheriting the runner's. Production
keeps locale-aware defaults (that is the point of `Intl`) — the pinning is a test-determinism
measure, not a behaviour change, and the design says so to stop a later reader "fixing" production
to match the tests.

### D5 — The `rawRows` branch: format only what survived stringification

On the `rawRows` branch (the panel detail modal), `usePanelData.ts:87-92` builds rows with
`String(v)` **before** `TableRenderer` sees them:
- numbers → `"1234.56"`, dates → an ISO string: **parseable, so formatting works**;
- objects → `"[object Object]"`: **type destroyed, unrecoverable**.

Decision: formatting is applied on both branches, because for the number/date/currency cases the
value survives as a parseable string and refusing to format there would make the same column render
differently in the grid and the modal for no user-visible reason. For an object-valued column the
spec is inert — `"[object Object]"` parses as neither a number nor a date, so D3's fallback returns
it unchanged. **No special case is written for it**: the fallback already produces the only honest
outcome, and a special case would imply the ticket had fixed something it has not.

**HEL-1033 owns the underlying fix** (it is the ticket for `String(v)` destroying object values, and
`rawRows` feeds five renderers, so it is not a table-local change). **When HEL-1033 lands, this
ticket's behaviour changes**: object-valued columns will arrive as objects, `formatCell` will
`JSON.stringify` them, and a `number`/`date` spec on such a column will still fall back — but the
displayed text will change from `[object Object]` to real JSON. Stated here so that change is
expected rather than surprising.

### D6 — COHERENCE PASS: one per-column spec, four consumers (restart)

The original run halted because rounds 2 and 3 each introduced defects while fixing the previous
round's. The cause was patching findings individually when the real structure is **one per-column
spec feeding several consumers that must not silently agree or silently diverge.** This section
derives all of them together, which is the halt's own recommended option 2.

At `a6bde0d3` the consumers are:

| consumer | site | reads | why |
| --- | --- | --- | --- |
| render | `DataGrid.tsx:803` | **formatted** | the user-visible cell |
| sort | `TableRenderer.tsx:309` | **RAW** | `1000` must order above `99`, not lexically |
| filter | `tableFilterPredicate.ts:13` | **formatted** | HEL-451 D2: a match must be visible |
| persist | Output `config.columnFormats` | the spec itself | survives reload |

**Sort and filter deliberately disagree, and that asymmetry is the design.** Sort reads raw so
ordering is numeric; filter reads rendered so a match is always visible in the cell that matched.
A future contributor will notice the two "inconsistently" derive from the same column and try to
unify them. **Do not.** Unifying on raw breaks visible-match; unifying on formatted breaks numeric
ordering — the exact defect HEL-448 already fixed once
(`localeCompare(numeric:true)` ordering `1.5` before `1.25`).

### D6a — Filtering must use the PER-COLUMN formatter (new; could not be asked before HEL-451)

`tableFilterPredicate.ts:5-9` states a load-bearing contract: *"the match source IS the rendered
text (`formatCell`), reused rather than reimplemented, so a match is always visible in the cell
that matched."* That is currently true because `formatCell` is the only renderer.

This ticket falsifies it unless the predicate is updated. With a currency format on a column:

- term `1,234` finds nothing, though the cell visibly reads `$1,234.56`;
- term `1234.56` matches a cell whose visible text contains no such substring.

Both directions break the stated invariant, and the second is worse — an invisible match reads as
a filtering bug.

**Decision: the filter predicate resolves the same per-column formatter the cell renders, falling
back to `formatCell` for unformatted columns.** The predicate therefore takes the column's format
spec, not just the value. The contract in `tableFilterPredicate.ts:5-9` must be **rewritten** in
the same change to say the match source is the per-column rendered text — leaving it describing
`formatCell` would be a confidently-false comment about a contract the code no longer honours.

**Guard, mutation-failable:** with a currency format active, the term matching the FORMATTED text
matches and the term matching only the RAW text does not. Run it against the pre-fix behaviour
(predicate on bare `formatCell`) and confirm it goes red — a guard that passes there guards
nothing.

### D6b — The formatter is resolved ONCE and shared, not implemented per consumer

Render and filter must never drift. One exported resolver — column spec → `(value) => string` —
consumed by both, with `formatCell` as its fallback. Sort does **not** use it: it reads raw
values, and `TableRenderer.tsx:127-130`'s comment (which currently says the sort key should match
the rendered cell text) becomes **false** with this ticket and must be corrected in this change.
Leaving it invites exactly the "tidy-up" that would re-point sort at the formatter and reintroduce
lexical ordering.

## Two-axes review targets

**(a) What does no source text carry?** Right-alignment of numeric columns is a rendered-geometry
property: nothing in a test of the formatter can see whether the column actually right-aligns, and
`table-layout: fixed` plus per-column widths mean alignment interacts with the column's own width.
Measure it rather than asserting a class name.

**(b) What data shape did the gates not exercise?** Three, all concrete and all currently untested
anywhere in the table-panel suite: **locale-dependent formatting** (D4), **timezone-dependent dates**
(D4 — the same instant is a different calendar day either side of midnight), and **values that fail
to parse** (D3's fallback — the AC's "never crash"). Add: an object-valued column on the `rawRows`
branch (D5), which is the shape HEL-1033 records and no test covers.

## Risks

| Risk | Mitigation |
| --- | --- |
| Formatting leaks into the comparator in a later refactor | Mutation-failable guard, not an observation (D1) |
| A parallel format vocabulary drifts from `MetricFormat` | Same names where they overlap; divergences named and justified (D2) |
| Hardcoded USD repeated from `MetricRenderer` | Explicit currency code in the spec; `MetricRenderer` untouched and flagged separately (D2) |
| Tests green on one machine, red on another | Locale and timezone pinned in tests only (D4) |
| Formatting an already-stringified value silently misleads | Fallback returns it unchanged; no special case; HEL-1033 named as owner (D5) |
| Right-alignment asserted rather than seen | Rendered-geometry measurement (two-axes (a)) |
| Nested container replaced wholesale by `mergeConfig` | Flat sibling, per HEL-448's own comment |

## Test plan

Jest with **pinned locale and timezone**: each formatter (number decimals/grouping, currency with a
non-USD code, date pattern, text passthrough); the never-throw fallback for unparseable values and
for `"[object Object]"`; tolerant `readColumnFormats` for malformed specs; and the **sort-raw-values
guard**, verified red by pointing `getValue` at the rendered value. Rendered-geometry check for
right-alignment. No dev-server or Playwright work is needed for the formatter logic itself.
