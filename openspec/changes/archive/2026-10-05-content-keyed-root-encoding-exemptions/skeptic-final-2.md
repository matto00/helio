## Skeptic Report — final gate (round 2, skeptic-final-2.md)

I reviewed HEAD `a11449afec69579ccce28b6023058dc7652a2f97`. `resolve-review-base.sh` gave the base as `32571b0166a25b127a27bec645b7e2aec11b3c2b`, and it exited 0.

The diff since round 1 (`46ae373a..HEAD`) changes only:
- two proof comments;
- two Scala selftest cases, `(text)` and `(arm-reset)`;
- one TS selftest case, `(d2)`;
- the change-dir docs.

No backend, helio-mcp or UI file changed, so I started no servers.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/content-keyed-root-encoding-exemptions/hel-1282`.
- **All four scripts are green at HEAD:**
  - Scala guard: `clean (3 file(s))`, exit 0.
  - Scala selftest: "All ... passed", exit 0.
  - TS guard: `clean (41 file(s))`, exit 0.
  - TS selftest: "All ... passed", exit 0.
  - CI runs all four (`.github/workflows/ci.yml:40-43`).

**Round-1 change requests:**

- **CR1 (pin the text part of the key) is closed for Scala.** I mutated `keyOf` in the real `scripts/check-node-root-encoding.mjs` to `JSON.stringify([file, scope, arm])` and ran the selftest. It exited 1 with `FAIL: (text) weakened selectQuery text: unmatched hit + stale entry`, plus the other two `(text)` checks. Restored with `git checkout -- scripts/check-node-root-encoding.mjs`.
- **CR2 (pin the arm reset) is closed.**
  - Scala: I deleted `      arm = NO_ARM;`. The selftest exited 1 with all three `(arm-reset)` checks failing. Restored.
  - TS: I deleted `arm = NO_ARM;` at `check-node-root-encoding.ts.mjs:145`. The TS selftest exited 1 with `FAIL: (d2) shifted-in case arm does not leak across scopes`. Restored with `git checkout -- scripts/check-node-root-encoding.ts.mjs`.
- **CR3 (stale line citations) is closed.** `grep -nE '\.(scala|ts)?:[0-9]+|Service:[0-9]+' scripts/check-node-root-encoding*.mjs` finds nothing (exit 1). Both replacements are symbol references that will not drift.

**Ticket ACs and driver brief, re-checked on the real tree:**

- **(a) Line shift stays green.** I added 30 comment lines at the top of `NodeSnapshotRepository.scala`, and two `private val` declarations plus a blank line above `def listRows` (33 lines in total). The guard printed "clean" (exit 0) and the selftest passed. Restored with `git checkout -- <NS path>`.
- **(b) A new unexempted hit goes red.** I added a new `def purgeRootless` whose body is `sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"`. That text is identical to `overwriteRowsAction`'s exempt text. The guard exited 1, naming `NodeSnapshotRepository.scala:162`. Restored.
- **(c) Removing an exemption goes red.** I deleted the `listRows` entry from `KNOWN_EXEMPTIONS`. The guard exited 1, naming `:178`. Restored.
- **The selftests cover (a), (b) and (c).** Each has its own named cases in `check-node-root-encoding.selftest.mjs` (lines 130, 150 and 195), with TS equivalents (d), (e2) and (f0).
- **Whole-file before/after parity.**
  - Method: I extracted 32571b01's two guards into scratch and emptied their `KNOWN_UNFIXED_LINES` and `KNOWN_ROOT_QUALIFIED_LINES`. I compared them with HEAD's guards called with `exemptions = []`, on the same tree.
  - Results, all byte-identical before and after:
    - NodeSnapshotRepository: 3 hits (130, 178, 202).
    - BinaryRefRepository: 3 hits (49, 108, 128).
    - TS: 1 hit (`context.ts:222`).
  - With the shipped table, HEAD reports 0 violations in each file.
- `git status` after every mutation showed only the evaluator's untracked `evaluation-3.md`.

**New adversarial search (resemblance and mutant survivors):**

- **The TS guard's text component is unpinned. This is a non-equivalent mutant that survives, the same defect class as round-1 CR1.**
  - The mutant: in `scripts/check-node-root-encoding.ts.mjs:125`, change `keyOf` to `JSON.stringify([file, scope, arm])`.
  - Result: the TS selftest exits 0. I ran it on the real file and restored it with `git checkout -- scripts/check-node-root-encoding.ts.mjs`.
  - Probes against `context.ts`, comparing the shipped guard with a scratch copy of this mutant:
    - **P1:** the exempt pair `nodeStepId: o.nodeStepId ?? null,` / `rootId: o.rootId ?? null,` is replaced in place by `nodeStepId: o.nodeStepId || null,`, which drops the rootId companion. Shipped guard: 2 violations (RED). Mutant: 0 (GREEN).
    - **P2:** the rootId companion is kept, and the hit moves to a differently-worded `({ nodeStepId: o.nodeStepId ?? null })` later in the same function. Shipped guard: RED. Mutant: GREEN.
  - Why it matters: P1 is exactly the null-means-root regression the TS exemption's proof rests against, because its safety is the companion on the next line. The shipped guard catches it only because of the text key, and no test would notice that protection being removed.
  - D1 and D3 say the TS key includes `text`. D5's TS mutation list (design.md:88) does not claim a text pin, so this is a gap in coverage, not a false claim.
  - I missed it in round 1: I listed the TS mutants I ran there, and text-out was not among them.
- **P3, the identical-line swap inside the same function:** green under both the shipped guard and the mutant. This is design.md D2's stated residual 1, so it is not a finding.
- **Scala resemblance probes:**
  - **A new `def` holding an exact copy of an exempt line is red.** I checked this on the real tree, with probe (b) above.
  - **A Scala overload with the same name is covered by the stated residuals.** A new `def listRows(...)` overload could hold the line only if the original is deleted, otherwise the count bound makes it red. The scope is the name "as computed", so this is a case of D2 residuals 1 and 3 as now worded. Not a new finding.
  - **No other silent exemption.** I found no Scala attack outside D2's three stated residuals.

### Verdict: REFUTE

Every ticket AC, (a), (b), (c), the parity check and all three round-1 change requests are met and independently reproduced. One spec'd key component is still unpinned: `text` in the TS guard's key. Under the standard round 1 applied to the Scala guard, that blocks: a mutant that removes it passes the selftest, and it lets through a concrete regression (P1) that the shipped guard catches. The fix is one selftest case.

### Change Requests

1. **Pin the `text` part of the TS key.**
   - **Add a case** to `scripts/check-node-root-encoding.ts.selftest.mjs`. In `ctxText`, replace the exempt pair `nodeStepId: o.nodeStepId ?? null,` + newline + `rootId: o.rootId ?? null,` with `nodeStepId: o.nodeStepId || null,`. This keeps the scope (`buildOutputSummariesByPipeline`) and arm (`<none>`) and changes only the text. Assert exactly 2 messages: one unmatched hit naming `nodeStepId: o.nodeStepId || null,`, and one `stale exemption:` entry.
   - **Prove it.** Set `keyOf` at `scripts/check-node-root-encoding.ts.mjs:125` to `(file, scope, arm, text) => JSON.stringify([file, scope, arm])`. The new case must FAIL. Restore with `git checkout -- scripts/check-node-root-encoding.ts.mjs`.
   - **Record it.** Add "text dropped from the key" to the TS mutation list in design.md D5 (line 88), and add a matching TS entry to mutation-proof.md.

### Non-blocking notes

- `scripts/check-node-root-encoding.mjs:72` is 142 characters, as evaluation-3 also noted. Other lines in the file already exceed 100 characters, and Prettier is not installed in the worktree, so I could not run `--check`. Worth re-wrapping while you are in the file.
- The round-1 note that the selftest is tied to the real file's structure still applies to the HEL-1276 brief. The tie points are the `"private def selectQuery"` and `"private def nodeFilterFragment"` markers, and the hard-coded counts of 6 entries and 3 hits.
- The trailing-comment `root_id` suppression hole predates this change and is unchanged and out of scope.

Scratch (`/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1282r2`) is removed by exact path after this report. Every real-tree mutation was restored by exact-path `git checkout --`.
