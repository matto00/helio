## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `46ae373af2cc7aa30cad0558e169cc26213e9b0c`. Base from `resolve-review-base.sh`: `32571b0166a25b127a27bec645b7e2aec11b3c2b`. The diff touches only the four `scripts/check-node-root-encoding*` files and the change dir. No backend, helio-mcp or UI change, so no servers were started.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/content-keyed-root-encoding-exemptions/hel-1282`.
- **All four scripts are green at HEAD:** guard `clean (3 file(s))` exit 0; TS guard `clean (41 file(s))` exit 0; both selftests print "All ... passed" and exit 0.
- **Before/after parity (the brief's whole-file scan):** I extracted 32571b01's two guards into scratch and emptied their `KNOWN_UNFIXED_LINES` and `KNOWN_ROOT_QUALIFIED_LINES` sets. I ran them next to HEAD's guards, which were given `exemptions = []`, on the same tree. Raw hits are byte-identical: Scala 6 (NS:130/178/202, BR:49/108/128) and TS 1 (`context.ts:222`). With the shipped tables both sides report 0 violations. The base `KNOWN_ROOT_QUALIFIED_LINES` set held only a comment, so dropping it loses nothing.
- **(a) Line shift on the real tree:** I inserted 25 comment lines at the top of `NodeSnapshotRepository.scala` and 7 code or blank lines above `def listRows`. Guard exit 0 and selftest exit 0. Restored with `git checkout -- <NS path>`.
- **(b) New unexempted hit on the real tree:** I added a new `def purgeRootless` with a bare `sqlu"... node_step_id IS NULL"`. Guard exit 1, naming `NodeSnapshotRepository.scala:162`. Restored.
- **(c) Exemption removed on the real tree:** I deleted the `listRows` entry from `KNOWN_EXEMPTIONS`. Guard exit 1, naming `:178`. Restored with `git checkout -- scripts/check-node-root-encoding.mjs`. After all three, `git status` shows only the evaluator's untracked `evaluation-2.md`.
- **Scanner mutations against the selftests (my own runs, on scratch copies of the scripts):**
  - Each of these is killed: line-number keying, normalisation dropped, count bound off, `n >= count`, scope removed from the key, arm removed from the key, stale check off, file not in the key, comment rule widened to `/*`, surplus reporting only the extras.
  - TS mutations, all killed: line-number keying, count off, stale off, scope dropped, normalisation dropped, post-scan stale off.
  - **Two non-equivalent mutants survive (both reproduced):**
    - **Text removed from the key:** `keyOf` becomes `[file, scope, arm]`. Selftest stays at 0 FAIL.
    - **Arm not reset on a scope change:** `arm = NO_ARM;` deleted. Selftest stays at 0 FAIL.
  - Both surviving mutants let a real unsafe regression through that the shipped guard correctly catches. I checked this with `attacks.mjs` against the shipped guard and each mutant:
    - **T1**, `selectQuery`'s exempt line weakened to `WHERE node_step_id IS NULL"""` (the `pipeline_id` filter dropped): the shipped guard is RED, the text-out-of-key mutant is GREEN.
    - **T2**, `selectQuery`'s match collapsed to an unconditional bare `node_step_id IS NULL` query, which is R12's named bug: the shipped guard is RED, the no-reset mutant is GREEN. This happens because the `case (None, None) =>` arm from `findByNodeAndRow` carries over into the next scope.
  - A third survivor, "stale only when n==0", is equivalent while every `count` is 1. That is not a finding.
- **Adversarial resemblance probes against the shipped guard:**
  - Each of these is RED:
    - a copy in a `val` after `nodeFilterFragment` with no `def` of its own (the count bound catches it);
    - a copy placed after a string containing `"def listRows"` with the original kept;
    - a nested `def` inserted inside `overwriteRowsAction` above its site (fail-closed);
    - in-place weakening of the exempt text (T1);
    - collapsing the match (T2).
  - **GREEN (T7):** fix `nodeFilterFragment`'s site in place, then add an identical bare line inside a different `object`, after a trailing comment `// mirrors def nodeFilterFragment`. `SCOPE_RE` matches `def` inside a trailing comment or string, so the swap-in can live outside the declaration. This is a variant of design.md D2's residual 1, which says "same declaration (as computed)". It needs both a simultaneous deletion and a spoofing comment. Non-blocking, see the notes.
  - **GREEN (T10, existing before this change, out of scope):** a trailing `// no root_id` comment suppresses any hit through `isRootQualifiedSameLine`.
- **HEL-1276 survivability:** I probed edits shaped like HEL-1276 (Linear: it touches `NodeSnapshotRepository.scala`'s transactional write path):
  - a new root-qualified `def` above `listRows`: GREEN;
  - extra statements inside `overwriteRowsAction` after the delete match: GREEN;
  - a nested helper `def` at the top of `overwriteRowsAction`'s body: RED, fail-closed. This is a false positive HEL-1276 could hit, see the notes.
  - The guard key itself has no line-number dependence. Line numbers appear only in violation messages, which is correct.
- **Line-number citations in the owned scripts (explicitly in the brief):**
  - `grep -nE ':[0-9]{2,4}\b'` over the four files finds two `file:line` citations presented as authoritative. Both carried over from base, and both are already wrong:
    - `scripts/check-node-root-encoding.mjs:72` cites `PipelineRunService:1030` as the location of the "explicit `if (nodeStepId.isEmpty) Some(realRootId) else None` guard immediately at the call site". The actual guard is `PipelineRunService.scala:1495` (`val explicitRootId = if (trunkLastStepId.isEmpty) Some(lowestRootId) else None`). Line 1030 is rate-limit code.
    - `scripts/check-node-root-encoding.ts.mjs:56` cites `PipelineProposalProtocol.scala:126` for `ProposalOutputSummary`. It is now at `:134`.
  - These sit in the proof that every exemption rests on. HEAD's script now adds "The proof above applies to every entry below, unchanged" (line 104). That keeps line-number drift alive in prose, in the very files this ticket de-line-numbers.

### Verdict: REFUTE

Every ticket AC and (a), (b), (c) are met and independently reproduced, and hit parity is exact. Two things still fail the brief: two spec'd parts of the key are not pinned by any selftest, and the owned scripts still carry stale line-number citations that the brief explicitly asked to remove. All three fixes are small and stay within the owned files.

### Change Requests

1. **Pin the `text` component of the key.** Add a selftest case to `scripts/check-node-root-encoding.selftest.mjs`. Weaken a multi-line exempt site's text in place without touching its arm or scope, e.g. in `selectQuery` replace `WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""` with `WHERE node_step_id IS NULL"""`. Assert an unmatched hit AND a stale entry (2 messages). Prove it by running the mutant `keyOf = (file, scope, arm, text) => JSON.stringify([file, scope, arm])` in `scripts/check-node-root-encoding.mjs`: the new case must FAIL. Restore with `git checkout -- scripts/check-node-root-encoding.mjs`. Add that row to design.md D5's mutation table and to mutation-proof.md.
2. **Pin the arm reset on scope change** (design.md D3: "The current arm resets to `<none>` whenever scope changes"). Add a selftest case: collapse `selectQuery`'s whole match into one unconditional `sql"""SELECT ... WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"""` body, then assert red. Today that site is red only because `arm = NO_ARM;` at `check-node-root-encoding.mjs:198` stops `findByNodeAndRow`'s trailing `case (None, None) =>` from carrying over. Prove it by deleting that line: the new case must FAIL. Restore by exact-path checkout and add the row to the D5 table and mutation-proof.md. Apply the same to the TS guard (`check-node-root-encoding.ts.mjs`'s `arm = NO_ARM;`) if you can build a case there. If not, state in D5 why it is equivalent for TS.
3. **Remove the stale line-number citations from the proof comments.**
   - Replace `` (`PipelineRunService:1030`) `` at `scripts/check-node-root-encoding.mjs:72` with a symbol reference that will not drift, e.g. the enclosing method name or the `val explicitRootId = if (trunkLastStepId.isEmpty) Some(lowestRootId) else None` expression. Also reconcile the comment's quoted guard text (`if (nodeStepId.isEmpty) Some(realRootId) else None`) with what the code actually says.
   - Replace `(PipelineProposalProtocol.scala:126)` at `scripts/check-node-root-encoding.ts.mjs:56` with `PipelineProposalProtocol.scala`'s `ProposalOutputSummary` case class, with no line number.
   - Acceptance: `grep -nE '\.(scala|ts)?:[0-9]+|Service:[0-9]+' scripts/check-node-root-encoding*.mjs` returns no hits.

### Non-blocking notes

- **Residual 1 is wider than design.md D2's "same declaration" wording.** `SCOPE_RE` (`\bdef\s+(\w+)`) matches `def <name>` inside trailing comments and string literals. So a fix-plus-swap can place the replacement line anywhere after a comment such as `// mirrors def nodeFilterFragment` (probe T7: GREEN). This needs a deliberate simultaneous deletion plus a spoof, so the risk is low. Consider one sentence in D2, or stripping trailing `//` comments and string contents before applying `SCOPE_RE`.
- **Fail-closed false positive HEL-1276 may hit:** a nested `def` inserted inside `overwriteRowsAction` above its delete match moves the site's scope and turns the guard red (probe T5). That is correct fail-closed behaviour, but D2 and D3 only mention renames. Consider stating "a nested `def` above an exempt site inside its method re-scopes it (red); update `scope`", so the HEL-1276 lane is not surprised.
- **The selftest is coupled to the real file's structure,** beyond the guard's own coupling. It hard-codes 6 entries and 3 raw hits per file, insertion markers `"  private def nodeFilterFragment"` and `"  private def selectQuery"` (a missing marker throws "mutation was a no-op"), and `/ {6}case \(None, Some\(rid\)\) =>\n.*\n/`. An HEL-1276 edit that, say, changes `private def nodeFilterFragment` to `def nodeFilterFragment`, or re-indents those arms, breaks `check:node-root-encoding:selftest` even though the guard stays green. That is not line-number dependence, but worth one line in the HEL-1276 brief.
- The existing hole where a trailing comment containing `root_id`/`rootId` suppresses any hit (T10) is unchanged and out of scope.

Scratch (`/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1282`) was removed by exact path after this report was written. Real-tree mutations were restored by exact-path `git checkout --`, and `git status` was confirmed clean apart from `evaluation-2.md`.
