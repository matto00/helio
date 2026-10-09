## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: worktree HEAD b0ff8570999d3550607df0ec64f4fb6956d50f39 (= origin/main), plus the untracked change dir
`openspec/changes/ci-sbt-diag-tidyups/`. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=task/ci-sbt-diag-tidyups/HEL-1362`.

### What I verified (with evidence)

- **Premise items 1, 3, 4, 6 hold on the live tree.**
  - Item 1: `scripts/check-ci-sbt-no-pattern-kill.mjs:24` uses `text.split("\n")` and tests each line on its own.
  - Item 3: `scripts/ci-sbt.sh:56-57` prints "thread dump captured" whenever `ci_sbt_capture` returns 0.
    `scripts/lib/ci-sbt-diag.sh:109` sets `dumped=1` when `kill -QUIT` succeeds, so a SIGQUIT-only run gets the same
    message as a real dump.
  - Item 4: `ci-sbt-diag.sh:110` has an unclamped `sleep 1`, and `:30` uses `timeout -k 1 "$cap"`. Both are plausible
    causes of the overrun. D4 correctly makes the executor confirm the cause with a probe before fixing it.
  - Item 6: grep for `--mode`, `E2E_SBT_SERVER_FLAG`, `active.json` and `_diag_socket_owner` outside the change dir and
    the archive finds them only in the three scripts and in selftest case (e) (`scripts/ci-sbt.selftest.mjs:158`).
    No workflow in `.github/` passes `--mode` or sets the flag.
- **Item 2.** `ci.yml:241` says "780 s + pre-steps (25-40 s) < 900 s". The archived `ci-evidence.md:102` says "780 + 40
  (pre-steps, max measured 31)". On PRs, shard 0 has extra steps before "Compile and test": the cache-composition report
  (`:202`) and the prune canary (`:216`), plus the selftest (`:234`). So D2 is right to measure the PR shape.
- **C1 (cache) and C2.** No decision touches cache keys, cache paths, the restore/save steps or any `timeout-minutes`.
  ci.yml has no path filters (`on: push main / pull_request main`), so the backend shard-0 selftest will run on this
  PR's CI, as D7 assumes.
- **Spec delta.** `openspec validate ci-sbt-diag-tidyups --strict` reports "Change 'ci-sbt-diag-tidyups' is valid".
  - The MODIFIED requirements repeat every original scenario from `openspec/specs/ci-sbt-invocation/spec.md`.
  - Dropping "or the sbt server's own state files" matches D6.
- **D6 (remove the thin-client lever): I accept it.** The owner ruled `accept-server`
  (`archive/2026-10-07-ci-sbt-hang-diagnostics/ci-evidence.md:47`, escalation HEL-1339-1791362731430-e6b288).
  - The only fallback rationale was in HEL-1339 `design.md:29`: "kept as the fallback if D1 costs time". That question
    is settled.
  - The socket lookup only ran in thin-client mode (`ci-evidence.md:89`: `active.json` does not exist in `--server`
    mode).
  - Removing the lever from both scripts is consistent. Keeping the e2e lever alone would leave dead code in the
    shared library.
- **D5 (keep the archived ci-logs): its factual basis is wrong.** D5 says the repo would be "the only durable copy of
  the only hang evidence captured so far". The archive itself says otherwise:
  - `ci-evidence.md:91`: "No real hang occurred in any of the 20+ other CI legs, so no other dumps exist."
  - `ci-evidence.md:57-69`: the two large logs are pre-existing flaky test failures "unrelated to this change":
    - `OutputRoutesSpec.scala:756`, `run37583797617-backend2-FAIL.log.txt`, 2,266,058 B
    - `ProductEventRollupServiceSpec.scala:85`, `run37586488590-attempt4-backend3-FAIL.log.txt`, 3,203,939 B
  - Those two logs are 5,469,997 of the directory's 5,606,029 B (`du -ab`), about 97.6%.
  - The only diagnostics evidence is the deliberate positive control: `run37583797617-security-control.log.txt`
    (84,498 B) and `control-artifact/` (51,534 B).
- **D1 risk claim checked by simulation.** I folded lines the way D1 describes over the four scanned files
  (`node <scratchpad>/sim.mjs`).
  - ci.yml: 30 joins, and 20 of them are YAML block-scalar headers (`run: |`, `path: |`), not shell continuations.
  - The three shell scripts: 0 joins.
  - There are no false positives on today's tree. But the design's risk statement ("only joins lines ending in a
    continuation token, which in bash really are one pipeline") is false for the YAML file it also scans.

### Verdict: REFUTE

### Change Requests

1. **D5: correct the rationale, then re-decide on the true facts** (design.md D5, tasks.md 1.6). The ci-logs hold no
   hang evidence. About 97.6% of the bytes are two logs of flaky tests unrelated to sbt diagnostics. Their relevant
   findings are already summarised with file:line in `ci-evidence.md:62-68`. The only diagnostics-relevant content is
   about 136 KB of positive-control output.
   - Rewrite D5 so every stated reason is true.
   - Re-make the decision: keep everything, keep only the control-run evidence, or remove everything. Weigh each
     option honestly. Removed files stay reachable at d71f646c, so the "breaks references" cost is cheaper than D5
     says: a pointer to the commit fixes it.
   - Whatever you choose, the "Correction (HEL-1362)" note must not describe these files as hang evidence. As planned,
     it would write a false statement into the repo.
2. **D3 / D7: deliberately exercise the e2e-backend SIGQUIT-only branch** (tasks.md 2.2). Task 1.2 changes
   `e2e-backend.sh`'s `die` to tell rc 2 apart from rc 1. The only planned SIGQUIT-only selftest case is unspecified
   and reads as `ci-sbt.sh`-only. This is a hang-only path, and the driver constraint requires an exercise. Add an
   explicit selftest case that runs the existing case (d) e2e setup with the jcmd PATH shim and asserts:
   - the die message says SIGQUIT was sent;
   - it does not claim a dump.
3. **D4: make the budget test unambiguous and non-self-certifying** (design.md D4, tasks.md 2.2). The sentence
   "asserting wall time <= budget+1" leaves open what is timed. The script's own "capture finished in Ns" line uses
   integer `SECONDS`, which is the very clock under test. Whole `ci-sbt.sh` wall time also includes the deadline, the
   5 s group-stop grace and the `sleep 1`. Specify:
   - (a) time only `ci_sbt_capture`, measured from outside with a sub-second clock. For example, a bash harness that
     sources the lib and brackets the call with `date +%s.%N`, or Node `hrtime` around a capture-only harness.
   - (b) use at least 3 verified-JVM candidates together with the hanging jcmd shim, so the per-candidate pile-up is
     what gets tested. Drop the "or" alternative.
   - (c) assert that the over-budget candidates are logged as `skipped`.
4. **Red-first proof for the new diag selftest cases** (tasks.md 2.2). Task 2.1 already requires a mutation-red for
   the guard. Require the same for the SIGQUIT-only case and the budget-ceiling case: show each one failing against
   the pre-change `scripts/ci-sbt.sh` and `scripts/lib/ci-sbt-diag.sh`, then passing after the fix. Record both
   outputs in files-modified.md. Otherwise a case that passes on the old code proves nothing.
5. **D1: handle YAML block-scalar headers** (design.md D1 and Risks, tasks.md 2.1).
   - Either do not join lines that are YAML block-scalar headers (`key: |`, `|-`, `|+`, `>`) in `.yml` files, or state
     explicitly that joining them is harmless and why.
   - Correct the risk sentence.
   - Add a selftest case built on a `run: |` block, so the decision is pinned whichever way it goes.

### Non-blocking notes

- D2: in the ci.yml comment, use the larger of the PR-shape figure measured on this PR and main run 37869010952's 55 s.
  PR and main pre-steps differ, and the comment governs both.
- D6: some ci.yml comments go stale once the lever is gone. Update them alongside the script headers:
  - `ci.yml:248-253` ("whichever client mode is in use")
  - the security comment near `:353`
  - the e2e start/wait comments near `:575-596`
  - `e2e-backend.sh:13-15` (the "thin-client sbt SERVER may live outside the group" paragraph)
- D3: when one candidate is dumped and another only gets SIGQUIT, rc 0 is fine. Consider having the message mention
  both.
- An inconsistency pre-dates this change: the spec scenario "process group recorded at launch is still stopped" does
  not match `e2e-backend.sh`'s deliberate no-stop `die` (`:22-23`). It is out of scope, but worth a follow-up.
