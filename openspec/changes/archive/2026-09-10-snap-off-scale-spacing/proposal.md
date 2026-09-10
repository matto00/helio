# Proposal: Snap off-scale spacing literals to the 4px scale (HEL-830)

## Why

HEL-439's token audit found spacing literals (`margin`/`padding`/`gap`) that sit between steps on `DESIGN.md`'s 4px scale — values like `6px`/`10px`/`7px`/`5px`/`14px` that were typed as optical nudges rather than chosen from the scale. The product owner ruled (2026-08-25) that the fix is to snap these onto the nearest scale step, not to widen the scale to accommodate them. Left unaddressed, the next audit finds the same pattern at a different pair of values.

## What Changes

- Re-derive the off-scale worklist mechanically from current `main` using a corrected scanner (parses each full declaration body up to `;`, strips `var(--space-N)` occurrences, then flags remaining literal px/rem values above the 4px optical-tweak floor that don't exactly match a `--space-*` token).
- Re-derivation on this run's `main` (commit `58855835`) found **102 off-scale spacing literals across 18 files** — down from HEL-439's original 119/20, reflecting file deletions (HEL-909's dataTypes/metrics/computedFields removal) and consolidation by intervening tickets. This is a real, reconciled finding, not a discrepancy to paper over — recorded in `enumeration.md`.
- For each literal, snap to the nearest scale step (`--space-1`=4px … `--space-10`=64px), using per-context judgment: default to the mathematically nearest step, but override toward the step that best preserves the surface's density/breathing-room intent when a site-specific visual reason applies (documented inline as a CSS comment at that declaration).
- Where a literal genuinely cannot snap without visual harm (e.g. an exact non-scale alignment with a sibling element), keep it and add an inline comment explaining why.
- Resolve HEL-680 overlap: the `7px` literals inside chip padding shorthands (`padding: 2px 7px`, `padding: 2px 6px` variants) are snapped by this ticket to a scale step; no new `--chip-padding` alias token is introduced here — that remains HEL-680's separate, narrower scope (a semantic recipe composed of existing tokens).
- Confirm `frontend/src/theme/tokenAuditSweep.css.test.ts`'s SPACING_BASELINE shrinks to reflect the snapped literals (each snapped file+line removed from the baseline; sites kept as documented exceptions remain).
- Confirm HEL-813's rendered touch-target guard (`e2e/support/touchTargetProbe.ts`-driven e2e suite) stays green — several snapped literals sit on interactive controls where a 2px reduction risks the 44px floor.
- Capture before/after screenshots (desktop, 430px, 768px) for every surface (file) touched, stored under the run's evidence directory — not the repo root.

## Impact

- Affected code: 18 `frontend/src/**/*.css` files (see `enumeration.md`) — pipelines, sources, panels, dashboards, settings features.
- Affected specs: none (`openspec/specs/` has no capability spec covering CSS spacing values; `DESIGN.md` is the governing standard, not an OpenSpec capability).
- No API/schema changes. No backend changes.
- Visual-only change; ~1–2px shift per snapped site. Regression surface is real and reviewed per AC3.
