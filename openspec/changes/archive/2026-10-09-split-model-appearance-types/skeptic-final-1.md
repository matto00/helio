## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: ae82a74813930bfb759d786876936f933d2f8be8 (merge of origin/main bcde936d into e667b025).
Review base resolved live with `resolve-review-base.sh` (origin/main): bcde936d5e09f22fc0150fba603f70c3065866f6, exit 0.
The only non-openspec files in `git diff bcde936d...HEAD` are `ChartAppearance.scala` (new), `PanelAppearance.scala` (new),
`model.scala`, `domain/model/README.md` and `PanelAppearanceWireGoldenSpec.scala` (new test).

### What I verified (with evidence)

- **C3, the byte-identical move. I checked it myself and did not use move-check.py.** I took the base model.scala from `git show b409172a:...`.
  Between b409172a and bcde936d the only change in `domain/model/` is `AssertionResult.scala`, so b409172a is still the right source for the move.
  - Expected model.scala = base minus lines 3, 7, 206-374 and 399-491. Diffed against HEAD's model.scala, the only difference is one collapsed
    double-blank line at the old seam (expected/227). D2 allows that.
  - `ChartAppearance.scala` without its first four scaffold lines (package and the two imports), compared with base 206-216 + 220-374, differs only by
    one blank line after the imports and one blank line between the case class and its companion.
  - `PanelAppearance.scala` without its scaffold, compared with base 218 + 399-491, differs only by blank lines.
  - The non-blank lines of both new files match base exactly, in order. Each removed import (`RequestValidation`, `LoggerFactory`) has no other user
    left in model.scala, and HEAD compiles.
- **C1/C2:** `git diff bcde936d HEAD --name-only` lists no existing test file and no caller file. The package line is unchanged, so no caller needs
  an edit.
- **C4 amendment, which I judge a legitimate correction and not a goalpost move.** I made my own javap comparison without relying on the executor's
  before-dumps. I ran `javap-dump.sh` over an independent base build: the scratch worktree `wt-base-2fb8deb5`, whose model.scala is `cmp`-identical to
  b409172a's. I compared that with a fresh dump of the merged HEAD's classes. Results:
  - The class-file name set is identical: 315 names.
  - The raw diff has exactly 58 changed lines: 16 `Compiled from` pairs, each mapped per D1, plus 13 `$anonfun$applyPatch$N` pairs in `PanelAppearance$` only.
  - After normalising only the numeric `$anonfun$<name>$N` suffix and dropping `Compiled from`, all 16 dumps are identical, with the same types
    and the same order.
  - The renumbering is a uniform N to N-14 shift, and `ChartAppearance$` owned lambdas 1..14 earlier in the same base compilation unit. That is
    scalac's per-compilation-unit fresh-name counter, which is unavoidable for any file move.
  - The source text is byte-identical (above), so no semantic change can hide behind the renumbering. The renamed members are synthetic lambda bodies
    that Scala source cannot reference by name. The original C4 rested on a factually wrong assumption. The amendment loosens only that one
    mechanically explained dimension and still requires identical types and order.
- **Golden wire spec:** the spec mixes in the production `com.helio.api.JsonProtocols` and re-declares no formats. It asserts the `compactPrint` goldens
  and the `convertTo` round-trip, and it covers `PanelAppearanceResponse.fromDomain`.
  - It was committed alone in b35c5453, before the move commit d3b3b514 (`git show --stat`).
  - The evaluator ran it on a `git archive` of the base (5/5), and the executor's red run (legend position mutated) failed it 3/5.
  - I did not re-run it on base myself. The goldens depend only on the moved code, which is byte-identical with a normalised-identical javap, and on
    `PanelProtocol`, which is untouched. Green at HEAD therefore implies green at base.
- **The merged head compiles and passes the relevant suites.** I ran
  `nice -n 19 sbt -J-Xmx3g -J-XX:ActiveProcessorCount=3 "testOnly ...PanelAppearanceWireGoldenSpec ...PanelAppearanceMergeSpec"`: rc=0,
  2 suites, 18 tests, all succeeded (MergeSpec 13, golden 5). The compile log shows no warnings from the moved or new files.
  - A broader run, `testOnly *Panel* *PatchSet* *DashboardSnapshot* *Appearance*`, gave rc=0, 39 suites and 473 succeeded, 0 failed.
  - I did not re-run the full `testFull` on the merged head. The merge brings in HEL-1385, the domain/engine split already on main, and it does not
    touch the moved seam. The executor's pre-merge full-suite comparison was per-suite identical, and the evaluator checked that independently.
- **AC3, no inline FQNs:** `node scripts/check-scala-quality.mjs` reports clean (exit 0). I read the six `${...}` interpolations in
  `ChartAppearance.scala` (lines 117-154) by eye. Each is `${other.getOrElse(JsNull)}`, so none contains an FQN. `PanelAppearance.scala` has no
  interpolations.
- **Tree coherence after the overlapping executors:** `git status` is clean, and e667b025 touches only five openspec markdown files (api-evidence,
  design, evaluation-1, files-modified, tasks). The diffs are coherent wording and C4/D6b amendments, with no partial edits. The README file list
  matches the 15 `.scala` files in the package.

### Verdict: CONFIRM

### Change Requests
none

### Non-blocking notes
- **Process hazard, which the orchestrator must handle before any squash or merge.** A stray retry loop from the overlapping executor was still
  live in this worktree while I reviewed.
  - The loop belongs to parent bash pid 1656557. Its `git commit -q -m "HEL-1376 Correct javap renumbering evidence; ..."` runs up to 4 attempts,
    each running the full pre-commit hook. Attempt 2 was running at pid 1712562.
  - Attempt 1 nearly committed. It started at e667b025 and staged the merged index, but failed with
    `fatal: cannot lock ref 'HEAD': is at ae82a748 but expected e667b025` (scratchpad `hel1376/commit1.log`). Git's ref lock is the only thing that
    stopped a duplicate commit.
  - The remaining attempts should fail with "nothing to commit" while the index equals HEAD. However, anything staged in this worktree before the
    loop exits would be committed under that message.
  - Before squashing, confirm that the loop has exited and that HEAD is still ae82a748. This verdict is pinned to that SHA.
- The golden spec's docstring says it pins "field order", but the goldens print keys alphabetically (`background, chart, color, transparency`
  differs from the declaration order). JSON key order is not semantic, so this is only an overstated comment.
- The amended D6b line in `design.md` is now longer than the surrounding wrap width. This is cosmetic.
- The follow-up candidates in `files-modified.md` are reasonable: the layering smell from `RequestValidation`, the stale pointer comments in helio-mcp
  and the frontend, and the fact that model.scala is still 1041 lines.
