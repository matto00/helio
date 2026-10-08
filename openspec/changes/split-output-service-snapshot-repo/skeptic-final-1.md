## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `7cec4bfca56ec71ffab6b2f5aa6ac91d2a605f45` against the live-resolved base
`24f6de4cf290c216c8ba94359f82d1d35ae88f2a` (`resolve-review-base.sh` exit 0). Spawn-cwd guard: READY.
Backend-only change, so there is no UI review. I wrote nothing except this report. Every build and
mutation ran in scratchpad `git archive` copies. Afterwards `diff -r` showed the scratch `backend/src`
identical to the worktree, and the worktree is clean apart from the evaluator's untracked `evaluation-1.md`.

### What I verified (with evidence)

1. **Every moved line is accounted for. My own check, not the executor's tooling.** I took a multiset line
   diff of base {OutputService, NodeSnapshotRepository, OutputConfigValidation} against head {those 3 +
   OutputRowReads, OutputRootResolution, NodeSnapshotFilterSql}.
   - Lines only in base: the 4 `private` -> `private[pipelines]` signatures (D2/D4), 2 trimmed import
     lines, and the D5-listed positional comment words ("above", "THIS class", "this class", "this file",
     "service.", "in this").
   - Lines only in head: package/imports, class scaffolding, the two `private val` wirings, the two
     member imports, the delegations and forwarders with their one-line docs, the D3 header
     amendment, and the new class docs.
   - No logic line changed.

2. **Public API (C2). My own `javap -public` on fresh `git archive` builds of base and HEAD.**
   - `OutputService`/`OutputService$`: the only differences are removed `$anonfun$*` static synthetics.
     Every constructor, `$default$N`, method and companion member is identical, `validateConfig$default$4`
     included.
   - `NodeSnapshotRepository` (+ companion and nested types): the only member removals are
     `...NodeSnapshotRepository$$escapeLikeTerm(String)` and `...$$likeEscapeChar()`, plus
     `$anonfun$` synthetics. No `$$` member was added on any checked class.
   - **`OutputConfigValidation` (design-3 note), checked explicitly.** The diff only adds: instance and
     static `validateConfig(OutputKind,JsObject,JsObject,OutputConfigWritePolicy)`,
     `validateFieldMapping(OutputKind,JsObject)`, `mergeConfig(JsObject,JsObject)`,
     `validateConfig$default$4()`, and `$anonfun$validateConfig$*`/`$anonfun$validateFieldMapping$*`
     synthetics. No pre-existing member is removed or changed.
   - `OutputConfigWritePolicy*` is unchanged.

3. **The `$$anonfun$N` class carve-out: I agree, ruling independently.** Class listing:
   - base has `OutputService$$anonfun$1/2` and `NodeSnapshotRepository$$anonfun$1`;
   - head has `OutputConfigValidation$$anonfun$3/4` and `NodeSnapshotFilterSql$$anonfun$1`.

   These are compiler-generated `collect { case ... }` partial-function classes. Their names encode
   only the owner and an ordinal. They are not members of any checked class, and no source can name
   them. D5b(b)'s rule exists to catch leaked private members (`$$rowReads`), and that rule still holds
   at member level (item 2). A verbatim move of a `collect` body cannot keep its owner-prefixed class
   name, so reading the rule as "no added `$$` member name" is correct, not a weakening.

4. **PR #847 still compiles when merged with this branch.**
   - `gh pr view 847` shows head `ca3f5619376829fbe97cd4ed61bf90c7be7f80d9`, still OPEN.
   - `git merge-tree --write-tree HEAD ca3f5619` gives a clean merge (tree `0cc5fa02c862`).
   - I extracted that tree to the scratchpad. The first `Test/compile` was a 100% disk-cache hit, so I
     did not count it. I then ran `clean` with a scalacOptions cache-buster and `Test/compile`:
     "compiling 465 Scala sources ... classes", "compiling 467 Scala sources ... test-classes",
     `[success]`, rc=0. That is a real full compile of main and test for the merged result.

5. **Tests are unmodified and green.**
   - `git diff 24f6de4cf...HEAD --name-only -- backend/src/test` returns 0 files.
   - Targeted `testOnly` of OutputRoutesSpec, OutputFilteredMetricRoutesSpec, PublicDashboardRoutesSpec,
     PatchSetPreviewServiceSpec, ExistenceNotLeakedRoutesSpec, NodeSnapshot*Spec and OutputService*Spec
     on a HEAD archive: 224 succeeded, 0 failed, exit 0.
   - I did not re-run the full 6180-test suite. For that I rely on the evaluator's pasted, unambiguous
     totals for base and after (identical, 443 suites, per-suite maps identical).

6. **The tests still catch defects (AC3). I chose four new mutations, different from the executor's
   and the evaluator's, each reaching the code only through public routes and reverted afterwards.**
   - A: `OutputRootResolution:55` `==` -> `!=`: **RED**, 3 failed (task 5.8a rootId tests).
   - B: `NodeSnapshotFilterSql:115` `DESC` -> `ASC`: **RED**, 3 failed (whole-node sort tests).
   - C: `OutputRowReads:109` `.map(Right(_))` -> `.map(v => Right(v.reverse))`: **RED**, 1 failed
     (distinct-values ordering).
   - D: `OutputConfigValidation:170` `Left(BadRequest(msg))` -> `Right(())`: **RED**, 5 failed
     (HEL-892/HEL-1139 fieldMapping 400s, through both create and PATCH, which proves the companion
     forwarder is live).

7. **Gates.**
   - `npm run check:scala-quality` exits 0. Soft warnings only: OutputService.scala 331 lines (was 503),
     NodeSnapshotRepository.scala 353 lines (was 458). No hard violations.
   - `npm run check:node-root-encoding`: clean, 4 files scanned.
   - `check-node-root-encoding.selftest.mjs`: all cases pass.
   - C4: exactly one `ServiceError.Forbidden(` in OutputService.scala and zero in the new files.
   - C5: `services/pipelines/README.md` line 5 is untouched; the addition starts after line 11.

8. **The seams are genuine.**
   - Row reads: the same concern as OutputRowsQuery/OutputFilterCapability.
   - Create-time root anchoring.
   - Whole-config write validation, moved to its existing home rather than a second one.
   - Pure SQL-fragment building, which touches no DbContext. The node-scoping predicate and its guard
     exemption stay on the repository.

   None of these is an arbitrary line-count split.

9. **Follow-up candidates and evaluator notes: was each one introduced by this change or already there?**
   - FU1 (sizes): accepted under the AC's "smaller overage" clause.
   - FU2 (exception text "OutputService: ..."): pre-existing text, moved verbatim. It is still reached
     via `OutputService.validateFieldMapping`. Follow-up only.
   - FU3 ("see `create`"): pre-existing cross-reference, moved verbatim. Follow-up.
   - FU4: pre-existing.
   - FU5 (`NodeRef` unused): already unused at base. The import line is the only base occurrence.
     Pre-existing.
   - FU6: covered in item 3.
   - FU7: process note.
   - Double blank line at NodeSnapshotRepository.scala:89-90: cosmetic.
   - **`OutputRootResolution.scala:11` was introduced by this change.** This class doc line is new text
     in a new file, not moved text. It says `pipelineRootRepo == null` "skips both checks". The code
     40 lines below contradicts it: `resolveExplicitRootId` with a null repo and `Some(rid)` returns
     `Left(BadRequest("rootId is not supported by this deployment"))` (lines 51-52). It does not skip.
     The wrong claim comes from pre-existing doc text that is also wrong: "degrades identically" in the
     moved `resolveExplicitRootId` doc, "matching ... degrade contract" in the moved
     `requireUnambiguousRootWhenNeither` doc, and the constructor comment at `OutputService.scala:44-47`
     ("falls back to the pipeline's auto-resolved first root"). Those stay as follow-ups under C3. The
     new line, though, puts that false claim into a fresh, authoritative-looking class contract. This
     is the laundering CONTRIBUTING.md:156 warns against, and a contract comment is the kind the
     comment standard values most.

### Verdict: REFUTE

### Change Requests
1. `backend/src/main/scala/com/helio/services/pipelines/OutputRootResolution.scala:11`: correct the
   new class doc so it matches the code. Suggested wording: "`pipelineRootRepo == null` (a fixture that
   doesn't wire one) skips the ambiguity check and rejects an explicit `rootId` with 400." Leave the
   moved doc bodies verbatim (C3). Update the move-check allow-list for this scaffolding line, re-run
   `check_moves.py`, and paste its PASS.
2. `files-modified.md`: add the pre-existing inaccuracies above as a follow-up candidate. That is the
   "degrades identically" and "degrade contract" phrases in the moved docs, and `OutputService.scala:44-47`'s
   "falls back to the pipeline's auto-resolved first root". All three contradict
   `resolveExplicitRootId`'s actual 400. Also add the evaluator's M1 test gap: the D6 LIKE-escape test at
   `OutputRoutesSpec.scala:931-942` stays green when the `%` escape is removed. Neither of these is
   fixed in this change.

No other change is required. Everything else above holds and does not need re-verifying beyond
check_moves and a compile after CR1.

### Non-blocking notes
- `NodeSnapshotRepository.scala:89-90`: drop one of the two consecutive blank lines while you are in
  the area.
- `evaluation-1.md` is untracked in the worktree. The orchestrator should commit it with the other
  change artifacts.
