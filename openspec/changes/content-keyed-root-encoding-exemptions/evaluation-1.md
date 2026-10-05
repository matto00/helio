## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 2bb5bfb9567cbae0eaaa22ade88835e383bf1ae2 (base 32571b0166a25b127a27bec645b7e2aec11b3c2b, resolved live).

### Phase 1: Spec Review — FAIL

Everything below was checked and passes:
- **AC1, content keying:** `KNOWN_EXEMPTIONS` entries are `{file, scope, arm, text, count, reason}`, and no line number appears in the key (`scripts/check-node-root-encoding.mjs`, `scripts/check-node-root-encoding.ts.mjs`).
- **AC2, a new hit goes red:** checked against the real tree (see Phase 2 evidence).
- **AC3, selftest coverage:** the selftests cover line-shift green, new-hit red, removed-exemption red, same-scope and other-scope duplicates, other-file, stale, whitespace, arm-widening at selectQuery and overwriteRowsAction, missing-file, and a leading `/* */` comment. Red cases check the message content (file + text, and "N occurrences, exemption covers M"), not only the count.
- **Scope:** `git diff --name-only` shows only the 4 `scripts/check-node-root-encoding*` files and the openspec change dir. No Scala, TS or migration file changed.
- **Detection:** the detection regexes, the scanned file set and the comment rule are unchanged.
- **CONSTRAINTS:** `[]`, so nothing to honour.

Issues:
1. **design.md D5's mutation table is wrong in one row.** It says "key by line number instead of content" must turn `(whitespace)` red. That cannot happen. The (whitespace) case only re-indents and re-aligns the exempt lines and never shifts a line number, so a line-number key keeps it green. I checked this by switching the scanner to line-number keying (`key = file + line`, entries pinned to the current lines 130/178/202/49/108/128):
   - These turned red: (a) ×3, (b') ×2, (stale) ×8 and (arm) overwriteRowsAction.
   - (whitespace) stayed PASS for both files.

   The mutation that actually catches (whitespace) is "normalisation dropped" (`raw.trim()` instead of `normalise(raw)` in the hit key). I checked it: both (whitespace) cases turn red, along with 29 others. That row is missing from the table. So the artifact makes a mutation-proof claim that is false and leaves out the real one.
2. **Task 3.2 (and 4.2's mutation proof) is marked `[x]`, but the red outputs were never recorded.** Task 3.2 says "Record each red output in the executor's handoff". `files-modified.md` has only the four file summaries, and the run's evidence dir (`.concertino/runs/HEL-1282/evidence/`) has only `premise-validation.md`. This is likely how issue 1 got past the executor: no recorded output means nothing to check the table against.

Minor: D5 says the TS selftest covers missing-file "via the entry point's post-scan evaluation". The selftest only checks `scanTextForViolations(CTX, "")`. I ran the entry-point path myself (below) and it works, so this is a wording point, not a gap in behaviour.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH:
- `npm run check:node-root-encoding`: exit 0, clean.
- `npm run check:node-root-encoding:selftest`: exit 0, 58 PASS / 0 FAIL.
- `npm run check:node-root-encoding:ts`: exit 0, clean, 41 files scanned.
- `npm run check:node-root-encoding:ts:selftest`: exit 0, 24 PASS / 0 FAIL.
- `npm run lint` (`eslint .`): exit 0. A direct `eslint --max-warnings=0` on the 4 files also passes.
- `npm run format:check`: all files pass.

Real-tree mutations. Each was restored with an exact `git checkout -- <path>`, and `git status` was clean afterwards.
- **(a) Line shift:** I added 25 comment lines at the top of NodeSnapshotRepository.scala and 10 `val` lines above `def listRows`, so the exempt sites moved to lines 155/213/237. Result: exit 0, clean.
- **(a, TS):** 3 lines added at the top of context.ts. Result: exit 0.
- **(b) New unexempted hit:** I appended `object EvalProbe { def probe(...) = sql"... WHERE node_step_id IS NULL" }` to NodeSnapshotRepository.scala. Result: exit 1, exactly one violation, naming `NodeSnapshotRepository.scala:439` and the line text.
- **(b) combined with a shift:** BinaryRefRepository.scala, 2 lines added at the top plus an appended `def probe2 = sql" AND node_step_id IS NULL"` (the same text as an exempt line, in a new def). Result: exit 1, exactly one violation (`:153`).
- **(c) Removed exemption:** I deleted the `listRows` entry from the shipped table. Result: exit 1, reporting `NodeSnapshotRepository.scala:178` (`case (None, None) => sql" AND node_step_id IS NULL"`). The identical `nodeFilterFragment` line stayed exempt, so the scope key holds.
- **Missing file (Scala entry point):** with BinaryRefRepository.scala removed, the run exits 1 and reports the 3 entries as stale.
- **Missing file (TS entry point):** with context.ts removed, the post-scan step reports 1 stale entry and exits 1.

D5 mutation table, applied to the Scala scanner. Each scanner was restored with an exact checkout after the run.

| Mutation | Result |
| --- | --- |
| line-number keying | 14 FAIL: (a) ×3, (b') ×2, (stale) ×8, (arm) ×1. **(whitespace) did not fail** (Phase 1 issue 1). |
| count bound off | (b') same-scope duplicate fails, as claimed. |
| scope dropped | 20 FAIL, including (b''). Collapsing scope also merges the listRows and nodeFilterFragment keys, so the baseline fails too. |
| stale check off | (stale) ×12, (missing file) ×2 and (arm) stale ×4 fail, as claimed. |
| arm dropped | (arm) ×6 fail, as claimed. |

TS mutations:

| Mutation | Result |
| --- | --- |
| line-number keying | (d) line-shift and (e) duplicate ×2 fail. |
| count bound off | (e) fails. |
| stale off | (g0) ×3 fail. |

Before/after parity (D6): I ran the pre-change scripts (`git show 32571b01:`) and the new scripts over the same tree, the 3 Scala target files and 41 `helio-mcp/src` non-test files:
- **Raw hits** (pre-exemption: new scanner with `[]` exemptions, old scanner on a non-matching path) are identical:
  - Scala, 6 hits: NodeSnapshotRepository 130/178/202, BinaryRefRepository 49/108/128.
  - TS, 1 hit: context.ts:222.
- **Violations** are identical (0 and 0) for both guards.

Scratch files were removed by exact path.

Code quality:
- Small, readable, no dead code.
- The grouping logic is duplicated between the two scripts. design.md D4 justifies this so each guard stays independently runnable. Acceptable.

### Phase 3: UI Review — N/A
This is a script-only change. No file matches a Phase 3 trigger.

### Overall: FAIL

### Change Requests
1. `openspec/changes/content-keyed-root-encoding-exemptions/design.md`, D5 mutation table, row 1: change the "must turn FAIL" cell for "key by line number instead of content" to `(a) line-shift` only. It may also list (b') and (stale), which turned red under my run. Remove `(whitespace)` from that row. Add a new row: "whitespace normalisation dropped (raw/trimmed text in the key)" → `(whitespace)`. Then actually run that mutation against `scripts/check-node-root-encoding.mjs` (hit key `normalise(raw)` → `raw.trim()`), confirm both `(whitespace)` cases FAIL, and restore with `git checkout -- scripts/check-node-root-encoding.mjs`.
2. Record the red output of every D5 mutation, Scala rows plus the TS line-key, count-bound and stale-off rows: the mutation applied and the FAIL lines printed. Put it in `files-modified.md` or a persisted evidence file, as task 3.2 requires. Either do this or un-tick 3.2/4.2. The task is currently `[x]` with no recorded output.

### Non-blocking Suggestions
- `scripts/check-node-root-encoding.selftest.mjs` lines 4-6: the header still says "in-memory fixture text -- no disk, no real repo files touched". The selftest now reads the real NodeSnapshotRepository/BinaryRefRepository from disk (read-only). Reword it to "no repo files modified".
- Consider adding a TS selftest case for the entry point's post-scan stale check of unscanned entry files, or reword D5 to say only `scanTextForViolations(file, "")` is covered.
