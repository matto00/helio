## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `5dd57b0e4d836bf1df648092d022f3c03e3386fd`. Diff base `64e374bb7519262655370bc8c0e210dba930f251` (resolved live via `resolve-review-base.sh`, exit 0). `origin/main` has moved 3 commits since (HEL-1492/1497/1493). None of them touches a file in this diff, and `git merge-tree HEAD origin/main` is clean.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/compute-conditional-boolean-logic/HEL-1070`.

### What I verified (with evidence)

**Round-1 CR1 (M11/M12 `<=`/`>=` equality boundary): CLOSED.**
I re-ran the mutations myself. Setup: a throwaway detached worktree at 5dd57b0e4 (since removed) and `nice -n 19 sbt -batch -J-Xmx3g "testOnly ...ExpressionBoolean* ...ComputeConditionalCountSpec"`. Each mutation was reverted with `git checkout` afterwards.
- M11 (numeric `case "<=" => a <= b` → `a < b`): `should compare numbers numerically *** FAILED ***`, `[hel1468-guard] ScalaTest summary: failed=1`. KILLED.
- M12 (text `ord`: `c <= 0` → `c <= -1`, `c >= 0` → `c >= 1`): `should compare text exactly, by UTF-16 code unit *** FAILED ***`, guard `failed=1`. KILLED. I used a textually different but equivalent form so this was a fresh compile, not a disk-cache replay of the evaluator's identical edit.
- M12b (text `>=` only → `>`): FAILED, guard `failed=1`. KILLED.
- M13 (numeric `>=` → `>`): FAILED, guard `failed=1`. KILLED.
- Baseline at the unmutated head: guard `failed=0`, 68 succeeded.

**Round-1 CR2 (ligatures): CLOSED.**
I ran the app on 6502/9409 (`start-servers.sh`; `assert-phase.sh servers` → `PASS servers`), using throwaway user `159e0f60-2590-42a9-8c82-b2a5b78b0f55` / `hel1070-skeptic2@example.test`. `/api/auth/me` returned 401 before I registered, so the owner account was never used. I opened the compute step editor and its "Functions and operators" disclosure.
- All 26 signatures compute `font-variant-ligatures: none`. `a != b`, `a <= b` and `a >= b` render literally in both themes.
- The new list separator is token-only (`--space-3`, `--app-border-subtle`). It resolves to `rgba(242,239,233,0.09)` in dark and `rgba(33,29,25,0.11)` in light.
- Spacing, type hierarchy and parity are consistent with the existing reference list. The only console error is the pre-existing `GET .../schedule` 404.
- Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-sk2-ops-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-sk2-ops-light.png`

**Ticket ask, end to end (live).**
I built a static source (`status` string, `amount` integer, `flag` boolean; 4 rows including nulls) into one pipeline via `POST /api/pipelines`, with compute `is_done = if($status = "Done" and $amount != 0, 1, 0)` and `big = $amount >= 5 or not $flag`.
- `GET /analyze`: `is_done` is `float`, `big` is `boolean`, there are no validation errors, and `canRun` is true.
- `POST /run?dry=true`: `is_done` is `[1.0, 0.0, 0.0, 0.0]`, which is correct (row 3 has `amount=0`, row 4 has a null status → else).
- Cleanup: deleted by exact id+email via `buildUserDeleteSql`. Post-check `users|pipelines|data_sources` = `0|0|0`. I logged out (`/api/auth/me` → 401) and restored `helio-theme=dark`. No file uploads, so there is no residue outside the worktree.

**Rest of the change.**
- The cycle-2 delta touches only tests, one scoped CSS rule plus a separator, an import move and a one-word MCP doc edit. No production Scala changed.
- I re-read the full branch diff stat against the live base. It matches the round-1 review, and nothing new appeared outside the delta.
- I relied on the evaluator's pasted `testFull` guard line (`failed=0 aborted=0 unreadable=0`, 7179 succeeded; persisted `hel1070-c2-testfull-summary.txt`) and its jest/lint/typecheck/build exits. They are unambiguous, and I added no code.

**NEW: the comparison operators' semantics are still not mutation-proven beyond the two boundaries CR1 named.**
I ran the same harness, widened to `ExpressionBoolean* ComputeConditionalCountSpec ExpressionEvaluatorSpec ComputeStepSpec` (194 tests). Every one of these single-operator mutations SURVIVED: guard `failed=0`, `Tests: succeeded 194, failed 0` (M14: 68/68 on the narrower set).

| id  | mutation (in `ExpressionInterpreter.compare`)                       | effect if shipped                                     |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| NNE | numeric `case "!=" => a != b` → `false`                             | `if($x != 0, ...)` always takes else                  |
| M14 | numeric `case "!=" => a != b` → `a > b`                             | `3 != 5` is false                                     |
| NLT | numeric `case "<" => a < b` → `a <= b`                              | `100 < 100` is true                                   |
| TLT | text `ord` `case "<" => c < 0` → `c <= 0`                           | `"a" < "a"` is true                                   |
| TGT | text `ord` `case ">" => c > 0` → `c >= 0`                           | `"a" > "a"` is true                                   |
| TNE | text `ord` `case "!=" => c != 0` → `true`                           | `"Done" != "Done"` is true                            |
| BNE | boolean `... else a != b` → `else true`                             | `true != true` is true                                |

The tests cover only one direction of each operator:
- Numeric `!=` has a single false case (`ExpressionBooleanEvalSpec.scala:29`) plus the false-path `if($b != 0, …)` at line 152, so there is no true case.
- Numeric `<` has a single true case (line 26).
- Text `!=` has only a true case (line 36).
- Text `<` and `>` have only true cases (lines 37-39).
- Boolean `!=` has only a true case (line 54).

`grep` over `backend/src/test`, `frontend/src` and `e2e` finds no other test that evaluates these operators. A wrong `!=` would silently corrupt exactly the conditional counts this ticket exists to enable. Round 1 required these boundaries for `<=`/`>=`, so the same standard applies to the other four operators.
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1070/evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-sk2-mutation-summary.txt`. Raw logs are persisted alongside it under `.../evidence/openspec/changes/compute-conditional-boolean-logic/hel1070-sk2-logs/hel1070-sk2-<id>.txt`.

### Verdict: REFUTE

### Change Requests

1. **Complete the comparison truth matrix in `backend/src/test/scala/com/helio/domain/engine/ExpressionBooleanEvalSpec.scala`** so every operator has a true case, a false case and an equality case, for each operand kind it accepts:
   - "compare numbers numerically" (lines 19-31): add `$amount != 100` vs 99 → `true` (kills NNE and M14 with a below-bound row; add vs 101 → `true` as well), `$amount < 100` vs 100 → `false` (kills NLT), and `$amount < 100` vs 101 → `false`.
   - "compare text exactly" (lines 33-45): add `$s < "a"` vs `"a"` → `false` (kills TLT), `$s > "a"` vs `"a"` → `false` (kills TGT), and `$status != "Done"` vs `"Done"` → `false` (kills TNE).
   - "support = and != on booleans" (lines 52-56): add `$a != $b` with true/true → `false` (kills BNE), and `$a = $b` with true/false → `false`.
   - Then re-apply each of NNE, M14, NLT, TLT, TGT, TNE and BNE exactly as in the table above. Observe each one red with a quoted `[hel1468-guard] ... failed>=1` line, revert, confirm the baseline is `failed=0`, and append all seven runs to `mutation-evidence.md`.
   - Before declaring done, sweep the remaining `compare` arms (`=` numeric/text/boolean) the same way. This should be the last round of this class, not one more.

### Non-blocking notes
- The compute expression input itself still renders with ligatures (`font-variant-ligatures: normal` measured on the input), so a typed `!=` displays as `≠` while editing. CR2 deliberately scoped this out. Consider a follow-up, since the same confusion applies while a user is typing.
- `files-modified.md` lists only the cycle-2 files. Regenerate it from `git diff --name-only <base>...HEAD` if the PR step reads it as the branch file list (also noted by the evaluator).
- In my dry run, two parentless steps in a single-call create became sibling lanes, and the run returned only the first lane's rows. This is pre-existing behaviour, not this change.
- Follow-through (collapse the roadmap dashboard's static % tiles) remains post-merge operational work.
- Process: Playwright MCP wrote its auto page and console logs into the main checkout's gitignored `.playwright-mcp/` (`page-2026-10-11T22-15-56-603Z.yml`, `page-2026-10-11T22-16-44-446Z.yml`, `page-2026-10-11T22-16-48-808Z.yml`, `page-2026-10-11T22-16-51-868Z.yml`, `page-2026-10-11T22-16-56-560Z.yml`, `page-2026-10-11T22-17-23-211Z.yml`, `page-2026-10-11T22-17-23-783Z.yml`, `page-2026-10-11T22-17-24-326Z.yml`, `console-2026-10-11T22-15-55-484Z.log`, `console-2026-10-11T22-16-43-681Z.log`). I did not remove them, because removal there is outside my write scope. They are tool-generated, not mine to delete.
- Gate-defect check (CON-160): no report in this chain rests on mtime ordering, so there is nothing to record.
