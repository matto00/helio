# HEL-830: Snap the 119 off-scale spacing literals to the 4px scale (74 are 6px/10px), with visual review

## Description

HEL-439's token audit found 119 spacing literals across 20 files with no matching `--space-*` token — values between steps on the 4px scale. 6px (41) and 10px (33) account for 74 of the 119. Product owner ruling (2026-08-25): snap these to the nearest scale step, do NOT add new tokens for the between-step values. This is a judgement call per context (e.g. 6px in a dense control may want 4px; 6px of card padding may want 8px), not a blanket rounding rule. Any literal that genuinely cannot snap without visual harm must be kept, with the reason recorded inline.

**Mandatory: re-derive the worklist mechanically from current `main`** — do not trust the 119 as frozen; `main` has moved substantially since (HEL-442, HEL-732, HEL-909 deletion of dataTypes/metrics/computedFields, HEL-443's 92-file icon consolidation). Use the corrected scanner methodology: parse the full CSS declaration body up to `;`, strip `var(--space-N)` occurrences, then scan every remaining literal — a naive value-after-colon regex under-reports (missed a `30px` case previously). Reconcile the new count against 119 explicitly; a different count is a finding to report, not to smooth over.

Reconcile with HEL-680 (compact-chip padding token, `2px 7px` case): HEL-680's own description (already re-scoped 2026-08-25) resolves this — HEL-830 snaps the `7px` chip sites to a scale step; HEL-680 separately introduces a semantic `--chip-padding` alias built from existing scale tokens (not a new raw-px token). No overlap as long as HEL-830 only changes the literal values and does not create a new named chip-padding token.

## Acceptance Criteria

- [ ] The off-scale set is re-derived from current `main` (mechanical scanner, command recorded) and reconciled against HEL-439's 119
- [ ] Each snapped value's target step is a deliberate per-context choice, not a blanket rule
- [ ] Visual verification at desktop, 430px, and 768px for every surface touched — evidence captured (screenshots), not asserted
- [ ] HEL-439's `tokenAuditSweep.css.test.ts` baselines shrink accordingly, and the guard stays green
- [ ] HEL-813's touch-target sweep still passes — several literals are on interactive controls; a 2px reduction could drop a control under the 44px floor
- [ ] Documented exceptions carry an inline reason
- [ ] HEL-680 reconciled: 7px chip sites resolved here; HEL-680 left to introduce only the semantic alias token

## Notes

- Screenshots must be written into the worktree or run evidence dir, never the repo root.
- Read the diff on every bulk find/replace — a green test suite is not sufficient evidence a CSS value change is correct (see MISTAKES.md discipline on evidence-shaped non-evidence).
