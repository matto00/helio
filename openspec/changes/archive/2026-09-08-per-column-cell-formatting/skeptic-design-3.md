# Skeptic Report — design gate (round 3, skeptic-design-3.md)

## What I verified (with evidence)

All reads are from the worktree at base `origin/main` @ `9e995f69`. I derived every fact below from
the source, not from rounds 1/2 or the orchestrator's summary.

**Round 2 CR1 (mutation site) — ADDRESSED.** `TableRenderer.tsx:196-198` is
`() => columns.map((col) => ({ key: col.key, getValue: (row) => getSortValue(row[col.key]) }))`, and
`getSortValue` (`:97-114`) takes only a value — so the call-site mutation is the only expressible
one. Design D1b and task 3.2 now name `TableRenderer.tsx:197` explicitly and forbid mutating inside
`getSortValue`. Under that mutation a currency column's raw `9.99`/`1234.56` become `"$9.99"` /
`"$1,234.56"` and sort lexically; the currency fixture is genuinely red. Correct.

**Round 2 CR2 (object guard honesty) — ADDRESSED.** Task 3.2a and design D1b/D3 both label the
object assertion a contract document, not a guard, and forbid claiming it as protection. The
labelling is duplicated in workflow-state.md. Consistent across all three artifacts.

**Round 2 CR4 (clear path) — mechanism verified, specification incomplete (see CR2 below).**
`OutputService.mergeConfig` (`backend/.../pipelines/OutputService.scala:274-282`) is
`existing.fields ++ patch.fields` with deep-merge only for
`Set("legend","tooltip","seriesColors","axisLabels")`. So a patch that carries `columnFormats: {}`
does clear, and one that omits the key does not. The design's claim is mechanically right.

**Deferrals — live and accurate.** HEL-1042 (Backlog, parent HEL-346, Medium) and HEL-1033 (Backlog,
Medium) both exist and their descriptions match what the artifacts attribute to them, including
HEL-1033's `usePanelData.ts:87-92` `String(v)` mechanism.

**Stale-comment hazard — real and correctly located.** `TableRenderer.tsx:108-112` carries HEL-448's
*"so the sort key matches the rendered cell text"*. Task 3.2b targets it.

**Round 2 CR3 (right-alignment mechanism) — NOT sound. See CR1.** I read
`frontend/src/shared/ui/DataGrid.css` directly:

```
66: .ui-data-grid__table thead th {
...
72:   text-align: left;
```

and

```
122: .ui-data-grid__table tbody td {
123:   border-bottom: 1px solid var(--app-border-subtle);
124:   color: var(--app-text);
125:   white-space: nowrap;
126:   max-width: 240px;
127:   overflow: hidden;
128:   text-overflow: ellipsis;
129: }
```

`ColumnDef` (`DataGrid.tsx:26-32`) confirmed to have only `key`/`header`/`render`/`width` — the
missing-align finding is right. `DataGrid.tsx:322-325` confirms `render` is consulted only at the
`<td>`. Header content for a sortable column is the `inline-flex` `.sortable-th__btn`
(`SortableTh.css:4-14`), which `text-align` on the `<th>` would move.

---

## Verdict: REFUTE — and I recommend HALTING

CR1 below is a **third defect introduced by round 2's own fix** (D3a, the alignment mechanism), and
CR2 is a fourth inside round 2's fix #4 (the clear path). Per the standing halt rule in
workflow-state.md, the fix-interaction count reaching three means iterative review is discovering
coupled parts faster than it is closing them. **Recommend HALT rather than spending rounds 4 and 5.**
The two CRs are stated concretely anyway, so a decision to continue is not blocked on re-derivation.

Note what did NOT go wrong: the sort/format separation (D1/D1b), the vocabulary decision (D2), the
never-throw fallback (D3), the locale/timezone pinning (D4) and the `rawRows` boundary (D5) all hold
up against source. The instability is confined to the two mechanisms round 2 added.

## Change Requests

1. **D3a / task 3.3 rest on a misread CSS rule, and specify an alignment that would render
   half-applied.** `DataGrid.css:72`'s `text-align: left` is inside `.ui-data-grid__table thead th`
   (block opens at `:66`, closes at `:82`) — it governs the **header**, not the cell. `tbody td`
   (`:122-129`) has **no** `text-align` rule at all. Two consequences:
   - The stated obstacle ("`DataGrid.css:72` hardcodes `text-align: left`, so `render` alone cannot
     do this") is a wrong supporting fact. The real reason `render` cannot align is only that it
     returns content, not layout — which is sufficient, so fix the fact rather than the conclusion.
   - As specified, `align` is set "from the format spec by `TableRenderer`" with the discussion
     entirely about the `<td>`. Aligning only the cell leaves the numeric column's **header still
     left-aligned by an explicit class rule** — a right-aligned column of numbers under a
     left-flushed header, which is exactly the off-pattern result a rendered-geometry check at
     task 5.2 would (at best) catch after the fact. Design D3a and task 3.3 must state that `align`
     applies to the `<th>` **and** the `<td>`, and must say how it beats
     `.ui-data-grid__table thead th`'s `text-align: left` (specificity `(0,1,2)`) — an inline style
     on the `<th>`, or a modifier class with sufficient specificity. Also state that a sortable
     header's content is the `inline-flex` `.sortable-th__btn`, so `text-align` on the `<th>` is what
     moves it (the button is an inline-level box), not a flex change.

2. **The clear path is unspecified exactly where it is most likely to go wrong: the EMPTY case.**
   Design D3b and task 3.4 assert "`buildOutputConfig` emits the whole `columnFormats` object", but
   never say what is emitted when the **last** format is removed. This matters because the sibling
   in the same object literal is `columnOrder: params.tableColumnOrder`
   (`buildOutputConfig.ts:66-69`), typed `string[] | undefined` — the established local idiom is to
   emit `undefined`, which `JSON.stringify` **drops**, which under
   `existing.fields ++ patch.fields` **preserves the old formats**. An executor mirroring the
   neighbouring line writes the bug. Require explicitly: emit `columnFormats: {}` (never `undefined`,
   never conditionally omitted) when the map is empty, and add a test asserting the **serialized
   PATCH body** for the last-format-removed case contains the key with an empty object — not merely
   that `buildOutputConfig`'s return value has it.
   Relatedly, task 3.4's assertion is a Jest test ("set a format, clear it, reload") while the
   property that makes clearing correct lives in `OutputService.mergeConfig`. State that the frontend
   test proves the emitted patch shape only, and name the merge semantics it depends on, so nobody
   later reads a green frontend test as proof the server cleared anything.

3. **Two ticket ACs have no requirement in the spec delta.** `specs/table-panel-column-formatting/
   spec.md` covers persistence, sort-raw-values, never-throw, determinism and the stringified-value
   boundary — but neither "Right-align numeric/currency columns per table convention" nor "a
   per-column formatting control in the config UI, keyboard operable and accessible" appears as a
   requirement or scenario, though both are ticket scope and both have tasks (3.3, 5.1). Add
   requirements with scenarios for each, or the final gate has no spec text to trace those ACs to.

## Non-blocking notes

- Task 3.4's phrase "reload" in a Jest context is ambiguous (remount vs. re-read of config); pick
  one wording so the executor does not invent a fake reload.
- D3's "the fallback IS `formatCell`" is right for the object case, but worth one sentence on a
  `date` spec over a numeric value: `formatCell` renders the bare number, which is the honest
  fallback but is not obviously "date-like" to a reader of the AC. Naming it now prevents a later
  "improvement" that special-cases epoch numbers.
