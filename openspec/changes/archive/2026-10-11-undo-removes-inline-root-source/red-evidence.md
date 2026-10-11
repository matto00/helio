# Red evidence (HEL-1493, C1)

## Backend: PatchSetUndoInlineSourceSpec on UNMODIFIED main code (tests only added)

Command: cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.patchsets.PatchSetUndoInlineSourceSpec"

```
[info] - should remove the unreferenced inline source and report it removed *** FAILED ***
[info]   1 was not equal to 0 (PatchSetUndoInlineSourceSpec.scala:169)
[info] - should keep a source another pipeline references since the apply, undo still succeeds, and report it kept with a reason *** FAILED ***
[info]   Vector() was not equal to Vector("kept") (PatchSetUndoInlineSourceSpec.scala:185)
[info] - should never delete a sourceId root, and delete only the inline root of a mixed create *** FAILED ***
[info]   1 was not equal to 0 (PatchSetUndoInlineSourceSpec.scala:198)
[info] - should remove the implicit Auto: Connector with a bare-url REST inline source *** FAILED ***
[info]   5 was not equal to 4 (PatchSetUndoInlineSourceSpec.scala:208)
[info] - should report nothing when every root names an existing source (guard: green before the fix)
[info] - should parse the literal pre-change row, delete only the pipeline, keep the source and report no inlineSources
[info] [hel1468-guard] ScalaTest summary: failed=4 aborted=0 unreadable=0
[info] Tests: succeeded 2, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
```

Four behavioural tests fail by assertion on main (source survives undo; no inlineSources; implicit Connector survives). The two passing tests are labelled GUARDS (legacy row and no-inline-roots keep today's behaviour), green before and after by design.
The legacy-row test first failed on main because the literal row lacked resultingState (the Phase-1 check requires it); the row was corrected to a realistic pre-change row, then it passes on main as a guard.

## Backend: new-API specs (compile-red on main)

PatchSetUndoInlineSourceCleanupSpec (InlineRootPairing, InlineSourceCleanup.deleteIfUnreferenced, PatchSetUndoInlineSources, JournaledEdit.inlineSources) and PatchSetUndoInlineSourceWireSpec (InlineSourceUndoOutcome, EditUndoOutcome.inlineSources) reference types and members that do not exist on main, so they cannot compile there: red by construction. After the change they pass (green3 log: 27 tests, failed=0).

## Frontend: with patchSetsSlice.ts, PatchSetReviewPage.tsx and undoToast.ts reverted

```
FAIL src/features/patchSets/state/patchSetsSlice.test.ts
FAIL src/features/patchSets/ui/undoToast.test.ts
    [96msrc/features/patchSets/ui/undoToast.test.ts[0m:[93m1[0m:[93m34[0m - [91merror[0m[90m TS2307: [0mCannot find module './undoToast' or its corresponding type declarations.
FAIL src/features/patchSets/ui/PatchSetReviewPage.test.tsx (6.453 s)
  ● PatchSetReviewPage › shows each kept inline source on its own line of one warning toast after an undo (HEL-1493)
Tests:       1 failed, 36 passed, 37 total
```

(patchSetsSlice.test.ts and undoToast.test.ts are red at compile time: inlineSources is not on the outcome type used by invalidateAffectedState, and ./undoToast does not exist.)

## Green after the change

```
[info] - a ScalaTest summary with no readable Tests: line fails closed
[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0
[info] Tests: succeeded 6984, failed 0, canceled 4, ignored 0, pending 0
```
(full sbt testFull; exit 0)

## Cycle 2 (skeptic-final-1.md CR1/CR2)

Line mapping: the cycle-1 red run above predates the extraction of `PatchSetInlineSourceFixture`, so its failure lines `:169/:185/:198/:208` correspond to the committed lines `:23/:39/:52/:62` of `PatchSetUndoInlineSourceSpec.scala` (the evaluator's eval1-red-on-base.log shows the committed numbers).

CR1 chose option (a): the backend builds UI-safe text (`InlineSourceCleanup.inUseReason`) from the structured conflict; no wire change, because `reason` was already the user-facing line. Red, on the cycle-1 code:

```
[info] - should keep a source another pipeline references since the apply, undo still succeeds, and report it kept with a reason *** FAILED ***
[info]   "This source is still referenced by pipeline(s) 'Holder of inline source' (d254497c-9b7d-4fe2-978b-d2da736d66b8; as root). Remove each reference first (detach it in the pipeline editor)." was not equal to "still used by pipeline \"Holder of inline source\"." (PatchSetUndoInlineSourceSpec.scala:43)
[info] [hel1468-guard] ScalaTest summary: failed=1 aborted=0 unreadable=0
[info] Tests: succeeded 9, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

## Cycle 3 additions

Jest, changed slice cases run against the cycle-1 `patchSetsSlice.ts` (restored afterwards; `git status` shows it unmodified):
```
  ● patchSetsSlice › invalidateAffectedState: source list after an undo that removed inline sources (HEL-1493) › re-fetches the sources and their references when an inline source was removed
  ● patchSetsSlice › invalidateAffectedState: source list after an undo that removed inline sources (HEL-1493) › re-fetches the sources and their references when an inline source was already gone
  ● patchSetsSlice › invalidateAffectedState: source list after an undo that removed inline sources (HEL-1493) › re-fetches only the references (not the list) when every inline source was kept
Tests:       3 failed, 19 passed, 22 total
```

Guards (green before and after by design, not red evidence): the `undoToast.test.ts` id-free in-use case (the toast just prints the reason it is given) and the wire spec's unknown-extra-property case (the schema already had `additionalProperties: false`).
