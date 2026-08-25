- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css` — exact-value `gap`/`padding` px→rem literals replaced with `--space-*` tokens (12px→`--space-3`, 8px→`--space-2`).
- `frontend/src/features/dataTypes/ui/TypeDetailPanel.css` — exact-value spacing literals (1rem/8px/12px/16px/0.5rem) replaced with `--space-*` tokens.
- `frontend/src/features/dataTypes/ui/TypeRegistryBrowser.css` — `gap: 1rem` → `var(--space-4)`.
- `frontend/src/features/dataTypes/ui/TypeRegistryPage.css` — `gap`/`padding-bottom: 8px` → `var(--space-2)`.
- `frontend/src/features/metrics/ui/MetricsPage.css` — exact-value `gap`/`padding` literals (12px/8px) replaced.
- `frontend/src/features/panels/ui/ImagePanel.css` — `gap: 8px` → `var(--space-2)`.
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — exact-value spacing literals (12px/20px/8px) replaced.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — largest batch of exact-value spacing substitutions (16px/20px/12px/8px throughout).
- `frontend/src/features/pipelines/ui/PipelinesPage.css` — exact-value spacing literals (12px/8px) replaced.
- `frontend/src/features/pipelines/ui/RunHistoryModal.css` — exact-value spacing literals (12px/8px) replaced.
- `frontend/src/features/pipelines/ui/computedFields/ComputedFieldForm.css` — exact-value rem spacing literals (0.75rem/0.5rem) replaced.
- `frontend/src/features/pipelines/ui/computedFields/ComputedFieldsEditor.css` — exact-value rem spacing literals (1.5rem/1rem/0.75rem/0.5rem) replaced.
- `frontend/src/features/settings/ui/AgentMemoryList.css` — `padding: 8px` → `var(--space-2)`.
- `frontend/src/features/sources/ui/AddSourceModal.css` — exact-value spacing literals (12px/8px) replaced.
- `frontend/src/features/sources/ui/SourceDetailPanel.css` — exact-value spacing literals (12px/8px/16px) replaced.
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — new guard test (co-located `*.css.test.ts`, following the `Modal.css.test.ts`/`inputs.css.test.ts` pattern): re-runs all five of design.md's widened grep patterns (spacing, color, font-size, font-weight, font-family) against the 15 swept files and asserts every surviving hit is in that category's pinned baseline (spacing's is the off-scale/optical-tweak residual; color/font-size/font-weight/font-family are empty baselines since those categories have zero live hits in the 15 swept files — they exist as regression guards) — catches both new violations and reverted fixes. RED-demonstrated for both spacing and color (see `enumeration.md` in this change dir for the full enumeration and RED-demonstration summary).

## Enumeration correction (cycle 2, per evaluator CR2)

Cycle 1's report stated font-size was "0 violations found." Corrected: the
widened font-size pattern (em/%-inclusive, per design.md) finds **3** hits
repo-wide, none inside the 15 swept files: `features/panels/ui/MarkdownPanel.css:79`
(`0.85em`), `shared/ui/EmptyState.css:171` (`0.8em`), `shared/chrome/MobileNavSheet.css:161`
(`0.8em`) — all relative-em icon-glyph sizing with no absolute `--text-*`
token equivalent, correctly `flag: no-token`, left unfixed. Font-size is
**3 flagged, 0 fixed** — not "0 found." This does not change the fix count
(84) or any substitution made; it corrects the enumeration completeness
claim only.

## For the PR description (task 4.4 / skeptic-final-1.md CR3)

**Off-scale spacing residual note (must appear in the PR body):** this audit
fixed all 84 exact-value spacing literals but leaves a residual of **119
off-scale spacing literals across 20 files** (dominated by `6px`/`10px`, plus
`14px`/`7px`/`5px` and a handful of rem/px outliers — see
`enumeration.md` for the full breakdown), which have no matching
`--space-*` token and were left unfixed per the exact-value-only rule (no
tolerance/near-miss substitutions). This residual is **materially larger**
than HEL-680's stated remit ("the one already-known compact-chip case") —
the human reviewer should decide whether to broaden HEL-680's scope or file
a further follow-up ticket to cover the rest of the off-scale residual.
