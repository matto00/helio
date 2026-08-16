## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold spawn — no memory of round 1. Read the round-1 report (`skeptic-design-1.md`) only as a
claim to independently re-verify, then read all five current planning artifacts (`ticket.md`,
`proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-assert-op/spec.md`) fresh and re-derived
every conclusion from the actual repo.

**Round-1's flagged gap is fixed, and I independently re-derived that it's fixed correctly, not
just present:**
- `design.md`'s Context section (lines 10-14) now explicitly names
  `api/protocols/PipelineAnalyzeProtocol.scala` as a touch point, correctly distinguishing it
  (declaration site: case class + `jsonFormat6` + `write`/`read` dispatch arms) from
  `services/PipelineService.scala` (construction site only).
- `proposal.md`'s Impact section (line 39-40) lists the same file with the same declaration/
  construction distinction.
- `tasks.md` now splits this into two tasks instead of one: **3.4** (define
  `AssertAnalyzeStepResponse` + `jsonFormat6` + both dispatch arms in
  `PipelineAnalyzeProtocol.scala`) and **3.5** (wire the `case Success(cfg: AssertConfig) =>
  AssertAnalyzeStepResponse(...)` construction arm in `PipelineService.scala`).
- I read `PipelineAnalyzeProtocol.scala` in full (285 lines) and confirmed `LookupAnalyzeStepResponse`'s
  actual shape: `case class LookupAnalyzeStepResponse(id, position, config: LookupConfig, inputSchema,
  outputSchema, validationError)` (6 fields → `jsonFormat6` — line 175-179, 224), plus its `write`
  dispatch arm (line 250) and `read` dispatch arm (line 277). Task 3.4's description mirrors this
  exactly, and 6 fields is the correct count for `AssertAnalyzeStepResponse` too (same shape, `config:
  AssertConfig`).
- I read `PipelineService.scala:380-411` (`toAnalyzeStepResponse`) and confirmed the construction-only
  pattern task 3.5 describes: `case Success(cfg: LookupConfig) => LookupAnalyzeStepResponse(s.id,
  s.position, cfg, inSchema, outSchema, s.validationError)` — task 3.5's arm matches this shape.

**I did not stop at re-verifying round 1's specific finding — I redid the grep-based touch-point
audit from scratch, independently, to check for any other gap the fix might have introduced or left
behind:**
- `grep -rl "LookupStep\|LookupConfig" backend/src/main/scala frontend/src/features/pipelines schemas/
  openspec/specs` → 18 files. Checked every one against `design.md`'s Context list / `tasks.md`:
  `PipelineAnalyzeProtocol.scala` ✓ (3.4), `PipelineStepConfigCodec.scala` ✓ (2.1),
  `PipelineStepProtocol.scala` ✓ (2.2), `domain/package.scala` ✓ (1.4), `domain/PipelineStep.scala`
  ✓ (1.3), `steps/LookupStep.scala` → analog is the new `AssertStep.scala` ✓ (1.1/1.2),
  `PipelineStepRepository.scala` ✓ (2.3), `PatchSetApplyResolvers.scala` → confirmed (via
  `validateEmbeddedStepReferences`'s catch-all `case Success(_) => Right(())` for any config that
  isn't Join/Union/Lookup, `PatchSetApplyResolvers.scala:263`) this is correctly and deliberately
  omitted — assert has no second-DataSource reference — matching design.md's explicit statement,
  `PatchSetPreviewProjectionSteps.scala` ✓ (2.4), `PipelineService.scala` ✓ (3.5),
  `domain/PipelineAnalyzeService.scala` ✓ (3.3), the frontend files (`pipelineStep.ts`,
  `stepNarrowing.ts`, `useStepCardState.ts`, `StepCard.tsx`, `LookupConfig.tsx`→analog
  `AssertConfig.tsx`) ✓ (4.1, 5.1-5.4), `openspec/specs/patch-set-apply/spec.md` → prose-only mention
  of the Join/Union/Lookup ACL set, doesn't apply to assert (no ACL surface added), correctly
  untouched. Found no touch point missing from `tasks.md`.
- Also independently checked `schemas/pipeline-proposal.schema.json`'s descriptive (non-enforced)
  op-list string (line 57) still lists ops through `lookup` — task 5.5 targets exactly this string.
  `helio-mcp/src` has zero `Lookup` references, confirming the Non-goals' claim that no MCP wiring
  is needed here (419-F, correctly out of scope).
- Verified no naming collision: `grep -rn "\bAssertStep\b\|\bAssertConfig\b\|\bAssertRule\b"` across
  `backend/src`, `frontend/src`, `schemas/` returns nothing — these are genuinely new names.
- Verified `PipelineStepKind`'s existing constants (`PipelineStep.scala:142-172`) are all plain
  `String` `val`s sourced from each step's `Kind` companion field — `PipelineStepKind.Assert` will
  fit the same pattern with zero special-casing (`assert` is not a Scala reserved word here; it's
  just a string literal).

**Cross-checked design.md's other factual/precedent claims against real code (not just narrative):**
- `FilterConfig.decode`/`StepCodecUtil` (`FilterStep.scala:24-38`, `StepCodecUtil.scala`) — confirmed
  exactly matches Decision 2's described tolerant-decode shape (`Try(...).toOption` per array item for
  `conditions`, `stringOr` default for `combinator`; `asObject` falls back to `JsObject.empty` on a
  non-object top level, throws on genuinely malformed JSON syntax — caught by the codec facade's outer
  `Try`, same as every other step, not a gap introduced here).
- `SelectConfig(fields: Vector[String])` (`SelectStep.scala:11`) — confirmed matches Decision 1's cited
  precedent for "config's sole payload is a vector, wrapped in a case class."
  `PipelineStepConfigCodec.encodeJsObject(kind: String, configJson: JsObject)` (line 129) — confirmed
  `JsObject`-typed as Decision 1 claims.
- `inferPivot`/`inferUnpivot` (`PipelineAnalyzeService.scala:306-401`) — read both in full; both
  aggregate every missing-field problem into one `validationError` string (`missing.map(...).mkString`)
  rather than short-circuiting on the first bad field, confirming Decision 5's cited precedent.
- `PipelineAnalyzeService.scala:73-87`'s dispatch — confirmed `filter|limit|sort|dedupe|fillnull|union`
  share one identity arm while `pivot`/`unpivot`/`lookup` etc. get dedicated cases, validating Decision
  5's reasoning for why `assert` needs its own `inferAssert` case rather than joining the blanket group.
- `V72__add_lookup_op.sql` — read in full; confirmed it is the drop/re-add pattern task 3.2 cites,
  and confirmed the highest migration on disk is `V81__agent_preferences.sql` (matching design.md
  Decision 7's `main at V81`, not ticket.md's stale `V59` — correctly and explicitly handled by
  deferring the actual number to execution time in both Decision 7 and task 3.1).
- Cross-checked `ticket.md` against the live Linear ticket HEL-454 via `mcp__linear__get_issue` —
  identical text, confirming no drift between the ticket source of truth and the planning artifact.

**Acceptance-criteria traceability (re-derived independently, not copied from round 1's mapping):**
AC1 (persist/round-trip/registry/parity) → 1.1-1.4, 2.1-2.3, 6.1. AC2 (migration) → 3.1-3.2. AC3
(analyze identity + validationError) → 3.3, 3.4, 3.5, 6.3 — this AC is the one round 1's finding was
about, and it now traces cleanly to both the declaration (3.4) and construction (3.5) sites. AC4
(decode tolerance) → 1.1, 6.2. AC5 (editor add/remove + Jest) → 5.1-5.5, 6.5. AC6 (`sbt test`/`npm
test` pass, no FQNs) → 6.4, 6.6, general discipline. All six trace to real tasks; no AC is left
uncovered, and no task falls outside the ticket's stated scope.

**Placeholders/contradictions/scope drift:** none found. No `TODO`/`TBD` in any artifact. No
internal contradiction between ticket → proposal → design → tasks → spec. `Non-Goals`
(rule evaluation, fail-policy, `referential` kind, MCP wiring) are consistently excluded from
`tasks.md` and the spec's Requirements. `spec.md`'s Requirement/Scenario structure matches the
sibling `pipeline-lookup-op` capability's shape closely (compared directly against
`openspec/specs/pipeline-lookup-op/spec.md`).

### Verdict: CONFIRM

Round 1's finding is fixed correctly and precisely — the fix distinguishes declaration vs.
construction sites exactly as the actual code requires, not just added a file name to a list. My
own independent re-audit of every `LookupStep`/`LookupConfig` reference in the codebase found no
further gaps, and every acceptance criterion traces to a concrete task grounded in verified,
existing code precedent. Sound enough to implement.

### Non-blocking notes

- (Carried forward from round 1, still applicable, still non-blocking) `AssertConfig.tsx`'s task 5.1
  leaves exact per-kind `params` widget shapes to implementer discretion — matches the level of detail
  every other per-kind config editor in this codebase was scoped at. Flagging for the evaluator/skeptic
  at the final gate to check the editor renders sensible per-kind controls rather than a freeform JSON
  textarea.
- Design.md Decision 3's UI-default-severity ("error" for a freshly-authored rule) isn't spelled out
  as an explicit sub-step in task 5.1 the way the field-requiring-kind visibility rule is (which cites
  "design.md Decision 4" inline). Not blocking — same discretion-level precedent as above — but worth
  a quick spot-check at the final gate that a newly added rule actually defaults to `severity: "error"`
  per Decision 3's stated rationale, not silently to `"warn"`.

### Environmental note (not a verdict blocker)

`WORKTREE_PATH/scripts/concertino/` in this worktree (and in the sibling `agent-memory-store/HEL-478`
worktree, checked for comparison) is missing `next-report-number.sh`, `persist-evidence.sh`, and
`emit-event.sh` — present in the main checkout's `scripts/concertino/` but apparently added after
this worktree was set up (that directory is gitignored, so a worktree's copy is whatever was placed
there at setup time and is never auto-refreshed). All three scripts are pure functions of their
arguments plus the calling shell's git context (`git rev-parse --git-common-dir`), not of their own
script path, so invoking the main checkout's identical copies with cwd set inside this worktree
produces byte-identical results to a (missing) local copy — this is not a guessed fallback, just
using the same deterministic tool from its other available location. Reporting this so the
orchestrator can refresh this worktree's `scripts/concertino/` directory (or route future artifact
generation) before it causes a real failure for a caller that can't self-route around it this way.
