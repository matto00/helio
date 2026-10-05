## Skeptic Report — final gate (round 3, skeptic-final-3.md)

I reviewed HEAD `2b722ab7802831a218a1c555770018688cdf5c85`. `resolve-review-base.sh` gave the base as `32571b0166a25b127a27bec645b7e2aec11b3c2b` and exited 0.

Since round 2 (`a11449af..HEAD`), the only script change is a new `(text)` case in `scripts/check-node-root-encoding.ts.selftest.mjs`. The rest of the delta is docs: design.md D5, mutation-proof.md and evaluation-3.md.

The change is script-only, so I started no servers. The worktree was clean after every step.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/content-keyed-root-encoding-exemptions/hel-1282`.

**Round-2 CR1 (TS `text` key unpinned) is closed.**
- I set the TS `keyOf` to `JSON.stringify([file, scope, arm])` in the real `scripts/check-node-root-encoding.ts.mjs` and ran the TS selftest.
- It exited 1 with:
  - `FAIL: (text) changed text: unmatched hit + stale entry`
  - `FAIL: (text) unmatched hit names the new text`
  - `FAIL: (text) stale entry reported`
- Restored with `git checkout -- scripts/check-node-root-encoding.ts.mjs`.
- The new case guards against a no-op replace with its own `(text) pair really replaced` check.

**All four scripts are green at HEAD:**
- Scala guard: `clean (3 file(s) ...)`, exit 0.
- Scala selftest: "All ... passed", exit 0.
- TS guard: `clean (41 file(s) ...)`, exit 0.
- TS selftest: "All ... passed", exit 0.

**Lint and format pass.** The worktree has no `node_modules`, so I used the main checkout's binaries with the worktree's own config.
- `eslint . --max-warnings=0`: exit 0.
- `prettier . --check`: "All matched files use Prettier code style!", exit 0.
- That clears round 2's line-length note.

**Mutant matrix on both guards.** Each mutant was applied to the real script, the selftest run, then restored with exact-path `git checkout -- <guard>`. Results are FAIL counts in each selftest (all exit 1) unless marked as surviving.

| Mutant | Scala | TS |
| --- | --- | --- |
| scope dropped from key | 20 FAIL | 1 FAIL `(e2)` |
| arm dropped from key | 9 FAIL `(arm)` | **survives (exit 0)**, see note 1 |
| text dropped from key | 3 FAIL `(text)` | 3 FAIL `(text)` |
| count bound off (`if (entry)`) | 1 FAIL `(b')` | 1 FAIL `(e)` |
| stale check off | 22 FAIL | 7 FAIL incl. `(g0)`, `(g1)` |
| arm not reset on scope change | 3 FAIL `(arm-reset)` | 1 FAIL `(d2)` |
| whitespace normalisation off | 33 FAIL `(whitespace)` | **survives (exit 0)**, see note 1 |
| keyed by line number | 39 FAIL | 6 FAIL `(d)`, `(e)` |
| file filter removed (`e.file === relPath` → `true`) | 42 FAIL | 11 FAIL `(e2)` |
| file dropped from the key string only | survives | survives |

The last row is an **equivalent mutant**. Entries are already filtered by `e.file === relPath`, and every hit carries `relPath`, so the file field in the key adds nothing. The file component is actually enforced by that filter, which the row above shows is killed in both guards.

**Rounds 1–2 fixes still hold:**
- The text and arm-reset pins are in the matrix above.
- `grep -nE '\.(scala|ts)?:[0-9]+|Service:[0-9]+' scripts/check-node-root-encoding*.mjs` finds nothing (exit 1), so the stale line citations are gone.
- The missing-file and post-scan stale cases `(g0)`/`(g1)` fail under stale-off.

**Ticket ACs and driver brief, re-checked on the real `NodeSnapshotRepository.scala`.** Each step was restored with `git checkout -- <path>`.
- **(a) Line shift stays green.** I added 30 lines: 25 comment lines at the top, two `private val` declarations and a blank line above `def listRows`, and a comment plus a `val` above `nodeFilterFragment`. The guard printed "clean" and exited 0.
- **(b) A new unexempted hit goes red.** I added a new `def purgeRootless` at the end of the file whose body text is identical to `overwriteRowsAction`'s exempt line. The guard exited 1 with 1 violation naming `:437`.
- **(b') A same-scope duplicate goes red.** I added a re-aligned copy of the `listRows` `(None, None)` line. The guard exited 1 with 2 violations, "2 occurrences, exemption covers 1".
- **(c) Removing an exemption goes red.** I deleted the `listRows` entry from `KNOWN_EXEMPTIONS`. The guard exited 1 naming `:178`.
- **The selftests cover (a), (b) and (c).** The named cases fail under the matching mutants above (line-number keying, count, stale).

**Hit parity against 32571b01.**
- Method: I extracted the base guards to scratch and emptied `KNOWN_UNFIXED_LINES` and `KNOWN_ROOT_QUALIFIED_LINES`. I compared them with HEAD's `scanTextForViolations(f, t, [])` on the same tree.
- Results, identical before and after:

| File | Hits before | Hits after | With shipped table |
| --- | --- | --- | --- |
| NodeSnapshotRepository | 3 (130, 178, 202) | same | 0 |
| BinaryRefRepository | 3 (49, 108, 128) | same | 0 |
| OutputRepository | 0 | 0 | 0 |
| helio-mcp/src (41 files) | 1 (`context.ts:222`) | same | 0 |

- The script printed `PARITY true`.

**No new silent-exemption route.** Round 2's Scala resemblance probes and the probes above found nothing outside design.md D2's three stated residuals. In the TS guard, the in-place text weakening (round 2's P1) is now pinned red.

### Verdict: CONFIRM

### Non-blocking notes

1. **Two TS key mutants survive the selftest: arm dropped, and whitespace normalisation off.** design.md D5's TS mutation list does not claim either one. The orchestrator brief asked for every component to be pinned "in BOTH guards", so I disclose these explicitly rather than pass over them. I checked with scratch copies against `context.ts`:
   - **Arm probe:** I put `case "x": return (q) => q;` above the site, inside `buildOutputSummariesByPipeline`. The shipped guard gives 2 messages (red). The arm-dropped mutant gives 0.
   - **Whitespace probe:** I changed the site's internal spacing. The shipped guard gives 0. The normalisation-off mutant gives 2.

   Why neither blocks (round 2's standard required a concrete regression as well as a surviving mutant):
   - The TS exemption's safety rests on the `rootId` companion on the next line. The arm has nothing to do with it: the TS arm is always `<none>` by design (D3).
   - So the arm mutant only turns green a case where the shipped red is itself a false positive. It lets through no unsafe line the shipped guard would catch.
   - The whitespace mutant only adds false positives, so it fails closed. Prettier also canonicalises internal whitespace in TS, so the case barely arises.

   If anyone wants full symmetry, a TS `(whitespace)` case and a TS `(arm)` case would pin both. That is cheap, but optional.
2. **The file field in `keyOf` is redundant** (equivalent mutant, both guards). It is harmless. The actual file enforcement is the `e.file === relPath` filter, and that is pinned.
3. **Round 1's note still stands for HEL-1276:** the Scala selftest is coupled to the real file's structure and its hard-coded counts.

Scratch `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/hel1282r3` is removed by exact path after this report. Every real-tree mutation was restored by exact-path `git checkout --`, and `git status --short` was empty afterwards.
