## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `1b091affdf7ebf6a1de3d848a4fb2192408126ea`. The base was resolved live with `resolve-review-base.sh`:
`55b53be4a305ec0fbd3fd44c1f137e97ad24a5c1`. That equals `origin/main` and `git merge-base HEAD origin/main`.
The spawn-cwd guard returned READY. No UI change was made, so step 4 is skipped.

### What I verified (with evidence)

- **Scope of the diff.** `git diff --stat 55b53be4a...HEAD -- backend/ frontend/ schemas/` shows 7 files. They are the kept `PatchSetApplyResolvers.scala`, five new `PatchSet{Panel,DataSource,Pipeline,PipelineStep,Output}Resolvers.scala` and the package `README.md`. No other main code changed.
- **C1: zero test diff.**
  - `git diff origin/main -- backend/src/test | wc -l` returns 0.
  - The `backend/src/test` diff since BASE is also empty.
- **Behaviour preservation and C3/C4 (independent check).** I wrote my own checker rather than reusing `check.py`. It compares the multiset of non-blank, non-package, non-import lines of the BASE (55b53be4a) file against the six result files. `private[patchsets] def` is normalised to `private def` before comparing.
  - Lines lost from BASE: **0**.
  - Lines added: only scaffolding. That is the 6 object headers, 6 one-line object docs, 11 named member-import lines and 6 closing braces. There are no wildcard member imports.
  - Within each new file, line order follows BASE order.
  - The only lines "out of order" are the `PatchSetResolverSupport` members. They sit as a second object after the first, which is exactly what D1 specifies.
  - The executor's `check.py` also PASSes when I re-run it on HEAD: 792 BASE lines, 0 unclaimed, 0 multiply-claimed.
- **Widenings.** There are exactly 19 `private[patchsets] def`: 5 support helpers and 14 dispatched resolvers. These are the names D1 and D2 list.
- **D7 merge resolution.** `git diff 6d298d5f8 55b53be4a` on the file is HEL-1480's single doc hunk (old line 178, now 2 lines). That text is present at `PatchSetPipelineStepResolvers.scala:22-23`.
  - The old text (`PipelineService.scala:568-597`) is absent.
  - Since my multiset check is against 55b53be4a, the resolution adopted HEL-1480's text and reverted nothing.
- **C2: the guards still hold.** The kept file has 4 producers, 2 `requireAccess(` calls and 18 dispatch lines. The five new files contain no `Forbidden(` producer and no access-helper call (grep).
- **AC6: the pins are still failable, reproduced by me.** I copied `backend/` (excluding `target`) to the session scratchpad. I never mutated the worktree.
  - On the unmutated HEAD copy, `testOnly ExistenceNotLeakedRoutesSpec com.helio.services.patchsets.*` gave 207/207 passed.
  - I then applied 4 scratch-only mutations at once and re-ran `ExistenceNotLeakedRoutesSpec`. Result: **7 failed / 54 passed.**
    1. A `ServiceError.Forbidden()` line in `PatchSetOutputResolvers`, plus `Forbidden(` → `Forbidden.apply(` on one Support producer. The producer-count pin went red with `"PatchSetApplyResolvers.scala" -> 3` and a new `"PatchSetOutputResolvers.scala" -> 1`.
    2. A `requireAccess(` call in `PatchSetOutputResolvers`. The helper-site pin went red with `HashSet("PatchSetOutputResolvers.scala") was not empty`.
    3. A `case ("panel", "rename")` dispatch line. The dispatch pin went red with `HashSet("panel:rename")`.
    4. The N3 gate mutation: the invisible-pipeline branch of `requireVisibleStep` changed to `Right(())`. All 4 pipelineStep foreign-vs-absent 404 rows went red.
  - Commands were `nice -n 19 sbt -J-Xmx3g`. 56 GB was available and no other sbt was running. No sbt or java process was left running afterwards, and the scratch `target` dirs were deleted.
- **Foreign-id gate mutations (N1-N5, M6).** I did not reproduce N1, N2, N4, N5 or M6 myself, so they rest on the executor's logs. I read those logs in `/home/matt/Development/helio/.concertino/runs/HEL-1479/evidence/gate-N{1..5}.log` and `mut-M6.log`.
  - Each log starts with `## BASE=55b53be4a`.
  - Failure counts: N1 1, N2 2, N3 4, N4 1, N5 4, M6 5.
  - The failing test names match `mutation-evidence.md`.
  - Together they cover all 12 rows naming `PatchSetApplyResolvers.scala`.
  - My own N3 reproduction gives the same 4 failing rows as `gate-N3.log`.
- **AC3/C5: javap.** I ran `javap -public` on HEAD's compiled `PatchSetApplyResolvers` and `PatchSetApplyResolvers$`.
  - The output is identical to `move-check/javap-after.raw`, except for the `===` banner lines the script adds.
  - After the declared filter it equals `javap-base.filtered`: the `resolveAll` forwarder, plus `MODULE$`, `<clinit>` and `resolveAll` on the module class.
  - Every line the filter drops from the BASE javap is a static `$anonfun$` or a `$deserializeLambda$` line. The filter hides no public member.
  - Limitation: I did not recompile BASE myself. The BASE javap rests on the committed `javap-base.raw`, whose content is consistent with a single public entry point.
- **AC4: per-suite results.**
  - `sbt-base3.log` and `sbt-after3.log` both exit 0. Each shows the `[hel1468-guard]` line, 485 suites and 6666 succeeded, 0 failed, 4 canceled.
  - `diff suites-base.tsv suites-after.tsv` is empty.
  - The AFTER run was at `fb5b09ef2`. `git diff --stat fb5b09ef2 1b091affd` touches only evidence files (`suites-after.tsv`, `test-count-evidence.md`), so the source under test is the same as HEAD.
- **AC2: move-check red runs.** `move-check/red-runs.txt` is stamped `BASE=55b53be4a`. It shows a forward red (a token changed in `findOwnedOutput`) and a reverse red (a duplicated brace), both with exit=1. Green also reproduces, as above.
- **Superseded 6d298d5f8 evidence is clearly labelled.** It sits under `move-check/superseded-6d298d5f8/` and `evidence/superseded-6d298d5f8/`. Its own headers say `BASE=6d298d5f8`. `move-evidence.md`, `api-evidence.md`, `mutation-evidence.md` and `test-count-evidence.md` each state that the current set is 55b53be4a and that the 6d298d5f8 set is superseded.
- **No inline FQNs.** I grepped all six files for `com.helio.|spray.json.|java.|scala.|org.` on lines that are not import or package lines. There are zero hits.
- **Commits.** In `git log 55b53be4a..HEAD`, no message contains `claude.ai` or a `Claude-Session` trailer. The only trailer is `Co-Authored-By`. The only diff hits for those strings are evidence prose that describes this very check.
- **README.** The Holds list adds the five new objects and `PatchSetResolverSupport`, in alphabetical order.

### Verdict: CONFIRM

### Non-blocking notes

- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit it with this report.
- These follow-up candidates, already recorded by the executor, stand:
  - stale prose references to `PatchSetApplyResolvers.<moved member>` in `PatchSetPreviewProjection.scala`, `PatchSetUndoService.scala` and two specs;
  - the output rows' `sites` label (D5);
  - no spec asserts `requireTargetId`'s message;
  - `PatchSetPipelineStepResolvers.scala` is 264 lines, over the 250 soft budget.
- No gate defect: none of the evidence I relied on depends on mtime ordering.
