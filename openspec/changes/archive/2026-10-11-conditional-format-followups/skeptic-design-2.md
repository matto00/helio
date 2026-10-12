## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD d6aef6c46cfd3fcd47ebddd5519497d0f58c562b. Only the planning artifacts exist in the change dir, and they are untracked. There is no code yet.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/conditional-format-followups/HEL-1490`.

### What I verified (with evidence)

**Round-1 change request and notes.** CR1 is resolved. The metric label is now in AC2, the proposal, D5 and tasks 2.1-2.3.
Notes 1-4 are folded in: the metric exclusion is disclosed in the PR body and listed as a follow-up in Risks; D6/3.1 frame the work as a mutation-proven guard; D3 memoizes the mapping; D7/Risks require hover parity across all three controls.

**Item 5 (HistoryRows): context claims are true.**
- `HistoryRows.tsx` passes `outputId`, `paginationRows`, `rowsTruncated={false}`, `leadingColumns`, `rowClassName` and `disablePinning` to `TableRenderer`. It passes no `conditionalFormats`.
- `OutputHistoryModal.tsx:14,66-67` holds the full `output` and forwards only `outputId`.
- `TableRenderer.tsx:786-800` runs `withCellRules(formattedColumns, …)`, then `withRowRules(rowClassName, …)`, and prepends the leading columns as `inert` after that.
- `withCellRules` (`tableConditionalFormats.tsx:40-79`) matches `rule.column === col.key` and puts the row mark on data column index 0. So D3's `{...rule, column: fieldMapping.value, target: "cell"}` mapping lands on the value column, and D4's "row mark on first DATA column" holds.
- `readTableConfig` / `readCollectionConfig` (`outputConfigTypes.ts:327,358`) both exist and carry `conditionalFormats` through `formatsField`.

**Item 5: the composition claim is not true visually (CR1).**
- `withRowRules` (`tableConditionalFormats.tsx:83-97`) does join the caller's class with `ui-data-grid__row--tone-<tone>`. So the "both classes on one row" test D4 promises will pass.
- `OutputHistoryModal.css:119` paints the changed-row highlight as `.output-history__row--changed td { background: var(--app-accent-surface) }`, specificity (0,1,1).
- The tone washes in `TableRenderer.css:133,158,183` are `.ui-data-grid__table tbody tr:where(.ui-data-grid__row--tone-*) td`, specificity (0,1,3).
- The cell tones in `TableRenderer.css:141…` are `.ui-data-grid__table tbody tr td.ui-data-grid__cell--tone-*`, specificity (0,2,3).
- All three rules set the same `background` property. So on a row that is both changed and row-ruled, the tone wash replaces the accent wash on every `td`, including the leading "Change" cell. On a changed row, any cell-ruled cell also loses the accent wash.
- The HEL-1277 comment at `OutputHistoryModal.css:117-118` defines the changed cue as "a text cue AND an accent wash". After this change, half of that cue disappears on ruled rows.
- None of the artifacts says this happens, or decides whether it is acceptable. AC5 says "composed with the existing changed-row highlight", and D4 says "compose". The only planned proof is a class-presence test. That test passes whichever wash wins, so it is evidence-shaped non-evidence for AC5.

**Item 2 (metric unit/label): verified.**
- `PanelContent.css:31` (label), `:40` (unit) and `:266` (trend) use `color-mix(in srgb, currentColor 60%, transparent)`.
- The container-query blocks (`:319-329`, `:355-365`) change only `font-size`.
- No other stylesheet colours `metric-label` or `metric-unit`. I grepped every `*.css` outside `PanelContent.css` and found nothing.
- D5's single token applied to the unit and label rules covers every colour rule for them.

**Item 4 (footer): verified.**
- `grep -rn "saveDisabled\|saveBlocked" frontend/src` finds only `OutputEditorFooter.tsx` (lines 16, 18, 31, 32, 70: `saving || saveDisabled || saveBlocked`) and `OutputEditorSheet.tsx:304-305`.
- D6 preserves behaviour, and task 3.2's empty-grep check is concrete.

**Item 6 (Select): verified.**
- `inputs.css:55-63` gives the invalid recipe to `.ui-input` / `.ui-textarea` only.
- `Select.tsx:178` sets `aria-invalid` on the trigger.
- The invalid `:focus-visible` rule (0,3,0) beats the trigger's `:focus-visible` (0,2,0).
- The plain invalid rule (0,2,0) loses to `:hover:not(:disabled)` (0,3,0). That is a fact today, not something to "verify", but D7/Risks handle it with an identical-for-all-three rule.

**Placeholders and contradictions.**
- The only deferral is the token name in D5. It does not block implementation.
- The proposal, design, tasks and spec deltas do not contradict each other.
- Scope matches the "Scope of this run" section of ticket.md. Items 1 and 3 are explicitly out.

### Verdict: REFUTE

### Change Requests

1. **Decide and specify the visual result of the changed-row highlight on rule-styled rows and cells.** This affects design D4, AC5, the spec scenario "Row rule composes with the changed-row highlight", and task 1.1.
   - **The problem.** On main, the tone background rules (`TableRenderer.css:133/158/183`, specificity (0,1,3), and the cell tones at (0,2,3)) override `.output-history__row--changed td` (`OutputHistoryModal.css:119`, (0,1,1)) on the same `background` property. A changed row that a rule matches therefore loses its accent wash on every cell, including the "Change" cell. Only the "New or changed" text survives.
   - **Pick one outcome and write it into D4 and the spec scenario.** Either:
     - (a) the tone wash wins and the change cue is the "Change" column text alone, stated as an accepted trade-off that the owner can see in the PR body; or
     - (b) both cues stay visible. For example, keep the accent wash on the "Change" cell, or add a non-background change marker. This uses tokens only and is checked in both themes.
   - **Then make the proof match the decision.**
     - Task 1.1/1.3 needs a computed-style or rule-specificity assertion that pins the chosen background on a changed+row-ruled row, and on a changed row's cell-ruled cell. A class-presence check alone is not enough.
     - Task 5.1's running-app check needs an explicit "changed + ruled row" screenshot in light and dark.

### Non-blocking notes

- D7's "verify invalid+hover still shows the error border" can already be answered from specificity. It will not show the error border: hover (0,3,0) beats the invalid rule (0,2,0), exactly as for `.ui-input` today. The executor can decide up front, either keep today's `.ui-input` behaviour or add the `[aria-invalid]` hover exclusion to all three controls, instead of discovering it.
- Task 2.2's guard test cannot measure rendered contrast in jsdom. It will most plausibly compute contrast from the `theme.css` token values (`--app-text` / `--app-surface` per theme plus the new mix token). That is fine. The running-app measurement in 2.3 remains the authoritative evidence.
