## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-derivation from source. Round 1 REFUTED on exactly one issue (CR-1/2/3: all 11
live refinement trials were positive-only, no discriminating negative control). This
round re-verifies the three claimed fixes in `98f5d785` against the actual current
source, plus re-checks diff scope and the AC trace.

### What I verified (with evidence)

**1. Negative-control tests genuinely assert degraded VALUES (CR-1) — VERIFIED**

`backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala:245-294`
adds a 4-test group, each hand-constructing a wrong-shape config (never a worked example)
and decoding through the real decoder. None is a bare no-throw assertion; each asserts a
concrete degraded value. I cross-checked every assertion against the real decoder source:

- `join`: omits `joinKey` → asserts `decoded.joinKey shouldBe ""`. Matches
  `JoinStep.scala:21` (`StepCodecUtil.stringOr(obj, "joinKey", "")`).
- `pivot`: `"index": "region"` (JsString, not JsArray) → asserts `decoded.index shouldBe
  empty`. Matches `PivotStep.scala:25-28` (`case _ => Vector.empty[String]`).
- `unpivot`: `"valueVars": "q1"` + omitted `varName` → asserts `valueVars shouldBe empty`
  and `varName shouldBe "variable"`. Matches `UnpivotStep.scala:33-38`. The test's inline
  comment correctly flags that `"variable"` is `stringOr`'s own hardcoded default (a
  silent substitution, same defect class) rather than `""` — an honest, non-inflated
  characterization.
- `window`: `"partitionBy": "region"` + `"orderBy": ["revenue"]` → asserts both `empty`.
  Matches `WindowStep.scala:37-45`; `SortKey` is `jsonFormat2` (`SortStep.scala:16`), so a
  bare `JsString` fails `convertTo[SortKey]` and is dropped by `flatMap(...).toOption`.

These are discriminating: if the decoders were hardened (the deferred scope item 4), every
one of these four tests would fail. That is the property round 1 asked for.

**2. The preview test genuinely exercises the real path and demonstrates acceptance (CR-2)
— VERIFIED**

`PatchSetPreviewServiceSpec.scala:569-596`. The `preview` helper (line 305) is
`await(service.preview(PatchSet(None, edits), user))` on the real `PatchSetPreviewService`
constructed at line 181 with real repositories over embedded Postgres — not a stub.

I traced the path the test drives: `PatchSetApplyResolvers.scala:628` calls
`validateEmbeddedStepReferences`, which at line 225 decodes the EDIT's config (not the
stored step's) and at line 228 matches `case Success(jc: JoinConfig)` → checks only
`findByIdOwned(jc.rightDataSourceId)`. `joinKey`/`joinType` are never inspected on any
arm; the fall-through is `case Success(_) => Right(())` (line 243). The test seeds a real,
owned right-side source so the referential check passes, then submits a config that omits
`joinKey` entirely. `preview` returning `Right` is therefore exactly the ticket's central
claim demonstrated, not inferred — and the test fails loudly with the returned error if
preview ever starts rejecting it.

**3. Prose over-claim corrected (CR-3) — VERIFIED**

- `live-trials.md:189-224` (Overall verdict) is rewritten. The prior "already prevents a
  wrong-shape edit for all four kinds" is gone, replaced with an explicit statement that
  11 non-ablated trials do NOT establish the prompt rule was load-bearing, that no ablation
  was run, and that several prompts would be shaped correctly with or without the rule. It
  points at the new tests as the deterministic evidence. I grepped the whole file for
  residual causal claims: the per-trial verdicts read "no live-reproduced shape gap," which
  is an accurate observation, not a causal claim.
- `RefinementEditShape.scala:68-84` comment block reworded identically: the examples now
  ship "per D1/3.1's unconditional instruction regardless of live-trial outcome," the
  tolerance is labeled a tested fact citing both new test locations, and the live trials
  are explicitly downgraded to "these specific, non-ablated prompts didn't trigger it."

**4. Test suite re-run independently — VERIFIED**

I ran `sbt -batch test` myself in the worktree (not trusting the reported figure):
`[info] Tests: succeeded 3355, failed 0, canceled 0, ignored 0, pending 0` /
`[info] All tests passed.` / `EXIT=0`. I confirmed all 5 new tests actually executed by
name in the log (preview test at line 11761; the 4-test negative-control group at
23311-23315) — not silently skipped.

**5. Diff scope — no creep (VERIFIED)**

`git diff main...HEAD --name-only` over code dirs returns exactly three files:
`RefinementEditShape.scala` (main), `PatchSetPreviewServiceSpec.scala`,
`RefinementEditShapeSpec.scala`. No `FilterStep`/`SortStep` changes (correctly out of
scope per the coordinator premise correction), and no decoder hardening — scope item 4
remains `defer-to-followup` as the coordinator resolved. `StepCodecUtil` and all four step
decoders are untouched, consistent with the spec delta's explicit "does NOT change
decode-time behavior for any caller."

**6. AC trace**

- AC1 (code-read per kind): satisfied and recorded in `ticket.md`'s premise correction; now
  additionally corroborated by the four executable negative-control tests rather than a
  code read alone.
- AC2 (live verification per kind): `live-trials.md`, 11 trials across all four kinds
  (join 3, pivot 2, unpivot 2, window 4), with cleanup confirmed via `204 No Content`. The
  epistemic limits of these trials are now stated accurately, which was the round-1 defect.
- AC3 (fix any confirmed gap): no live gap reproduced; the worked examples shipped
  unconditionally per D1/3.1 anyway, and each is decoder-verified with real value
  assertions (`RefinementEditShapeSpec`), satisfying the AC's explicit "a merely-decodes-
  without-throwing assertion does NOT catch this defect class" requirement.
- AC4 (scope decision escalated, not silently made): resolved by the coordinator to
  `defer-to-followup`, recorded in `ticket.md`; the diff honors it.

**7. UI gate — N/A.** Zero `frontend/**` files in the diff, so `DESIGN.md` is not engaged
and no server/screenshot pass applies.

### Verdict: CONFIRM

The one round-1 objection is fully and honestly closed. The evidence is now deterministic
and in code rather than narrative, the negative controls are discriminating (they would
break under decoder hardening rather than passing vacuously), the preview test proves the
ticket's central claim through the real service, and the corrected prose no longer claims
more than the trials support. Scope stayed clean and the full suite is green on my own run.

### Non-blocking notes

- The `function: "sum"` vs `"running_sum"` value-mismatch observed in window trials 2-4 is
  correctly triaged in `live-trials.md` as a value-validation gap (caught loudly at execute
  time), distinct from this ticket's silent-shape class. It is flagged as a spinoff
  candidate but no ticket appears to be filed yet — worth filing before archive.
- The deferred decoder-hardening scope item now has four ready-made characterization tests
  pinning current tolerant behavior. Whoever picks that follow-up should expect to invert
  these four assertions rather than delete them.
