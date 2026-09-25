# HEL-1180: Split ChartPanel.tsx and ChartPanel.test.tsx (structural, behavior-preserving)

## Description

`frontend/src/features/panels/ui/ChartPanel.tsx` is now ~610 lines (was
already ~514, over CONTRIBUTING.md's ~400-line propose-a-split threshold,
before HEL-572 added click wiring/cursor logic — HEL-572 extracted the
reusable pure-function half into `chartClickSelection.ts`, which reduced
`ChartPanel.tsx`'s own net growth, but the file itself still warrants a
structural split — the appearance/option-assembly `useMemo` body is the
single largest remaining block). `ChartPanel.test.tsx` is ~1100 lines and is
also a splitting candidate (by concern: appearance mapping vs. data-option
assembly vs. compact-mode vs. theme-sync).

This is a pure behavior-preserving structural refactor — no behavior change,
no new tests beyond what already exists, just splitting large files into
smaller ones by concern.

## Provenance

`origin_kind: followup`
`origin_ticket: HEL-572`

Flagged independently by the executor, evaluator, and final-gate skeptic
during HEL-572 (chart click drill-down). Triaged as **standalone** — this
is a **driver decision** (fleet-driver triage call: fold-in/standalone/
discard), **not an owner ruling** — made because folding a behavior-
preserving refactor into an already-CONFIRMed/PASSed/merge-ready change
would have reopened Execution/Evaluation/the final gate for unrelated work
on a tight one-lane batch cadence (HEL-350 Panel Interactivity epic).

**Owner ruling (2026-09-25):** this split runs BEFORE HEL-588
(cross-filtering), so HEL-588 lands in smaller single-concern files.
HEL-1180 now `blocks` HEL-588 in Linear (confirmed via issue relations).

## Acceptance criteria

* `ChartPanel.tsx` split into smaller, single-concern modules/files with no
  behavior change (existing tests continue to pass unmodified in substance,
  only import paths change as needed).
* `ChartPanel.test.tsx` split by concern to match.
* `npm run lint` / `npm run typecheck` / `npm test` all pass, zero new
  warnings.

## Constraints (from driver brief, binding for this run)

* Behavior-preserving structural refactor ONLY. No behavior change. Any real
  bug discovered along the way becomes a filed follow-up ticket, NOT a fix
  in this PR (refactor discipline).
* The theme-sync behavior (HEL-566) is the fragile part: toggling light/dark
  while the chart stays mounted must keep re-resolving tooltip styling via
  the rAF-deferred recompute. Moving code across module/hook boundaries must
  not change hook order or memo dependencies. Must be live-verified via
  Playwright WITHOUT navigating away (navigating remounts and masks bugs),
  in-grid and in `PanelFullscreenOverlay`, plus click-to-Inspect (HEL-572)
  and tooltips (HEL-566).
* HEL-588 will next consume `panelsSlice.interactionState` /
  `SelectionDescriptor` (HEL-572) and will likely add cross-filter row
  filtering upstream of the chart's data option. Seams that make that easy
  are a plus, but do NOT pre-build any HEL-588 behavior.
* Tests: split `ChartPanel.test.tsx` by concern. Assertions must be
  preserved in substance; moving is fine, weakening isn't. Report the test
  count before and after (must not drop), and list any assertion changed
  with the reason.
* Red-first mutation proof for the refactor: pick 2-3 representative moved
  tests, mutate the code they cover in its NEW location, show them fail,
  then revert.
* Known non-goals (do not fix, do not pre-build): HEL-1178 (charts with no
  `appearance.chart` get `{}` for appearance — a behavior fix, not this
  ticket), HEL-1179 (`prefersReducedMotion` consolidation, not this ticket).
* Migration ledger: V110 is highest; V111 free but not expected to be used
  by this ticket (pure frontend structural refactor).
* Binding standards: CONTRIBUTING.md (file-size/module guidance, no inline
  FQNs), DESIGN.md, MISTAKES.md.
