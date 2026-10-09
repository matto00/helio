## Why

HEL-1384 and HEL-1393 left small inaccuracies behind: two tests labelled GUARD that are actually red-first, a comment
pointing at a `recover` that moved, test names and doc notes naming members that moved out of `PipelineRunService`,
a repository method with no remaining callers, and "Defaulted to `None`" comments that may not be true. Each is the
kind of thing that misleads the next reader into trusting a gate or a default that is not there.

## What Changes

- Relabel FireTimeRunConfigGateSpec's two undecodable-config tests red-first, after proving they fail on 1bf11f55.
- Fix the stale "this `recover`" comment in `PipelineSchedulerService.fire()`.
- Rename stale describe/it strings (and one comment) in `PipelineRunServiceSpec` to the members' current owners.
- Delete `PipelineRepository.findPrimaryDataSourceIdInternal` if grep + compile show zero callers; fix doc refs to it.
- Update the archived `forbidden-classification.md` pin note to the post-#888 split (Service 1 + Preview 1).
- Verify each "Defaulted to `None`" comment against its signature and callers; correct the false ones.
- Tighten the `explicitRootId` "`None` ... single-root case" wording (optional item).
- Split PipelineSchedulerService.scala (314 lines): auto-run debounce claim-and-fire moves to a new
  `PipelineAutoRunDebounceFirer` collaborator; cron schedule firing stays. Behaviour-preserving.
- MISTAKES.md: one line on `audit_events` append-only scoping, only if evidence shows it recurs.

## Capabilities

### New Capabilities

### Modified Capabilities

None. Tests, comments, docs, one behaviour-preserving split, and one dead-method deletion; no requirement changes (`skip_specs: true`).

## Non-goals

- Item 3's PipelineRunService split: superseded by HEL-1393 (#888), the "combine if they collide" path the ticket named;
  the file is now 386 lines.
- Any behaviour change. Any edit to PipelineAnalyzeService (HEL-1385, in flight).

## Impact

Backend test sources, comments in backend main sources, PipelineSchedulerService (split), `PipelineRepository` (one method removed), MISTAKES.md
(maybe), one archived openspec note. No API, schema, or migration change.
