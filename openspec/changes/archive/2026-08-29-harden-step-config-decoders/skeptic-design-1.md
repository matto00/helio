## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**1. D1 flips pivot/unpivot/window — TRUE.**
Read `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala:266-303`. All three
fixtures are genuine wrong-**TYPE** cases:
- pivot: `"index": "region"` — JsString where JsArray expected.
- unpivot: `"valueVars": "q1"` — JsString where JsArray expected. (Its second assertion,
  `varName shouldBe "variable"`, is an absence case and will NOT flip on its own, but the test flips because
  the `valueVars` decode raises first. Executor should be aware the surviving inverted test can no longer
  assert the `varName` default — that assertion belongs in the 2.5 GUARD.)
- window: `"partitionBy": "region"` (wrong type) and `"orderBy": ["revenue"]` (wrong element type).
D5's first three rows are correct.

**2. D2+D3 corruption trace — closed.**
Path traced: editor adds `compute` with `column: ""` → D2 accepts (correct type, empty value) → row persists →
`PipelineStepRepository.rowToDomain` decodes tolerantly (D1 keeps absence/empty tolerant) → run reaches D3's
required-value check → run fails naming step + `column`, so HEL-888's `""`-named output column is never
produced; analyze reports the same via `validationError`. The D2 relaxation does not leave that hole open.

**3. The preview-test flip claim — FALSE. This is the blocking defect.**
`PatchSetPreviewServiceSpec.scala:592-594` constructs
`JsObject("rightDataSourceId" -> ..., "joinType" -> JsString("inner"))` — `joinKey` is **omitted entirely**,
which the test's own comment states explicitly ("joinKey is OMITTED entirely (never \"\" explicitly)"). D2
rejects wrong-**TYPE** only (design.md:48), and the `pipeline-step-config-rejection` delta says in terms
"Absence of a key SHALL NOT be rejected... Rejection SHALL apply only to a key that is present but whose JSON
type cannot represent the declared shape." A `validateRawConfig` built to that contract therefore returns
`None` for this config. Nothing else in the wired path catches it: `PatchSetApplyResolvers.
validateEmbeddedStepReferences:222-229` only checks decode `Success`/`Failure` (absence still decodes
successfully under D1) and then does a `findByIdOwned` referential check on `rightDataSourceId`, which the
fixture supplies validly. D3's completeness check is run/analyze-time, not preview-time, by the spec's own
wording. **This test will still return `Right` after the change.** design.md:103 ("flips at `validateRawConfig`
— proof"), the D5 heading "4 of 5 flip", ticket.md:129 and :138, and tasks.md 6.2 are all wrong in the same way.

**4. Spec deltas vs. design — the specs are RIGHT; design.md is wrong.**
`pipeline-step-config-rejection/spec.md`'s preview scenario correctly uses a wrong-**type** `pivot.index`, not
an absence case, and its absence-not-rejected paragraph is unambiguous. `pipeline-step-config-read-strictness`
and `pipeline-step-config-runtime-completeness` are consistent with D1/D3. So the required revision is to
design/tasks, not the specs.

**5. Enumeration task.**
`ls backend/src/main/scala/com/helio/domain/steps/` = 25 entries, minus `README.md` and `StepCodecUtil.scala`
= exactly **23** step files, matching tasks.md 1.1's count. Task 1.1 does state the both-directions
requirement verbatim ("no step file omitted, none wrongly included"), matching ticket.md:47, and 1.3 makes
ambiguous requiredness an ESCALATION rather than a silent call. Sound as written — see non-blocking note 1
for the one strengthening I would ask for.

### Verdict: REFUTE

### Change Requests

1. **design.md:96-111 — correct the D5 table and heading.** The `PatchSetPreviewServiceSpec` row must be
   reclassified from "flips at `validateRawConfig` — proof" to a **guard** (absence stays accepted at preview
   by D2 + the rejection spec). Change the heading from "4 of 5 flip" to **3 of 5 flip, and 2 are relabelled**.
   The document's own principle ("We do not contrive a fifth flip") applies equally to the fourth.

2. **tasks.md 6.2 — replace the instruction.** "Invert `PatchSetPreviewServiceSpec`'s preview test to expect
   rejection" is not achievable under D2 and would push the executor either to implement absence-rejection
   (contradicting the approved D2 and the spec delta) or to fake the flip. Replace with: keep the test's
   `Right` expectation and rewrite its CHARACTERIZATION-TEST WARNING comment to state that HEL-814 deliberately
   preserves preview acceptance of an absence-only draft, and that the wrong-**type** rejection at preview is
   proven instead by the new test in 7.1. Same treatment 6.3 gives the `join` decode test.

3. **tasks.md 7.1 — make the replacement proof explicit.** Add, adjacent to the general "preview rejects a
   wrong-shape config for each affected step kind": a specific PROOF test that preview rejects a **join** edit
   whose `joinKey` is present but of the wrong JSON type (e.g. `{"rightDataSourceId": "...", "joinKey": 123}`),
   sited in `PatchSetPreviewServiceSpec` next to the relabelled guard. This is what actually closes the gap
   the original preview characterization test was written to expose, and it makes the guard/proof pair legible
   in one place.

4. **ticket.md:126-138 — apply the same correction** to the RESOLVED DESIGN DECISIONS D5 text ("4 of 5 flip",
   "`PatchSetPreviewServiceSpec`'s preview test flips at the `validateRawConfig` level. Proof.", and "The 4
   flipping characterization tests are proof"), so the artifact of record does not carry a claim the
   implementation cannot satisfy. Note in the same edit that the Linear description carries the same wording
   and should be corrected there too.

5. **tasks.md 8.4 — update the PR-statement requirement** from "4 of 5 characterization tests flip, with the
   5th relabelled" to the corrected count, and require the PR to state explicitly *why* the preview test does
   not flip (absence is deliberately tolerated on write; completeness is enforced at run/analyze by D3).

### Non-blocking notes

- tasks.md 2.2/6.1: the inverted `unpivot` test can no longer assert `varName shouldBe "variable"` once
  `valueVars` raises. Move that absence-default assertion into the 2.5 GUARD so the coverage is not lost.
- tasks.md 3.2: worth stating which `ServiceError` the wired rejection produces at the preview surface. The
  rejection spec says 422 for create/update; `validateEmbeddedStepReferences` currently emits
  `BadRequest` (400) for decode failure. Ordering (validate before decode) is already specified in 3.2, but
  the status the preview surface returns should be pinned so the new 7.1 test can assert a status, not just
  a `Left`.
- D1 + `rowToDomain`'s `IllegalStateException` means any wrong-type row created between measurement and deploy
  becomes a 500 on listing. design.md Risks names this and the write-path closure mitigates it; acceptable, but
  the PR should say it out loud.
