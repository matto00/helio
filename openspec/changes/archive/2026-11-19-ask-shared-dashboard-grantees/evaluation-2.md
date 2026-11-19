## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `0bb7dde473a36051ef5a4e791f599c88e68fdf39` against live base `b2603ab7998f3e9b4bdca5089a18f89da16fdc8b`. The cycle-2 delta is commit 0bb7dde47.

### Fresh gate evidence (evaluator's own runs)

- `npm run lint`, `npm run format:check`, `npm run typecheck`: all exit 0.
- `npm test` (jest, 3 workers): root 617/617; frontend 10177/10177 (one more than cycle 1, the new stability test). Exit 0.
- `npm --prefix frontend run build`: exit 0.
- `AskAnswerCard*` jest run with `--silent=false`: 0 occurrences of "returned a different result". Cycle 1 had 4 at d3bc2f9da.
- `sbt -J-Xmx3g testFull` on a recreated `helio_hel1781`, with `ANTHROPIC_API_KEY` exported empty: 10018 succeeded, 0 failed, "All tests passed". All 4 `AskGranteeRlsSpec` cases ran under their new names.
- Playwright (2 workers, lane DB, `start-servers.sh` + `assert-phase.sh servers` PASS): full `hel1781-ask-shared-dashboard.spec.ts` and full `hel1773-viewer-grantee-dashboard.spec.ts`, 13/13 passed. This includes the new console-error assertion.
- Cleanup: servers stopped with `stop-servers.sh`, and the lane DB is dropped. The worktree has no stray files.

### Verification of cycle-1 change requests

- **CR1 (stable selector): resolved.**
  - `AskAnswerCard.tsx:55-64`: `panelItems` (a stable `s.panels.items` reference, or the module-level `NO_PANELS`) and a boolean `panelsSettled`, fed to a `useMemo`.
  - New unit test `AskAnswerCard.grantee.test.tsx:140-153` filters exactly that warning. I reproduced the warning on the old code in cycle 1, so this test was red there. The persisted `red-cr1.txt` (`1 failed, 6 passed, 7 total`) is consistent with that.
- **CR2 (e2e red): resolved.** Persisted transcripts:
  - `e2e-mutation-a.txt` (chip forced to `authenticated`): viewer desktop and phone red, the other 3 green.
  - `e2e-mutation-b.txt` (Ask re-gated on `isOwner`): viewer x2, editor and free red, owner green.
  - `e2e-green.txt`: 5/5 green.
  - The line numbers in the transcripts (228/276/291/305) match the HEAD file.
  - Caveat: the transcripts carry only pass/fail lines, not failure messages. The failure reason is inferred, not shown: for (a), 2.8 s failures match the request assertions; for (b), 30 s and 3 m timeouts match a missing button. Acceptable.
  - Tasks 1.5 and 4.2 now state that the e2e was not run red at base.
- **CR3 (RLS spec): partially resolved.**
  - The no-pin assertion now has teeth. The viewer's answer cites `amount` from `get_output_rows`, so `AskPinBuilder` runs and `citedOutputs` is asserted. The owner control sends the same cited answer and asserts a non-null pin. `mutation-RLS-C.txt` (`case _ => Some`) turns the viewer case red, so the pin path is really reached.
  - The history assertion now checks the seeded 100.0/110.0 values.
  - **Not resolved:** the doc comment still overclaims; see Phase 1.
- **CR4 (persist transcripts): resolved.**
  - All 11 files listed in `files-modified.md` exist under `/home/matt/Development/helio/.concertino/runs/HEL-1781/evidence/.concertino/scratch/HEL-1781/`.
  - Jest mutation runs for "chip authenticated" and "CommandBar Ask disabled" are honestly marked "not persisted". Those cases are covered anyway by the red-at-base `red.txt`.

### Phase 1: Spec Review — FAIL

The ACs are met; the behaviour and evidence are as in cycle 1, plus the stronger RLS pin proof. Two statements in the diff contradict the persisted evidence. Constraint C16 says a mutation left green is never proof, so both count:

1. **`backend/src/test/scala/com/helio/services/ask/AskGranteeRlsSpec.scala:25-26`** says: "offering `get_history_rows` without the pipeline-grant check turns the offered-tools and payload cases red". The persisted `mutation-RLS-A.txt` shows only one red case ("read rows and history ... offer no payload tool and pin nothing"). The payload case ("refuse a scripted get_history_rows call ... never read the payload row") stayed green under RLS-A.
   - The only mutation aimed at the payload case is RLS-B (skip the grant check inside `historyRows`), and it also stayed green (`mutation-RLS-B.txt`, 4/4).
   - So the payload-refusal case has no mutation that reaches it, yet the comment presents it as mutation-proven. This is the same overclaim class as cycle-1 CR3.
   - Line 23 ("is never offered or served the payload tool") is fine as a description of what the guard asserts. The problem is only the "Mutation evidence" sentence.
2. **`openspec/changes/ask-shared-dashboard-grantees/tasks.md:37` (task 4.2) is garbled, so it does not say exactly what ran.** Markdown formatting turned `get_history_rows` into "get*history_rows". The RLS-C entry reads "AskPinBuilder \`case * => Some\`", which is not the mutation that ran (`case _ => Some`, as M1 states in the same line). The orchestrator asked specifically that tasks.md state exactly what ran.

Everything else in Phase 1 passes:
- Tasks 1.5 and 4.2 are otherwise honest: RLS-B is recorded as green and not proof, and the jest mutations are marked "not persisted".
- No scope creep in the cycle-2 delta. The `skeptic-design-1.md` change is whitespace only; see suggestions.

### Phase 2: Code Review — PASS

- The `AskAnswerCard.tsx` fix is correct and minimal.
  - `s.panels.items` is a stable reference between panel mutations.
  - `NO_PANELS` keeps the owner path at a constant reference.
  - The `useMemo` dependencies are complete.
  - The unused-`Map` rebuild now happens only when panels or settledness change.
- The new jest test restores its `console.warn` spy in `finally`.
- The e2e console listener is attached and detached alongside the other listeners.
- The `AskGranteeRlsSpec` changes use the existing `AskScript` helpers (`citations`, `lastResults`). No new dead code.
- All gates are green on my own runs (above).

### Phase 3: UI Review — PASS

- The 13/13 e2e run on the final HEAD covers:
  - viewer on desktop and phone: Ask opens, cited answer, no pin, per-panel provenance, zero `/api/outputs|pipelines` requests, no `/api` 4xx/5xx, and now zero console errors;
  - editor with no pipeline grant: no pin;
  - free grantee: upsell, zero `/ask` requests;
  - owner regression;
  - the full hel1773 grantee suite.
- The public viewer was already verified in cycle 1 (no change since).

### Overall: FAIL

### Change Requests

1. **`AskGranteeRlsSpec.scala:25-26`: make the "Mutation evidence" sentence match the transcripts.** It should say that offering `get_history_rows` without the grant check turns the offered-tools case red (RLS-A); that `case _ => Some` in `AskPinBuilder` turns the viewer no-pin case red (RLS-C); and that skipping the grant check inside `historyRows` left every case green (RLS-B), so the payload-refusal case has no reaching mutation and is an unproven guard.
   - Alternatively, find a mutation that does turn the payload-refusal case red and persist its transcript. One option is removing both the offer gate and the downstream refusal, so the viewer is actually served the payload row.
   - No code change is needed beyond the comment unless you take that alternative.
2. **`tasks.md:37`: restore the identifiers.** Wrap them in backticks so formatting cannot rewrite them: `` `get_history_rows` `` and `` `case _ => Some` `` for RLS-C. Then re-run `npm run format:check` and confirm the line still reads correctly.

### Non-blocking Suggestions

- `skeptic-design-1.md`: commit 0bb7dde47 re-indented 4 continuation lines of the skeptic's report (whitespace only; prettier). Editing another role's report, even cosmetically, is best avoided. Content is unchanged, so this is not blocking.
- Persisted transcripts would be stronger with the failure message lines (Playwright `Error:` / ScalaTest `... was not ...`), so the reason a case went red is self-evident rather than inferred.
