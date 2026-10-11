## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `674fbf879d33091954966ffd6fa200efe2d144a2` (HEAD of `task/split-patchset-apply-resolvers/HEL-1479`).
Review base (LIVE, `resolve-review-base.sh`): `6d298d5f83a56041188fb619bb0fd4ad333bb9ca`.
Scope: backend only (`services/patchsets/`: 1 file reduced, 5 new files, README "Holds" line) plus change-dir evidence.

### Phase 1: Spec Review — PASS
- AC1: `PatchSetApplyResolvers.scala` (233 lines) now holds `resolveAll`, `resolveEdit`, the four dashboard resolvers and a second top-level `private[patchsets] object PatchSetResolverSupport` with the five shared helpers (D1). There are five new `private[patchsets]` objects (D2). All are in `com.helio.services.patchsets`.
- AC2: I re-ran `move-check/check.py` myself and it passed: 36 blocks, 791 non-blank BASE lines claimed, 0 unclaimed, 0 claimed more than once. I dumped `spec.json`. Its scaffold lines are only package, imports, a one-line object doc, object header/brace and named member imports. Its 19 substitutions are exactly the 19 declarations D1/D2 name. My own red runs on scratch copies all failed as they should:
  1. A token change inside `validateEmbeddedStepReferences` failed the forward check (base line 211).
  2. A duplicated member-import line failed the reverse/positional check.
  3. Widening `rejectUnboundOrBadlyBoundForm` without a declaration failed.
  4. Deleting a kept doc line failed.
- AC3: I re-ran `javap.sh` against the current class output and it reproduces `javap-after.raw` byte-for-byte. The filtered output equals `javap-base.filtered`. All 66 dropped BASE lines are `public static $anonfun$...`/`$deserializeLambda$` (none dropped by the `$$` arm). BASE source has exactly one non-private member (`def resolveAll`, :34), which agrees with the 12-line filtered surface. The red run (`javap-red-run.txt`) is present and non-empty.
- AC4: I re-ran `suites.py` on `sbt-base.log` and `sbt-after.log`, and the per-suite diff is empty (484 suites). Both logs carry `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 6655, failed 0, canceled 4`, and exit file `0`. `git diff BASE...HEAD -- backend/src/test` is 0 lines.
- AC5: verified below (Phase 2, mutations).
- AC6: resolved by the ticket's first branch (D1), with no spec edits. I re-showed each guard as still failable (Phase 2).
- AC7: there are no inline FQNs (grep is empty). No defect was fixed; follow-up candidates are recorded in `move-evidence.md`.
- Tasks: all ticked and consistent with the diff. There is no scope creep. Planning artifacts reflect the result.
- CONSTRAINTS C1-C5: all honored.
  - C1: zero test diff, and per-suite results equal.
  - C2: confirmed through the spec's own guards. In my G-run the producer map showed `"PatchSetApplyResolvers.scala" -> 4`, and the only new key was my probe file. The helper-site set listed only my probe file.
  - C3/C4: confirmed by the checker.
  - C5: confirmed by javap.

### Phase 2: Code Review — PASS
Gates run myself (backend only, so no npm frontend gates apply). Each sbt command was `nice -n 19 sbt -J-Xmx3g`, run with 33 GB available and no other `testFull` running. The only other sbt process belonged to another lane (HEL-1478 worktree). I did not re-run a full `testFull`, because the executor's BASE/AFTER logs verified as described under AC4.
- `testOnly com.helio.services.patchsets.* com.helio.api.http.ExistenceNotLeakedRoutesSpec` on the clean HEAD tree: 207 passed, 0 failed.
- `npm run check:scala-quality`: clean (exit 0). The only new-file soft warning is `PatchSetPipelineStepResolvers.scala` at 264 lines, which design.md Risks already accepts.
- Unused-import scan of the six files: none found. Inline-FQN grep outside import/package lines: none found.
- Commit message: there is no claude.ai session link and no `Claude-Session` trailer. The only trailer is `Co-Authored-By`.

D6d / Support mutation (the specific concern raised in the brief):
- The executor's M1 targets `PatchSetApplyResolvers.scala:189`. That line is inside `PatchSetResolverSupport.authorizeEditorOnDashboard` (`case Right(_) => Right(())` becomes a Conflict). `mut-M1.log` shows `apply M1 PatchSetApplyResolvers.scala 189`, a one-file recompile, `Tests: succeeded 167, failed 40`, `sbt exit=1`, then `revert M1`. So M1 is the mutation that covers Support, and it was really red.
- The `requireTargetId` probe the executor mentions was the one that stayed green. It is correctly recorded as a coverage observation, not as the Support mutation. Its log was not kept, but nothing load-bearing depends on it.
- My own Support spot-checks:
  - **A**: in `authorizeEditorOrOwnerOnPipeline`, `case Some("editor") => Right(())` became a NotFound. It stayed GREEN (207/207) in the patchsets + ExistenceNotLeaked scope. This is a pre-existing coverage gap that the split did not introduce (see suggestions).
  - **B**: in `requireVisibleStep`, the `None` branch was changed to delegate to `authorizeEditorOrOwnerOnPipeline`, which leaks `Pipeline not found`. It went RED in 4 `ExistenceNotLeakedRoutesSpec` "identical 404 ... pipelineStep update/delete" rows (apply and preview).
- M2-M6: each log shows the mutated file and line on its `apply` line, failing tests attributable to it, `sbt exit=1` and a revert, matching `mutation-evidence.md`.

D6f guard failability (my own scratch run, combined in one `ExistenceNotLeakedRoutesSpec` run, then reverted):
- A `ServiceError.Forbidden()` val added to `PatchSetPipelineStepResolvers.scala` failed "pin the per-file count..." with the new map key `"PatchSetPipelineStepResolvers.scala" -> 1`.
- A non-def `ctx.accessChecker.requireAccess(` line added to `PatchSetOutputResolvers.scala` failed "name every source file that calls a shared access helper..." with `HashSet("PatchSetOutputResolvers.scala")`.
- **Removing** the `case ("output", "delete")` dispatch line failed "cover every (kind, op)..." with `stale ... entries no longer dispatched: HashSet("output:delete")`. This is the reverse direction of the executor's G4, which only tested the add direction.
- After the revert, `git diff --quiet HEAD` was clean, and the re-run was green (207/207, including the output delete rows).

Code-quality checklist:
- DRY: good.
- Naming: target-kind object names are clear.
- Modularity: improved.
- Type safety: no escape hatches added.
- Security: the access checks moved byte-identical. The producers and helper calls stayed in the guarded file, and the guards are still live.
- Error handling: unchanged.
- Dead code: none.
- Over-engineering: none.
- Behaviour-preserving: yes, verified by the checker, javap, the suites diff and the mutations.

### Phase 3: UI Review — N/A
There are no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Coverage gap (pre-existing, not introduced here): the editor-grant branch of `PatchSetResolverSupport.authorizeEditorOrOwnerOnPipeline` (`case Some("editor") => Right(())`, kept-file :205) is not observed by the patchsets or ExistenceNotLeaked specs. Mutating it to a NotFound stays green there; I did not check the wider suite. Add it to `move-evidence.md`'s coverage observations or file it as a follow-up test ticket, next to the `requireTargetId` observation.
- `origin/main` has moved to `744c37720` (HEL-1465) since the review base and is not an ancestor of HEAD. The 30 upstream files do not touch `services/patchsets/` or `ExistenceNotLeakedRoutesSpec`; the only backend change is `AnalyzeSchemaWarnings`. Under D7 the auditor must still merge `origin/main` before merging. HEL-1480 has not landed, so D7's re-pin branch is not triggered.
- Minor inconsistency: `move-evidence.md`/`guard-evidence.txt` give `PatchSetPipelineStepResolvers.scala` as 263 lines (`wc -l`) in one place and 264 (quality script) in another.
- `suites.py`'s TOTAL line reports canceled=0 although the logs report 4 canceled. The canceled-line suffix match does not fire. This is harmless to the per-suite equality claim, because both sides are counted the same way.
