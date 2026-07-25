## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ties policy claim vs. `SortStep`'s real implementation.**
   - Read `backend/src/main/scala/com/helio/domain/steps/SortStep.scala` directly. Its class
     scaladoc already reads "Sort step — multi-key stable sort" (line 36-37), and `SortStep.apply`
     (lines 59-87) implements this via `Seq.sortWith` per key (folded right-to-left for multi-key
     stability), with ties (`av == bv` under the comparator) falling through to `sortWith`'s
     stability guarantee rather than any custom index bookkeeping.
   - I did not just trust the doc comment — I empirically verified Scala 2.13's `sortWith` is a
     genuinely stable sort in this project's own toolchain: ran a live `sbt console` session
     (`scalaVersion := "2.13.15"`, confirmed in `backend/build.sbt`) with
     `Vector(Item(1,a), Item(2,b), Item(2,c), Item(2,d), Item(1,e), Item(3,f)).sortWith(_.key < _.key)`
     → result `Vector(Item(1,a), Item(1,e), Item(2,b), Item(2,c), Item(2,d), Item(3,f))` — ties
     preserved original relative order. This directly confirms design.md Decision 3's central
     technical claim ("ties are naturally broken by original row order... reached here for free").
   - Cross-checked `direction.equalsIgnoreCase("desc")` (line 65) against design.md Decision 1's
     claim that `SortStep` treats `direction` case-insensitively — matches exactly.
   - Non-blocking observation: `WindowStep.scala`'s own scaladoc (lines 63-68, HEL-376, already
     merged) says building its own index-augmented `Ordering` was chosen "rather than delegating to
     `SortStep.apply` (which would leave the tie-break undefined for equal `orderBy` keys)" — this
     reads in tension with the stability guarantee I just empirically confirmed. This is a
     pre-existing comment in already-merged code, not something this design introduces or needs to
     fix, and it does not undermine the design's (verified-correct) claim. Flagged as a
     non-blocking note below since a future reader could find the two comments confusing side by
     side.

2. **`n <= 0` rejection vs. `LimitStep`'s real no-op behavior, and the `AtMostParam` contract.**
   - Read `backend/src/main/scala/com/helio/domain/steps/LimitStep.scala`: `LimitStep.apply` line
     51, `if (count <= 0) rows else rows.take(count)` — confirms `count <= 0` really is a
     passthrough no-op, exactly as design.md's Risk section states. `expand`'s plan to reject
     `n <= 0` with `Left` before any step is built is the correct mitigation — letting it through
     would silently produce an unbounded row count, violating `AtMostParam("n")`.
   - Read `backend/src/main/scala/com/helio/domain/shapes/OutputContract.scala`:
     `RowCountContract.AtMostParam(paramName: String)` exists exactly as design.md describes.
   - Read `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` (wire format)
     and `backend/src/test/scala/com/helio/api/protocols/PipelineShapeProtocolSpec.scala` — the
     `{"kind":"at-most-param","paramName":"n"}` round-trip is already tested (pre-existing, from
     HEL-391/393), consistent with the design's claim that no new wire-format work is needed here.
   - Read `schemas/pipeline-shape-catalog.schema.json` — `rowCount.kind` enum already includes
     `"at-most-param"` with an optional `paramName`, and `fields` is already a generic array that
     may be empty. Confirms "no schema change needed" claim.

3. **Scope-out of per-group top-N / keep-ties as a spinoff.**
   - Read `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala` in full.
     `LimitStep` genuinely has no partition concept (confirmed above), and `WindowStep` only
     computes a rank-like column — it does not filter rows. Design.md Decision 5's claim that a
     per-group top-N needs either a new `filter`-on-computed-column two-step recipe or a new step
     kind, plus its own per-partition tie-break design, is accurate given the real capabilities of
     `window`/`filter`/`limit`. This is a reasonable, specifically-justified invocation of the
     ticket's "unless trivially added... otherwise note as a follow-up" clause — it is not trivial,
     and the design explains why in concrete terms (not hand-waved).

4. **`SingleRowShape.fn` case-insensitivity fix (Decision 4).**
   - Read `backend/src/main/scala/com/helio/domain/shapes/SingleRowShape.scala` line 130:
     `measures.find(m => !SupportedFns.contains(m.fn))` — confirmed case-sensitive today.
   - Read `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala` line 85:
     `val fn = agg.fn.toLowerCase` before the `match` — confirmed the step's runtime is genuinely
     case-insensitive. The design's claim that today's validation is "stricter than the engine it
     guards" is verified true (e.g. `"SUM"` is rejected at `expand`-time today but would execute
     fine if it got past validation).
   - Read `backend/src/main/scala/com/helio/domain/steps/FilterStep.scala` line 88-89:
     `evalCondition`'s `operator match` is genuinely case-sensitive with no `.toLowerCase` —
     confirms the design's claim that `operator` has no equivalent inconsistency to fix.
   - This is a one-line, single-file, behavior-widening (never behavior-narrowing) fix, fully
     traceable to a real runtime/validation mismatch — contained and low-risk, not scope creep.

5. **General soundness.**
   - Read `backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala`,
     `ShapeStepExpansion.scala`, `OutputContract.scala` — `PipelineShape.Registry` is a plain
     in-memory `Map`, no persistence; `ShapeStepExpansion`'s own scaladoc explicitly states it is
     kept in `com.helio.domain.shapes` "so domain code never imports `com.helio.api.protocols`" —
     the design's layering claim is grounded in an existing, enforced convention, and `TopNShape`
     following the same pattern as `SingleRowShape`/`PassthroughShape` (neither of which imports
     `com.helio.api.protocols`) is a safe bet.
   - `git status` on the worktree shows a clean tree at `3d4b0c07` (HEL-393, already on `main`)
     with only the untracked `openspec/changes/top-n-pipeline-shape/` — no stray migration or code
     changes have snuck in ahead of the design gate.
   - Compared the change's `spec.md` against the current base spec at
     `openspec/specs/pipeline-shape-registry/spec.md`: the three requirements marked MODIFIED
     ("PipelineShape.Registry enumerates every registered shape", "single-row shape reduces a
     source to exactly one row", "GET /api/pipeline-shapes returns the shape catalog") are each
     reproduced in full with the actual behavioral delta inline (registry size 2→3, `fn`
     case-insensitivity + new scenario, named-shape catalog assertion + new scenario) — correct use
     of MODIFIED (full replacement text, not a diff fragment). The four `top-n`-specific
     requirements are genuinely new and correctly marked ADDED. No requirement that should have
     been touched was left unmodified (checked "single-row shape declares an exactly-one-row output
     contract" and "single-row expansion is valid..." — neither is affected by the `fn` fix, and
     both are correctly left untouched).
   - Traced every ticket AC to a design/spec artifact: catalog entry with params + output contract
     (Decision 1/spec "top-n shape sorts and limits..."), `expand` → sort+limit + correct rows
     (spec scenarios), ties policy documented/tested (Decision 3, dedicated tie-break requirement +
     scenario), tests planned for expansion and e2e (tasks 2.1/2.2/2.5), additive/no schema change
     (verified directly above). No AC is left uncovered.

### Verdict: CONFIRM

### Non-blocking notes

- `WindowStep.scala` (already-merged, HEL-376) carries a scaladoc comment claiming that delegating
  to `SortStep.apply` "would leave the tie-break undefined for equal `orderBy` keys." I've
  empirically confirmed (live `sbt console` run against this project's actual Scala 2.13.15
  toolchain) that `SortStep.apply`'s underlying `sortWith` *is* stable, which is exactly what this
  design relies on and exactly what `SortStep`'s own class doc already claims. The `WindowStep`
  comment appears to be over-cautious/stale relative to that guarantee. Not a defect in this
  design and not this ticket's job to fix, but worth a one-line acknowledgment in `TopNShape`'s
  scaladoc (already planned per design.md Risk 3) so a future reader comparing the two files isn't
  confused by the apparent contradiction — optional polish, not a blocking requirement.
