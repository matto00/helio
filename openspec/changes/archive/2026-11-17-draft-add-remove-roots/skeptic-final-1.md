## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d40b8fd3662dff5bcd19f4436c222800a822c07b`. The diff base was resolved live with `resolve-review-base.sh` to `aeeb6867500663652295876f3970001c2d69ef55` (87 files). The spawn-cwd guard returned READY.

### What I verified (with evidence)

**Backend, read in full from the diff**
- `DraftDiff.planRoots` implements D1/D2. Absent `roots` leaves the plan unchanged. It covers: an empty list (400); both or neither of id/clientId (400); a survivor carrying `sourceId` (400 in public mode only); an unknown id (400 in public mode; in restore mode it needs a `sourceId`); duplicates; survivors that do not keep their stored order; and a new root placed before a survivor. Steps and Outputs resolve `rootId`/`rootClientId` against the FINAL root set, so a step still naming a removed root is a 400.
- `DraftSaveTransaction.run` takes lock (0) through `lockAddedSources`: `FOR KEY SHARE` per id, distinct and sorted, before `lockDefinition`. A missing source gives 404 in public mode and 409 "Undo refused" in restore mode. After the re-plan, a subset guard on `addedSourceIds` answers 409 stale. The cycle check runs under the advisory lock already held (`needsAdvisory ||= creates.nonEmpty`). The cascade gate now also requires `rootIds`.
- Apply order is D5 as written: `insertRoots` at stored max+1+i, then steps, relinks and `deleteRemoved`. `deleteRoots` then removes the snapshots of removed steps under each removed root, then its `root_id` snapshots, then the root rows. `placeRoots` moves roots through negative temporaries only when a root is not already at its index.
- The journal's `rootDefs` come from the fingerprinted definition's `roots` (`PatchSetPipelineDefinition.scala:67` writes `{id, dataSourceId}` in position order). `DraftRestore` sorts them by position. An old row without `rootDefs` restores with `roots` absent.
- `checkReferences` requires every added source to be caller-owned (`findByIdOwned`) in public mode.

**Tests and red-first**
- The evaluator's pasted `sbt testFull` log (`.concertino/scratch/HEL-1734/eval1/testfull.log`, written after the HEAD commit) shows 9695/9695, 0 failed, and hel1468-guard failed=0. I read the per-test lines of `DraftSaveRootsApiSpec` (25 tests, covering every 400 case in the spec, the 404s, the 422 with `impact.rootIds`, the stale 409, replace-only-root, and remove-first-and-add). I also read `DraftSaveRootsUndoSpec` (3) and `DraftSaveRootsRaceSpec` (19 including controls). All passed.
- `mutation-insert-at-final-position.log.txt`: 3 red (undo of position 0 of two, replace-first-and-add, replace-only-root). Each fails on `duplicate key ... "pipeline_roots_pipeline_id_position_key"`. That is self-authenticating evidence that the mutation hit the insert position the D5 design guards. The log does not name the patch, so this is inferred from the failure mode.
- `race-and-deadlock-controls.log.txt`: every control was red-by-design and passed. Without lock (0), the writer-first source delete makes the save fail on the FK instead of the clean 404. The opposite-order root-adding save against a source delete raises a deadlock.
- The jest mutation logs name both the replaced source line and the failing test titles. Each targets the code it claims: `PipelineSpine.tsx` openAddRoot disabled, `keptDraft.ts` version guard, `pipelineDraft.ts` prune filter, `draftSaveRequest.ts` roots spread and stale check, and `draftOps.ts` `removeRootSteps`. I checked each replaced fragment against the diff.
- I re-ran the targeted jest suites myself (draftRoots, draftSaveRequest, keptDraft, draftBlocks, draftMode, usePipelineDraftRouting, draftSaveWire, pipelinesSlice) with 3 workers: 11 suites and 186 tests passed. The evaluator's lint, format, typecheck, build, full jest (790/790) and e2e (11/11) logs are pasted with EXIT codes, and I read them.

**UI (my own isolated Chromium, not the shared MCP browser, servers on 7166/10073 against `helio_hel1734`)**
- `assert-phase.sh servers` printed PASS, and `pg_stat_activity` showed 7 connections to `helio_hel1734`.
- Probe `.concertino/scratch/HEL-1734/skeptic1/probe.cjs`, run at 1440 light and 375 dark. It uses a 2-root pipeline (a with Filter, b with Limit). It opens a draft, adds source c, removes source b, and runs Save & run. The confirm dialog listed "Source: sk-src-b, Step: Limit rows". The body carried `roots: [{id: a}, {clientId: draft-…, sourceId: c}]`. The stored result was roots [a, c] with only the Filter step. I then clicked **Undo** on the "Saved." toast. The roots came back as [a, b] under b's ORIGINAL id with the Limit step on it, and the **fingerprint after undo equals the pre-save fingerprint** (`v1:1cfb76ee…` in both). This covers the client undo path (`pipelineRootsReplaced`, `adoptDefinition` with roots), which the evaluator noted had no behavioural test. Console errors were only the known 404 on `/schedule` and the expected 422.
- Visual judgment against DESIGN.md. No CSS changed in this diff. The drafted card reuses `spine-card__meta` with the same "New · not saved" wording as drafted Outputs (`SpineOutputs.tsx:65`), and the drafted removal is hidden, as the spec requires. Light and dark render the same way, and the phone action bar (Discard / Save & run) and the cascade dialog match the existing pattern. Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/skeptic1/draft-light-1440.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/skeptic1/draft-dark-375.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/skeptic1/confirm-light-1440.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/skeptic1/confirm-dark-375.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/skeptic1/afterundo-light-1440.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1734/evidence/.concertino/scratch/HEL-1734/skeptic1/saved-dark-375.png` (saved-state baseline for comparison)

**AC trace**
1. Root add and remove inside a draft are applied atomically on Save & run and dropped on Discard. Evidence: `DraftSaveRootsApiSpec` (atomic, nothing written on any refusal), the e2e discard and save cases, and my probe.
2. Kept-draft restore and the stale-base path still work. Evidence: keptDraft v4 parsing with v2/v3 root-op refusal (jest, mutation red), the e2e kept-draft reload and stale-base Reload cases, and the `stale-ignores-roots` e2e mutation red.
3. Desktop and phone, light and dark, with e2e that fails first. Evidence: the e2e spec runs desktop light and phone dark, and three recorded e2e mutations (4, 6 and 1 red). Screenshots cover all four combinations: the executor's evidence plus mine.

**Evaluator's teardown note.** `userCleanup` read the shared dev DB, not `helio_hel1734`, and deleted nothing. This is an environmental mismatch of the lane-private DB setup. It is not a defect of this change and it caused no wrong deletion. The residue (e2e, evaluator and skeptic users `hel1734-*`) lives only in `helio_hel1734`, which is dropped at Delivery. It does not block shipping. It is worth a MISTAKES.md note for C15-style lanes.

No mtime-ordering evidence was relied on.

### Verdict: CONFIRM

### Non-blocking notes
- `DraftSaveJournal.rootDefsOf(definition, rows)`: `rows` is unused.
- The e2e and the backend mutation logs do not record the patch text or the failing titles. The jest ones do, so match that format next time.
- The `structuralBlockedReason` prop on `PipelineSpine` now blocks very little. Check whether it is dead and remove it in a follow-up.
- On a multi-root pipeline a drafted secondary root shows the existing "No steps yet — join this source into another lane's step to use it." copy. This is consistent with saved secondary roots. Adding a step directly on a drafted root is only possible when it is the first root, which is the existing UI model, not a regression.
- `DraftDiff.scala` and `pipelineDraft.ts` crossed roughly 400 lines. Propose a split in the PR description, as the evaluator noted.
