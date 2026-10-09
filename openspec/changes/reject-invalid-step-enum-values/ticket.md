# HEL-1416: Reject clearly invalid enum values at save for fillnull/window/pivot steps (keep incomplete drafts saveable)

## Description

origin_kind: followup
origin_ticket: HEL-1267

**Owner-approved scope (Matt, 2026-10-08, via AskUserQuestion)**, split out from HEL-1267 (closed as already-done: analyze
has reported these errors since HEL-859, and auto-run skips them via `stepConfigProblem`).

The remaining gap is write time: the step companions' `validateRawConfig` accepts clearly invalid configs on save.
Following HEL-1310's aggregate precedent (9fbdd426: write-time 422 for an unsupported function / invalid `p`):

* reject at save: an unknown fillnull strategy, an unknown window function, an unknown pivot agg, a window offset <= 0;
* keep accepting incomplete drafts (constant strategy with no `value`, lag/lead with no `field`, etc.) to preserve
  HEL-814 D2 ("legitimate to save is not legitimate to run", InProcessPipelineEngine.scala ~:257-265), which protects
  the editor's add-then-configure flow.

## Acceptance Criteria

* Apply on every write path that already calls `validateRawConfig`, plus single-call create once HEL-1402 lands
  (HEL-1402 merged as 06a4eb97 — single-call create and patch-set pipeline-create now call it).
* Read-only check of helio-news's step configs (/home/matt/Development/helio-news) for anything newly rejected;
  escalate if so.
* Legacy stored invalid configs still read and analyze (no read-time validation).
* Red-first per check; the frontend editor surfaces the 422 message (or prevents the invalid choice) for each kind.
