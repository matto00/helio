## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 46ae373af2cc7aa30cad0558e169cc26213e9b0c (base 32571b0166a25b127a27bec645b7e2aec11b3c2b, resolved live). This report covers the cycle-1 to cycle-2 delta (2bb5bfb9..46ae373a) plus fresh gate runs. Everything verified in evaluation-1.md still holds for the parts of the code this cycle did not touch.

### Phase 1: Spec Review — PASS

Both cycle-1 change requests are resolved:
1. **design.md D5 table, row 1 (CR1).** The line-number-keying row now names only (a), plus the "(b'), (stale)" observations I reported. A new row says "whitespace normalisation dropped" must turn (whitespace) red. I re-ran that mutation myself (`normalise(raw)` → `raw.trim()` in the hit key): both `(whitespace)` cases go red, along with 29 others, matching mutation-proof.md's Scala 6 section.
2. **Recorded mutation evidence (CR2).** `mutation-proof.md` records 6 Scala and 4 TS mutations, each with its exit code and the verbatim FAIL lines. The Scala 1–5 and TS 1–3 entries match my own cycle-1 runs line for line. Tasks 3.2 and 4.2 are now backed by recorded evidence.

Other checks:
- **Changed files:** only `scripts/check-node-root-encoding*` and the openspec change dir changed. The change dir now also holds evaluation-1.md and mutation-proof.md.
- **CONSTRAINTS:** `[]`, so nothing to honour.

### Phase 2: Code Review — PASS

Fresh gate runs in WORKTREE_PATH:
- `check:node-root-encoding`: exit 0.
- `:selftest`: exit 0, 58 PASS / 0 FAIL.
- `:ts`: exit 0.
- `:ts:selftest`: exit 0, 27 PASS / 0 FAIL. This is 24 plus the 3 new (g1) cases.
- `npm run lint`: exit 0.
- `npm run format:check`: clean.

The cycle-2 code change is the TS post-scan stale pass, pulled out into an exported, pure `staleForUnscannedFiles(scannedRelPaths, exemptions)`. The entry point calls it with repo-relative paths, and its behaviour matches the cycle-1 inline loop. I checked it three ways:
- **Mutation:** with the post-scan check disabled (`if (!scanned.has(file)) found.push` → `if (false) found.push`), both affected (g1) cases go red: "unscanned entry file reports stale" and "absolute-form path would not match". The scanner was then restored with an exact `git checkout`.
- **Real entry point:** with `helio-mcp/src/context.ts` removed, `check:node-root-encoding:ts` reports 1 stale exemption and exits 1. The file was restored with an exact `git checkout`.
- **Scala real-tree spot checks:** with 3 lines added at the top of NodeSnapshotRepository.scala, the guard exits 0. Appending a new `def evalProbe = sql" AND node_step_id IS NULL"` gives exit 1 with one violation. Both were restored with an exact `git checkout`, and `git status` was clean afterwards.

Parity: this cycle did not change the Scala scanner or the TS hit/exemption logic; the only change is the post-scan refactor above. So the cycle-1 parity result still holds: raw hits are 6 Scala and 1 TS, identical before and after, with 0 violations either way.

### Phase 3: UI Review — N/A
This is a script-only change. No file matches a Phase 3 trigger.

### Overall: PASS

### Non-blocking Suggestions
- The reworded selftest header comments run past the ~100-column comment width used elsewhere in these files:
  - `scripts/check-node-root-encoding.selftest.mjs:5` is 166 characters.
  - `scripts/check-node-root-encoding.ts.selftest.mjs:6` is 120 characters.

  Prettier does not reflow comments. Re-wrapping them would match the surrounding style.
