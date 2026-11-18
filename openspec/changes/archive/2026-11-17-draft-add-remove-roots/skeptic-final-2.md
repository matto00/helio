## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `6e31d7e44b8eb0eaa99db9782c9b2a17fa68a4c9`. The spawn-cwd guard returned READY. I resolved the diff base live with `resolve-review-base.sh`: it is `fd7090bf6bc10a091c99d8090a440093ced74475` (93 files). The previous final-gate CONFIRM was at `d40b8fd36`.

### What I verified (with evidence)

**The branch's own patch is unchanged by the squash, the archive and the merge, apart from 2 new tests**
- I diffed the change lines of `git diff aeeb68675 d40b8fd36 -- frontend e2e` against `git diff fd7090bf6 HEAD -- frontend e2e`. They are IDENTICAL. Every frontend and e2e change this branch makes is exactly the one round 1 confirmed, and that includes all UI.
- I did the same comparison for `backend`. The only difference is the 2 added `DraftSaveRootsApiSpec` cases in "an insight Output (HEL-1740) in a root-changing draft". The non-trivial merge resolution in `DraftDiff.scala` is therefore only the union of HEL-1740's insight check and this branch's root pass. `git show --cc da8a412d0` confirms this: in `DraftDiff.scala`, the only combined hunk is the import line.
- `git diff --stat da8a412d0 HEAD` changes 6 files, all markdown: the two synced specs, the two archived deltas, and evaluation-2.md and evaluation-3.md. No code, schema or test changed after the merge.

**Interaction between insight Outputs and draft or removed roots (`DraftDiff.planOutputs`, lines 370-393)**
- `kept` is built from `survivorIds`: the stored Outputs the draft names by id. Can a survivor sit on a removed root? Two checks in `resolveNode` say no:
  - `rootId` is checked against the FINAL root set, so naming a removed root is a 400.
  - A stored step under a removed root that is not relinked is in `removedSteps`, so it is also a 400.
- So an insight that reads an Output on a removed root cannot find it in `kept`, and `InsightReadsCheck` refuses it with 400. The test `400 and write nothing when it reads an Output on a root the same draft removes` checks that the body includes `reads.outputs`, which is the check's own message. That is self-authenticating evidence that the 400 comes from the insight check and not from some other refusal, and the test also checks `storedState` is unchanged.
- An insight placed on a draft root by `rootClientId` that reads a surviving Output is saved (the companion test). In Restore mode the check is skipped (`RestorePriorStored`), as HEL-1740 intends, so undo is never refused because of it.
- An unchanged stored insight whose reads dangle after a root removal is allowed. This is HEL-1740's documented tolerance rule (`readsChanged`), not a regression.
- The frontend cannot create an insight (`outputKinds.ts:17` offers it only for an existing insight), so there is no client path to the refused case beyond a generic save error.
- The schemas carry both the `insight` kind and `rootClientId`/`roots`: `draft-save-request.schema.json:73-83` and `draft-save-response.schema.json`.

**Gates**
- Evaluator cycle 2 ran the gates at the merge head, and I read its logs myself (`.concertino/scratch/HEL-1734/eval2/`):
  - `testfull.log` reads `Tests: succeeded 9788, failed 0, canceled 5` and `All tests passed`. The two insight cases appear as passed.
  - `e2e.log` reads `11 passed`. Its EXIT 1 comes only from `userCleanup` teardown targeting the shared DB, the same environmental artifact round 1 recorded.
  - The lint, tsc, format, schema and hook logs are all present.
- Fresh runs by me at HEAD:
  - `npm --prefix frontend run typecheck`: EXIT 0.
  - Targeted jest with 3 workers (draftRoots, draftSaveRequest, keptDraft, draftBlocks, draftMode, draftSaveWire, pipelinesSlice, draftOutputs): 11 suites, 193 tests, all passed.
  - Logs: `.concertino/scratch/HEL-1734/sk2-tsc.log` and `sk2-jest.log`.

**Synced specs (commit a0ff7f0ea)**
- `openspec/specs/pipeline-draft-mode-ui/spec.md:9` now says that adding and removing a source change only the draft. The scenario was renamed "Structural actions stay available during a draft" and lists add source and remove source (except the last) as enabled.
- `openspec/specs/pipeline-draft-save/spec.md:10-13` lists `roots?` and root add/remove in the atomic transaction.
- Both match the shipped code: `canRemove` over the draft roots, and `planRoots`.

**AC trace** (unchanged from round 1; the code behind it is byte-identical)
1. Atomic add and remove of roots on Save & run, thrown away on Discard: `DraftSaveRootsApiSpec`, the e2e cases, and round 1's live probe with undo restoring the fingerprint.
2. Kept-draft restore and stale base: keptDraft v4 jest, the e2e reload and stale cases, and the recorded mutation reds.
3. Desktop and phone, light and dark, with e2e that fails first: the e2e spec (11/11 at the merge head), the recorded e2e mutation reds, and round 1's screenshots.

**UI.** I did not open a fresh browser session. The branch's frontend patch is identical to the one round 1 judged visually in all four combinations, and no CSS is in the diff. The pipeline UI files that changed since d40b8fd36 (outputEditor, liveOutput) arrived from origin/main through HEL-1740, not from this branch.

No mtime-ordering evidence was relied on. Every claim above rests on content diffs and log text.

### Verdict: CONFIRM

### Non-blocking notes
- origin/main has moved one commit past the base: `36735a24a`, HEL-1739, which adds migration V144 and touches PipelineRunService/Executor. `git merge-tree` against it is clean, with no overlapping files, and this change adds no migration. The delivery merge's CI is the first measurement of runAfterSave against HEL-1739's run-service change.
- Round 1 and evaluator notes still stand:
  - `DraftSaveJournal.rootDefsOf` has an unused `rows` parameter.
  - The PR should carry split notes for `DraftDiff.scala` and `pipelineDraft.ts`.
  - The e2e mutation logs should name the patch and the test titles.
  - The draft-mode spec's "(its steps or its Outputs)" could add "or its roots".
