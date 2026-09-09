# Design — HEL-451 In-panel column filtering

## Context

Base `origin/main` @ `36a9c1cc`. This extends the pipeline HEL-448 shipped (merged `adadb5d4`):
`TableRenderer` already performs ONE pre-branch normalization producing a single
`{ normalizedRows, columns }` and feeds ONE `useSortedRows` call (`TableRenderer.tsx:158-215`),
because a per-branch hook call violates `react-hooks/rules-of-hooks`, an ERROR under this repo's
zero-warnings policy. Filtering inserts into that existing pipeline; it does not add a second one.

Ground truth carried forward, verified again on this base:
1. **Rows are not fully client-loaded.** `panelThunks.ts:296` carries a COMMENT claiming client-side
   slicing; `:309-311` computes a server `offset`/`limit` and `panelsSlice.ts:204-207` APPENDS pages.
   Initial fetch 200, "Load more" +50, `Page.MaxLimit` 500.
2. **`hasMore` is server-derived** from `result.total`, so no client-side filter can make a count
   describe the filtered set. Moved to HEL-1027 (open, retitled).
3. **`PATCH /api/outputs/:id` merges** (`OutputService.mergeConfig`, shallow, deep-merging only four
   hardcoded chart keys), so the write is a minimal patch and nested containers are unsafe.

## Goals / Non-goals

**Goals.** Quick-filter and per-column contains filtering on the `full` variant; composition with
sort in the existing single pipeline; Output-scoped persistence as `columnFilters`; an empty state
that explains itself and offers a way out; disclosure that keeps the UI honest about filtering a
sample; a defensible answer for map-classified columns.

**Non-goals.** Typed operators; a server-side filter or whole-Output counts (HEL-1027); the
`preview` variant; OR semantics; building HEL-465/469.

## Decisions

### D1 — Storage: `columnFilters`, a flat sibling of `columnSort`

```ts
export interface TableColumnFilters {
  /** Case-insensitive contains, matched across every visible column. */
  quick?: string;
  /** Per-column case-insensitive contains. Columns AND together. */
  columns?: Record<string, string>;
}
export interface TableOutputConfig {
  fieldMapping: Record<string, string>;
  columnOrder?: string[];
  columnSort?: SortState<string> | null;     // HEL-448
  columnFilters?: TableColumnFilters | null; // HEL-451
}
```

Flat sibling, per the settled ruling: `mergeConfig` deep-merges only `legend`/`tooltip`/
`seriesColors`/`axisLabels`, so any *other* nested object is replaced wholesale — which is
**fine and required here**: `columnFilters` is replaced as a unit on every write, which is exactly
the semantics we want (removing a column's filter must not leave a stale key behind). This is a
different case from a nested *container of independent concerns*, which is what the ruling forbids;
HEL-465's `pinnedColumns` and HEL-469's `columnFormats` still land as their own top-level siblings,
never inside `columnFilters`.

`readColumnFilters` is tolerant, mirroring `readColumnSort`: a non-object yields `undefined`; a
non-string `quick` is dropped; `columns` keeps only string-valued string keys. Empty strings are
normalized away at write time (an empty filter is no filter), so a cleared filter does not persist as
`{ columns: { region: "" } }`.

### D2 — The match predicate is the RENDERED TEXT, and that is the whole justification

A cell matches a term when `formatCell(value).toLowerCase().includes(term.trim().toLowerCase())`.
`formatCell` is `DataGrid`'s existing cell renderer (`DataGrid.tsx:128-132`) — exported and reused,
never reimplemented, so the match source and the rendered text cannot drift apart.

**This is the answer to the map-classified-column question, and it is the reason it is answerable
at all.** HEL-1015 (`36a9c1cc`, backend-only) made `JsonFlattener` classify nested-object paths MAP
vs STRUCT cross-row (`detectMapPaths`, `MapCoverageThreshold = 0.25`,
`MinObjectRowsForMapClassification = 2`). A path whose keys are DATA no longer explodes into one
column per key, so a map-classified path arrives as a SINGLE column whose values are objects.
`formatCell` already renders those as `JSON.stringify(value)`.

The concern is real: substring-matching serialized JSON can match a brace, a quote, or a key name.
Three options were considered.

- **(a) Match the rendered text — CHOSEN.** A match is always visible in the cell that matched. If a
  user types `region` and a row matches because its cell reads `{"region":"EMEA"}`, they can see
  exactly why. The rule is one sentence — *the filter matches what the cell shows* — and it is
  uniform across every column type, so there is no per-column-type behaviour to learn.
- **(b) Refuse to filter map-classified columns.** Legitimate, and explicitly allowed by the
  ruling — but the frontend does not receive the MAP/STRUCT classification. It would have to
  re-derive it from `typeof value === "object"`, i.e. invent a second, weaker classifier that
  disagrees with the backend's cross-row one on any column that is object-valued in some rows and
  not others. A filter that silently refuses some columns for reasons the user cannot see is worse
  than one whose matches they can inspect.
- **(c) Match only map VALUES, not keys or punctuation.** Requires parsing what `formatCell` just
  serialized, and produces the surprising result that a term visible in the cell does not match.

**Branch-dependent limitation, discovered in review, and RESTATED after its first rationale was
refuted.** An earlier revision of this section attributed the limitation to HEL-1015 making
map-shaped data arrive as object-valued columns. **That was wrong, and it was checked against real
stored data rather than the code path:** `PipelineRowJson.jsValueToAny`'s catch-all is
`case other => other.compactPrint`, so a map-classified path lands in a stored row as a compact JSON
**string**, not an object — and `String(aString)` is a no-op. At scale in the dev DB: of 3,997
`node_snapshots` rows, 2,020 cells across 2,010 rows are JSON-encoded strings, and a `jsonb_each`
scan finds **exactly one** object-valued cell in 3,997 — a `content` column holding a `BinaryRef`,
the image connector's deliberate HEL-216 special case (`PipelineRowJson.scala:37-49`).

So the limitation is REAL but its trigger is the image connector's `content` column, NOT ordinary
map-shaped data and NOT a consequence of HEL-1015. Ordinary map-shaped columns arrive as JSON
strings and filter correctly on both branches, because the text they display IS their value. D2's "match the
rendered text" guarantee holds on the PAGINATION branch, where `paginationRows` arrive as raw
`Record<string, unknown>` and `formatCell` `JSON.stringify`s objects into readable text. It does NOT
hold on the `rawRows` branch: `usePanelData.ts:87-92` builds those rows with
`String(v)`, and `String({region:"EMEA"})` is `"[object Object]"`. The value is destroyed BEFORE
`TableRenderer` or `formatCell` sees it, so on that branch an object column both DISPLAYS and
MATCHES as `[object Object]`.

**The justification is intact in FORM and worthless in EFFECT.** The predicate remains
self-consistent there — the filter does match exactly what the cell shows — but it is operating over
data that was already destroyed upstream, so the guarantee it delivers is empty. This is a distinct
failure mode from being wrong: nothing in the predicate misbehaves, and no test of the predicate
would catch it, because the defect is in what reaches it. Filtering such a column on that branch is
useless rather than unpredictable. That display defect is PRE-EXISTING and not introduced here; it is filed
as **HEL-1033** (Medium; its verification target is the image connector's `content` column), which
also owns removing this limitation. HEL-1033 is triaged High and owned by the lane that shipped HEL-1015. If its fix lands before this
merges, this section is RESTATED, never silently deleted — removing it would lose the record of why
filtering behaved differently across branches. It is deliberately NOT fixed inline here:
`rawRows` feeds FIVE renderers through `PanelContent` (`:119`, `:136`, `:181`, `:193`, `:293`), so
changing the stringification is not a table-local edit and would silently alter chart, metric,
collection and timeline inputs.

**Second limitation:** a wide JSON value may be visually clipped
by the column's width, so "what the cell shows" can exceed what is currently legible. The full text
is available via the `th`/cell `title` and by widening the column (resize already exists). This is a
legibility limit, not an unpredictability one — the match is still explainable by inspecting the
cell. If review finds this unacceptable, the fallback is (b), and that is an escalation, not a
silent switch.

Numeric and date values are matched as their rendered text, deliberately: this is a *contains*
filter, not a typed comparison, and typed operators are explicitly out of scope.

### D3 — Filter BEFORE sort, in the existing single pipeline

`normalizedRows` → **filter** → `useSortedRows`. Filtering first is cheaper (sorting a smaller set)
and the composition is order-independent for a stable comparator, so this costs nothing in
correctness. The filtered array must be `useMemo`-stable for the same reason `normalizedRows` is:
`useSortedRows` memoizes on `[rows, columns, sortState]` by identity, and an unstable array defeats
it every render.

No second hook, no second normalization, no early return added — the D6a structure HEL-448
established stays intact.

### D4 — Disclosure: what the UI says, and when

This is the design obligation, not a nicety. The rule is **the UI never states a number or an
absence that could be read as describing the whole Output.**

**The truncation signal must be true on BOTH row branches — this is where a naive implementation
inverts the whole guarantee.** HEL-448's qualifier uses
`truncated = usingPagination && paginationHasMore`. That is WRONG for this design, and verifying it
exposed a real hole: `PanelDetailModal.tsx:400-404` renders `PanelContent` with `rawRows`/`headers`
ONLY — no `paginationRows`, no `paginationHasMore`, no `onLoadMore` — while
`usePanelData.ts:87-95` derives those `rawRows` from the SAME paginated `paginationEntry.rows`
(initial 200, appended by "Load more"). So in the detail modal `TableRenderer` takes the `rawRows`
branch, `usingPagination` is false, and that predicate reports `truncated = false` **over a row set
that is genuinely truncated**. The matrix would then render an unqualified count described as "a
complete answer", and the non-truncated empty state — a confidently wrong "no results" — in exactly
the case this design calls the sharpest. The honesty guarantee inverts precisely where it matters.

**`rowsTruncated` is a SHARED CORRECTNESS PRIMITIVE, not a filter detail.** Any disclosure that
implies completeness — this ticket's filter counts, HEL-448's sort qualifier, and anything
HEL-465 (pinning) or HEL-469 (cell formatting) later adds — MUST CONSUME this signal rather than
re-derive truncation locally. Re-deriving locally is exactly how HEL-448 got it wrong: it computed
truncation from the props its own branch happened to receive, which silently reported "complete" on
the branch that did not receive them. A later ticket that recomputes `usingPagination && ...` will
reintroduce the same defect in a new place. Consume the prop.

Required: `usePanelData` exposes the `hasMore` it already holds on `paginationEntry`, and **BOTH**
`PanelContent` call sites pass it to `TableRenderer` as a branch-independent `rowsTruncated` prop —
`PanelDetailModal.tsx:400` AND `PanelCard.tsx:99`. Wiring only the modal would default the prop to
`false` on the dashboard grid and simply RELOCATE the inversion there; `PanelCard` already holds
`paginationEntry?.hasMore` (`:113`) and must pass it under the new prop too, not only as
`paginationHasMore`. `truncated` is then that prop, true on both branches, defaulting to `false`
only when genuinely unknown.

**HEL-448's sort qualifier is fixed by the same signal (ruled `fix-inline`).** Its gate is the same
broken predicate, so `Sort covers only the loaded rows.` has NEVER rendered in the panel detail
modal since `adadb5d4` — a sorted 200-row sample has been presenting as complete there. Re-gating it
on `rowsTruncated` is one line on a signal this diff introduces anyway; a separate ticket to change
one line in a file already being edited would be ceremony, not discipline. Three conditions attach:
the PR body states the defect and its mechanism plainly; HEL-448 gets a Linear comment pointing at
this PR (it stays Done — a note, not a reopen); and the pending-confirmation labelling is unchanged.

**Both qualifiers remain trivially removable TOGETHER.** D9a is still a delivery-coordinator
addition awaiting the owner's confirmation, and fixing its predicate does NOT promote it to
approved. The sort and filter disclosures must share one removal seam, so that if the owner strikes
the disclosure, one change takes out both rather than leaving half of it behind.

**The sort re-gate is NOT one line — the note and the button share a conditional.**
`TableRenderer.tsx:282-305` wraps BOTH the `panel-content__truncation-note` and the Load-more
`<button onClick={onLoadMore}>` in a single `{usingPagination && paginationHasMore && ...}` block.
Re-gating that block on `rowsTruncated` would render the button in the detail modal, where
`onLoadMore` is undefined — a visible, focusable, dead control. The note and the button must be
gated SEPARATELY: the note on `rowsTruncated`, the button on the load-more affordance actually
being available (`onLoadMore != null`, which also implies the pagination branch).

**The modal has no `onLoadMore` at all**, so "offer Load more" is not implementable there. When the
truncated-empty state has no load-more affordance available, it renders the disclosure TEXT WITHOUT
the action ("...load more to widen the search" becomes "...more rows may match"), and offers Clear
filters alone. The executor must not discover this as an undefined prop and improvise.

Let `filtering = any active filter term`.

| state | what renders |
| --- | --- |
| `!filtering`, `truncated` | HEL-448's existing sort qualifier only (unchanged) |
| `filtering`, `!truncated`, results | match count, unqualified — a complete answer, every row IS loaded (only ever true when `rowsTruncated` is genuinely false) |
| `filtering`, `!truncated`, empty | "No rows match your filter." + Clear filters |
| `filtering`, `truncated`, results | count SCOPED: "N of M loaded rows match." + loaded-scope note |
| `filtering`, `truncated`, empty | **the sharpest case** — see below |

**Two things follow that a naive implementation gets wrong.**

First, when nothing is truncated the disclosure must **disappear**. A permanent "results may be
incomplete" caveat is noise that trains users to ignore it, and it would be false: with every row
loaded, the count is exact. Honesty is conditional, not decorative.

Second, the truncated-empty case cannot be a bare empty table. It renders: *"No rows match your
filter in the M rows loaded so far. More rows may match — load more to widen the search."* plus BOTH
actions — **Clear filters** and **Load more**. Load more is the actual remedy for the actual
problem, and offering only "clear filters" would answer the user's real question ("are there any
EMEA rows?") with a shrug. This is why `DataGrid`'s empty state needs an action slot (D5): the
existing `<p>{emptyText}</p>` cannot carry either action, and that gap is precisely where the wrong
answer currently lives.

Counts are never rendered bare. When truncated, the number is always paired with its denominator
("3 of 200 loaded rows"), so it cannot be read as "there are 3".

This EXTENDS HEL-448's qualifier precedent — same trigger condition, same minimal register, same
placement discipline — rather than copying it. Note that qualifier remains **pending the owner's
confirmation and is NOT approved**; this design does not treat it as settled, and if the owner
removes it, the filtered-scope disclosure here is separable and can be reconsidered on its own.

### D4a — `rawRows` positional keys (precedent, stated not rediscovered)

On the `rawRows` branch with no `headers`, column keys are POSITIONAL
(`TableRenderer.tsx:180`: `String(i + 1)`), so a persisted `columns: { "3": "emea" }` binds to a
position rather than a field. `columnSort` (HEL-448) already persists against the same positional
keys, so this is inherited precedent, not a new defect introduced here — recorded explicitly so a
later reader does not rediscover it as a surprise. Not fixed in this ticket; fixing it would change
HEL-448's persisted-key semantics too.

### D4b — Consolidated truth table (whole-artifact coherence pass)

Rounds 2 and 3 each found a defect introduced by the previous round's fix — locally correct against
the finding that prompted it, wrong against the rest of the document. This table is re-derived from
the two call sites rather than patched, so the gates are right BECAUSE the table says so.

**Surfaces, from the actual props (not assumed):**

| surface | `rawRows` | `paginationRows` | `onLoadMore` | `rowsTruncated` source |
| --- | --- | --- | --- | --- |
| Dashboard grid (`PanelCard.tsx:99-118`) | YES | when loaded | **always present** | `paginationEntry?.hasMore ?? false` |
| Detail modal (`PanelDetailModal.tsx:400-412`) | YES | **never** | **always absent** | new prop from `usePanelData` |

**A correction this pass produced was itself WRONG, and is retracted here rather than quietly
edited.** This section previously claimed the dashboard grid falls to the `rawRows` branch whenever
`paginationRows` is null/empty, making "`rawRows` branch WITH `onLoadMore` present" a reachable
state. **It is not reachable.** `usePanelData.ts:80-95` derives BOTH from one source:
`rows = paginationEntry?.rows ?? []`, with `rawRows` returning `null` when `rows.length === 0`,
while `PanelCard` passes `paginationRows={paginationEntry?.rows ?? null}`. When one is empty the
other is null, so `TableRenderer` renders its skeleton rather than the `rawRows` branch. On the
dashboard grid `usingRaw` is unreachable.

The error was reasoning from the props visible AT the call site without tracing where those props
come FROM — the same mistake that produced the refuted HEL-1015 rationale earlier in this design.
Recorded rather than deleted, because a design that silently drops a wrong claim teaches nothing and
the next reader re-derives it.

**Consequence for the gates: none.** `rowsTruncated && onLoadMore != null` is CONSERVATIVE rather
than wrong — it is correct on both reachable surfaces and would also be correct on the unreachable
one. Keep it: a gate that stays right if `usePanelData`'s derivation is ever decoupled is worth more
than one tuned to the current coupling. But the JUSTIFICATION is the truth table below, not the
retracted claim above.

**Sort-note / Load-more gates:**

| `rowsTruncated` | `onLoadMore` | note | button | wrapper |
| --- | --- | --- | --- | --- |
| true | present | yes | yes | renders (2 children) |
| true | absent | yes | **no** | renders (1 child) |
| false | present | no | **no** | **must not render** |
| false | absent | no | no | **must not render** |

So: wrapper and note gate on `rowsTruncated`; button additionally requires `onLoadMore != null`.
Row 3 is the defect round 3 caught (`onLoadMore != null` alone renders a live button on every
fully-loaded grid panel); rows 3-4 are why the wrapper cannot gate independently of its children —
it carries its own padding and would render as an empty padded box.

**CORRECTION (HEL-451 skeptic CR5, filed against the executor's own diff — this table's own
`rowsTruncated`-only note gate was ALREADY wrong once the filter-disclosure table below exists.**
This table predates HEL-451's OWN filter-scoped message. Read literally as `showSortNote =
rowsTruncated && !filtering` (the executor's original 4.0g wording), the note would NOT render for
`filtering && rowsTruncated && results` when `onLoadMore` is absent — exactly the panel detail
modal, which never has one — even though the filter-disclosure table two sections below REQUIRES
"scoped count + loaded-scope note" to render there unconditionally. **The note's gate is
`rowsTruncated || filtering` (any of the three non-empty message states this ticket's own
`LoadedScopeDisclosure` can produce — the plain sort note, an unqualified count, or a scoped
count), not `rowsTruncated` alone and not `rowsTruncated && !filtering`.** The button's gate is
unchanged (`rowsTruncated && onLoadMore != null`); the wrapper is still derived from its two
children, `showLoadedScopeNote || showLoadMoreBtn`. Corrected table:

| `rowsTruncated` | `filtering` | `onLoadMore` | note | button | wrapper |
| --- | --- | --- | --- | --- | --- |
| true | any | present | yes | yes | renders (2 children) |
| true | any | absent | yes | no | renders (1 child) |
| false | true | any | yes (unqualified count) | no | renders (1 child) |
| false | false | any | no | no | **must not render** |

Implemented in `TableRenderer.tsx` as `showLoadedScopeNote = rowsTruncated || filtering`,
`showLoadMoreBtn = rowsTruncated && onLoadMore != null`, `wrapper = showLoadedScopeNote ||
showLoadMoreBtn` — named booleans, wrapper derived from them, per 4.0g's own discipline; only the
FORMULA for the note changed, not the structural rule. This is also why the unqualified-count and
scoped-count messages now render through the SAME wrapper/call site (`.panel-content__disclosure`,
renamed from `.panel-content__load-more` — it no longer only wraps a load-more affordance) instead
of two different DOM positions: the corrected table shows they are the SAME "note" child, just with
different content chosen by `filtering`/`rowsTruncated` inside `LoadedScopeDisclosure` (4.0f).

**Filter disclosure states** (`filtering` = any active term):

| filtering | truncated | rows | renders |
| --- | --- | --- | --- |
| no | any | any | sort note only, per the table above |
| yes | false | some | plain match count, no caveat — a complete answer |
| yes | false | none | "No rows match your filter." + Clear filters |
| yes | true | some | scoped count ("N of M loaded rows match.") + loaded-scope note |
| yes | true | none | loaded-scope text + Clear filters + Load more **only if `onLoadMore != null`** |

**Coherence defect this pass exposed — SUPERSESSION.** With `filtering && truncated`, the sort note
("Sort covers only the loaded rows.") and the filter-scoped disclosure would BOTH render: two
loaded-scope messages stacked, saying overlapping things, in the same panel. Neither prior round
caught this because each looked only at the gate it was fixing.

Rule: **the loaded-scope disclosure is ONE message, never two.** When a filter is active, the
filter-scoped message SUPERSEDES the sort note — it is strictly more informative, naming both the
scope and the match count. The sort note renders only when `!filtering`. The single
`LoadedScopeDisclosure` component required by the removal seam is exactly where this belongs: it
takes the state and emits exactly one message, which makes the supersession structural rather than
a pair of conditions that can drift apart.

### D4d — Filter chrome sits behind a toggle (ruled, after live measurement)

Measured on a default-size dashboard panel: the filter chrome consumed **124.5px of a 143px scroll
area**, leaving ~18px for a 35px row. That is structural, not a spacing nit — two filter rows on top
of the column-header row. Ruled: **`filters-behind-a-toggle`**.

Rejected alternatives, recorded so they are not re-proposed: `single-quick-filter-row-only` (silently
drops an acceptance criterion), `detail-modal-only` (makes the capability inaccessible on the surface
people actually use), `keep-two-rows-and-shrink` (18px of usable area for a 35px row is not
shrinkable).

**Both rows go behind the ONE toggle.** The global quick-filter is NOT an addition — it is required
by `ticket.md:9` ("a single quick-filter text input that matches case-insensitively across visible
columns, **plus** per-column contains-filter inputs") and by the acceptance criterion at
`ticket.md:18` ("Typing in the quick-filter narrows rows across all columns live"), both carried
verbatim from the original Linear text. It is not kept merely because it is already built.

**Collapsed MUST NOT hide an active filter.** This is this ticket's own honesty theme turned on its
own chrome: a filtered table that LOOKS unfiltered is a confidently wrong answer, and it is worse
than the partial-count problem because the user has no cue at all that a filter exists. Required of
the collapsed state:
- it indicates filters are ACTIVE and HOW MANY (quick-filter counts as one);
- clearing all filters is reachable WITHOUT expanding;
- it is visually distinct from the inactive state, not merely a changed tooltip.
Design this explicitly; do not let it fall out of the toggle implementation.

### D4e — Sticky offsets are computed, not assumed

Measured live: all three `<thead>` rows are `position: sticky; top: 0`, so on scroll they collapse to
the same offset (347/347/347) and the column-name header is painted over entirely — the user loses
the headers as soon as they scroll.

`DataGrid.css:188-192` carries a garbled, unfinished comment admitting the offsets were never worked
out, followed by `top: 0` anyway. **Delete it and replace it with one stating what the offsets
actually are.**

**The toggle does NOT fix this.** It reduces how often the state occurs; when expanded the offsets
must be computed and correct. This needs a test that MEASURES RENDERED GEOMETRY — nothing in lint,
types or unit tests can see three sticky rows resolving to one offset, which is precisely why it
survived a green suite and reached review.

### D5 — `DataGrid`'s empty state gains an action slot

Today: `return <p className={emptyClasses}>{emptyText}</p>` (`DataGrid.tsx:230-231`) — message only,
rendered before the `<table>` early-return, so a filtered-empty grid has no header row either.

Change: the empty state accepts an optional `emptyAction?: ReactNode` rendered beneath the message,
and `TableRenderer` supplies the Clear-filters / Load-more actions. Kept as a slot rather than
typed props so `DataGrid` stays presentational and does not learn what a filter is.

**Markup shape, specified rather than left to the executor** — this is exactly the "no source text
carries it" class from two-axes (a), and three plausible shapes produce visibly different geometry:

- When `rows` is empty and NO filter is active: unchanged from today — the existing
  `<p className="ui-data-grid__empty">` early return, message only (plus `emptyAction` beneath it
  when supplied). Existing consumers must be unaffected.
- When `rows` is empty and a filter IS active: render the full grid shell — the `role="region"`
  scroll wrapper (`DataGrid.tsx:246`), the `<table>`, and the `<thead>` including the filter row —
  and the empty message as a single full-width row inside the existing `<tbody>`:
  `<tr><td colSpan={resolvedColumns.length}>` carrying the message and the action.

Chosen over a sibling `<p>` after a header-only `<table>` because a `<td colSpan>` inherits the
table's own column geometry, so the message aligns with the first column and scrolls WITH the
header rather than sitting outside the scroll region and drifting out of alignment at narrow
widths. The alternative places the message outside `role="region"`, which also loses it from the
scrollable area a keyboard user tabs into.

**Deliberate decision — the filter row stays visible when the result set is empty.** Otherwise the
control that caused the empty state disappears along with the rows, and the user cannot see or edit
the term that produced it. This means the empty-state branch can no longer short-circuit the whole
render when filtering is active.

### D6 — Persistence reuses HEL-448's path exactly

Minimal patch `{ config: { columnFilters } }`; never spread `output.config` (a per-mount
`useOutputMeta` snapshot, never refreshed after a write — spreading makes every change a lost
update). Debounced ~300 ms and **flushed on unmount, not cancelled** (closing the detail modal
unmounts `TableRenderer`, which is the path the persistence AC exercises). Written only in response
to a real user edit, never on mount. Owner **pre-check** on `ownerId` (`canWrite`, already computed
at `TableRenderer.tsx:159`) — a non-writable caller filters session-locally and silently, with the
write suppressed rather than attempted-and-swallowed. The rejection path keeps the deliberate
commented `.catch` HEL-448 added; a filter is a keystroke-frequency action, so an unhandled
rejection here would be noisier than the one that gate caught.

Debounce interacts with typing: the filter applies to the rendered rows **immediately** (local
state) and only the PATCH is debounced. Persistence latency must never make typing feel laggy.

### D4c — `tasks.md` is the authoritative artifact for the executor

Round 3 found `design.md` and `tasks.md` disagreeing about the `rowsTruncated` wiring: a scripted
edit landed in one and silently no-opped in the other. **The executor works from `tasks.md`**, so a
design/tasks divergence is not a documentation inconsistency — it is a defect that ships, with the
design falsely attesting that it will not. Any change to a decision here MUST be reflected in
`tasks.md` in the same pass, and every scripted edit MUST assert its match and be verified
afterwards. An action reported as done is not an action verified as done, and a script that edits
several files can succeed at some and fail at others silently.

## Two-axes review targets (required in this document by the run's binding state)

**(a) What does no source text carry?** The empty-state and result-count chrome. Lane B's 40px
misalignment on HEL-510 was inherited from UA defaults, written nowhere in source, and passed lint,
2801 unit tests and 6/6 Playwright cases. The new empty state renders a `<p>` plus buttons, and the
filter row adds inputs to a `<thead>` — both are exactly the kind of markup that inherits UA margin,
padding and line-height. **No source-text check can see this; only looking at rendered geometry can.**

**(b) What data shape did the gates not exercise?** Two, both of which produced real HEL-448
defects: legacy Outputs whose `fieldMapping` fails HEL-892 merged-config validation (4 of 53 table
Outputs in the dev DB — the filter write hits the identical owner-only PATCH, and HEL-448's
unhandled rejection was found ONLY by sampling one), and the all-strings `rawRows` branch, where both
of HEL-448's ordering defects actually lived. A filter exercised only against the pagination branch
with well-formed Outputs will look green and prove little. **Also new here:** an Output with a
map-classified column, without which D2's central justification is untested.

## Risks

| Risk | Mitigation |
| --- | --- |
| A count read as a whole-Output count | Never rendered bare when truncated; always paired with its denominator (D4) |
| Truncated-empty renders as a confident "no results" | Dedicated message naming the loaded scope + Load more as an action (D4, D5) |
| Disclosure becomes permanent noise | Conditional on `truncated`; disappears when the answer is complete (D4) |
| Map-column matches unexplainable | Match source IS the rendered text, reusing `formatCell` (D2) |
| Filter row/empty state inherit UA spacing | Two-axes (a); rendered-geometry review, both themes |
| Unstable filtered array defeats the sort memo | `useMemo` on the filtered rows (D3) |
| Cleared filter persists as an empty string | Normalized away at write time (D1) |
| Typing feels laggy | Rows filter on local state immediately; only the PATCH is debounced (D6) |
| Filter control vanishes with the rows it emptied | Filter row stays visible while filtering; empty message as `<td colSpan>` inside the live grid (D5) |
| Truncation misread as false in the detail modal | Branch-independent `rowsTruncated` from `usePanelData`'s `hasMore`, wired at BOTH `PanelContent` call sites (D4) |
| Re-gating exposes a dead Load-more button in the modal | Note and button gated SEPARATELY — note on `rowsTruncated`, button on `onLoadMore != null` (D4) |
| Object columns match `[object Object]` on the `rawRows` branch | Pre-existing display defect, filed as HEL-1033; limitation stated, not fixed inline (five renderers share `rawRows`) (D2) |

## Test plan

Jest: the predicate (case-insensitive contains, trimmed, quick-filter across columns, per-column AND,
object cells matched via `formatCell` text, empty term is no filter); tolerant `readColumnFilters`
(non-object, non-string `quick`, non-string column values, `null`); filter-then-sort composition on
BOTH the pagination and `rawRows` branches; disclosure state machine (all five D4 rows); minimal
patch body carries only `columnFilters`; no write on mount; no write when `!canWrite`; debounce
flushes on unmount.
Playwright: persistence across modal open/close and reload; the truncated-empty state on a real
Output; light and dark rendered-geometry review of the filter row and empty state against the
HEL-448 sort header and the HEL-1022 list tables.

---

## D10 — Reframe: chrome and the filtered-empty message leave the table (owner-authorized)

Supersedes D5 and the sticky-cell mechanism from final-gate rounds 1–2. Authorized by the owner
after three consecutive rounds found three faces of one constraint set. **Revised after design-gate
round 5 REFUTEd the first draft** — corrections marked inline.

### Why the previous shape could not be fixed incrementally

`DataGrid.tsx:402` makes the **root element itself** the scroll container (`ref={scrollRef}`,
`role="region"`), with `<table>` its only child. Nothing can be a sibling of the scroll container,
so all full-width chrome had to live inside the table as a `colSpan` cell — and simultaneously
satisfy `table-layout: fixed` geometry (12,160px on a real 44-column Output), the `tbody td`
truncation group, sticky positioning whose containing block is confounded by ancestor
`overflow: hidden`, and a width tracking a viewport it is not a child of. Finding 3 is the residue:
`stickyCellMaxWidth` (`:267-297`) measures the viewport once per dependency change, and its deps
track no width.

### D10-1 — Which element actually scrolls (corrected TWICE; see D10-7)

Draft 1 reasoned as if `.ui-data-grid` were the vertical scroller and placed chrome after it.
Draft 2 corrected the placement but over-corrected the claim, asserting `.ui-data-grid` "has no
height cap and never scrolls vertically". **That is also wrong** — see D10-7, which settles it with
measured CSS. The accurate statement:

- `.panel-content--table` (`PanelContent.css:50-52`, `overflow-y: auto`) is a vertical scroller on
  the panel surface.
- `.ui-data-grid` is `overflow: auto` on **both** axes (`DataGrid.css:1-4`), so it is the nearest
  scrolling ancestor — the sticky scrollport — for every `thead` row, and it **can** scroll
  vertically: `.ui-data-grid--preview` sets `max-height: 320px` (`:36`) and `.ui-data-grid--full`
  sets `height: 100%` (`:40-42`) against a container the panel body sizes.

Both facts hold at once. Placement is decided by the outer scroller; sticky engagement is decided by
`.ui-data-grid` itself.

### D10-2 — The change, with corrected ordering

Introduce an outer wrapper; the scroll container becomes an inner element:

- `.ui-data-grid__frame` (new outer, static, naturally viewport-width)
  - filter toolbar (`Filters (n)` + "Clear all") — **BEFORE** the scroll container
  - quick-filter row — **BEFORE** the scroll container
  - filtered-empty message (`emptyText`/`emptyAction`) — **BEFORE** the scroll container
  - `.ui-data-grid` (scroll container; keeps `ref={scrollRef}`, `role="region"`)
    - `<table>` — data and column-aligned chrome only

**All frame chrome precedes the scroll container.** Draft 2 kept the message AFTER, reasoning "the
table is short in that state". That reasoning was unsound and is withdrawn: whether the message is
below the fold is decided by the height of the *scroller*, not the height of the table inside it. In
the filtered-empty state with filters expanded, the scroller's content is toolbar + quick-filter +
(header + per-column filter row + empty tbody) + message + `.panel-content__disclosure`
(`TableRenderer.tsx:449`) — a minimum-height dashboard panel is easily shorter than that stack, so
the message would fall below the fold in exactly the state the ticket calls sharpest: a filter
matching nothing rendering as a confident, wrong answer. **Invariant, stated against the scroller:
no frame chrome may require scrolling `.panel-content--table` to become visible.**

Naming: `.ui-data-grid__frame`, deliberately NOT `__wrap` — `.ui-data-grid__empty-wrap` (`:384`)
already exists and is a confusable neighbour.

**Stays in the table:** `.ui-data-grid__filter-row--columns` (`:554-559`). Its inputs align to
individual columns, so the table is the correct parent; moving it would mirror the original mistake.

### D10-3 — Frame contract (round 1 CR6 / round 2 CR3 / round 3 CR1)

- The frame becomes the flex item of `.panel-content--table` (and, in the modal, of the same box
  under `__view-body`). Every ancestor flex/height rule that used to land on `.ui-data-grid` now
  lands on the frame, so the frame carries `min-width: 0` and `min-height: 0`.
- **The height chain must be preserved explicitly — this is D10-3a below, and it is load-bearing for
  D10-7.**
- Staying on the scroll container, NOT moving to the frame: `border-radius`, the scroll-shadow
  modifiers `--scroll-left`/`--scroll-right` (`:16-30`), and `.ui-data-grid--full .ui-data-grid__table`.
- The frame is introduced at **all four** call sites, including the three `variant="preview"`
  consumers (`StepCard.tsx:382`, `SourceDetailPanel.tsx:288`, `SqlTab.tsx:223`), and must be
  layout-neutral for them. No CSS outside `DataGrid.css` selects `.ui-data-grid`, so nothing breaks
  by selector — but the frame becomes their flex/grid item, which must be verified, not assumed.
- Consumer `className` continues to land on `.ui-data-grid`, not the frame.
- The un-filtered empty early-return (`:376-388`) gets **no** frame, so the component root is
  conditionally the frame, a `<p>`, or `.ui-data-grid__empty-wrap`.
- The frame is unconditional otherwise and takes no modifiers.

### D10-3a — EIGHTH + NINTH ASSUMPTIONS: preserving the `--full` height chain

`.ui-data-grid--full { height: 100% }` (`DataGrid.css:40-42`) is the **only** thing giving the grid a
definite height on the panel surface. D10-7's liveness argument depends entirely on it, so the
reframe must preserve the chain deliberately.

**Corrected premise (round 4 CR1).** An earlier draft cited `.panel-content`
(`PanelContent.css:1-8`, `align-items: center; justify-content: center`) and worried about a short
table being vertically centred. **That rule is overridden for this surface** by
`.panel-content--table` (`PanelContent.css:110-116`): `flex-direction: column;
justify-content: flex-start; align-items: stretch`. Consequences:

- `align-items: stretch` in a **column** flex stretches children on the cross axis (horizontal), so
  the frame is already full-width — **`width: 100%` is unnecessary** and is withdrawn.
- `justify-content: flex-start` means a short table already top-aligns — **the vertical-centring
  worry was a non-risk** and is withdrawn.
- The main axis is vertical, so the frame's height comes from **flex**, not from a percentage.

**NINTH ASSUMPTION (round 4 CR1, structural).** After the reframe the frame is a flex sibling of
`.panel-content__disclosure` (`TableRenderer.tsx:448-449`), which is `flex-shrink: 0` — it carries
this ticket's own partiality message and the Load-more control. A frame with `height: 100%` survives
only via the default `flex-shrink: 1`; under pressure from a non-shrinking sibling that is fragile
and can overflow the panel. **The shrink-safe form is `flex: 1; min-height: 0`.**

Required:

- The **frame** takes `flex: 1; min-height: 0` for the `full` variant — **not** `height: 100%`, and
  **not** `width: 100%`.
- The frame is `display: flex; flex-direction: column` so chrome and the scroll container stack.
- `.ui-data-grid--full` changes from `height: 100%` to `flex: 1; min-height: 0` **within** the frame.
  Keeping `height: 100%` would overflow, since chrome now shares the frame.
- `--preview` keeps `max-height: 320px` on the scroll container, not the frame — it caps the
  scrollable area, not the chrome.
- **Frame chrome carries `flex-shrink: 0`.** The frame is a column flex container; the toolbar,
  quick-filter and filtered-empty message must not be squeezed when the scroll container competes
  for space. No defect was constructible at an achievable panel size (`itemHeights.min: 4` ×
  `rowHeight: 52` leaves ~200px against ~140px of chrome), so this is hardening, not a fix — but
  pinning it costs one declaration and removes the whole question.
- Verify live that the sticky still engages after the change, on **both** surfaces.

**Extended no-scroll invariant.** D10-2's invariant covered frame chrome only. It must also cover
`.panel-content__disclosure`: **neither frame chrome nor the disclosure may require scrolling
`.panel-content--table` to become visible.** The disclosure is the partiality message — hiding it
below the fold reproduces the exact defect this ticket exists to fix, on a different element.

**Highest-risk item in D10**, because D10-7 depends on it and the failure is silent: the grid still
renders, the sticky simply stops engaging.

### D10-4 — Re-home the chrome's presentational CSS (round 2 CR2)

The moved chrome currently gets its entire visual treatment from table-cell selectors that will no
longer match, and D10 must not ship it as bare controls on a bare background:

- `.ui-data-grid__filter-toggle-row th` (`:274-279`) — `background: var(--app-surface-soft)`,
  `border-bottom`, `padding: var(--space-1) var(--space-2)`
- `.ui-data-grid__filter-row th` (`:185-190`) — same recipe
- `.ui-data-grid__empty-row` (`:402-405`) — `padding: var(--space-4) var(--space-3)`, `text-align: left`

Required: frame-level replacements carrying the same surface, border and padding, expressed in
DESIGN.md tokens (`--app-surface-soft`, `--app-border-subtle`, `--space-*`) — not re-derived values.

**Density.** `ui-data-grid--condensed` and its siblings live on `.ui-data-grid`, which after the
reframe is a **sibling** of the chrome, not its ancestor, so `.ui-data-grid--condensed
.ui-data-grid__table th` can no longer reach the toolbar. State explicitly whether the chrome
responds to density; if it must, the modifier class moves to (or is mirrored on) the frame, and that
is stated rather than left implicit.

### D10-5 — What this deletes rather than fixes

With no `colSpan` chrome cell left:

- `stickyCellMaxWidth` state + effect (`:267-297`) — **finding 3 dies at the root; no
  `ResizeObserver`, no resize listener, nothing measures a viewport WIDTH**
- `.ui-data-grid__sticky-cell` and its specificity-boosted `overflow: visible` overrides
- `stickyOffsets.toggle`, `.quick`, and `toggleRowRef`
- **the whole `73a2dd0c` truncation-group reset** — its selector list (`:260-262`) is exactly the
  three removed cells, so it is fully dead CSS and is deleted outright. Deleting it must not touch
  the `thead th`/`tbody td` group governing ordinary data cells.

**Success criterion: `stickyCellMaxWidth` no longer exists and no inline `maxWidth` is computed
anywhere in `DataGrid`.** If the implementation still measures a viewport width, the reframe was not
done.

### D10-6 — The genuinely empty `<tbody>` (round 2 CR6)

D10-8's shell requirement creates a state that has never existed here: a `<tbody>` with zero rows,
where the `colSpan` empty row previously filled it. Specify its rendered appearance — a `min-height`
so it cannot collapse to a 0px sliver, and whether the header's `border-bottom` is left dangling
over nothing. Add it to the light/dark rendered-geometry verification list.

### D10-7 — SEVENTH ASSUMPTION, resolved: the sticky machinery is LIVE, not inert

Round 2 CR4 hypothesised that `stickyOffsets.columns` survives the reframe computing a number
nothing consumes, because `.ui-data-grid` never scrolls vertically. **Measured against HEAD, that
premise is false**, and the correction runs the other way:

- `.ui-data-grid--full { height: 100% }` (`:40-42`) is the operative case: it resolves against
  the definite height of `.panel-content--table` (`flex: 1; min-height: 0`), and is the ONLY thing
  capping the grid today — and it does cap it. (Layout specifics live in D10-3a, which is
  authoritative; do not re-derive them here.) **Its preservation is D10-3a, on which this whole argument
  depends.**
- `.ui-data-grid--preview { max-height: 320px }` (`:36`) is height-capped too, but does NO work for
  this argument: preview is never `filterable`, and `stickyOffsets.columns` only renders under
  `filterable && filterExpanded`. Recorded to prevent it being cited as support it does not give.

Since `.ui-data-grid` is `overflow: auto` on both axes, it IS the sticky scrollport, and it does
scroll vertically. So `position: sticky` on the header row and the per-column filter row **engages**,
and `stickyOffsets.columns` is consumed. The machinery stays.

`stickyOffsets.columns` is additionally sound on the height-vs-width axis: `thead th` is
`nowrap` + ellipsis, so header height is width-invariant, and the offset does not need re-measuring
on resize the way `stickyCellMaxWidth` did. Retriggering remains its existing dependency set minus
the removed members.

**This must still be confirmed live, per surface, by measurement** — panel and modal — as part of
implementation. If measurement contradicts the CSS above, delete `stickyOffsets`, the
`useLayoutEffect`, `headerRowRef` and the `position: sticky` declarations, and say so; do not leave
machinery whose output nothing consumes.

### D10-8 — The `rows.length === 0 && filtering` state

The table SHELL must still render: `<thead>`, the header row, and the per-column filter row. Only
`<tbody>` rows are absent. Dropping the shell removes the per-column inputs and traps the user with
no way to clear the filter that produced the empty result. The filtered-empty message renders as
frame chrome (D10-2). Distinct from the un-filtered empty case, which early-returns at `:382`.

### D10-9 — Test guards: full enumeration and named replacements (round 2 CR5)

The reframe invalidates, at minimum, `DataGrid.test.tsx`: `:405` (sticky-cell carries the pin),
`:421` (per-row sticky-cell wrapper counts), `:749` (filtered-empty renders as a `colSpan` row inside
`tbody`), `:805` and `:840` (three distinct increasing sticky offsets — **`:840` is mutation-failable
and guards machinery D10 KEEPS**, so it must be retargeted, not dropped), `:880` and `:915` (computed
inline `maxWidth`), `:936` and `:948` (static-source guards on the reset rule and on
`.ui-data-grid__sticky-cell`). `:730` (filtered-empty renders the full grid shell) SURVIVES and is
the existing guard for D10-8.

Each invalidated test is either retargeted so it still fails under mutation, or deleted with a stated
reason the property is now structurally impossible rather than merely untested. **A guard deleted
because it broke is a defect symptom.**

Three replacement guards are required, each shown failing by mutation:
(a) no element inside `<table>` carries `colSpan`;
(b) no inline `maxWidth` is computed anywhere in `DataGrid` — the failable form of the success criterion;
(c) toolbar, quick-filter and filtered-empty message all precede `.ui-data-grid` in DOM order — the
failable form of D10-2's ordering.

### D10-10 — Invariants that must survive (verify, do not assume)

1. **Persistence** — minimal patch `{ config: { columnFilters } }`, never spreading `output.config`;
   user-edit-only; debounce FLUSHES on unmount; `canWrite` pre-check.
2. **Predicate** — matches `formatCell(value)`, the exported renderer, so match source and rendered
   text cannot drift.
3. **Supersession** — exactly ONE loaded-scope message: `showLoadedScopeNote = rowsTruncated || filtering`.
4. **Removal seam** — one `LoadedScopeDisclosure`, one marker comment, grep-removable.
5. **HEL-448 modal re-gate** — `Sort covers only the loaded rows.` had NEVER rendered in the panel
   detail modal since `adadb5d4` (gated on `usingPagination && paginationHasMore`, but
   `PanelDetailModal.tsx:400-404` passes no pagination props). Re-gated on branch-independent
   `rowsTruncated`. **A fix to shipped behaviour; it must land.**
6. **Collapsed filters must not hide an active filter** — carried by the `Filters (n)` badge; this is
   why D10-2's ordering is load-bearing.
7. **Drag-resize** still works (`table-layout: fixed` retained) and ordinary data-cell truncation is
   undamaged by the D10-5 deletion.
8. **No element inside `<table>` spans more than one column.** This single sentence makes findings
   1–3 structurally unreachable rather than merely fixed; D10-9(a) is its failable form.

### D10-11 — TENTH ASSUMPTION, owner-ruled: chrome must not exceed its container

**Owner ruling: auto-collapse below a height threshold.** `accept-scroll` was considered and
rejected; do not reopen it.

**The defect (evaluation-2, measured).** At the app's enforced minimum panel height (262px item →
159px of `.panel-content`), with a filter matching nothing, the chrome stack is **178px**. The
filtered-empty message runs to y=315 against a fold at 288 — cutting "Clear filters" and "Load more"
through their middle — and `.ui-data-grid` is squeezed to **0px**, so the header row and every
per-column filter input vanish. This is exactly what D10-8 exists to prevent, and it is the same
class as the three halting findings: chrome that does not fit its container, now on the OUTSIDE of
the table rather than the inside.

**D10-3a's dismissal of this was wrong in both terms** and is withdrawn. It claimed "~200px against
~140px of chrome". The card's title bar and footer consume ~103px of the 262px minimum, leaving 159px
not ~200px; and the real chrome stack is 178px not ~140px. The figures were reasoned, not measured.
Recorded rather than deleted, because the failure was accepting a non-risk finding without checking
its arithmetic.

**The remedy.** Below a height threshold, the filter chrome renders COLLAPSED by default — the
existing toggle affordance, not a new mechanism. This preserves:

- **D10-8** — the grid keeps a usable height, so the header and per-column inputs never vanish.
- **D10-2/D10-3a's no-scroll invariant** — the partiality message stays above the fold, so a filter
  matching nothing still cannot render as a confident wrong answer.
- **The owner's earlier four-condition ruling** — collapsed must not hide an ACTIVE filter, and the
  `Filters (n)` badge remains visible and carries the count.

**Threshold derivation — required, and a bare number is not acceptable.** State in
`files-modified.md`:

1. The **measured** height of each chrome element (toolbar, quick-filter row, filtered-empty
   message) and of the minimum grid height that keeps the header row plus one per-column filter input
   usable — measured in the running app, both surfaces, not computed from CSS.
2. The threshold **as a derivation from those measurements**, not a literal chosen to make the
   observed case fit. A number picked to fit one case is how this ticket stalled the first time.
3. **Behaviour at one pixel either side.** At threshold−1 the chrome collapses; at threshold+1 it
   does not. Show that neither state is broken — in particular that the expanded state at
   threshold+1 still satisfies the no-scroll invariant, since that is the boundary where the two
   regimes meet and the one most likely to be wrong.
4. Whether the threshold is expressed against `.panel-content`'s height or the panel item's height,
   and why — they differ by the ~103px of title bar and footer, which is precisely the confusion that
   produced the withdrawn arithmetic above.

Collapse is a **default**, not a lock: a user who expands filters in a short panel gets the expanded
chrome and whatever scrolling that implies. The invariant governs what the app CHOOSES to render, not
what the user may override.

### D10-12 — ELEVENTH ASSUMPTION, owner-ruled: threshold AND floor, not either

**Owner ruling: `raise-threshold-and-floor` — BOTH remedies.** `bound-expanded-message` was
considered and rejected. Do not reopen either.

**The defect (evaluation-3, measured in the real app).** The 151px threshold derives from
`37 + 37 + 34.5 + 34.5 = 143`, which omits the filtered-empty message as "separately bounded". That
is true only of the **compact** message (44px, measured). Expanded, the message is the full 86px
block, so real expanded chrome in the filtered-empty state is `37 + 37 + 86 = 160px` — **more than
the 151px threshold the app uses to decide it may expand.** Reproduced with no forced styles and no
user override, detail modal at 1100×325: frame 167px → app auto-expands → `.ui-data-grid` is **7px**,
containing the header row and 61 per-column filter inputs. A forced sweep maps the band: 149/150
healthy (grid 68/69px); 151/152/160 all grid 0px.

Same shape as D10-3a's withdrawn arithmetic: **not a number slightly off, but the wrong term set
summed.**

**Both remedies are required, and they are NOT redundant. A later reader will see the floor and the
threshold as overlapping and delete one. Do not.**

1. **Raise the threshold to the honest expanded floor** — the expanded chrome INCLUDING the full
   message, plus a grid height that keeps one header row and one per-column filter input usable
   (~229px, to be re-derived by measurement, not adopted as a literal). This fixes the path where
   **the app** chooses to expand.
2. **Add a `min-height` floor on `.ui-data-grid`** — at least one header row plus one per-column
   filter input. This fixes the path where **the user** expands filters in a short panel, which
   D10-11 explicitly sanctions ("collapse is a default, not a lock"). Without the floor, the identical
   crushed shell remains **one click away**; the threshold makes the state unchosen, only the floor
   makes it unreachable.

**Why scrolling is acceptable on the override path and nowhere else.** D10-11 already permits it
there: a user who expands filters in a short panel gets the expanded chrome and whatever scrolling
follows. So when the floor forces chrome past the container, the panel scrolls — and the no-scroll
invariant still holds where it matters, in states **the app** chooses. That asymmetry is the whole
design; it is not an inconsistency to tidy away.

**Accepted consequence (owner-ruled, not a regression).** With the honest threshold, the dashboard
panel collapses filters by default at its **first two size steps**, expanding only at the third.
This is what auto-collapse is for. Recorded here because it is a visible behaviour change and must
not be discovered after the fact.

**Required guard (mutation-failable).** Shrink the container and assert the grid retains at least one
header row plus one per-column filter input. **A floor with no guard is the same trap one layer
down.** Note `:861` guards "the explanation survives collapse"; nothing guarded "the table shell
survives collapse" — which is why this defect and the cycle-1 defect both shipped with a fully green
suite. Name the invariant, then guard it.

### D10a — disclosure labelling is now CONFIRMED

The owner has confirmed the disclosure. Every "pending owner confirmation", "NEVER owner-approved"
and "deliberately trivially removable" label is now false and must be stripped —
`LoadedScopeDisclosure.tsx:7` and `TableRenderer.tsx:451-454`. The removal seam (invariant 4) stays;
it is good structure independent of the labelling. Stop describing the disclosure as provisional.
