## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: worktree HEAD b0ff8570999d3550607df0ec64f4fb6956d50f39 (= origin/main), plus the untracked change dir
`openspec/changes/ci-sbt-diag-tidyups/` (proposal.md, design.md, tasks.md, specs/). Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=task/ci-sbt-diag-tidyups/HEL-1362`.
`openspec validate ci-sbt-diag-tidyups --strict` reports "Change 'ci-sbt-diag-tidyups' is valid".

### What I verified (with evidence), per round-1 change request

1. **CR1 (D5 rationale and decision): closed.**
   - Every factual claim in D5 now matches the tree. Checked with `du -ab` on the archived `ci-logs/`:
     - `backend2-FAIL` is 2,266,058 B and `attempt4-backend3-FAIL` is 3,203,939 B, together about 5.47 MB of 5.61 MB.
     - The security-control log is 84,498 B and `control-artifact/` is 51,534 B.
     - `ci-evidence.md:62-69` says both FAIL logs are flaky-test failures unrelated to the change.
     - `ci-evidence.md:91` says no real hang occurred.
   - The decision is now made on these true facts: keep the control evidence and `git rm` the two unrelated logs. The
     cost is handled. The only references to the removed files are `ci-evidence.md:65` and `:68` (grep, excluding the
     change dir). Task 1.7's correction note names d71f646cb and the run ids. Both D5 and task 1.7 forbid calling these
     files hang evidence.
   - "The only dump this tooling has produced" is accurate for real CI steps. Per `ci-evidence.md` "D6 in-build
     positive control", the control run produced `threads-2564.txt` through jcmd.
2. **CR2 (e2e-backend SIGQUIT-only exercise): closed.**
   - D3 now has a "D3 test" paragraph, and task 2.2 says "BOTH ci-sbt.sh and e2e-backend.sh die".
   - The test is feasible. Selftest case (d) (`scripts/ci-sbt.selftest.mjs:122`) already drives `e2e-backend.sh wait`
     into `die` with a stand-in JVM, so a PATH-scoped jcmd shim on that spawn reaches the rc-2 path.
   - It would be red on today's code. `e2e-backend.sh:40` prints nothing that tells the cases apart. `ci-sbt-diag.sh:109`
     sets `dumped=1` on a successful SIGQUIT, so today's rc is 0 and no "SIGQUIT sent" text exists.
3. **CR3 (D4 budget test shape): closed.**
   - D4 now spells out the test:
     - it calls `ci_sbt_capture` directly by sourcing the lib;
     - it times the call externally with `date +%s.%N` and node `performance.now()`, explicitly not the lib's `SECONDS`
       or its "capture finished" line;
     - it uses at least 3 verified JVMs, a hanging jcmd and a budget of about 6 s;
     - it asserts elapsed <= budget + 1.0 s and that at least one candidate is logged `skipped`.
   - I traced today's lib against that setup and it is red as specified, so the test is not self-certifying:
     - Candidate 1: `_diag_timeout 12` is clamped to 6 s. `timeout -k 1 6` plus `sleep 1` comes to about 7-8 s.
     - Candidates 2 and 3: `_diag_timeout` returns 124 at once, but each still runs `kill -QUIT` and the unclamped
       `sleep 1` (`:108-110`). That is about 9-10 s in total, more than the 7 s ceiling.
     - No "skipped" string exists today.
4. **CR4 (red-first for the new diag cases): closed.** D4's last sentence and task 2.3 require both the SIGQUIT-only
   cases and the budget case to run against the unchanged scripts, with red and green output recorded in
   files-modified.md. The guard selftest is also covered (2.1 mutation-red, 2.3 red on the unchanged guard).
5. **CR5 (D1 YAML block-scalar headers): closed in substance.**
   - D1 now never joins a line matching `:\s*\|[-+]?\s*$`.
   - It adds a YAML negative/positive selftest pair: a `run: |` header is not joined, and a split `ps ... \` / `| grep`
     inside a `run: |` body is flagged.
   - I re-simulated D1's folding with that exclusion over the four scanned files (`node <scratchpad>/sim2.mjs`). The 20
     block-header joins are gone. Ten joins remain, all in ci.yml:
     - two genuine shell backslash continuations (`:381`, `:394`);
     - eight jq pipe lines inside one quoted jq program (`:422-439`).
   - Joining the jq lines only concatenates text that is already one shell argument. None of it contains `ps`, `pgrep`
     and the like, so there is no false positive on the live tree. A `key: >` folded header ends in `>`, not `|`, so it
     was never a join candidate.
   - The three shell scripts still have 0 joins.

Round-1 non-blocking notes were also taken up: D2 now quotes the larger of the PR-run and main-run figures, and D6 now
updates the client-mode comments in ci.yml, e2e-backend.sh and ci-sbt.sh. Driver constraint C1 still holds: no decision
or task touches cache keys or paths, HEL-1299's restore/save split, or any `timeout-minutes`. The ci.yml edit is
comment-only (`ci.yml:241`, still "(25-40 s)" on the live tree, as expected before execution).

### Verdict: CONFIRM

### Non-blocking notes

- The Risks bullet in design.md still says joins happen only "which in bash really are one pipeline". Round-1 CR5 asked
  for this sentence to be corrected, and it is unchanged. It is now harmless: block headers are excluded, and the only
  non-bash joins are the jq lines at `ci.yml:422-439`, which cannot produce a match. Still, the executor should not
  treat it as a guarantee. A one-line rewording ("or lines of one quoted multi-line argument, e.g. the jq program; harmless")
  would make it true.
- tasks.md 2.1 lists the split-pipeline positives and the no-join negative, but not D1's YAML `run: |` pair. D1 binds,
  so the executor must implement the pair anyway, and the evaluator should check it exists.
- D5 says the kept control evidence is "~150 KB". Measured, it is 136,032 B. "Of the 5.4 MB" mixes MB and MiB slightly.
  Use exact byte counts in the correction note.
