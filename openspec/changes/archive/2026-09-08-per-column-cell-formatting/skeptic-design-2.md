## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold agent. Every claim below is from the files/commands named, not from round 1's report or the
orchestrator's summary.

### What I verified (with evidence)

**Round 1 CR1 (persistence surface) — addressed, and the fix is sound as far as it goes.**
- `buildOutputConfig.ts` table case still emits only `{ fieldMapping, columnOrder }` (read directly;
  the `case "table":` block). It is now named in task 1.4 and design D1a, and the in-panel
  minimal-patch/debounce language is gone from tasks. Confirmed.
- The shallow-merge claim is TRUE, verified at source, not inherited:
  `OutputService.mergeConfig` (`backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:274-282`)
  is `existing.fields ++ patch.fields` with deep-merge only for
  `mergeableSubObjects = Set("legend","tooltip","seriesColors","axisLabels")` (`:272`). An omitted key
  survives; `columnFormats` is not in that set, so a supplied `columnFormats` REPLACES wholesale.
- Read path is unbroken and already has an exact precedent: `PanelContent.tsx:143` passes
  `columnSort={cfg.columnSort}` from `readTableConfig` (`outputConfigTypes.ts:142`). Nothing else
  needed the dropped in-panel machinery — `updateOutput(... columnSort ...)` at
  `TableRenderer.tsx:130` is untouched by this design, and because the editor Save omits `columnSort`,
  a concurrent in-panel sort write cannot be clobbered. No clobber risk found.

**Fourth leak path — searched, none found (verified negative).**
`grep formatCell` across `frontend/src` (non-test) returns exactly 3 non-definition sites:
`TableRenderer.tsx:113`, `DataGrid.tsx:324`, and the barrel re-export. `col.render` has exactly ONE
consumer, `DataGrid.tsx:324`, inside the `<td>`; the `<td>` carries no `title`/`aria-label` derived
from the value (read `DataGrid.tsx:318-328`). No CSV/clipboard/download exists under
`frontend/src/features/panels`. `getSortValue` has one call site (`TableRenderer.tsx:197`). So
`:113` remains the only comparator-reachable formatter, and the export/filter clauses were correctly
dropped.

**Deferrals are real.** HEL-1042 (Backlog, Medium, parent HEL-346) and HEL-1033 (Backlog, Medium)
both fetched live; their bodies match what design D2/D5 attribute to them. HEL-1033 additionally
records that the ONLY object-valued cell shape in real data is the image-connector `content`
BinaryRef — consistent with, and not contradicted by, D5.

**Ticket line-number citations spot-checked.** `DataGrid.tsx:31` (`render?`), `:128-132`
(`formatCell`), `:324`; `TableRenderer.tsx:97-114`, `:110-112` (the stale comment, quoted verbatim in
the source), `:197`. All accurate. Design cites `DataGrid.tsx` without its real path
(`frontend/src/shared/ui/DataGrid.tsx`) — cosmetic only.

### Verdict: REFUTE

Four required revisions. CR1 and CR2 are the crux question I was asked to attack, and the answer is
that task 3.2a's guard can be satisfied while proving nothing.

### Change Requests

1. **Task 3.2a's guard is vacuous as written — the mutation is not expressible, and the assertion
   may not discriminate.** Two distinct defects:
   (a) *The mutation is not expressible where the task puts it.* `getSortValue(value: unknown)`
   (`TableRenderer.tsx:97`) receives ONLY a value; it has no column, so "re-point `getSortValue`'s
   object branch at the per-column formatter" cannot be written without changing its signature. The
   realistic tidy-up — the one a contributor restoring the `:110-112` comment would actually write —
   is at the CALL SITE, `TableRenderer.tsx:197`:
   `getValue: (row) => getSortValue(row[col.key])` becoming
   `getValue: (row) => col.render ? String(col.render(row, row[col.key])) : getSortValue(row[col.key])`.
   Specify THAT as the mutation, at `:197`, by name.
   (b) *The assertion may be green under the mutation.* Whether the mutant changes the sort key
   depends on what the per-column formatter returns for an OBJECT value — and D3 does not define it.
   D3 says an uninterpretable value "renders as its raw string", which is undefined for a non-string.
   If `text` (task 2.1: "unchanged") or the fallback is implemented as `formatCell(value)` — the most
   natural implementation, since `formatCell` is already imported in this file — then
   `formatter(obj) === formatCell(obj)` and the mutant produces an IDENTICAL sort key. The guard
   passes green under its own mutation, i.e. round 1's exact failure repeated a third time with the
   fixture moved. Required: design D3 must state what each format returns for a non-string,
   non-parseable value, and task 3.2a must require the test to first ASSERT the discriminating
   precondition (`formatter(objectFixture) !== formatCell(objectFixture)`) and report both strings,
   so a vacuous guard fails loudly instead of passing quietly.

2. **design.md and tasks.md still disagree about what the guard IS — the fifth instance of this
   divergence class in this lane.** design.md D1's CORRECTION says the currency guard "tests the
   branch that cannot leak", and then the very next paragraph of the same section still states the
   deliverable as *"a mutation-failable guard: a test over a currency column ... which goes RED when
   `getValue` is pointed at the rendered value"*, and the **Test plan** names only *"the
   sort-raw-values guard, verified red by pointing `getValue` at the rendered value"* — singular.
   Task 3.2a's object-branch guard, which is the corrected deliverable, appears NOWHERE in design.md
   as a deliverable. An executor reading design.md alone builds exactly the guard round 1 refuted.
   Required: rewrite D1's deliverable paragraph and the Test plan to name BOTH guards, with the
   object-branch one as the load-bearing one.

3. **Right-alignment (task 3.3 / proposal Impact "Styling for right-aligned numeric columns") names
   an outcome with no mechanism — CR1's class, second occurrence.** Ground truth: `ColumnDef`
   (`DataGrid.tsx:26-32`) has `key | header | render | width` and **no alignment field**;
   `DataGrid.css:66-72` sets `text-align: left` on `thead th` explicitly; the `<td>` has no per-column
   class. So right-alignment requires one of two materially different changes, and the artifacts pick
   neither: (i) add `ColumnDef.align` to the SHARED primitive — an API change to a component with six
   non-test consumers (`TableRenderer`, `StepCard`, `ConnectorsPage`, `SqlTab`,
   `SourcePreviewSkeleton`, `SourceDetailPanel`), and the one that can also align the header; or
   (ii) right-align inside `render`'s returned node — table-local, but leaves the HEADER left-aligned
   over a right-aligned column, and interacts with the `td` truncation/ellipsis under
   `table-layout: fixed` (a right-aligned truncated cell ellipsises at the wrong end). Decide it in
   design.md and say which, with the header-alignment consequence stated. Task 5.2's
   measure-the-geometry requirement is otherwise adequate and I am not asking for more there.

4. **CR1's fix introduced one gap: clearing a format is unspecified, and the merge semantics make
   that a real defect.** Because `columnFormats` is NOT in `mergeableSubObjects`, a supplied
   `columnFormats` replaces the stored map wholesale — correct for editing, but it means removal
   works ONLY if `buildOutputConfig` emits the key UNCONDITIONALLY (as `{}`/`null` when the user has
   cleared every column's format). `buildOutputConfig`'s existing style is conditional emission
   (`readFormatOrNull`, the spread guards in the chart/metric cases), so an executor following local
   convention would emit it only when non-empty and clearing the last format would silently leave the
   old map persisted. Task 1.4 must state the key is emitted unconditionally, and task 1.5's
   round-trip test must cover "clear the last remaining format → the persisted map is emptied".

### Non-blocking notes

- Task 3.1 and the proposal's Impact never name `PanelContent.tsx:143` as the threading point for
  `columnFormats` into `TableRenderer`. Unlike `buildOutputConfig` (whose omission would silently
  DROP data), omitting this one cannot ship silently — the feature simply would not work — so it is a
  note, not a CR.
- design.md cites `DataGrid.tsx` without its path; it lives at `frontend/src/shared/ui/DataGrid.tsx`,
  not under `features/panels/ui/renderers/`. Line numbers are all correct.
- Task 3.2b's comment correction is right and should stay: I read `TableRenderer.tsx:110-112` and the
  stale rationale is exactly as quoted.
