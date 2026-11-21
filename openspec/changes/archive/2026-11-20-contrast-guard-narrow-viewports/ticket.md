# HEL-1649: Contrast guard (HEL-866) runs only at 1440px: add narrow/header layouts; it missed two hover defects in HEL-1628

## Description

origin_kind: followup
origin_ticket: HEL-1628

The HEL-866 state-surface contrast guard measures hover and focus states only at **1440px**. The redesign added
layouts that exist only at narrower widths: the pipeline header at 1100px and below, the phone and tablet headers,
and the glass nav. Two invisible-hover defects in HEL-1628 (spine-card refresh at 1.03, phone/tablet header refresh
at 1.000, against a 1.1 floor) got past CI and were caught by the evaluator's manual measurement.

**Fix:**

* Extend the guard's viewport matrix to the redesign's breakpoints (at least 1440, 1100, 768, 390), in both themes.
* Cover the controls that render only at those widths (pipeline header, phone/tablet headers, glass-nav pills,
  dashboard chips).
* Keep runtime in budget: CI shards are at 11-15 of 18 minutes, and the shard weights are pending regeneration
  (HEL-1645).

## Acceptance Criteria

* The guard fails on HEL-1628's pre-fix hover (reintroduced by mutation) at 768 and 390, and passes on main.
* CI time impact is measured and stated.

## Premise notes (orchestrator, 2026-11-20, verified against 4f101209b)

* `PipelineDetailHeader.css` was deleted by HEL-1582 (d83875077); the phone/tablet *header* refresh button no longer
  exists. `SourceSampleLabel` (and its refresh button) now renders only inside `SpineSourceCard`, at every width.
  The surviving HEL-1628 pre-fix hover is the spine-card refresh rule pair in
  `frontend/src/features/pipelines/ui/spine/PipelineSpine.css` (the two `.spine-card .source-sample-label
  .ui-icon-btn:hover:not(:disabled)` rules).
* HEL-1735 (31094b154) gated feature hover rules behind `@media (hover: hover)`: a touch-emulated context renders no
  hover state at all.
* HEL-1789 (87cf01a5f) split the guard into `e2e/state-surface-contrast-guard-*.spec.ts` parts with a shared
  `e2e/support/state-surface-contrast-guard.ts`, and regenerated `e2e/shard-weights.tsv`. HEL-1645 is still Backlog.
