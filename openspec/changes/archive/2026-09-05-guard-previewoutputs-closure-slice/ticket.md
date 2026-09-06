# HEL-994: previewOutputs has no guard of its own on the dependency-closure slice it reaches by delegation

## Description

Follow-up from HEL-957 (merged `0f758ff3`, PR #564), which guarded `previewAtNode`'s
dependency-closure slicing at `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:507`
and the second slicing site at `:662` (`evaluateNodeRowsForBackfill`).

`previewOutputs` (`PipelineRunService.scala:329`) does not slice in its own body — it reaches the
line-507 slice by **delegating** to `previewAtNode` (`:403`). HEL-957's guards therefore cover it
**transitively, and that is real coverage, not zero**: a break in `closureOf` or in `previewAtNode`'s
use of it is caught today.

What is not covered is `previewOutputs`' **own** path. A change that alters how `previewOutputs`
resolves its target, its root, or the arguments it hands to `previewAtNode` — without touching
`previewAtNode` itself — would go uncaught by every guard HEL-957 added, because those guards
exercise the shared callee (`service.previewStep`), not this caller.

**This is a hardening ticket, not a hole.**

## Acceptance Criteria

1. A guard that observes the executed node SET on the `previewOutputs` path specifically — not the
   target node's own recorded rows, which are read through the node-keyed lookup at `:527` and are
   invariant under a widening mutation by construction.
2. That guard demonstrated RED under a mutation applied to the `previewOutputs` path specifically,
   with the mutation applied to real source, actually run, and the verbatim failure output captured.
   Reasoning that it would fail is not sufficient. **A mutation at `:507` does NOT satisfy this** —
   that only re-proves HEL-957's existing guards.
3. A non-degenerate fixture: the pipeline must contain at least one **enabled** node outside the
   target's closure, and the fixture's non-degeneracy must be **demonstrated, not asserted**.
   `InProcessPipelineEngine.scala` (`com/helio/domain/engine/`, ~:449) records `stepCounts` only for
   enabled nodes (`if (next.enabled) counts = ...`), so a disabled off-closure node makes the guard
   silently vacuous — HEL-957 hit exactly this trap at its design gate.
4. If a mutation reds for the wrong reason (an engine `UnprocessableEntity` rather than a key-set
   mismatch), record it and discard it rather than counting it as evidence.
5. Distinct mutation axes must be observationally distinct. HEL-957's cycle-1 error was claiming
   three axes where two were observationally identical on a two-node closure — one axis wearing
   three labels. If two mutations produce the same observed output, that is ONE axis; the fix is to
   lengthen the fixture until they differ, not to reword the claim.
6. `mutation-evidence.md` written to the same standard as HEL-957's.

## Constraints

- No migration. Prefer a spec with its own EmbeddedPostgres (the existing `PipelineRunServiceSpec` harness).
- Do NOT use Playwright and do NOT run e2e specs — HEL-972 holds Playwright and the dev database.
- No production database or deploy access. Agent-merge is off.
