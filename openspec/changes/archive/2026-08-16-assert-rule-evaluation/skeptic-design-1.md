## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/pipeline-assert-evaluation/spec.md` in full.
- Confirmed this is a genuine cold, round-0 first pass: `workflow-state.md` shows
  `PHASE: Planning`, `SKEPTIC_CYCLE: 0`, `LAST_SKEPTIC_VERDICT: —`; `find` over the
  change dir shows no pre-existing `skeptic-design-*.md`.
- **Central claim under test — `AssertionSink` as a mutable side-channel is
  required to survive a mid-pipeline `Future` failure.** Read the actual code this
  claim is about, not the design doc's restatement of it:
  - `InProcessPipelineEngine.executeWithStepCounts` (`domain/InProcessPipelineEngine.scala:29-44`)
    is a `steps.foldLeft(initial) { (acc, step) => acc.flatMap { ... step.evaluate(...) } }`
    — a strictly sequential `Future.flatMap` chain with no per-step recovery. A
    step's `Future` failure anywhere in the chain makes the *entire* chain's
    result a failed `Future`, carrying only the exception.
  - `PipelineRunService.executeRun` (`services/PipelineRunService.scala:276-318`)
    confirms this is exactly the failure mode reached in practice: `runFuture`
    is built from that same chain, then `runFuture.transformWith { case
    Failure(ex) => ... case Success((resultRows, stepCounts, sourceCount)) =>
    ... }`. The `Failure(ex)` branch has access to `ex` only — no tuple, no
    partial rows, no partial anything, because a failed `Future` genuinely
    carries no value. A purely-functional extension of the success tuple
    (`(rows, counts, assertions)`, design.md's own "alternative considered")
    would therefore be unreachable in exactly the branch the ticket requires
    ("both succeeded and — where evaluated — failed runs").
  - Confirmed the mutable-sink escape hatch actually closes that gap
    structurally: `executeRun` can construct `assertionSink` *before*
    `preExec`/`runFuture` even starts, pass it into `executeWithStepCounts` as
    a parameter (mutated as a side effect during step evaluation, independent
    of whether the chain that mutates it ultimately resolves or fails), then
    reference the same captured variable's `.results` from *both* arms of
    `transformWith` after the `Future` settles. This is architecturally sound
    and is the only one of the two options considered that satisfies the
    ticket's partial-results-on-failure requirement — the design's reasoning
    holds up against the real code, not just its own narrative.
  - Confirmed the "zero behavior change for existing callers" claim:
    `InProcessPipelineEngine.execute` delegates via `executeWithStepCounts(...).map(_._1)`
    (3-arg call) and every caller of `engine.execute`/`executeWithStepCounts`
    in the codebase (`PipelineRunService.previewStep`, `PipelineRunService.executeRun`,
    and ~20 test call sites across `InProcessPipelineEngineSpec` and all four
    `*ShapeEngineSpec` files) calls with 3 args, so a new *optional* 4th
    parameter with a fresh-per-call default (`new AssertionSink`) leaves every
    one of them uncompiled-unaffected.
  - Confirmed `PipelineExecutionContext` (`domain/PipelineStep.scala:64-71`) is
    constructed in exactly one test site outside production code
    (`AssertStepSpec.scala:83-86`) plus the engine's own `makeContext` — so
    adding a required `assertionSink` field has a genuinely small, traceable
    blast radius, and the one test site that needs updating is the same file
    task 6.1 already plans to extend.
  - Confirmed the `domain` → `domain.steps` import-direction argument (Decision
    1): `AssertStep.scala` already imports `PipelineExecutionContext`,
    `PipelineId`, `PipelineStep`, `PipelineStepId` from `com.helio.domain`
    directly, and `InProcessPipelineEngine.scala` lives in `package com.helio.domain`
    — placing `AssertionResult`/`AssertionSink` in `domain` (not `domain.steps`)
    is consistent with the codebase's existing import direction, verified, not
    asserted.
  - Confirmed `FilterStep`'s numeric-coercion precedent cited for the `range`
    rule (`v.toString.toDouble` wrapped in `Option(fieldVal)` to avoid an NPE
    on null/absent, `domain/steps/FilterStep.scala:76,98-99`) is real and, as
    cited, is null-safe by construction.
  - Confirmed the RLS policy shape cited for the new `pipeline_run_assertions`
    table (Decision 6) matches `pipeline_runs_owner`'s actual `EXISTS`-subquery
    shape in `V35__rls_owner_only_tables.sql:77-84`.
  - Confirmed `PipelineRunRepository`'s existing `insertRunInternal`/
    `listByPipelineInternal` (`withSystemContext`, ACL-bypassing) vs.
    `insertRun`/`listByPipeline` (owner-scoped) split, which the plan's
    `insertAssertions`/`listAssertionsByRun`/`listAssertionsByRunInternal` is
    modeled on — pattern genuinely exists as described.
  - Confirmed `PipelineAnalyzeService.inferAssert` (`domain/PipelineAnalyzeService.scala:455-498`)
    already has the "analyze-time allow-list check" Decision 3 references
    (`AssertRuleKinds`/`AssertFieldRequiredKinds`, non-blocking — a
    `validationError` string, not a hard reject), confirming a malformed rule
    (bad `kind`/`severity`, unknown `field`) genuinely can still reach
    execution, so the "never throws on a malformed rule" requirement in
    Decision 3/task 2.1 is addressing a real, not hypothetical, condition.
  - Checked migration numbering: current highest on this branch is `V83`, not
    the ticket's stale `V59` reference — but design.md Decision 7 explicitly
    tells the executor never to trust that number and to re-list the migration
    directory at execution time, which is the correct discipline, so this is
    not a design defect (the ticket text being stale is expected/acceptable
    given the explicit re-check instruction).
  - No placeholders/TBDs found in the planning artifacts (`grep -rniE
    "TODO|TBD|figure out later|to be determined|placeholder"` — one incidental
    match was a false positive, not an actual placeholder).

### Verdict: REFUTE

The design's central, hardest-to-verify claim (`AssertionSink` as a mutable
side-channel) checks out completely against the real `PipelineRunService`/
`InProcessPipelineEngine` code — that part of the design is sound and well
justified. But Decision 3's per-kind evaluation semantics leave one rule kind
genuinely underspecified in a way a competent implementer could resolve
incorrectly, with a real runtime-crash consequence, not just a style
divergence.

### Change Requests

1. **`design.md` Decision 3's `regex` rule spec is missing (a) match semantics
   and (b) null/absent-field handling — both of which are spelled out
   explicitly for every other field-requiring rule (`notNull`, `range`) but
   silently absent here.** As written: `regex(field, params.pattern) — fails
   if any row's field (as a string) doesn't match pattern.` That sentence
   answers neither:
   - **Full-match vs. partial-match.** The codebase already has a directly
     analogous precedent two files away —
     `domain/steps/StringOpsStep.scala:152-171` (`extractRegexFn`) — which
     uses `Pattern.compile(patternStr).matcher(v.toString).find()` (a
     substring/partial match), not `String#matches` (an implicit full-anchor
     match). Design.md cites `FilterStep`'s exact pattern by name for the
     `range` rule's coercion; it doesn't cite this equally-relevant precedent
     for `regex`, leaving the choice open. The one spec.md scenario that
     exercises `regex` uses an already-anchored pattern (`^[A-Z]{3}$}`), so it
     cannot distinguish the two semantics and won't catch a wrong choice.
   - **Null/absent field.** `range`'s citation of `FilterStep`'s pattern is
     null-safe *by reference* (`Option(fieldVal).flatMap(v =>
     Try(v.toString.toDouble).toOption)`, confirmed at
     `FilterStep.scala:98-99` — `Option(null)` is `None`, never dereferenced).
     `notNull` explicitly defines null/absent as the failure condition itself.
     `regex`'s literal description ("field (as a string)") has no equivalent
     guard stated, and the directly relevant codebase precedent
     (`StringOpsStep.extractRegexFn`) has to explicitly guard `if (v == null)
     null else { ... v.toString ... }` to avoid exactly this — calling
     `.toString` on a `null` `Any` throws `NullPointerException` in Scala
     (method dispatch on a null receiver), it does not degrade to `"null"` or
     `""`. If an implementer follows Decision 3's literal wording without
     independently rediscovering `StringOpsStep`'s guard, a row with a
     null/missing target field for a `regex` rule throws an uncaught
     exception inside `AssertStep.evaluate`'s `Future`, which propagates up
     through `executeWithStepCounts`'s `foldLeft` and fails the *entire
     pipeline run* — not a recorded assertion failure. That directly
     undermines this ticket's stated purpose: a null in the asserted field is
     precisely the kind of data-quality problem these rules exist to surface
     as an inspectable recorded failure, not as an opaque "Pipeline execution
     failed" crash that discards even the earlier `assert` step's own already-
     evaluated results (the very thing Decision 4's `AssertionSink` was built
     to preserve).

   **Required revision:** Decision 3 must state explicit `regex` semantics for
   both points — recommend adopting `StringOpsStep.extractRegexFn`'s existing
   convention for consistency within the codebase: partial/`find()` match, and
   null/absent field treated as `passed = false` (mirroring `notNull`'s
   explicit null handling, or `range`'s "can't prove it, so it fails"
   framing) rather than throwing. Add one scenario to
   `specs/pipeline-assert-evaluation/spec.md` exercising a null/absent field
   under a `regex` rule (the existing scenario's anchored pattern cannot catch
   a wrong choice either way), so the gap doesn't silently regress in
   implementation or in a future change.

### Non-blocking notes

- `tasks.md` 1.1 attributes "guarded against concurrent access" to "design.md
  Decision 4," but Decision 4's text is about mutability-for-failure-survival,
  not concurrency, and doesn't itself discuss thread-safety. In practice no
  concurrency exists to guard against: `executeWithStepCounts`'s `foldLeft` is
  strictly sequential within one run, and `executeRun` constructs a fresh
  `AssertionSink` per run (never shared across concurrent runs of the same
  pipeline). Harmless defensive coding either way — just a citation mismatch,
  not worth blocking on.
- `onDryRunSuccess` (`PipelineRunService.scala:321-337`) only inserts the
  parent `pipeline_runs` row (via `insertDryRun`) *after* the run already
  succeeded — unlike the real-run path, where `preExec` inserts the parent row
  *before* the engine runs. When wiring `insertAssertions` into
  `onDryRunSuccess` (task 5.1), the executor needs to sequence it strictly
  after `insertDryRun` resolves (not run it concurrently/before), or the FK to
  `pipeline_runs(id)` will not yet be satisfiable. Design.md Decision 5
  doesn't call out this ordering constraint explicitly, but task 6.4's planned
  dry-run persistence test would catch a wrong ordering immediately (FK
  violation or missing row), so this doesn't rise to a blocking design gap —
  flagging for the executor's attention rather than requiring a doc revision.
