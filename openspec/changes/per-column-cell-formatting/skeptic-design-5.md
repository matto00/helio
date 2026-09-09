## Skeptic Report — design gate (restart round 2, skeptic-design-5.md)

Cold read at `a6bde0d3` (verified `git log --oneline -3`). Every citation below was read from the
file at that commit.

### What I verified (with evidence)

**CR2 is genuinely fixed.** tasks 3.5 / 3.5a / 3.6 now exist and specify the predicate change, the
shared resolver, the sort exclusion and the mutation-failable guard. spec.md's new requirement
("Filtering matches the text the user can see, sorting orders the underlying value") states the
do-not-unify clause with its *reason* on both sides, plus the unformatted-column-unchanged scenario.
A contributor reading only the spec cannot unify them without arguing against a written rationale.
`openspec validate per-column-cell-formatting --strict` → valid.

**CR3 is fixed.** 3.5a names the `en-US` hazard and points at 4.1a's mechanism.

**CR1 is fixed.** 3.3 now states the `DataGrid.css:72` claim as false, cites `:147` (verified inside
`.ui-data-grid__table thead th`) and `tbody td :197-204` (verified: no `text-align`), and mandates
wiring both elements in the same task.

**CR4 / task 3.3a — your least-sure item is correct.** `rowMatchesFilters(row, columns, filters)`
(`tableFilterPredicate.ts:29-33`) receives `ColumnDef[]`, but `ColumnDef.render`
(`DataGrid.tsx:32`) returns `ReactNode`, which the predicate cannot lowercase or `includes`. So the
predicate needs a `(value) => string` regardless. 3.3a forbids the spec on `ColumnDef`, and 3.6
mandates one shared `(value) => string` resolver, which leaves exactly one buildable reading:
`TableRenderer` builds the resolver map, passes it as an extra predicate argument, and derives
`render` from it. `DataGrid` genuinely needs no format knowledge — its only cell site is `:803`,
which consumes `col.render`. The decision is determinate and correct.

**No fix-interaction regression against settled decisions.** D1 sort-raw, D1b call-site mutation,
D3b clear-semantics (`OutputService.mergeConfig` still `existing.fields ++ patch.fields`, still four
`mergeableSubObjects`), D4 pinning and D5 `rawRows` are all still stated consistently; 3.6's sort
exclusion reinforces D1 rather than eroding it. I did not re-derive the items you listed as settled
and found no contrary evidence.

### Verdict: REFUTE

Three of the five CRs are properly fixed. The refutation is narrow and is the same class as last
round: the coherence pass reached `design.md` and the new tasks, but **the pre-existing tasks in
§3 and §8 were not reconciled with them**, and two of the leftovers are executable instructions
that point at the wrong code.

### Change Requests

1. **STRUCTURAL — tasks 3.2 and 3.1 send the executor's mutation at a line that is not the sort
   call site.** 3.2 says "VERIFY IT GOES RED by mutating **the call site at
   `TableRenderer.tsx:197`**"; 3.1 says "Do NOT touch `sortColumns` (`TableRenderer.tsx:197`)". At
   `a6bde0d3`, `:197` is `const usingRaw = !usingPagination && Boolean(rawRows && rawRows.length > 0);`.
   The `getValue: (row) => getSortValue(row[col.key])` call site is `:243` — which design.md already
   says (design.md:22, :68, :216). An executor following 3.2 literally mutates an unrelated line,
   observes no red, and either fabricates the evidence or reports a broken guard. This is the
   "guard whose mutation exercised the wrong branch" failure 3.2 itself was written to prevent.
   Correct both to `:243`.

2. **STRUCTURAL — tasks 3.2b and 3.6 mandate correcting the same comment, in two places, at
   conflicting locations, and 3.2b's is wrong.** 3.2b targets `TableRenderer.tsx:110-112`; 3.6
   targets `TableRenderer.tsx:127-130`. Only one comment exists: the "so the sort key matches the
   rendered cell text" text is at `:127-130` (verified; `return formatCell(value)` at `:130`).
   `:110-112` is inside the *blank-trap* comment (`"".localeCompare("-5", …)`), which this ticket
   must not touch. Two tasks editing "the comment" at different addresses is a live risk of one
   executor rewriting a correct comment and leaving the false one. Fold 3.2b's comment-correction
   into 3.6 (or make 3.2b cite `:127-130` and explicitly defer the edit to 3.6).

3. **STRUCTURAL — task 8.3 mandates a PR-body claim that its own sibling tasks falsify.** 8.3 still
   lists "filter composition is untested" among the required PR-body statements, then appends a
   parenthetical saying the out-of-scope note is superseded. Tasks 3.5a requires a mutation-failable
   filter guard, so "untested" will be false at PR time. Replace the clause with what will actually
   be true: filter composition is in scope, is guarded by a mutation-failable test (3.5a), and sort
   is deliberately excluded from the shared resolver (3.6).

4. **EDITORIAL — line citations still stale in both artifacts** (CR5 was applied to some sites only):
   - tasks.md preamble: `ColumnDef.render` at `DataGrid.tsx:31` → `:32`.
   - tasks.md 1.2 and design.md:106: `MetricFormat` at `outputConfigTypes.ts:50` → `:68`
     (`:50` is now a `columnSort` comment line).
   - tasks.md 7.1 and design.md:185: `usePanelData.ts:87-92` → block `:95-103`, `String(v)` at `:99`.
   - design.md:5: "Base `origin/main` @ `9e995f69`" → `a6bde0d3`; `formatCell` at
     `DataGrid.tsx:128-132` → `:267-271` (`:128-132` is now HEL-451 panel-height prose);
     `ColumnDef.render` "(`:31`)" → `:32`.
   - design.md:30: `getSortValue` at `TableRenderer.tsx:97-114` → the function is at `:114`
     (its comment block `:104-113`); `:97` is the `UNSORTED_SENTINEL` area.

5. **EDITORIAL — proposal.md still under-describes the now-in-scope filter work.** Impact omits
   `frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts`, which tasks 3.5/3.6 modify —
   this was called out in round 1's CR2 and not applied. Relatedly, the "**Filter composition** — IN
   SCOPE (superseded)" bullet is filed under the **Non-goals** heading; a reader skimming Non-goals
   reads the heading, not the bullet. Move it to Impact/Scope and leave at most a pointer.

### Non-blocking notes

- tasks 1.5 still omits `columnFilters` from the survive-the-minimal-patch key list; it exists at
  `outputConfigTypes.ts:61` and has the same shallow-merge property (repeat of last round's note).
- spec.md still has no requirement covering right-alignment, though it is a ticket AC and task 3.3
  covers it. Not a plan hole; adding it would make the capability contract match what ships.
