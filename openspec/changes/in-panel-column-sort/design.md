# Design — HEL-448 In-panel column sort

## Context

Rebased onto `origin/main` @ `6b081b86` (HEL-1022) mid-Planning. **This is not a greenfield sort
feature.** HEL-1022 shipped a shared sorting system in `frontend/src/shared/ui/`:

- `useSortedRows(rows, columns, defaultSort)` — client-side sort + comparator
- `SortableTh` — a `<th>` whose whole contents are a button, with the canonical FontAwesome glyph
  (`faSort`/`faSortUp`/`faSortDown`) and `aria-sort`
- `SortableTable` — the shared shell for the four overview list tables (shell ONLY)

DESIGN.md documents all three (~lines 452-475, 520-540). The bar for this ticket is that the panel
table's sort **is** that system, not that it resembles it.

Table panels reach `DataGrid` through `TableRenderer`, rendered by `PanelContent.tsx:131-143` after
reading the bound Output's config via `readTableConfig(output.config)`.

### Ground truth established during Planning (do not re-litigate)

1. **No panel-level table config exists.** HEL-909 retired it; `panelsSlice.ts` has no column-config
   persist path and column widths are local-only `useState` (`TableRenderer.tsx:61-67`). Owner
   ruling: sort persists **Output-scoped** on `TableOutputConfig`. Table config is NOT returned to
   the placement record.
2. **Rows are NOT fully client-loaded.** `panelThunks.ts:296` carries a COMMENT saying "pagination
   is sliced on the client"; the CODE at `:309-311` computes a server-side `offset`/`limit` and
   `panelsSlice.ts:204-207` APPENDS each page. A comment is not evidence. Page sizes: 50 in the
   dashboard grid (`PanelCard.tsx:88`), 200 in the detail modal (`usePanelData.ts:66`), server
   `Page.MaxLimit = 500`.
3. **`PATCH /api/outputs/:id` MERGES, it does not replace.** `OutputService.scala:247` →
   `mergeConfig` (`:274-282`) = `existing.fields ++ patch.fields`, shallow, with a one-level deep
   merge for `legend`/`tooltip`/`seriesColors`/`axisLabels` only.

## Goals / Non-goals

**Goals.** Sortable panel-table headers built from the HEL-1022 system; sort applied across the
loaded row set; Output-scoped persistence; `aria-sort` and keyboard operation inherited from
`SortableTh`'s contract; visual cohesion with both the list tables' sort and the panel's own
resize/density affordances.

**Non-goals.** Multi-column sort; a server-side sort endpoint; a third "unsorted" click state;
forking or extending `useSortedRows`; sort on the `preview` variant; building HEL-451/465/469;
restoring column-width persistence.

## Decisions

### D1 — Reuse `useSortedRows` as-is; two-state cycle (owner ruling)

`toggleSort` cycles `asc ⇄ desc` only. `SortState<Key>` has no "none" variant and `defaultSort` is
required — unsorted is not representable in that type. Three-state was therefore not available by
reuse; it needed either extending the hook (changing the four list tables HEL-1022 just shipped) or
forking it (the divergent second dialect the cohesion gate exists to prevent). The owner chose
reuse. **Do not add a "none" direction.**

**Accepted cost:** once a panel table is sorted, no click returns it to the pipeline's own row
order. Stated plainly in the PR body. No affordance is invented for it; if it matters in practice it
is a follow-up ticket, not a widening of this diff.

### D2 — Initial unsorted render via a sentinel `defaultSort`

A panel table's columns are arbitrary runtime row keys, so no real column can be nominated as a
default, and a never-sorted panel must render in the pipeline's own row order.

`useSortedRows` already handles this **without modification**: `columns.find(c => c.key ===
sortState.key)` returns `undefined` for a key matching no column, and the hook then returns `rows`
unchanged. So `defaultSort` is a documented sentinel key that matches no column
(`UNSORTED_SENTINEL`), which renders source order and leaves every `SortableTh` at its neutral
glyph (`sortState.key === key ? direction : null` → `null` for all).

**Coupling risk:** this relies on the hook's no-match passthrough. That behaviour is real but
UNSPECIFIED — it is load-bearing here in a way it is not for the list tables. Two mitigations, both
REQUIRED, not optional:
1. A test naming the dependency that **fails if the passthrough is removed**. A guard that survives
   mutation is not a guard.
2. A comment at the sentinel's definition pointing at the `useSortedRows` behaviour it relies on, so
   a future refactor of the hook has a chance of noticing. The comment must also record that
   DESIGN.md (~458) says `defaultSort` "should match the page's backend-driven default order" — the
   sentinel is a DELIBERATE documented deviation from that line for a surface whose columns are not
   known until runtime, not an oversight.

### D3 — Reuse the comparator; coerce `unknown` at the boundary only

`useSortedRows`' comparator is used unchanged. **No new comparator, no new glyph.** Its two solved
edge cases are inherited, not reimplemented: nulls last in BOTH directions (checked outside the sign
flip), and `Instant.toString()` shapes parsed to epoch millis (a `localeCompare` with
`numeric: true` inverts order across differing fractional-second widths — the exact bug HEL-1022
fixed).

Panel rows are `Record<string, unknown>` but `SortValue` is `string | number | null | undefined`, so
each column's `getValue` coerces at the boundary. **Numeric-looking STRINGS must be coerced to
numbers here — letting them "pass through" as strings fails the ticket's numeric-sort AC on this
surface.** `useSortedRows.compareNonNull` takes its numeric branch (`a - b`) only when BOTH values
are `typeof number`; strings fall to `localeCompare(..., { numeric: true })`, which compares digit
RUNS, so `["1.5","1.25","1.9","10","2"]` orders as `1.5, 1.9, 1.25, 2, 10` — decimals inverted
(verified in this repo's node). HEL-1022 never hit this because the four list tables' `getValue`
returns real typed numbers off typed models; a panel's `rawRows` branch is `string[][]` where EVERY
value is a string, and CSV-sourced snapshots carry numbers as strings on the pagination branch too.

The rule, per value (not per column):
- `number`, `null`, `undefined` — pass through.
- `string` — first, **a string whose trimmed value is empty (`""` or whitespace-only) coerces to
  `null`**, so the hook's blanks-last handling applies to it. Then, coerce to `Number(v)` when
  `Number.isFinite(Number(v.trim()))`; otherwise pass the string through. ISO date strings are
  unaffected (`Number("2026-09-08T00:00:00Z")` is `NaN`), so the hook's own `Instant.toString()`
  epoch-millis path still applies.

  **Why the empty-string case must become `null`, not a passed-through string.** Two traps sit next
  to each other and only one is obvious. `Number("") === 0`, so coercing a blank naively sorts it as
  zero. But merely *guarding* against that and letting `""` through as a string is also wrong:
  `useSortedRows`' blanks-last logic keys on `null`/`undefined` ONLY (`useSortedRows.ts:58-60`), so a
  passed-through `""` reaches `localeCompare` and sorts FIRST ascending —
  `"".localeCompare("-5", undefined, { numeric: true })` is `-1` (verified in this repo's node;
  `["3","","-5"," ","10"]` sorts to `"", " ", "-5", "3", "10"`). On the all-strings `rawRows` branch
  that means every blank leads the ascending sort, contradicting the ticket AC and this change's own
  blanks-last spec scenarios. Mapping empty/whitespace-only to `null` routes it into the hook's
  blanks-last branch and satisfies both.
- `boolean` and everything else — stringify by REUSING `formatCell`'s semantics
  (`DataGrid.tsx:108-112`), which `JSON.stringify`s objects. A bare `String(v)` would yield
  `"[object Object]"` for every object, collapsing them to one tie; reusing `formatCell` keeps the
  sort key equal to the rendered text.

Per-value rather than per-column is deliberate: a mixed column yields a number on one side and a
string on the other, `compareNonNull` falls to its string branch for that pair, and the result is
merely a stable non-numeric ordering rather than an error.

This is a value adapter, not a comparator — no ordering logic is written here, and the shared hook
still owns nulls-last, dates and stability.

`columns` and `defaultSort` must be stable references (`useMemo`), per DESIGN.md's note that the
hook memoizes on `[rows, columns, sortState]` by identity.

### D4 — Why `SortableTh`/`SortableTable` cannot be rendered directly

Required by the owner instruction to name the specific incompatibility. Two, both in `SortableTh`:

1. **`SortableTh` renders its `children` inside the `<button>`.** `DataGrid`'s resize handle is an
   interactive `<span role="separator" tabIndex={0}>` inside the `<th>`
   (`DataGrid.tsx:240-250`). Nesting interactive content inside a `<button>` is invalid HTML, and
   every resize drag would also fire the sort.
2. **`SortableTh` exposes `className` but no `style`.** `DataGrid` sets
   `style={{ width: appliedWidth }}` on each `<th>` — that *is* the column-width mechanism
   (`DataGrid.tsx:229-236`). There is no prop to carry it.

`SortableTable` is further out of scope: it owns the scroll wrapper + `<table>` + `<thead>`, all of
which `DataGrid` already implements with its own class family, density variants and `useScrollEdges`
usage.

What IS reused: `useSortedRows` (hook + comparator), `SortState`, and `SortableTh`'s exact glyph set
(`faSort`/`faSortUp`/`faSortDown`), `aria-sort` vocabulary (`ascending`/`descending`/`none`),
whole-header-is-the-button interaction, and its CSS idiom. `DataGrid`'s header button reuses the
`.sortable-th__btn`/`.sortable-th__glyph` classes rather than inventing a parallel family, so the
two surfaces cannot drift apart visually.

**Extending `SortableTh` with a `style` pass-through and a trailing-content slot** so the panel
table could render the real component was offered to the owner as a larger, better change touching
an adjacent surface. It was not taken up for this ticket; it is not done silently here.

### D5 — Storage: `columnSort`, a flat sibling on `TableOutputConfig`

```ts
export interface TableOutputConfig {
  fieldMapping: Record<string, string>;
  columnOrder?: string[];
  columnSort?: SortState<string> | null;   // HEL-448 — { key, direction }
}
```

**Named `columnSort`, not `sort`:** `TimelineOutputConfig.sort: "asc" | "desc"` already exists in
the same file (`outputConfigTypes.ts:66-69`, read by `readTimelineConfig` at `:145`). Two different `sort` keys with two
different types in one config file would have been inherited three more times by this lane.
`columnSort` also pairs cleanly with the documented siblings below.

**Vocabulary matches runtime:** the persisted value is `SortState<string>` — `{ key, direction }`,
the same shape `useSortedRows`/`SortableTh` use. No translation layer.

**Flat siblings, confirmed by ground truth:** `mergeConfig` deep-merges only four hardcoded chart
keys, so any *nested* container (`tableColumns: {...}`) would be replaced wholesale on every patch,
while flat top-level keys each merge correctly. **This settles the lane's extension point:**
HEL-451/465/469 add `columnFilters`, `pinnedColumns`, `columnFormats` as their own flat siblings,
each read tolerantly with an absent-field default that renders exactly as today. No sibling should
invent a nested container or repurpose `columnSort`.

`readTableConfig` reads `columnSort` tolerantly: an object with a string `key` and a `direction` of
exactly `"asc"`/`"desc"`, else `undefined`. A key naming a column absent from the data needs no
special handling — `useSortedRows` already returns rows unchanged for it (D2).

### D6 — Persistence: minimal patch, never a spread

The write is **`updateOutput(outputId, { config: { columnSort } })`** — the minimal patch. Do NOT
spread `output.config`: it comes from `useOutputMeta`, a per-mount `useState` snapshot never
refreshed after a write, so spreading re-sends a stale `fieldMapping`/`columnOrder` and turns every
sort click into a lost-update against any concurrent Output edit. The backend merge preserves the
untouched keys.

Because the cycle is two-state (D1) there is no clear-to-unsorted path, so there is no
clearing-persistence question and no explicit-JSON-`null` semantics to specify.

`TableRenderer` holds the sort via `useSortedRows`, seeded from the persisted `columnSort` (or the
D2 sentinel when absent), and writes back debounced ~300 ms so rapid asc/desc toggling collapses
into one PATCH.

**The write fires on a user activation ONLY — never on mount, never on a config-seeded state
change, and the sentinel key is NEVER written.** This is not a nicety. `useSortedRows` holds
`sortState` in `useState`, so the obvious implementation — a debounced effect keyed on `sortState` —
fires on mount with the sentinel and PATCHes
`columnSort: { key: "<sentinel>", direction: "asc" }` into the Output config of every table panel a
user merely VIEWS. D5's tolerant read (string `key`, direction exactly `asc`/`desc`) would accept
that value, so it round-trips and persists forever. It is visually benign because of D2's
passthrough, which makes it silent — the worst kind of defect. It would also make D7's non-owner
suppression path fire on every view rather than on a real interaction.

Concretely: the persist is invoked from the `onSort` activation handler, not from an effect
observing `sortState`; and the handler guards `key !== UNSORTED_SENTINEL` before writing.

**The debounce MUST flush on unmount, not cancel.** The standard `useRef` + `clearTimeout`-on-cleanup
idiom cancels the pending PATCH when the component unmounts — and closing the panel detail modal
unmounts `TableRenderer`, which is exactly the path the AC "sort persists across panel detail-modal
open/close" and Playwright step 5.4 exercise. A cancelling debounce turns that AC into a timing race
the user loses whenever they close the modal inside the debounce window. Flush the pending write in
the cleanup instead.

**Sentinel value:** pick a token that cannot collide with a real JSON column key — a `__helio_`
prefix (e.g. `__helio_unsorted__`) — fixed at the definition site the D2 comment already requires.

**Naming trap:** `PanelContent.tsx:134` passes `panelId={outputId}` — that prop already carries an
Output id despite its name, and it is declared (`TableRenderer.tsx:11-13`) but not destructured.
Rename it `outputId` while touching it rather than adding a second prop with the same value.

### D6a — `TableRenderer` normalizes BEFORE branching (required structure)

**Seeding note (load-bearing):** seeding the persisted `columnSort` through `useSortedRows`'
`useState` initializer is correct ONLY because `PanelContent.tsx:104-110` withholds `TableRenderer`
behind a skeleton until `useOutputMeta` resolves, so the stored value is present on first mount.
`useSortedRows` has NO reseed path — a later `defaultSort` prop change is ignored. If that skeleton
guard is ever relaxed, the stored sort silently stops applying. Record this at the seeding site.


`useSortedRows` is a hook and must be called unconditionally, but `TableRenderer.tsx` early-returns
in three places (`paginationRows` at `:73`, `rawRows` at `:104`, empty skeleton at `:119`) and the
two data branches derive DIFFERENT rows and DIFFERENT columns — `paginationRows` are already
`Record<string, unknown>`, while the `rawRows` branch builds records from `headers`/positional
indices at `:105-107`. A per-branch hook call violates rules-of-hooks, which
`eslint.config.cjs:70,79` enables as an ERROR under the zero-warnings policy, so it would not even
lint.

Required shape: **one pre-branch normalization** producing a single `{ rows, columns }` (plus the
"no rows" case), feeding **one** `useSortedRows` call. Memoize the normalized `rows` as well as
`columns`/`defaultSort`: the `rawRows` branch rebuilds its record array every render
(`TableRenderer.tsx:107`), which would otherwise defeat the hook's `[rows, columns, sortState]`
memo on every render. Cheap at 50-500 rows, but free to avoid here. with the three branches reduced to
presentation. This is specified here rather than left to the executor so that a restructure of an
existing component is a planned, reviewable decision rather than an improvisation under the
"keep changes focused" rule — and so the final gate has something to judge it against.

### D7 — Non-owner writes degrade silently to session-local (owner ruling)

The config write goes through `OutputRepository.updateOwned` (`:256`), an RLS owner-only write, so a
viewer/editor grantee on a shared dashboard would fail the PATCH on **every** sort click. Ruling:
when the caller cannot write the Output, **suppress the persist and keep the sort session-local** —
no error toast, no owner-only restriction, no hint affordance. Grantees can sort; it just does not
stick. Stated in the PR body.

`validateFieldMapping` (`OutputService.scala:113-126`) is safe for a `columnSort`-only patch:
`table` has no binding slots, so merged-config validation cannot reject it.

### D8 — Output-scoped convergence is on load, not live

Each `TableRenderer` holds its own sort state and each `PanelContent` has its own `useOutputMeta`
fetch; there is no Redux entry and no cross-panel subscription. Sorting panel A does **not** move
panel B in the same session — they converge **on next load**. The spec and the PR body say exactly
that. Owner-accepted is not the same as inaccurately described.

### D9 — Sort covers loaded rows only (owner ruling: client-side only)

With server-side offset/limit paging (Context §2), a client-side sort orders only the rows currently
fetched: 50 in the dashboard grid (`PanelCard.tsx:88`), 200 in the detail modal
(`usePanelData.ts:66`), `Page.MaxLimit` 500. Sorting "revenue desc" on a 10,000-row Output surfaces
the largest of the loaded 50 and presents it at the top of the table.

**Owner ruling: client-side sort only.** This ticket stays frontend-only. Rejected explicitly:
- a sort parameter on `GET /api/outputs/:id/rows`;
- the column-whitelist/typing question for arbitrary `node_snapshots` JSON keys;
- any change to pagination reset semantics;
- gating the sort control on a fully-loaded set. **The control stays live at all times, including
  while rows are truncated** — a control that goes dead on exactly the large Outputs where sorting
  matters most is worse than a partial sort.

Sort the rows that are loaded, always, using `useSortedRows` as shipped.

The ticket's original exclusion of a server-side endpoint was justified by "rows are already fully
client-loaded", which Context §2 refutes. The exclusion was re-ruled on its merits (v0.7 scope
discipline), not on that false reason. **The deferral is owned by a real ticket: HEL-1027**, which
records the concrete numbers and the false-premise correction.

### D9a — Truncation qualifier (NOT owner-approved; lowest-confidence item in this design)

**Provenance, stated because it matters:** the owner ruled on the sort MECHANISM. This disclosure is
a judgment call layered on top of that ruling by the delivery coordinator. It must NOT be described
as owner-approved, in the PR body, in code comments, or anywhere else. It is deliberately shaped to
be trivially removable if the owner wants it gone.

Rationale: the failure mode is silent, and a silent wrong answer on "top revenue" erodes trust in
every number on the dashboard.

Constraints — deliberately tight:
- A short qualifier near the EXISTING "Load more" affordance. Reuse existing type and token
  treatment.
- Shown ONLY when the set is actually truncated (`paginationHasMore`); completely silent when
  everything is loaded.
- NOT a new banner, NOT a new component, NOT a tooltip system, nothing that needs its own design
  decision.
- **Objective escalation trigger** (a self-referential "if it costs more than allowed" test never
  fires — an executor who has already written the qualifier reads its own output as within budget).
  STOP and ESCALATE with a screenshot if, at the DEFAULT dashboard-grid panel size, in EITHER
  theme, the qualifier: wraps to a second line; is clipped or truncated by overflow; or displaces,
  overlaps or reflows the "Load more" button. Any of those means the honest version needs real
  design work — do not invent something to get around it.
- The riskiest surface is the small dashboard-grid panel (50 rows, tightest space), NOT the detail
  modal (200 rows). Evidence must include it specifically, in both themes.

## Risks

| Risk | Mitigation |
| --- | --- |
| Hand-rolling a comparator reintroduces HEL-1022's nulls/date bugs | Comparator is reused unchanged (D3); no ordering logic is written here |
| Sentinel-`defaultSort` passthrough silently breaks if `useSortedRows` is refactored | REQUIRED mutation-failable test naming the dependency, plus a comment at the sentinel definition pointing at the behaviour it relies on (D2) |
| Spreading `output.config` causes lost updates | Minimal patch only; test asserts the PATCH body carries just `columnSort` (D6) |
| `columnSort` vs `TimelineOutputConfig.sort` confusion | Distinct name, decided here not left to the executor (D5) |
| Grantee errors on every sort click | Writability check, silent session-local degrade (D7) |
| Blank string cells lead the ascending sort on the all-strings branch | `getValue` maps empty/whitespace-only strings to `null` so the hook's blanks-last branch applies (D3) |
| Sentinel silently PATCHed into every table Output on mere view | Persist on user activation only, never on mount; sentinel key never written (D6) |
| Per-branch hook call fails rules-of-hooks under the zero-warnings policy | One pre-branch normalization, one `useSortedRows` call (D6a) |
| Panel sort visually diverges from list-table sort | Reuses `SortableTh`'s glyph and CSS classes (D4); cohesion gate below |
| Sort misread as covering the whole Output | Ruled client-side-only (D9); truncation qualifier (D9a); deferral owned by HEL-1027 |
| `main` moves again on frontend files | Rebase before PR, re-run the visual comparison |

### D10 — Visual cohesion is judged against the running app

The affordance must read as the same system as BOTH the list tables' sort (HEL-1022) and the panel's
own resize/density affordances — verified in the running app in **light and dark**, not by a token
check, which is necessary but not sufficient. Known light-theme hover token collision: HEL-866,
HEL-496. Baseline and post-change screenshots are saved and referenced by path so the final gate
inherits a comparison rather than a claim. If cohesion requires an adjacent surface beyond scope, or
the two existing surfaces disagree with each other, that is escalated with screenshots for an owner
ruling — never resolved by agent judgment, never silently widened, never quietly shipped incohesive.

## Test plan

Jest: `getValue` boundary coercion; sentinel-`defaultSort` renders source order (D2 coupling);
two-state toggle and cross-column reset via the shared hook; `aria-sort` values incl. `"none"`;
Enter/Space activation; no sort controls on `preview`; resize does not alter sort; persisted
`columnSort` round-trips through `readTableConfig`; the PATCH body contains only `columnSort` while
`fieldMapping`/`columnOrder` survive; non-writable Output does not PATCH; sort spans the whole
loaded set and newly loaded rows merge into the order.
Playwright: persistence across detail-modal open/close and reload; the D10 light/dark cohesion
comparison against both neighbouring surfaces.
