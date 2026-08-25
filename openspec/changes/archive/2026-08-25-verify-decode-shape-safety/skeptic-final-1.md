## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope.** `git diff main...HEAD --stat`: only two source files touched —
  `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala` (+81)
  and `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala` (+67);
  everything else is change-dir docs. **No scope creep**: no edits to `FilterStep.scala`,
  `SortStep.scala`, or any decoder (`git diff main...HEAD -- '*.scala'` read in full). Decoder
  hardening correctly absent per D3 `defer-to-followup`.
- **Tests re-run by me** (not trusting evaluation-2.md): `sbt -batch test` in the worktree backend →
  `Total number of tests run: 3350 / Tests: succeeded 3350, failed 0 ... [success] Total time: 153 s`.
  The four new specs decode through the real `JoinConfig`/`PivotConfig`/`UnpivotConfig`/`WindowConfig`
  decoders and assert actual field values (not bare "decodes without throwing") — satisfies D2.
- **Source claims checked against current code, not narrative:**
  - `JoinStep.scala:17-24` — `stringOr(obj,"joinKey","")`, `stringOr(obj,"joinType","inner")`,
    `stringOr(obj,"rightDataSourceId","")`. Tolerance confirmed as described.
  - `PatchSetApplyResolvers.scala:215-244` `validateEmbeddedStepReferences` — `Failure` → BadRequest;
    `Success(jc: JoinConfig)` → `dataSourceRepo.findByIdOwned` referential check only;
    **`case Success(_) => Right(())`** catch-all for pivot/unpivot/window. No semantic-completeness
    check. Claim accurate.
  - `PatchSetPreviewService.scala:45-49` `preview` → `PatchSetApplyResolvers.resolveAll`, and
    `PatchSetApplyResolvers.scala:628` routes the pipelineStep-update resolve through
    `validateEmbeddedStepReferences`. The "preview reuses it verbatim" claim is accurate.
- **UI:** none. Diff is backend-only; no `frontend/**` files. `DESIGN.md` not engaged; no server/browser
  pass performed (correctly out of scope).
- **Acceptance criteria trace:**
  - AC1 (per-kind code read of the tolerant decode) — met; premise-validation + design.md Premise
    Correction, independently re-confirmed by me above for join and for the resolvers fall-through.
  - AC2 (LIVE verify per kind) — `live-trials.md` records 11 real `POST /api/refinements` trials
    (join 3, pivot 2, unpivot 2, window 4) with verbatim prompts and returned `patch.config`. Trials
    were run; **but see the mandated question below — they do not establish what the conclusion claims.**
  - AC3 (fix if a gap is confirmed live) — no gap confirmed; examples shipped unconditionally per D1/3.1.
  - AC4 (scope item 4 = escalation/decision) — met: resolved `defer-to-followup` and recorded.

### Mandated question: is there a discriminating negative control?

**No. There is none anywhere in this change's evidence trail.** I checked exhaustively:

- All 11 trials in `live-trials.md` are *positive* observations: every prompt was answered with a
  correctly-shaped config. Not one trial shows a wrong-shape config being emitted, and not one shows
  a wrong-shape config being *accepted by preview*.
- Neither of the two forms the review question specifies exists:
  - No trial was run with the prompt rule / worked examples absent or evaded. `RefinementEditShape`
    was unmodified-minus-additions throughout; there is no ablation run of any kind.
  - No hand-constructed wrong-shape config is fed through any decoder + `PatchSetPreviewService.preview`.
    `git diff main...HEAD -- '*.scala'` shows the four new tests decode only the *correct* worked
    examples and assert the *expected* values. There is no test in the diff (nor anywhere in the change
    dir) asserting "degraded decode AND preview returns valid". `grep -rn` across
    `openspec/changes/verify-decode-shape-safety/` for `negative control|hand-construct|degraded`
    returns only prose restating the risk — never an executed check.
- Consequently "11/11 PASS" cannot distinguish hypothesis (a) the prompt rule is load-bearing from
  (b) the trials never stressed it. Reading the actual prompts strengthens this concern rather than
  relieving it: e.g. join trial 3 ("Just switch the join to be a left join, keep everything else the
  same") and unpivot trial 1 (rename two output columns) are edits any competent model would shape
  correctly with or without the rule; pivot trial 1's "also group by quarter" is the closest thing to
  design.md D1's intended adversarial framing, and it still only *adds an element to an already-correct
  array*, which is the low-temptation direction. `live-trials.md`'s own closing paragraph concedes
  "this specific adversarial framing didn't reproduce it" — correct, and precisely why it cannot
  support the change's shipping conclusion that "the existing generic prompt rule already covers all
  four kinds."
- Note the asymmetry that makes this cheap to fix: the ground truth the design gate already settled
  (the tolerance IS present in all four decoders) is exactly the thing a deterministic test can pin
  down without a single further Claude call. Absent that test, this change ships four worked examples
  and four tests that all pass *by construction* on correct input — evidence-shaped, but proving
  nothing about the defect class the ticket exists to close.

### Verdict: REFUTE

### Change Requests

1. **Add a deterministic wrong-shape negative-control test** (the cheap, no-API-call option explicitly
   offered in the review brief). In `backend/src/test/scala/com/helio/services/patchsets/` add one test
   per step kind that (a) hand-constructs a wrong-shape config, (b) decodes it through the REAL decoder,
   and (c) asserts the decoded config IS semantically degraded. Minimum coverage, one case each:
   - `join`: `{"rightDataSourceId":"src_456","joinKey":"","joinType":"inner"}` (or `joinKey` as a
     `JsArray`) → assert `JoinConfig.decode(...).joinKey shouldBe ""` — i.e. the degradation is real and
     silent. (Probe `joinKey`/`joinType`, not `rightDataSourceId` — the latter is backstopped by the
     `findByIdOwned` check at `PatchSetApplyResolvers.scala:228-232`.)
   - `pivot`: non-array `index` (e.g. `"index": "region"`) → assert `decoded.index shouldBe empty`.
   - `unpivot`: `"valueVars": "q1"` (bare string) → assert `decoded.valueVars shouldBe empty`, and a
     missing `varName` → assert `decoded.varName shouldBe ""`.
   - `window`: `"orderBy": ["revenue"]` (plain strings, not `{field,direction}`) → assert
     `decoded.orderBy shouldBe empty` (item-level flatMap drop), and non-array `partitionBy` →
     assert `decoded.partitionBy shouldBe empty`.
   Each assertion must be on the VALUE (empty vector / `""` / defaulted scalar), never on absence of a
   thrown exception.
2. **Prove the tolerance survives the gate, not just the decoder.** For at least one of the four kinds
   (join is the clearest, since it is the only one with any downstream check at all, and `joinKey` slips
   past it), drive the same hand-constructed wrong-shape `UpdatePipelineStepRequest` through
   `PatchSetPreviewService.preview` (or, if wiring a full preview harness is disproportionate,
   `PatchSetApplyResolvers.validateEmbeddedStepReferences` directly — it is the code path `preview`
   reuses at `PatchSetApplyResolvers.scala:628`) and assert it returns **`Right`/valid** despite the
   degraded decode. This is the assertion that makes the ticket's central claim — "a wrong-shape edit
   passes preview and would silently corrupt the pipeline" — a tested fact rather than a code-read
   inference, and it is what makes the prompt rule demonstrably the only thing standing in the way.
3. **Correct the over-claim in the written conclusion.** `live-trials.md`'s "Overall verdict" and
   `RefinementEditShape.scala`'s new HEL-671 comment block both state that the live trials found the
   generic rule "already prevents a wrong-shape edit for all four step kinds." With no negative control,
   the supported statement is narrower: *"11 non-ablated trials produced correctly-shaped configs; this
   does not establish that the prompt rule was load-bearing in any of them."* Reword both to that, and
   record the CR-1/CR-2 tests as the deterministic evidence that the underlying tolerance is real.

### Non-blocking notes

- The `function: "sum"` vs `"running_sum"` value mismatch reproduced across cycle-1 and cycle-2 window
  trials 2-4 is correctly scoped out (loud `IllegalArgumentException` at execute time, not silent
  degradation), and correctly flagged as a spinoff candidate. Worth actually filing — it reproduced
  consistently, which makes it a real prompt-grounding gap, not noise.
- `join` trial 2's `joinType: "full"` is the same class of out-of-scope value defect; consider folding
  it into the same spinoff (`JoinStep` supports only `inner`/`left`, per its own doc comment).
- Cleanup of the throwaway trial pipelines/data sources on the shared dev DB is documented with `204`
  confirmations for all 8 resources — good discipline given the known shared-DB collision hazard.
