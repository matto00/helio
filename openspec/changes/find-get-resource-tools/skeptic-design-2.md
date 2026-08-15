## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/workspace-resource-search/spec.md`, and round 1's `skeptic-design-1.md` in full, fresh
  (cold), against this worktree's current on-disk state.
- `openspec validate find-get-resource-tools --strict` → `Change 'find-get-resource-tools' is valid`.

**Round-1 required fix #1 (pipeline `getResource` sharing-aware leak) — re-verified against real code, confirmed fixed:**
- `PipelineService.scala:126-129`: `findSummaryById`'s doc comment still reads `/** Sharing-aware
  read. Owner, editor, and viewer grantees can read. */`, backed by `pipelineRepo.findSummaryByIdShared`
  — confirms the round-1 finding still holds as a real property of the method design.md D1b reuses.
- `PipelineService.scala:667,678`: `toSummaryResponse` still populates `ownerId = if
  (s.ownerId.nonEmpty) Some(s.ownerId) else None` — confirms design.md D1b's claim that
  `PipelineSummaryResponse.ownerId` is already available for a post-fetch filter, no new repo method
  needed.
- `design.md` D1b (lines 54-67) now explicitly requires filtering
  `summary.ownerId.contains(user.id.value)` before calling `buildPipeline`, `Left(NotFound)`
  otherwise. `tasks.md` 3.5 (lines 51-56) restates the identical filter-before-build step. `spec.md`
  gained both the base Requirement text ("isn't owned by `user`", lines 34-41) and a dedicated
  Scenario ("get_resource on a pipeline shared with (but not owned by) the caller still returns
  NotFound", lines 53-58) that names the exact mechanism (`findSummaryById` is itself sharing-aware,
  `getResource` stays owner-only regardless). `tasks.md` 5.3b is the matching test.
- Checked `WorkspaceContextService.buildPipeline` (`WorkspaceContextService.scala:196-207`): it
  internally calls `pipelineService.analyze(PipelineId(summary.id), user)`, itself sharing-aware
  (`PipelineService.scala:182`) — but since D1b's ownership filter runs *before* `buildPipeline` is
  ever invoked, the caller is already confirmed as owner by that point, so this internal call cannot
  reintroduce the leak. No new gap.
- **This required fix is real, concrete, and grounded in the actual sharing-aware method it targets — closed.**

**Round-1 required fix #2 (unbounded `find` result set) — re-verified as concrete, not just prose:**
- `design.md` D1a (lines 43-52) adds a named `MaxFindResults: Int = 20` constant plus an explicit
  deterministic sort (name-match-position ascending, then `(resourceType, name)` ascending) and
  truncation step — not a bare mention.
- `tasks.md` 3.3a (lines 42-44) restates the same constant name and the same sort-then-truncate
  step as an actual implementation task, distinct from 3.2's basic filter/map step.
- `spec.md` gained a dedicated Requirement ("find's result set is bounded, never unbounded", lines
  24-26) and Scenario ("A query matching more resources than the top-K limit is truncated", lines
  28-32), correctly phrased generically (not hardcoding the literal `20`, which is right — the
  number is an implementation tunable, not a contract detail). `tasks.md` 5.3a is the matching test.
- **This required fix is real and concrete — closed.**

**Checked for new inconsistencies introduced by the fixes (adversarial pass):**
- `openspec validate --strict` still passes after both edits (schema-level, doesn't catch prose
  drift — see below for what it can't catch).
- Re-checked `WorkspaceContextService.scala` for the `private[services]` widening plan (D2/1.1):
  unchanged from round 1, still accurate (`toDataSourceEntry`/`toDataTypeEntry`/`toDashboardEntry`
  are `private` today; `buildPipeline` is already `private[services]`).
- Found two residual, pre-existing round-1 **non-blocking** items that the fix pass did not fully
  propagate everywhere (see notes below) — neither is new damage from this round's edits, and
  neither blocks implementation since `tasks.md` (the operational checklist) is unambiguous on both.

### Verdict: CONFIRM

Both required revisions from round 1 are genuinely closed, not just reworded: D1b's fix is grounded
in the actual sharing-aware method (`findSummaryById`) and the actual field
(`PipelineSummaryResponse.ownerId`) it needs, verified against the real `PipelineService.scala`
source, not just asserted; D1a's fix adds a real named constant and a concrete sort+truncate step
present in all three artifacts (design/tasks/spec) rather than a prose mention of "top-K." No new
correctness or security-relevant inconsistency was introduced. `openspec validate --strict` passes.

### Non-blocking notes

1. `tasks.md:16` still reads `with \`fromString\`/\`toString\`, mirroring \`DataFieldType.fromString\``,
   while `design.md:84-87` was corrected this round to `fromString`/`asString` (matching the actual
   codebase convention `DataFieldType`/`Role`/`PanelType`/etc. all use). The round-2 summary claims
   this naming was "corrected," but the correction only landed in `design.md` — `tasks.md` 2.1 is now
   the one place in the change that still says `toString`, actively disagreeing with `design.md`
   rather than merely being silent on it (round 1's state, where both files agreed on the same wrong
   term). Cosmetic — an implementer following `design.md`'s authoritative decision text (and the
   established codebase pattern) would likely still land on `asString` — but worth a one-line fix to
   `tasks.md` 2.1 before/during execution so the two artifacts don't visibly contradict each other.
2. `proposal.md:51-53`'s Impact section still reads `backend/src/main/scala/com/helio/ai/` (new file,
   e.g. `WorkspaceAssistantTools.scala`, or co-located with `WorkspaceSearchService`) — i.e. still
   framed as the round-1-flagged either/or, with `com.helio.ai` listed first/primary. `design.md` D7
   (lines 116-126) explicitly settled this to `com.helio.services`, and `tasks.md` 3.1/4.1 already
   consistently say `com.helio.services` with no ambiguity. So the operational checklist
   (`tasks.md`) is unambiguous and this doesn't block implementation, but `proposal.md`'s Impact
   section is now stale relative to `design.md`'s settled decision and should be updated to match
   for artifact hygiene.
3. D1a's tie-break sort key ("name-match-position ascending") doesn't define what position to use
   for a summary that matches only via its *description* (not its name) — e.g. a metric whose real
   `description` contains the query but whose `name` does not. A literal `name.indexOf(query)` would
   return `-1` for such entries, which (sorted ascending) would rank them *ahead of* even an
   exact-prefix name match at position 0 — likely the opposite of intent. This doesn't violate the
   spec's literal requirement (the outcome is still deterministic and reproducible, not "arbitrary/
   unstable" per `spec.md`'s own Scenario wording), and D1a explicitly frames this as "a concrete, if
   simple, ranking... a smarter ranking is a future, separate improvement," so I'm not treating it as
   blocking. Still worth a one-line clarification (e.g., "when the match is only in the description,
   use a sentinel position after all name-matched entries") before implementation to avoid a
   plausible one-line ranking bug that no test in `tasks.md` 5.x currently exercises (5.3a only tests
   truncation count, not cross-field ranking order).
