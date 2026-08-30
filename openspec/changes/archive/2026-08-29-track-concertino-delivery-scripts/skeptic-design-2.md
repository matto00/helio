## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. Read the revised `tasks.md` in full (this worktree). Task group 4 now carries a "Verify by measurement (no attestation anywhere in this group)" header with an explicit self-check ("If a step cannot be executed, it is not marked done — it is escalated").

2. **Round-1 CR1 (task 4.4 was attestation, not measurement) — genuinely fixed.** Task 4.4 now requires: a disposable `git clone` sandbox, resetting local `main` one commit behind origin so a real fast-forward (and therefore `FF_STATUS=updated`) is reachable — which round 1 identified as the specific thing the old 4.4 never reached — a real `setup-worktree.sh` + `cleanup.sh --phase4` invocation, capture of the literal stderr skip-notice line, plus a "demand the red" counter-run with `CONCERTINO_CLEANUP_SKIP_SYNC` forced empty showing different (sync-fires) output. This directly answers CR1's requirement to distinguish a passing run from a vacuous one, not a paraphrase of branch logic.

3. **Task 4.6 matches CR1's explicit fallback instruction.** Round 1's CR1 said: if a controlled run isn't feasible, say so and defer to this ticket's own terminal Phase-4 run rather than falling back to static reading. Task 4.6 states this verbatim in substance ("do NOT downgrade to code reading... this ticket's own terminal Phase-4 run is a second real opportunity... may never be satisfied by static inspection").

4. **New task 4.5 closes the postcondition gap** round 1 noted was never separately observed: it runs `git status --porcelain scripts/concertino/` in the same sandbox after the real `--phase4` run and requires it to be empty — AC4's literal assertion, observed rather than inferred from 4.4's stderr capture alone.

5. **Round-1 CR2 (AC3's two properties left to be inferred) — genuinely fixed.** New task group 5 states the mapping explicitly: AC3(a) "setting survives a re-render" → task 1.4; AC3(b) "cleanup.sh does not auto-run sync" → task 4.4. Task 5.2 requires confirming no AC is discharged by an unexecuted step and recording the mapping as evidence. I compared this mapping against `ticket.md`'s AC3 text (read directly in this session) and it accurately reflects the two bundled properties.

6. **Full AC→task mapping (task 5.1) checked against `ticket.md` verbatim:** AC1→4.2 (worktree listing + a real script execution, not just presence), AC2→2.4, AC3(a)/(b)→1.4/4.4, AC4→4.4+4.5, AC5→3.1, AC6→2.1+2.4+4.3. Each AC's wording in `ticket.md` matches what the mapped task actually measures — no AC is left mapped to an unexecuted or inspection-only step.

7. **Settled decisions untouched, as instructed.** AC6's negative-`.gitignore`-pattern mechanism (tasks 2.1/2.4/4.3) and the ordering constraint (task group 1 must complete before group 2) are unchanged from round 1's already-confirmed text — I did not re-derive these, only confirmed the task numbers referencing them still match.

### New issues found: none blocking

Task group 4's sandbox construction (clone + reset-behind-origin + `setup-worktree.sh` + two full `cleanup.sh --phase4` runs, one real one forced-red) is heavier than a typical design-gate verification plan, but that weight is exactly what round 1's CR1 demanded to reach the actual `FF_STATUS=updated` branch — trimming it would reopen the settled objection. Task 4.6's explicit escalate-rather-than-downgrade clause covers the case where the sandbox can't be built, so this isn't a design gap, just an execution-cost tradeoff the tasks already account for.

### Verdict: CONFIRM

Both round-1 change requests are substantively addressed with real measurement plans, not rewordings. The AC→task mapping is complete and accurate against `ticket.md`. No settled decision (AC6 mechanism, ordering constraint, tracking-vs-copy) was reopened, and I found no new blocking issue.

### Non-blocking notes

- Task 4.7 (cleanup of the throwaway worktree and sandbox clone) is good hygiene; worth a reminder in the executor's report that this cleanup must not touch the ticket's own worktree.
