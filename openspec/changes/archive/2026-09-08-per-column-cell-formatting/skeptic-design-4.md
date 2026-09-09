# Skeptic Report — design gate (restart, skeptic-design-4.md)

Cold read against ground truth at `a6bde0d3` (worktree HEAD, verified `git log --oneline -3`).
Every citation below was read from the file, not inherited from the handoff or the premise
re-validation.

## What I verified (with evidence)

**D6a's central claim — VERIFIED TRUE against the code.**
`frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts:5-9` carries the contract
verbatim as quoted; `:13` is `formatCell(value).toLowerCase().includes(...)`. `formatCell`
(`DataGrid.tsx:267-271`) returns `String(value)` for a number, so a cell whose `ColumnDef.render`
emits `$1,234.56` is matched against `1234.56`. Term `1,234` therefore finds nothing though the
text is on screen, and term `1234.56` matches text that appears nowhere. Both directions confirmed
mechanically. The same path serves the quick filter (`rowMatchesFilters` calls the identical
`cellMatches`), so the break is not confined to per-column terms.

**Judgment on D6a's decision: correct, and the alternative is worse.** Matching raw would preserve
numeric-ish intuitions for one column type at the cost of falsifying HEL-451's shipped, tested D2
invariant (`tableFilterPredicate.test.ts:63,68` assert match-source-is-rendered-text, including the
object/JSON case). Resolving the per-column formatter keeps that invariant literally true and keeps
unformatted columns byte-identical (fallback is `formatCell`), so no HEL-451 test changes meaning.
I would not weaken D2.

**D6's sort/filter asymmetry: right, and stated durably enough.** Sort raw / filter formatted is
the only combination that keeps both "1000 orders above 99" and "a match is visible". D6 names the
unification attempt, names what each direction breaks, and cites the concrete prior defect
(`localeCompare(numeric:true)` ordering `1.5` before `1.25`). That is stated in a form a
"let's unify these" contributor has to argue against. D6b additionally forbids sort from using the
shared resolver and requires correcting the now-false comment — verified the comment is real and
does say what D6b claims (`TableRenderer.tsx:127-129`, returning `formatCell` at `:130`).

**D3a is stated correctly.** `DataGrid.css:147` is inside `.ui-data-grid__table thead th`;
`.ui-data-grid__table tbody td` (`:197-204`) has `white-space`/`max-width`/`overflow`/
`text-overflow` and **no** `text-align`. The only other `text-align: left` in the file is `:428` on
`.ui-data-grid__filtered-empty`, unrelated chrome. Nothing elsewhere in **design.md** contradicts
the owner's th+td coupling ruling. (tasks.md does — CR1.)

**Fifth-consumer hunt: none found.** `formatCell` has exactly four non-definition sites —
`tableFilterPredicate.ts:13`, `TableRenderer.tsx:130`, `DataGrid.tsx:803`, plus the barrel re-export
`shared/ui/index.ts:8`. `col.render` is consumed only at `DataGrid.tsx:803`. Every `title=` /
`aria-label` in `DataGrid.tsx` (`:688,694,723,754,779`) derives from `col.header ?? col.key` or is a
static string — none from a cell value. No row-data export exists. `rawRows` is built inside
`usePanelData` and consumed by `TableRenderer` itself; no separate mobile table stack. The
`LoadedScopeDisclosure` sibling handles counts only.

**D3b still holds at `a6bde0d3`.** `OutputService.mergeConfig`
(`backend/.../pipelines/OutputService.scala:274-282`) is `existing.fields ++ patch.fields`, and
`mergeableSubObjects:272` is still exactly `legend`/`tooltip`/`seriesColors`/`axisLabels` — HEL-451
did **not** add `columnFilters` to it. Only `{}` clears; omission preserves. Unchanged.

**D1 / D1b / D5 unchanged by the restart's edits.** Sort call site is
`TableRenderer.tsx:243` (`getValue: (row) => getSortValue(row[col.key])`); `getSortValue`'s object
fallthrough is untouched. `usePanelData`'s `String(v)` is at `:99` (block `:95-103`). D4's premise
still live: neither `frontend/jest.config.cjs` nor `src/test/jest.setup.ts` pins locale or TZ.

**`openspec validate per-column-cell-formatting --strict` → valid.**

## Verdict: REFUTE

The **design.md** changes are sound — D6a's claim is true, its decision is the right one, D6's
asymmetry is correctly derived and durably stated, and D3a states the owner ruling accurately. I am
not manufacturing a finding there.

The refutation is that **the restart updated design.md only.** `tasks.md`, `specs/…/spec.md`,
`proposal.md` and `ticket.md` are still the pre-halt, pre-HEL-451 documents. An implementer working
from tasks.md — which is what an implementer works from — would ship the exact defect that halted
round 3, and would ship the broken filter contract. That is a fix-interaction defect of the same
family this ticket halted for: the fix landed in one artifact and the coupled artifacts were left
asserting its opposite.

## Change Requests

1. **STRUCTURAL — tasks.md 3.3 reasserts the falsified fact and contradicts D3a.** It reads
   "`ColumnDef` has NO alignment field and `DataGrid.css:72` hardcodes `text-align: left`, so
   `render` alone cannot do this", then mandates `align?: "left" | "right"` on `ColumnDef` with no
   mention of the header. Verified false: `:72` is not that rule at `a6bde0d3`; the declaration is
   `:147` inside `thead th`, and `tbody td` has none. Following 3.3 as written produces
   right-aligned cells under a left-aligned header — the round-3 shipping defect, restored.
   Rewrite 3.3 to carry D3a: state the coupling (th and td together, or neither) as the
   requirement, state that the mechanism must wire both elements in the same change, and correct
   the citation to `DataGrid.css:147` / `tbody td :197-204`.

2. **STRUCTURAL — D6a and D6b have no task and no spec requirement, and three artifacts assert the
   opposite.** `grep` over tasks.md and spec.md returns zero filter work.
   - tasks.md §3 has no task to change `tableFilterPredicate.ts`, no task for D6b's single shared
     resolver, and no task for D6a's mutation-failable filter guard.
   - tasks.md 3.2b still points the comment correction at `TableRenderer.tsx:110-112`; D6b also
     requires the `tableFilterPredicate.ts:5-9` contract rewrite, which appears nowhere in tasks.
   - tasks.md **8.3 mandates a PR-body claim that is now false**: "filter composition is untested
     because HEL-451 is parked". HEL-451 merged as `a6bde0d3`.
   - proposal.md Non-goals: "**Filter composition** — HEL-451 is parked, so `columnFilters` is not
     on `main`. Nothing is built against an absent interface." Directly contradicts D6a, which
     requires editing that interface. proposal.md Impact also omits
     `frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts`.
   - ticket.md "Acceptance criteria adjusted to reality" and "Out of scope" carry the same parked
     statement.
   - spec.md has no requirement for match-visibility under formatting, so D6a's behaviour is not in
     the capability contract at all.
   Reconcile all five: add the tasks, add a spec requirement ("a filter term matches the text the
   cell displays"), and rewrite the parked-HEL-451 language in proposal.md/ticket.md/8.3 to the
   narrow, still-true scope boundary (D6a's predicate only; broader filter/format composition out
   of scope).

3. **STRUCTURAL — D6a × D4 interaction: the filter guard is outside the pinning scope.** Task 4.1a
   enumerates where locale/TZ pinning applies — formatter unit tests, `TableRenderer`/`DataGrid`
   rendered-text tests, and the 3.2/3.2a sort guards — written before a filter guard existed.
   D6a's guard asserts that a term matching the **formatted** text matches, which for the currency
   fixture is a literal `"1,234"`/`"$1,234.56"` assertion: green in `en-US`, red elsewhere. Extend
   4.1a to name the D6a filter guard explicitly.

4. **STRUCTURAL (small) — D6a leaves its own plumbing unspecified, and the gap collides with
   D3a.** D6a says "the predicate therefore takes the column's format spec, not just the value",
   but `rowMatchesFilters(row, columns, filters)` already receives `ColumnDef[]`
   (`tableFilterPredicate.ts:27-31`), and `ColumnDef` (`DataGrid.tsx:30-33`) has no format field —
   while `render` is a `ReactNode` producer the predicate cannot use. Two readings survive: thread
   `columnFormats` (or a resolver map) as a fourth argument, or add a string-producing field to
   `ColumnDef`. They are not equivalent, and the second one lands in the same interface D3a's
   alignment mechanism touches — precisely the coupled-parts situation that halted this ticket.
   Decide it in design.md rather than in implementation.

5. **EDITORIAL — line citations not re-derived on restart.** design.md Context still declares
   "Base `origin/main` @ `9e995f69`" and cites `formatCell` at `DataGrid.tsx:128-132` (actual
   `:267-271`) and `render` at `:31` (actual `:32`). D1 cites `TableRenderer.tsx:197` and
   `DataGrid.tsx:324`; D1b cites `:197` — all pre-HEL-451, and D6's own table gives the corrected
   `:243` / `:803` twelve paragraphs later, so design.md contradicts itself on the same two sites.
   D2 cites `MetricFormat` at `outputConfigTypes.ts:50` (actual `:68`). D5 and tasks 7.1 and
   ticket.md cite `usePanelData.ts:87-92` (actual `:95-103`, `String(v)` at `:99`). tasks 3.2 cites
   the mutation site as `:197` (actual `:243`) and 3.2b the comment as `:110-112` (actual
   `:127-129`). Correct all of these to `a6bde0d3`. Verified-correct and needing no change:
   `MetricRenderer.tsx:28`, `buildOutputConfig.ts:66-70`, `OutputService.mergeConfig:272-282`.

## Non-blocking notes

- tasks.md 1.5 asserts the minimal-patch test must show `fieldMapping`/`columnOrder`/`columnSort`
  survive a `columnFormats` write. `columnFilters` now exists on `TableOutputConfig`
  (`outputConfigTypes.ts:61`) and belongs in that list — same shallow-merge property, one more key.
- spec.md contains no requirement covering right-alignment, though it is a ticket AC. Task 3.3
  covers it, so this is not a coverage hole in the plan; adding it would make the capability
  contract match what ships.
- D6's consumer table is the most useful artifact in the change. Consider keeping it as a code
  comment on the shared resolver D6b introduces, since that is the file a would-be unifier opens.
