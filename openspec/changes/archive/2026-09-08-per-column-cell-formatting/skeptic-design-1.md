## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Base `origin/main` @ `9e995f69` (confirmed: `git log --oneline -1 origin/main`).

### What I verified (with evidence)

**1. The central claim — sort reads RAW values. CONFIRMED, with one qualification (see CR2).**
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:197` reads exactly
  `() => columns.map((col) => ({ key: col.key, getValue: (row) => getSortValue(row[col.key]) })),` — raw row value.
- `frontend/src/shared/ui/DataGrid.tsx:324` is the ONLY `.render` reference in the file
  (`grep -n "\.render\|render(" shared/ui/DataGrid.tsx` → 1 hit, line 324):
  `<td key={col.key}>{col.render ? col.render(row, value) : formatCell(value)}</td>`.
- Third-path hunt: `grep -rn "useSortedRows\|SortColumn"` over `frontend/src` finds three other
  consumers (`ConnectorsPage.tsx:104`, `PipelineListTable.tsx:108`, `SourceListTable.tsx:91`), none of
  which is a table panel and each supplying its own `getValue` over typed domain objects. `DataGrid`
  itself does no ordering (it receives `sort`/`onSort` props only). No third path into the comparator
  **except** `getSortValue`'s own object branch — CR2.

**2. The mutation-failable guard (task 3.2) does go RED as specified.** Executed:
`"$1,234.56".localeCompare("$9.99", undefined, {numeric:true, sensitivity:"base"})` → `-1`, and
`Intl.NumberFormat("en-US",{style:"currency",currency:"USD"})` formats `9.99`/`1234.56` as
`$9.99`/`$1,234.56`. So a comparator pointed at rendered text orders `1234.56` before `9.99`
ascending — the asserted numeric order fails. The chosen values are genuinely mutation-failable
(also under a `de-DE`/EUR pin: `1.234,56 €` vs `9,99 €` compares `-1` the same way).

**3. Locale/timezone are NOT pinned today. CONFIRMED.**
`grep -n "locale\|TZ\|timeZone\|globalSetup\|setupFiles" frontend/jest.config.cjs frontend/src/test/jest.setup.ts`
returns exactly one line, `jest.config.cjs:5: setupFilesAfterEach…setupFilesAfterEnv: ["<rootDir>/src/test/jest.setup.ts"]`
— no locale, no timezone, in either file. Host resolves `en-US` / `America/Los_Angeles`, so a naive
`"$1,234.56"` assertion is green here and portable nowhere. Also verified that assigning
`process.env.TZ` mid-process DOES take effect in this Node (a `Date` built after the assignment
rendered `Asia/Tokyo`), i.e. per-suite pinning is mechanically possible — but the mechanism is
unspecified in tasks.md (CR3).

**4. `rawRows` / D5. Sound.** `usePanelData.ts` builds
`rows.map((row) => Object.values(row).map((v) => (v !== null && v !== undefined ? String(v) : "")))` —
verified at the cited lines. HEL-1033's own body records that map-classified columns materialise as
JSON *strings* (`compactPrint`), and that a `jsonb_each` scan found exactly one object-valued cell in
3,997 dev `node_snapshots` rows (an image-connector `content` BinaryRef). So the object case is real
but narrow, and D3's fallback returning `"[object Object]"` unchanged is the honest outcome: a special
case would be a *repair* of a value whose type is already destroyed, and it would have to be undone
when HEL-1033 lands. I accept D5 and 7.1–7.3 as written. One caveat is folded into CR2.

**5. `TableColumnFormat` vs `MetricFormat` (D2). Right call.** `outputConfigTypes.ts:50` is
`export type MetricFormat = "number" | "integer" | "currency" | "percent";` with `isMetricFormat`
guarding it at `:152`/`:167`. A shared enum would force `percent` onto columns and `date` onto
metrics. Same-names-where-they-overlap plus HEL-1042 owning reconciliation is the low-drift option,
and HEL-1042's body explicitly lists "apply the outcome consistently to … HEL-469's
`TableColumnFormat`" — the two documents agree.

**6. Deferrals are live.** HEL-1042 (Backlog, Medium, parent HEL-346), HEL-1033 (Backlog, Medium),
HEL-1027 (Backlog, Medium) — all open, and each ticket's own body names HEL-469 as the non-absorber,
so the references are accurate in both directions.

**7. Flat-sibling ruling checks out.** `outputConfigTypes.ts:40-43` carries HEL-448's comment naming
HEL-469/`columnFormats` by name. Backend `OutputService.mergeConfig`
(`OutputService.scala:274-281`) is `existing.fields ++ patch.fields` with per-key deep merge only for
`Set("legend","tooltip","seriesColors","axisLabels")` — so a top-level omitted key survives a patch,
and a nested container is replaced wholesale. Design's rationale is factually correct.

**8. Rendered-geometry commitment.** design.md "two-axes (a)" and tasks 5.2/3.3 do commit the
executor to measuring right-alignment rather than asserting a class name, with light+dark screenshots
to `.concertino/runs/HEL-469/evidence/`. That is sufficient for the final gate to inherit. I did not
start servers.

### Verdict: REFUTE

Three findings. Two are the design/tasks divergence class this lane keeps hitting.

### Change Requests

**1. tasks.md §1.4 and §5.1 name two different persistence surfaces, and design.md decides neither.**
§5.1 puts the only format control in the Output editor (`useOutputTableColumns.ts` /
`OutputEditorSheet.tsx`). §1.4 mandates `updateOutput(outputId, { config: { columnFormats } })` with a
`canWrite` PRE-CHECK and silent session-local degrade — which is `TableRenderer`'s HEL-448 in-panel
pattern (`TableRenderer.tsx:159` `canWrite`, `:259-268` debounce, `persistColumnSort` at `:130`), not
the sheet's. The sheet persists differently and only on Save:
`OutputEditorSheet.tsx:330-333` dispatches `updateOutput({ outputId, payload: { name, config: buildConfig() } })`,
and `buildConfig()` calls `buildOutputConfig(...)` whose table branch (`buildOutputConfig.ts:66-69`)
emits only `{ fieldMapping, columnOrder }`. Consequences an executor cannot resolve from the current
artifacts:
   - `buildOutputConfig.ts` must gain a `tableColumnFormats` param — it is named in **no task** and in
     **no** proposal.md Impact bullet. Without it the sheet control cannot persist at all.
   - Read `canWrite`/silent-degrade is meaningless in the Output editor (a non-owner has no editor),
     so §1.4 as written either dead-codes or, taken literally, bolts a direct debounced `updateOutput`
     inside the sheet — which would persist a format the user then **Cancels**, breaking the sheet's
     modal save/cancel contract.
   Required: add a design decision (D6) naming the surface and the exact write path, reconcile §1.4 and
   §5.1 to it, add the `buildOutputConfig.ts` task and Impact bullet, and state cancel semantics. If the
   control is instead (or additionally) in-panel, say so and keep §1.4; do not leave both.
   Note for whichever way it goes: `mergeConfig` is a shallow top-level merge, so a sheet save that
   omits `columnFormats` preserves it — the risk is the opposite one (never emitting it), not clobbering.

**2. `getSortValue`'s object branch already routes sort through the DEFAULT rendered text, and this
ticket silently breaks the invariant that comment asserts.** `TableRenderer.tsx:110-113`:
> `// `formatCell` (not a bare `String(v)`) so the sort key matches the rendered cell text — `String({})` collapses every object to the same "[object Object]" tie, while `formatCell` JSON-stringifies it.`
> `return formatCell(value);`

Once `ColumnDef.render` overrides `formatCell` for a formatted column, that stated invariant ("the
sort key matches the rendered cell text") becomes false for object-valued columns. Two problems:
(a) design.md's D1 claims flatly "two separate paths over one raw value", which is not true of this
branch and should not be left as an overclaim a future reader inherits; (b) the obvious
consistency-restoring refactor — pointing `getSortValue`'s fallback at the new formatter — is exactly
the drift D1 exists to prevent, and task 3.2's currency guard would **NOT** go red for it, because a
numeric currency column returns early at the `typeof value === "number"` / `Number.isFinite` branch
and never reaches `formatCell`. Required: record the divergence in D1, state that `getSortValue` is
not to be re-pointed at the format-driven `render`, and either extend the 3.2 guard (or add a
sibling) that is mutation-failable for THAT narrower mutation, or state explicitly why an
object-valued column's ordering is out of scope.

**3. Task §4 states the pinning REQUIREMENT but not the MECHANISM, and scopes it too narrowly.**
"PIN LOCALE AND TIMEZONE EXPLICITLY in every formatting test" is unimplementable as written without a
decision, and each option has a different slip path: passing locale/`timeZone` as explicit formatter
arguments only works if the format spec (task 2.1, which lists "decimal places, currency code/locale,
date pattern" and no timezone) actually carries them; `process.env.TZ` works in this Node but only if
set before any `Intl` instance is constructed — a formatter memoized at module scope would freeze the
pre-pin zone. Required: (a) name the mechanism, and say whether the spec carries a timeZone or the
tests set the environment; (b) forbid module-scope `Intl` caching that would defeat it, or require the
pin to be established before import; (c) extend the pin's scope beyond the formatter unit tests to
**every** test that renders formatted output — the 3.2 sort guard and the §5 config-UI/geometry tests
render currency and date text too, and an unpinned assertion there is the same defect wearing the same
green check. HEL-1042 still owns the shared-setup question; nothing here folds that in.

### Non-blocking notes
- AC tracing is otherwise complete: currency/number/date/text → 2.1; unparseable/null → 2.2 + D3;
  persistence across reload → 1.4/1.5 (pending CR1); the sort guard → 3.2; pinned locale/timezone → §4;
  right-alignment → 3.3 + 5.2. The ruled-out ACs (export, filter composition) are documented as dropped
  in both proposal.md Non-goals and ticket.md, consistently.
- design.md's D1 and the spec's "Sorting reads raw values" requirement are worded consistently; the
  spec deltas contain no `TODO`/`TBD` and no unspecified types beyond CR1's gap.
- For the final gate's geometry baseline: the current table panel chrome is `table-layout: fixed` with a
  seeded default column width (`DataGrid.tsx` `MIN_COLUMN_WIDTH = 60` and the "Default width (px)"
  comment at `:39-45`) plus locally-held resize state (`TableRenderer.tsx` `const [widths, setWidths]`).
  Right-alignment must be measured at a NARROW column width where truncation is in play, not only at
  the seeded default.
