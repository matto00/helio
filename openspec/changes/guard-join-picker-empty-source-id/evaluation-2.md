# Evaluation Report — Cycle 2 (evaluation-2.md)

HEAD fd190a68; base 824aa914. Re-reviewed the cycle-2 delta (8b22f60d..fd190a68) plus
independent re-verification of the claims. Working tree clean before and after my checks.

## Phase 1: Spec Review — PASS

- **CR1 (fifth-site coverage) — closed and verified first-hand.** New test at
  `PipelineCreateTransactionalSpec:341`. I re-ran the mutation myself rather than trusting the
  transcript: restored join's own unconditional `checkOwnedSource(jc.rightDataSourceId, user)`
  arm inside `validateStepCrossOwnerRefs` ONLY (every other site left on the shared extractor),
  then `testOnly ...PipelineCreateTransactionalSpec` → `Tests: succeeded 10, failed 1`, with
  exactly the new test RED and both pre-existing join tests ("reject ... another owner's data
  source" :292, "accept ... the caller's OWN data source" :316) GREEN. Mutation reverted;
  `git status --porcelain` empty, HEAD still fd190a68. The executor's claim is accurate.
- **CR2 (AC6b) — performed as written.** §5.3 records a real browser click-through of the
  `"+ Add step"` → `"Union / append rows"` → `UnionConfig` combobox flow with POST 201 / PATCH
  200 and a traced, unrelated `/schedule` 404. This is what the AC asked for. See the labelling
  finding below — it does not change the verdict, and the executor already labelled it
  correctly.
- No pre-existing assertion, fixture or expected value was changed anywhere in the cumulative
  diff: `git diff 824aa914..HEAD -- backend/src/test | grep "^-"` yields exactly ONE line, the
  `PipelineStepRoutesSpec` import extended with `JoinStepResponse`. Additions only.
- Non-blocking three from cycle 1 all addressed: patch-set test count corrected to three, the
  bypass note now states `-n` skips the entire 17-step hook and lists the checks re-run
  separately, codec alignment/blank line fixed (a pure whitespace change — verified in the
  cycle-2 diff, no logic touched).

### AC6b's evidence DISCRIMINATES? — No, and that is the correct, pre-declared outcome

Verified independently as asked. `git show 824aa914:.../PipelineService.scala` shows
`case uc: UnionConfig if uc.otherDataSourceId.nonEmpty =>` already present at **:873 (addStep)**
and **:1110 (updateStep)** — HEL-620 had already guarded exactly the two endpoints the browser
walkthrough drives (`POST /pipelines/:id/steps`, `PATCH /pipeline-steps/:id`). The walkthrough
would therefore have passed identically against unfixed code. It is **not** a red-backed gate
for anything this change fixes.

Its real, narrower value: it proves (a) the union path is genuinely reachable from the real
`OP_TYPES` picker, (b) `join` is genuinely absent from that picker — the ticket's CORRECTION
re-confirmed at the UI, and (c) the shared-extractor rewrite did not regress a previously
working path. Design Decision 6 and AC6b both labelled it a regression guard *in advance*, and
§5.3 repeats that label, so the record already matches reality. No correction needed; recorded
here so the PR body cannot be read as claiming a red-backed UI gate.

### Which mechanism actually covers each of the five sites

The coordinator's premise that the walkthrough touched a `PatchSetApplyResolvers` cell is
**wrong**; I verified the correct mapping against the tree:

| Site | Empty-id coverage | Foreign-owned (ACL) coverage |
| --- | --- | --- |
| `PipelineService.addStep` | `PipelineStepRoutesSpec` join empty-default POST + live curl probe 1.4 | `PipelineStepRoutesSpec` cross-user POST + live probe 5.2 |
| `PipelineService.updateStep` | `PipelineStepRoutesSpec` PATCH-to-empty + live curl probe 1.5 | new `PipelineStepRoutesSpec` cross-user PATCH |
| `PatchSetApplyResolvers` join cell | `PatchSetApplyServiceSpec` + live curl probe 1.3 | pre-existing 7.9d test + live probe 5.2 |
| `PatchSetApplyResolvers` union cell | `PatchSetApplyServiceSpec` + live curl probe 1.2 | new `PatchSetApplyServiceSpec` foreign-union test |
| `PipelineService.validateStepCrossOwnerRefs` | new `PipelineCreateTransactionalSpec:341` (mutation-proven singly, re-verified above) | pre-existing :292 |

The browser walkthrough covers **none** of these cells' fixes; it exercises the union
(already-guarded) leg of rows 1-2 only. The patch-set surface is reachable only via the
assistant/proposal handoff, which is precisely why AC6c excluded a patch-set UI walkthrough.
No browser evidence is credited to a surface the browser never touched.

### Class-closing audit — re-verified against the tree, one methodological blind spot

Every number in `proposal.md`'s "Class-closing audit" checks out:

- `grep -c "final case class [A-Za-z]*Config" backend/src/main/scala/com/helio/domain/steps/*.scala`
  → **23**, matching the audit and matching `PipelineStep.Registry.size shouldBe 23` in the
  passing structural guard.
- Grepping those 23 for a `*DataSourceId` field returns **exactly three**:
  `JoinStep.scala:12` `rightDataSourceId`, `UnionStep.scala:11` `otherDataSourceId`,
  `LookupStep.scala:12` `referenceDataSourceId`. (Note `LookupConfig` is multi-line, so a
  single-line `case class ... DataSourceId` grep misses it — the audit's own field-level grep
  does not, and the runtime guard catches it regardless.)
- `grep -c "def resolve"` in `PatchSetApplyResolvers.scala` → **18**, as claimed.
- `requireTargetId` trims and rejects an empty `target.id` (the audit cites L90; the `def` is at
  L89 and the `.map(_.trim).filter(_.nonEmpty)` at L90 — correct, one line off).
- `resolvePipelineCreate` rejects an empty `sourceDataSourceId` with a `400` (audit cites
  L501-503; the `if (sourceIdTrimmed.isEmpty)` guard is at L498-499 — correct, ~3 lines off).

**Agreed: the audit's stated method has a real blind spot, and it should be recorded.** The
enumeration constrained on `findByIdOwned`, but `PipelineService.validateStepCrossOwnerRefs`
reaches the same repository call indirectly through the `checkOwnedSource` helper
(`PipelineService.scala:223-227`, which wraps `dataSourceRepo.findByIdOwned`). That indirection
is exactly why the audit missed the fifth site and the executor found it only while
implementing. The finding (three fields, three ops, class closed at the config level) is sound;
the *search* was one hop short. Since the audit will be quoted in the PR body, it is worth
adding one sentence naming that: "a call-site enumeration keyed on the repository method name
misses helper indirection — `checkOwnedSource` is why the fifth site was found by hand, not by
this grep." Non-blocking (suggestion 1 below); it strengthens an already-accurate document
rather than correcting an error in it.

## Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH`:

- `cd backend && sbt test` → `Total number of tests run: 3623` / `Tests: succeeded 3623, failed
  0, canceled 0, ignored 0, pending 0` / `All tests passed` / exit 0. Exactly **+1** over cycle
  1's 3622, accounted for by the single new `PipelineCreateTransactionalSpec` test. No test
  disappeared.
- `check:scala-quality` clean (146 pre-existing soft warnings, none in touched files);
  `check:openspec` clean; `check:repo-integrity` clean; `check:spec-structure` 337 specs / 0
  issues. All exit 0 under my own run, not cited from the executor's.
- Frontend gates still scan nothing relevant (`git diff --stat 824aa914..HEAD` is `backend/**`
  + `openspec/changes/**` only) and are not cited. Confirmed the `npm install` left no
  `node_modules`/`package-lock.json` in the diff.

Nothing regressed:

- Both ACL error strings remain byte-identical to base: `s"Data source not found: $id"` /
  `checkOwnedSource`'s `s"Data source not found: $dataSourceId"` in `PipelineService`, and
  `s"edit $index: data source not found: $id"` in `PatchSetApplyResolvers`.
- Guard is still `.nonEmpty` on the raw string; the only `trim.nonEmpty` occurrence in the codec
  is inside the doc comment explaining why it is NOT used. The whitespace-not-trimmed regression
  test is intact.
- The cycle-2 codec change is whitespace-only (`=>` alignment + one blank line); the match arms
  and guards are character-identical otherwise.

## Phase 3: UI Review — N/A

Diff remains backend-only (`backend/**` + `openspec/changes/**`); none of the evaluator's Phase-3
triggers match. AC6b's browser walkthrough was a delivery obligation and is satisfied (Phase 1).

## Overall: PASS

Both cycle-1 change requests are genuinely closed, each verified by my own re-run rather than
from the transcript: the CR1 mutation turned only the new test red with both sibling ACL tests
green, and the CR2 walkthrough was performed rather than substituted. The fix itself is
unchanged and still correct — five sites on one extractor, `.nonEmpty` not `.trim`, error
strings byte-identical, no pre-existing assertion touched, full suite 3623/0.

## Non-blocking Suggestions

1. **Class-closing audit blind spot** (`proposal.md`, "Class-closing audit"): add one sentence
   noting that the enumeration keyed on `findByIdOwned` and therefore missed
   `validateStepCrossOwnerRefs`, which reaches it via the `checkOwnedSource` helper
   (`PipelineService.scala:223`). The audit's findings are correct; only its stated search
   method needs the caveat, and it matters because the audit is headed for the PR body.
   Optionally correct the two small line-number drifts (`requireTargetId` L89-90 not L90;
   `resolvePipelineCreate`'s empty-rejection L498-499 not L501-503).
2. **Test name at `PipelineCreateTransactionalSpec:341`** — "(the picker's own defaultConfigFor
   seed)". Judged **acceptable as-is, not worth a cycle 3**, and here is why rather than
   leaving it unremarked. It is imprecise: `defaultConfigFor("join")` does return exactly this
   body, but `join` is absent from `OP_TYPES`, so no picker ever seeds it — the framing three
   design-gate rounds removed. But (a) it is a test name, with the corrected reachability
   stated at length in ticket.md's CORRECTION, design.md Decision 6, and the spec deltas that
   actually document behavior; (b) the near-identical phrase "the picker's exact empty-default
   config" is AC4's OWN wording and already shipped in cycle 1's `PipelineStepRoutesSpec` names,
   so failing cycle 2 for it would be inconsistent with cycle 1's pass; and (c) forcing a third
   delivery cycle over a parenthetical, on a change whose substance is verified complete, costs
   more than the ambiguity does. If any further commit lands on this branch for another reason,
   fold in the one-line rename — drop the parenthetical entirely: "accept a join step whose
   rightDataSourceId is empty without a spurious cross-owner rejection" — and the same
   parenthetical in the comment above it. Do not create a cycle solely for this.
3. Record in the PR body that AC6b's walkthrough does not discriminate (see Phase 1), so the
   reviewer reads it as the reachability/regression proof it is.
