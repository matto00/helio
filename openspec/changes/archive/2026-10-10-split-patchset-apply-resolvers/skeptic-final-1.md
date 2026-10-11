## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `18b1b2cc49f0b05744307b1cae5cbba02738d615` (implementation 674fbf879 + merge of origin/main 744c37720).
Live review base from `resolve-review-base.sh`: `744c3772000379426a699e7abae2a2543e0953ee` (= `git merge-base HEAD origin/main`).
`PatchSetApplyResolvers.scala` is byte-identical at 6d298d5f8 and 744c37720 (`cmp`), so the D6 evidence pinned to 6d298d5f8 stays valid; HEL-1480 has not merged, so the D7 re-pin is not triggered.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/split-patchset-apply-resolvers/HEL-1479`.
- **Diff scope** (`git diff 744c37720...HEAD --stat`): the six resolver files, the patchsets README "Holds" line, and change-dir artifacts. Nothing else under `backend/`.
- **Zero test diff (C1)**: `git diff 744c37720 HEAD --stat -- backend/src/test` is 0 lines. Against 6d298d5f8 the only test diff is HEL-1465's `AnalyzeSchemaWarningsSpec.scala` from the upstream merge, not this change.
- **Independent byte-move check (AC1/AC2, C3/C4).** I wrote my own checker in the scratchpad rather than reusing `move-check/`. It took BASE from `git show 6d298d5f8:...` and, for each of the six files, matched every non-blank line (after reverting `private[patchsets] def` to `private def`) against BASE as exact strings, indentation included. Results:
  - Nothing is missing: every non-blank BASE line from 17 to 852 is present.
  - The only extra lines are 6 `}`, which are the closing braces of the new objects.
  - Every line not found in BASE is a package line, an import, a member-import line, a one-line object doc or an object header. No logic or comment was edited.
  - The maximal contiguous runs map to BASE spans 17-92, 95-152, 154-166, 169-173, 175-227, 230-337, 339-413, 416-476, 481-590, 593-782 and 784-852, and each destination matches design.md D1/D2.
  - Every BASE gap line (93-94, 153, 167-168, 174, 228-229, 338, 414-415, 477-480, 591-592, 783) is blank (`cat -A`), and 853 is the kept closing brace.
  - The executor's own forward and reverse red runs (`move-check/red-runs.txt`) fail in the right places.
- **Widening**: 19 `private[patchsets] def` lines: 5 in `PatchSetResolverSupport`, plus 3+3+3+3+2 dispatched resolvers. This matches design.md exactly. Every other moved member is still `private`.
- **Name-resolution safety**: BASE declares no implicit members (the only `implicit` hits are parameter lists). No `package.scala` exists under `services`. The only same-named def elsewhere is `PanelService.authorizeEditorOnDashboard`, a class member that is not in scope. So the named imports cannot change which symbol a moved body binds to.
- **C2 pins (grep on HEAD)**:
  - `PatchSetApplyResolvers.scala` has exactly 4 `ServiceError.Forbidden(` lines (:111, :143, :188, :206) and 2 `requireAccess(` lines (:109, :186).
  - All 18 `case ("kind","op")` dispatch lines are still in `resolveEdit`.
  - None of the five new files has a producer or an access-helper call.
- **ExistenceNotLeakedRoutesSpec guards still failable (AC6)**:
  - I read the guard code at spec :469-499. `scalaFiles()` walks every main `.scala`. The producer count is keyed per file name. The helper-site check takes the set difference against `rows.flatMap(_.sites)`. The dispatch check reads the file named `PatchSetApplyResolvers.scala`.
  - So a producer or helper call added to a new file fails both pins by construction.
  - I did not rerun the scratch red edits myself, because this role is read-only on code. Instead I read the executor's logs in `/home/matt/Development/helio/.concertino/runs/HEL-1479/evidence/guard-G{1..4}.log`, which show:
    - G1: the map gains `"PatchSetOutputResolvers.scala" -> 1`.
    - G2: `"PatchSetApplyResolvers.scala" -> 3`.
    - G3: `HashSet("PatchSetPanelResolvers.scala") was not empty`.
    - G4: `HashSet("panel:rename") was not empty`.
  - Each failure message matches the mechanism in the guard code.
- **Targeted specs on HEAD (fresh)**: `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.http.ExistenceNotLeakedRoutesSpec com.helio.services.patchsets.*"` exited 0.
  - Output: `Suites: completed 17`, `Tests: succeeded 207, failed 0`, and `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
  - sbt recompiled before the run (`compiling 1 Scala source` for both main and test), so the run used fresh classes.
  - 207 matches the executor's green reference for the same scope.
- **javap (AC3/C5, fresh)**: I ran `javap -public` on HEAD's freshly compiled `PatchSetApplyResolvers` and `PatchSetApplyResolvers$`.
  - After the declared filter (`\$anonfun\$|\$deserializeLambda\$|\$\$`), the output is identical to the committed `move-check/javap-base.filtered`.
  - The BASE side is consistent with the BASE source: `resolveAll` is BASE's only non-`private` member. So the public surface is `resolveAll` plus `MODULE$` and `<clinit>`, before and after.
  - The executor's red run (`javap-red-run.txt`, a defaulted parameter) gives a non-empty diff, so the filter does not hide signature changes.
- **testFull per suite (AC4)**: I did not rerun the full suite. The evidence is the executor's committed `suites-base.tsv`/`suites-after.tsv` (484 suites each, `diff` empty) and the logs `sbt-base.log`/`sbt-after.log` in the run evidence dir.
  - Both summaries show 6655 succeeded, 4 canceled and the `[hel1468-guard]` line.
  - The upstream merge since then only touched HEL-1465's domain/engine code, which is outside this package. My fresh targeted run covers the affected scope.
- **Mutations (AC5)**: `mutation-evidence.md` lists six mutations, one per new object, each red in an existing spec. The logs `mut-M1..M6.log` exist. The note that the `requireTargetId` message is not asserted by any spec is disclosed honestly as a coverage gap.
- **No inline FQNs (AC7)**: my scan for `com.helio.|spray.json.|java.|scala.|org.` on non-import/package lines in the six files found nothing.
- **Commits**: no `claude.ai`, `Claude-Session` or session trailer in any first-parent commit message from 6d298d5f8 to HEAD. 674fbf879 carries only the `Co-Authored-By` attribution.
- **Evidence honesty**: none of my load-bearing claims rest on mtime ordering. All checks are content-based: string-exact line matching, `cmp`, `diff`, grep counts and test summaries. No report I drilled into discloses unsound mtimes, so there is no gate defect.
- **UI**: no `frontend/**` changes, so the design review was skipped.

### Verdict: CONFIRM

### Non-blocking notes
- The `services/patchsets/README.md` "Holds" list adds the five new objects but not `PatchSetResolverSupport`, which is a second top-level object inside `PatchSetApplyResolvers.scala`. That is defensible if the list is per file, but it is worth one word in a follow-up.
- `evaluation-1.md` is untracked in the worktree (`git status`). The orchestrator should commit it with the delivery artifacts.
- Stale prose references (move-evidence.md follow-up items 1-3, plus D5's output-row `sites` label) are correctly left unedited under C4. They should be filed as the follow-up the evidence names.
- D7: if this change merges before HEL-1480, the HEL-1480 lane must be told that its :178 doc edit now lives in `PatchSetPipelineStepResolvers.scala` (`validateEmbeddedStepReferences` doc).
