## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: worktree HEAD d6aef6c46cfd3fcd47ebddd5519497d0f58c562b (= main); change dir untracked.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/conditional-format-followups/HEL-1490`.

### What I verified (with evidence)

**Round-2 CR1 (changed-row wash vs rule wash): resolved, and the mechanism D4 chooses works in the live tree.**
- D4, AC5 and the spec scenario now give one specific outcome. The "Change" cell of a changed row always keeps
  `--app-accent-surface` and its text. Data cells show the rule wash, with a cell rule winning over a row rule. A
  changed row with no rule keeps the accent on every cell.
- The proof is a computed-style or specificity assertion plus light/dark screenshots. That replaces the class-presence
  test that round 2 rejected.
- **Can a leading column carry `cellClassName`?** Yes.
  - `TableRenderer.tsx:798` builds the leading columns with `leadingColumns.map((c) => ({ ...c, inert: true }))`, so
    any `cellClassName` on the column survives.
  - `DataGrid.tsx:1260` applies `col.cellClassName?.(row)` to every body `<td>`, whether or not the column is inert.
  - `DataGrid.cellClassName.test.tsx` already pins this hook.
- **Which rules compete on the Change cell?**
  - `HistoryRows.tsx` passes no `pinnedColumns`, so `pinnedKeys` is empty and the Change cell never gets
    `ui-data-grid__pinned-cell`. The pinned tone variants, at (0,2,3)+, do not apply to it.
  - `withCellRules` never sees the Change column: it is prepended after `ruledColumns` (`TableRenderer.tsx:786-800`).
    So no `ui-data-grid__cell--tone-*` class can land on it.
  - The only competing background is therefore the row tone,
    `.ui-data-grid__table tbody tr:where(.ui-data-grid__row--tone-*) td` (`TableRenderer.css:133/158/183`), at (0,1,3).
- **Can a token-only selector beat it?** Yes. For example,
  `.output-history__row--changed td.output-history__change-cell { background: var(--app-accent-surface) }` is (0,2,1),
  which beats (0,1,3).
- **Data cells behave as D4 says.**
  - On a changed row, the row tone (0,1,3) beats `.output-history__row--changed td` (`OutputHistoryModal.css:119`,
    (0,1,1)), so data cells show the rule wash.
  - A cell tone (0,2,3) beats both.
  - With no rule, the accent wash stays on every cell.
- **Glyph placement.** `withCellRules` puts the row-rule glyph on data column index 0
  (`tableConditionalFormats.tsx:46`), not on the Change column. This matches the claim "lands on the first DATA column".
- **Class composition.** `withRowRules` (`:83-97`) joins the caller's `rowClassName` with the tone class, as D4 says.

**D1–D3 (item 5): verified.**
- `OutputHistoryModal.tsx:14,21,67` holds the full `Output` and forwards only `outputId`. `HistoryRows` passes no
  `conditionalFormats`. `TableRenderer` already accepts the prop (`:117`).
- `readTableConfig` (`outputConfigTypes.ts:327`) and `readCollectionConfig` (`:358`) both expose `conditionalFormats`
  via `formatsField`. The collection config has a `fieldMapping` record.
- `ConditionalFormatRule.column` and `.target` are optional (`conditionalFormatting.ts:23-26`). So mapping each
  collection rule to `{...rule, column: fieldMapping.value, target: "cell"}` is well-typed, and it keeps rule order.
  `resolveCellRule` picks the first match, the same first-match semantics the collection item uses.
- `matchRule` (`:77-79`) returns false on empty or undefined raw text. So an absent column applies nothing, as the
  Risks section claims.
- With no rules, `withCellRules` and `withRowRules` return their inputs unchanged (`:44`, `:88`), so the no-rules
  history grid is DOM-identical.

**D5, D6, D7: re-checked against the tree; they match.**
- The metric label and unit mix sit at `PanelContent.css:31` and `:40`.
- `saveDisabled` / `saveBlocked` appear only in `OutputEditorFooter.tsx` and `OutputEditorSheet.tsx`.
- `inputs.css` gives the invalid recipe to `.ui-input` / `.ui-textarea` only.
- Hover parity is now decided up front (Risks section), not left to the executor to discover.

**Placeholders, contradictions, scope.**
- The only deferral is the token name in D5. It does not block implementation.
- Proposal, design, tasks and specs agree with each other.
- Scope matches ticket.md "Scope of this run": items 5, 2, 4 and 6 are in; items 1 and 3 are explicitly out.
- Every AC (AC5, AC2, AC4, AC6) maps to a task group (1, 2, 3, 4) with a concrete verify signal.

### Verdict: CONFIRM

### Non-blocking notes

- **Jest cannot measure task 1.4's computed style.** Jest maps `\.(css)$` to `src/test/styleMock.js`
  (`frontend/jest.config.*` moduleNameMapper), so stylesheets never load in jsdom. The red-first proof will have to
  be a specificity/rule assertion that reads the CSS source, in the style of the existing token guards. The running-app
  computed style and screenshots (task 5.1) remain the authoritative evidence. The design already allows "computed-style
  or specificity"; the executor should pick the specificity route deliberately, not discover this mid-task.
- **Decide when the Change cell gets its class.** If `output-history__change-cell` is applied unconditionally, the
  Change `<td>` of a no-rules Output gains a class. That is visually identical, but not literally "renders identically
  to before". Either apply the class only when rules are present, or read the no-rules scenario as a visual statement.
  Either is fine; pick one and say which.
- **Make the history-scoped selector robust.** Make it beat at least (0,2,3), so it would also survive a pinned or
  cell-tone class if pinning is ever enabled in history. (0,2,1) is enough today only because history never pins.
