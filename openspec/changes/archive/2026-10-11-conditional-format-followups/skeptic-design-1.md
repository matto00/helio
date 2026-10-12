## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d6aef6c46cfd3fcd47ebddd5519497d0f58c562b. The change dir is untracked: only planning artifacts exist, no code yet.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/conditional-format-followups/HEL-1490`.

### What I verified (with evidence)

**Item 5 (HistoryRows rules): D1-D4 verified against the tree.**
- `HistoryRows.tsx` renders `TableRenderer` with `outputId`, `paginationRows`, `rowsTruncated={false}`, `leadingColumns`,
  `rowClassName`, `disablePinning`. It passes no `conditionalFormats` and has no `config` prop.
  `OutputHistoryModal.tsx:66-72` holds the full `output` and passes only `outputId`. The context claims are true.
- `TableRenderer.tsx:786-800`: `withCellRules(formattedColumns, …)` and `withRowRules(rowClassName, …)`. The leading
  columns are prepended after ruling, as `inert`. So D4 is true: the "Change" column is not ruled, the row mark goes on the
  first data column, and the caller's `rowClassName` is joined with the tone class (`tableConditionalFormats.tsx`,
  `withRowRules`).
- `HistoryRow = Record<string, unknown>` (`diffRows.ts:1`) matches `paginationRows: Record<string, unknown>[]`, and
  `resolveCellRule` reads `row[column]`. Raw-value evaluation carries over unchanged.
- D3 (collection to value column) matches the dashboard exactly. `CollectionRenderer.buildMetricItem` sets
  `item.value = row[headers.indexOf(fieldMapping.value)]`, and `MetricRenderer.tsx:150` runs `resolveRule(rules, data.value)`.
  Mapping each collection rule to `{column: fieldMapping.value, target: "cell"}` and passing it through
  `resolveCellRule` gives the same first-match-in-list-order result on the same raw value. The kind-specific
  validator (`readConditionalFormats(…, "collection")` rejects `column`/`target`) runs before the mapping, so the mapped
  rules are never re-validated as collection rules. That is fine as long as the helper runs after the read, which the design says it does.
- D3 (metric excluded): **sound, and consistent with the ruling.** A metric rule evaluates one headline value
  (`MetricRenderer` `data.value`). No stored row is that value in general (aggregate case), and in the
  no-aggregate case "first row" is unstable under the table's own sort. Colouring every row's value cell would claim
  that each row passed or failed a threshold that was defined for the headline. The ruling requires reuse of
  the same evaluation and tones. It does not require inventing a row semantics that metric rules lack. Spec states the
  exclusion explicitly. See non-blocking note 1 for the owner-facing disclosure.
- Ticket ACs: the Linear ticket body has no ACs. AC2/4/5/6 in ticket.md are planner-authored and match the ticket items.
  AC5 matches D1-D4 and the spec delta.

**Item 2 (metric unit contrast): claim reproduced, design incomplete (see CR1).**
- `PanelContent.css:40`: `.panel-content__metric-unit { color: color-mix(in srgb, currentColor 60%, transparent) }`.
  The container-query blocks (`:323`, `:359`) change only `font-size`. Card colour comes from
  `PanelGrid.css`: `color: var(--panel-text-override, var(--app-text))` on `background: var(--panel-surface-override, var(--app-surface))`.
- I computed WCAG contrast from the theme tokens (`theme.css:239` light `--app-text #211d19`, `:234` `--app-surface #fdfcfa`;
  dark `#f2efe9` / `#1a1816`). Light at 60% gives **4.40**, which matches the ticket. 62% gives 4.67, 65% gives 5.16.
  Dark at 60% gives 6.24 and needs no change. These numbers are computed from the tokens; the design correctly
  requires them to be re-measured in the running app.
- **`.panel-content__metric-label` (`PanelContent.css:31`) uses the identical 60% recipe on the same surface, so it
  also measures 4.40:1 in light.** It renders on every metric that has a label, on every collection item, and in the
  "No data" state (`MetricRenderer.tsx:177-179`). `.panel-content__metric-trend` (`:266`) also has the 60% base, but every
  render carries a `--up/--down/--flat` class (`MetricRenderer.tsx:137-140,182`) that overrides it, so the trend is
  not affected. The design and tasks say nothing about the label.

**Item 4 (footer prop): verified.** `OutputEditorFooter.tsx:16-18,70` ORs `saveDisabled || saveBlocked`. The only caller is
`OutputEditorSheet.tsx:304-307` (`grep -rn "saveDisabled\|saveBlocked" frontend/src` gives these two files only). D6 is
behaviour-preserving as written.

**Item 6 (Select invalid): verified.** `inputs.css:55-63` styles only `.ui-input`/`.ui-textarea[aria-invalid]`. `Select.tsx:178`
sets `aria-invalid` on the trigger. Specificity checks: invalid:focus-visible (0,3,0) beats the trigger's
`:focus-visible` (0,2,0). The plain invalid rule (0,2,0) **loses to `:hover:not(:disabled)` (0,3,0)**. That loss already
exists for `.ui-input` today, so "mirror exactly" also reproduces it. The design's Risks section names this case and gives a
remedy. No feature stylesheet already styles an invalid trigger (`grep aria-invalid --include=*.css`: only
CounterControl and DashboardList, both unrelated). There are 9 `ariaInvalid=` consumers (FormFieldRow, FormFieldControl ×4,
Pivot/Window/FillNull configs, ConditionalFormatsField), so a running-app probe target exists.

**Placeholders and contradictions:** none blocking. The only deferral is D5's token name ("name final in Execution"), which does not block.
I found no contradictions between proposal, design, tasks and specs.

### Verdict: REFUTE

### Change Requests

1. **Decide the metric label, which has the same 4.40:1 failure (design D5, tasks 2.2-2.3, AC2).** `.panel-content__metric-label`
   (`frontend/src/features/panels/ui/PanelContent.css:31`) uses the same `currentColor 60%` mix on the same surface as
   the unit, so it fails WCAG AA at 4.40:1 in light. As written, the plan raises only the unit. Two text elements in the same metric
   block, which share one recipe today, would end up at different shades, and a known identical failure would stay
   beside the fix. A final-gate reviewer measuring the metric card would find it. Revise D5/AC2/task 2.3 to
   either (a) apply the new per-theme mix token to `.panel-content__metric-label` as well, with the label included in the
   measurement and guard test (recommended: same defect, same one-line fix, and the token is already named generically), or
   (b) state explicitly that the label is out of scope and why, and record a follow-up ticket for it. Silence is not
   acceptable.

### Non-blocking notes

1. Metric exclusion (D3) narrows the relayed ruling, and the narrowing is sound. Say it plainly in the PR body ("metric
   rules do not colour history rows; they evaluate a headline value, not rows") so the owner sees it. Note also
   that the history modal does show a per-run metric headline (`HistorySummary.tsx`, `output-history__metric`),
   and that headline, not the rows, is where metric rules would naturally apply. That is outside this ruling (`HistoryRows` only). Offer it as a possible follow-up, not in-run scope.
2. Item 4 is a behaviour-preserving refactor. A behavioural test of "Save disabled for trigger X" cannot be red against
   the current two-prop code. Task 3.1's "RED first" should be framed as guards per C1: show each trigger test failing
   under a mutation (for example, drop one operand of the folded expression) rather than inventing a red.
3. Memoize the collection-rule mapping (in the modal or `HistoryRows`). A fresh array on every render defeats
   `TableRenderer`'s `useMemo` on `conditionalFormats`.
4. Item 6: if the executor adds `[aria-invalid]` to the hover exclusion so invalid+hover keeps the error border, it
   should do the same for `.ui-input`/`.ui-textarea`. Otherwise the "same as `.ui-input`" parity (AC6) breaks in the other
   direction. Either outcome is acceptable as long as both stay identical.
