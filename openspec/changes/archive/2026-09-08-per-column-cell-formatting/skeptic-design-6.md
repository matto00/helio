## Skeptic Report — design gate (restart round 3, skeptic-design-6.md)

Cold read at `a6bde0d3` (`git log --oneline -3`). Every address below was read from the file at that
commit with `sed -n`, not inferred.

### What I verified (with evidence)

**The sweep of EXECUTABLE addresses is complete.** Every address a task or design decision tells the
executor to mutate, edit or wire is correct at `a6bde0d3`:

| cited | verified |
| --- | --- |
| `TableRenderer.tsx:243` (tasks 3.1/3.2/3.6, design D1/D6) | `getValue: (row) => getSortValue(row[col.key])` — exact |
| `TableRenderer.tsx:127-130` (tasks 3.2b/3.6) | `// \`formatCell\` (not a bare \`String(v)\`) so the sort key matches the / rendered cell text …` through `return formatCell(value);` — exact, and NOT the `:104-113` blank-trap block |
| `DataGrid.css:147` + `tbody td :197-204` (task 3.3, D3a) | `text-align: left` inside `.ui-data-grid__table thead th`; `tbody td` block is `:197-204` with no `text-align` — exact |
| `DataGrid.tsx:803` (tasks 3.6, D1) | `<td>{col.render ? col.render(row, value) : formatCell(value)}</td>` — exact, and the only `render` consumer |
| `tableFilterPredicate.ts:13` and `:5-9` (tasks 3.5/3.6) | `return formatCell(value)...` at `:13`; the HEL-451 D2 contract comment occupies `:5-9` — exact |
| `buildOutputConfig.ts:68-69` (task 1.4) | `fieldMapping` / `columnOrder`, table case, `columnFormats` genuinely absent — exact |
| `MetricRenderer.tsx:28` (task 2.1) | the hardcoded `currency: "USD"` line — exact |

**Round 2's CR1/CR2/CR3 are properly fixed.** 3.1/3.2 both say `:243`; 3.2b and 3.6 both say
`:127-130` with 3.2b explicitly OWNING the edit and 3.6 referencing for context; 8.3's falsified
"filter composition is untested" clause is replaced with the true statement plus the supersession.
CR5's Impact omission is fixed — `tableFilterPredicate.ts` is now listed with both the match-source
change and the `:5-9` comment rewrite.

**Both deliberate non-sweeps were right.**
- design.md D3a and task 3.3 quoting `DataGrid.css:72` "(as it then was)": correct. Both sentences
  exist to mark the halted draft's claim FALSE, and both immediately state the verified `:147`
  and the `tbody td` inheritance beside it. Rewriting the quote to `:147` would make a claim that is
  false read as true and destroy the reason the correction exists.
- Not editing `skeptic-design-{1..5}.md` / `workflow-state.md`: correct. A gate report is a record of
  what was verified when; retroactive edits would falsify the audit trail. No executor instruction
  routes through them.

**Task 3.2's guard actually goes red — I checked the comparator, not the prose.** Under the
`:243` call-site mutation the currency column's values become `"$9.99"` / `"$1,234.56"` and reach
`compareNonNull`'s string branch (`useSortedRows.ts:51`,
`localeCompare(…, { numeric: true, sensitivity: "base" })`). Executed:
`"$9.99".localeCompare("$1,234.56", undefined, {numeric:true, sensitivity:"base"})` → `1`, so
ascending yields `$1,234.56, $9.99` — the reverse of the raw numeric order `9.99, 1234.56`. The
mutation is expressible and the assertion flips. (Worth checking: `numeric: true` can defeat exactly
this kind of fixture; here it does not, because the grouping comma splits the digit run.)

**Tasks read end to end, without design.md beside them, as a buildable change.** §1 shape+persist →
§2 formatters → §3 wiring (render / sort exclusion / filter / align) → §4 pinning → §5 UI → §6 gates
→ §7 boundary → §8 handoff. 3.3a's one-new-field rule (`align` on `ColumnDef`, format spec resolved
in `TableRenderer`) is consistent with 3.6's single `(value) => string` resolver and 3.5's
"pass the resolved formatter into the predicate" — exactly one buildable reading, and `DataGrid`
needs no format knowledge. 3.4's clear-by-write depends on 1.4's `buildOutputConfig` emission; both
say the same thing about `mergeConfig` being `existing.fields ++ patch.fields`.

**No fix-interaction regression.** D1 sort-raw, D1b call-site mutation, D3b clear-semantics, D4
locale pinning (test-only, 4.2), D5 `rawRows`, D6 asymmetry, D6a filter direction, D6b single
resolver and D3a header+cell coupling are all still stated consistently across design.md, tasks.md
and spec.md; nothing this round's edits touched weakens any of them. Per instruction I did not
re-derive 3.3a or the new spec requirement and found no contrary evidence.
`openspec validate per-column-cell-formatting --strict` → valid.

### Verdict: CONFIRM

Every remaining finding is a stale CONTEXT citation — a "see also" pointer, never an instruction to
edit that address — and each is unambiguous by symbol name. Per the round instruction these are
notes, not another round.

### Non-blocking notes

1. Stale context citations not swept (round 2's CR4, unapplied). Correct values at `a6bde0d3`:
   - `design.md:5` — base is `a6bde0d3`, not `9e995f69` (this is the only place still naming the old
     base, and `design.md:151`/`:211` already say `a6bde0d3`, so the file contradicts itself);
     `formatCell` is `DataGrid.tsx:267`; `ColumnDef.render` is `:32`.
   - `design.md:30` — `getSortValue` is at `TableRenderer.tsx:114` (doc block `:104-113`).
   - `design.md:106`, `tasks.md` 1.2 — `MetricFormat` is `outputConfigTypes.ts:68`.
   - `design.md:185`, `tasks.md` 7.1, `ticket.md:47` — `usePanelData.ts` block is `:95-103`,
     `String(v)` at `:99`.
   - `tasks.md` preamble, `ticket.md:5` — `ColumnDef.render` is `DataGrid.tsx:32`;
     `formatCell` is `:267`.
2. proposal.md's "**Filter composition** — IN SCOPE (superseded)" bullet is still filed under the
   **Non-goals** heading (round 2 CR5's second half). The bullet body is correct and tasks 3.5/3.5a/
   3.6 are the binding instruction, so nothing is misbuilt; a skimmer reads the heading, though.
3. tasks 1.5 still omits `columnFilters` from the survive-the-minimal-patch key list
   (`outputConfigTypes.ts:61`, same shallow-merge property). Third repeat.
4. spec.md still has no requirement covering right-alignment though it is a ticket AC covered by
   task 3.3. Not a plan hole.
