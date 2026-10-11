## Skeptic Report — design gate (round 4, skeptic-design-4.md)

This round reviewed the current ticket.md (six owner rulings), proposal.md, design.md, tasks.md and the three spec deltas. Worktree HEAD is 5dceeae9d11ca1b0a8891ad31f0a2c4397b92521. No code has changed yet; the only untracked path is the change dir. I re-derived every claim from the tree rather than from the round 1-3 reports.

### What I verified (with evidence)

**Backend chain points are sufficient.**
- `OutputConfigValidation.validateConfig` (OutputConfigValidation.scala:180-197) runs the key check only under `ValidateWrite`, then runs the merged-config validators.
- `OutputService` create (:135) and update (:208) and `PatchSetPreviewProjection` (:135) all route through that function.
- `PipelineCreatePreflight.validateOutputConfig` (:204-208) is the only other path. Single-call create reaches it at :197, and proposal grounding reaches it via `PipelineServiceSupport.validateOutputFieldMapping` (:71) ← `PipelineProposalAnalyze` (:149).
- So D2's two chain points cover every write path the spec names.
- D2 gates the new validator on `ValidateWrite` only, which matches the spec's rollback/undo exemption. (`OutputCompare`/`PayloadOptIn` run under both policies, and the design deliberately differs from them here.)
- `KnownKeys` (:21-28) matches the delta's "before" sets exactly.

**Render funnel.** The only production consumers of the renderers are `PanelContent` → `OutputPanelContent` → `MetricOutputPanel`/`CollectionRenderer`/`TableRenderer`, plus `OutputPreviewPane` (metric preview, :145) and `HistoryRows` (excluded by the design, and it passes no rules). Public dashboards reuse `OutputPanelContent`, and `PublicPanelOutputMetaResolver` (:31-35) returns the raw config. So the spec's "every dashboard surface" claim holds with no backend public change.

**MetricRenderer / DataGrid seams.**
- `ColumnDef.rowClassName(row)` exists (DataGrid.tsx:309).
- The pinned-cell background rule is `.ui-data-grid__table tbody td.ui-data-grid__pinned-cell { background: var(--panel-surface-override, var(--app-surface)) }` (DataGrid.css:212-213). D6's opaque-gradient treatment for pinned cells is aimed at exactly this rule.
- `HistoryRows` passes its own `rowClassName` into `TableRenderer` (:52, :109), so the "compose with caller rowClassName" requirement is real.
- `DataGridConsumerRegression.test.tsx` exists.
- `ICON_SIZE` exists (iconSize.ts:4). `lucide-react` is a dependency.
- `shared-test-fixtures/join-step-config.json` (the precedent) exists.

**Tokens and contrast.**
- `--app-success|warning|error` and their `-surface` washes are defined for both themes (theme.css:197-218, 282-288).
- contrast-audit §2 lists each intent on its own wash at >= 4.5 in both themes after remediation (light 4.62-5.42; dark >= 4.63).
- The §1 figure of 5.67 for `--app-warning` light on `--app-bg`, which the design cites, is present (line 59).

**Round-3 change requests, checked against the current text.**
- (a) Task 4.7 is now Playwright computed-style only, in light and dark. The Jest branch is gone.
- (b) The unit-colour check under `--panel-text-override` has moved to 4.7(b). 4.4 now holds a labelled STRUCTURAL guard: the unit is outside the toned element and carries no tone class. That guard does fail in jsdom on the round-2 defect.
- (c) Task 4.7(c) checks one wash per cell on an unpinned cell, a pinned cell, and a cell-rule cell inside a washed row.
- (d) Task 4.8 runs mutation reds for (b) (tone class on the outer span) and (c) (wash on the `<tr>`).
- C5 records the Jest-cannot-measure-CSS constraint.

**Round-3 non-blocking notes.** All three are now in the design:
- D7: an empty label is omitted, and the `eq`/`neq` number-vs-string choice is pinned in the seam fixture.
- D6: the row-rule `title` sits on the glyph wrapper in the first visible cell.

**ACs traced to tasks.**
- AC1 (metric token colour, both themes) → 3.3, 4.4, 4.7(a), 4.9.
- AC2 (table cell/row per column/row) → 3.4, 3.5, 4.4, 4.7(c).
- AC3 (invalid rejected / no rules unchanged) → 1.2, 1.3, 4.1, 4.2, 4.5, C3.

**Owner rulings.** Each of the six maps to the spec: ordered first-match list; colouring targets; three tones and their washes; glyph + label + tooltip; table column/target, resolved independently; delta untouched.

**Placeholders.** None found: no TODO/TBD and no deferred blocking decision. Scope matches the ticket, and no AC is left uncovered.

### Verdict: CONFIRM

### Non-blocking notes
- **Wording mismatch, tasks.md 4.4 vs D6.** Task 4.4 says a cell-rule cell "carries the cell class and not the row-wash cell class". D6 defines no per-`<td>` row-wash class: the row class sits on the `<tr>`, CSS paints the wash on its `<td>`s, and a higher-specificity cell-tone rule replaces it. The executor should not invent a per-td row class just to satisfy 4.4's wording. The Jest assertion should be "row tone class on `<tr>`, cell tone class on that `<td>`", with the no-layering behaviour proven by 4.7(c)/4.8 as planned. Either reading still satisfies the spec, because Playwright enforces the outcome.
- **Glyph size.** D5 names the `ICON_SIZE` constant but not which size (sm 14 / md 16 / lg 20). A fixed px glyph next to a `--text-3xl` metric figure and a compact `--text-xl` card should be judged at the final gate (4.9 already lists the compact card).
- **Pinned-cell tone selector.** The tone selector must out-rank the existing `tbody td.ui-data-grid__pinned-cell` rule (specificity 0,2,2). 4.7(c)'s pinned-cell check will catch this if it is missed.
- **Metric preview test.** The editor's metric preview applying unsaved rules (spec, D4) is not named in any group-4 test. Cover it under the 3.6 editor tests.
