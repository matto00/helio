## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD a606a9833910e36ad544e6aff6e4b87049245559. The planning artifacts are untracked in the worktree.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/output-history-view-polish/HEL-1352`.
- **Round-1 CR1 (virtualised table path) is resolved.** Design D4 now requires three running-app sizes: 2 rows, roughly 20–150 rows (non-virtualised overflow), and more than 150 rows (virtualised, citing `VIRTUALIZATION_ROW_THRESHOLD = 150` and the `PAYLOAD_HISTORY_MAX_ROWS` 1000 ceiling). Each size records the `.output-history__table` and `.ui-data-grid` heights. For the >150 case, D4 also requires a bounded (<=360px) scroll container and the final rows rendering at the bottom with no spacer gap. D4 names the HEL-1060 trap explicitly. The same requirement appears as standing constraint [C1] and is referenced from tasks 3.2 and 4.2. Fallback edits stay confined to `.output-history__table …` descendant rules; the shared `PanelContent.css`, `TableRenderer.css` and `DataGrid.css` are excluded.
- **Round-1 CR2 (measured hover contrast) is resolved.** D1 records the computed ratios (dark 1.122, light 1.179) and the 1.10 `CONTRAST_THRESHOLD`. It names the backdrop (`--app-surface-soft`, the hovered card). It requires a rendered-pixel sample in both themes after transitions settle, and says a value below 1.10 is a defect to fix, not to document. That is constraint [C2], tied to task 4.2.
- **Round-1 non-blocking notes are absorbed.** The `formatCapturePair` signature takes `comparisonIso: string | null`, and the null case stays at minute precision as today. Tests must assert relationships rather than exact localized strings (D2, task 2.3). Task 1.1's guard asserts that the hover stays `--app-surface-raised`. The scrubber's accessible names are a stated non-goal.
- **Premises re-checked against live code:**
  - `OutputGalleryCard.css`: `.output-gallery-card:hover` has `background: var(--app-surface-soft)`.
  - `.output-gallery-card__history` has `border-radius: var(--app-radius-md)`, `font: inherit` and no `font-weight`, with a hover of `--app-surface-raised`. The ticket's drift claim is accurate.
  - The tokens exist: `--weight-medium: 500` and `--app-radius-sm: 6px` (theme). DESIGN.md:399 gives Ghost's hover as `--app-surface-soft`. D1's reasoned deviation from that (the button sits on a hovered card already painted `--app-surface-soft`, so the hover would be invisible) is correct.
- **D2 call-site enumeration matches grep.** `formatCaptureTime`/`sameMinute` are used at `HistorySummary.tsx:34,49,58,69`, `HistoryRows.tsx:83-85`, `HistoryChart.tsx:36`, `HistoryScrubber.tsx:17` and `chartOverlay.ts:90`. The three routed components are exactly the ones that use `sameMinute`, so removing `sameMinute` is safe. The two un-routed callers use only the default `withSeconds` argument, so they are unaffected.
- **D3 can be built as written.** In `HistoryRows.tsx`, `comparisonNote` is set inside `if (comparison)` in the `diff` branch, and is currently `null` when `noLongerPresent === 0`. The new branch drops into that slot. The missing, loading and error branches are unchanged.
- **D4 rule shape:** `.output-history__table` currently has `height: 360px; display: flex; flex-direction: column` (OutputHistoryModal.css:105-110), and `.panel-content` is `flex: 1; min-height: 0`. Swapping `height` for `max-height` is a plausible first step, and the three-size check will show whether it is enough.
- **Spec delta integrity.** Both MODIFIED requirements carry the full original text with additions appended. Every original scenario is kept: Label and Oldest point; then Added and changed, Duplicates, and Missing comparison (extended with the new note's absence). New scenarios were added for same-second, identical, identical payloads and short table. No original requirement text was lost (diffed against `openspec/specs/output-history-scrubber/spec.md`).
- **AC coverage:**
  - Ghost button → 1.1.
  - Note → 3.1 (RTL test).
  - Table height → 3.2.
  - Same-second labels → 2.1–2.3 (RTL test).
  - Both-theme comparison → 4.2.
  - No scope drift.
- **Placeholders and contradictions:** there are no TODO/TBD markers. The proposal, design, tasks and spec agree. The one apparent conflict is proposal "What Changes" bullet 1, which says the hover becomes `--app-surface-soft`, against design D1, which keeps `--app-surface-raised`. Design D1 and task 1.1 are explicit and authoritative, so I record this as a non-blocking note rather than a REFUTE.

### Verdict: CONFIRM

### Non-blocking notes

- **The proposal contradicts D1 on the hover colour.** Proposal "What Changes" bullet 1 still says the button gets hover `--app-surface-soft`. D1 and task 1.1 deliberately keep `--app-surface-raised`. Fix the proposal bullet during execution (or archive) so the archived record does not describe the invisible-hover variant D1 rejected.
- **The `font` shorthand will override a weight placed before it.** `.output-gallery-card__history` declares `font: inherit`, and that shorthand resets `font-weight`. The new `font-weight: var(--weight-medium)` must come after `font: inherit` in the rule, or replace it. If it comes first, the button's weight stays at 400. Task 1.1's regex guard (`[^}]*font-weight: …`) passes either way, so it cannot catch the ordering. Have the 4.2 running-app check read `getComputedStyle(btn).fontWeight === "500"`, or make the guard assert the ordering.
- **Scrubber accessible names stay ambiguous.** Same-minute points still share an accessible name on the scrubber. This is out of scope here and is a follow-up candidate.
