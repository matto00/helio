## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD b36e38858d4fc85d6930a7b638ee40ebe7771dc5. The base was resolved live with `resolve-review-base.sh`: 07a1180016b8032c9c16f2514aa8a8c0319cb776.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/deflake-hel1820-e2e-specs/HEL-1826`.
- **Scope (from `git diff BASE...HEAD`):**
  - Only three e2e specs and the change dir changed. No app code changed.
  - No probe spec is tracked: `git ls-files e2e | grep probe` lists only the pre-existing `hel1790-hover-probe` and `support/*Probe` files.
- **CI failure messages, checked against the real job logs with `gh run view --log-failed`:**
  - Run 44998353027, job 137141434791, failed at `hel1791...:290` with `status message: text`: expected `/The row was added\./`, received `""`.
  - Run 44979065391, job 137075333074, failed at `hel1572...:126`: expected `"serif"`, received `"mono"`.
  - Both match `ci-evidence.txt`.
- **Static gates, which I ran myself on the three specs:**
  - eslint `--max-warnings=0`: exit 0.
  - prettier `--check` on the specs and the change dir: clean.
  - `tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- **My own full-file runs** were done with servers started by `start-servers.sh` on 7258/10165, lane DB `helio_hel1826`, `ANTHROPIC_API_KEY` empty, 2 workers and `nice -n 19`. Log: `.concertino/scratch/HEL-1826/skeptic-final-runs.txt` in the main checkout.
  - hel1791: 2 of 2 runs green (6 passed each).
  - hel1582: 2 of 2 runs green (8 passed each).
  - hel1572: 2 of 2 runs green (15 passed each).
- **Committed 20x evidence, which I counted myself:**
  - `t1/t2/t3-plain.txt` and `t1/t2/t3-stress.txt` each have 20 `exit=0` lines and no non-zero exit.
  - All stress files carry `STRESS-ACTIVE` lines (t1 80, t2 140, t3 40).
  - The stress mechanisms are committed (C16): `t1-stress-diff.txt`, `t2-stress-diff.txt`, `t3-stress-diff.txt`, plus the generators.
- **C17:** the mutation files' after-revert `git status --short` lists only e2e and change-dir paths, never a `frontend/` or `backend/` file.

### Acceptance criteria

- **AC1: root cause per test, with evidence.**
  - **T1.** `t1-probe-evidence.txt` (CI trace) shows the 429 on `POST panels/<id>/submit`. `t1-red-burn-stress.txt` reproduces it: the unfixed spec fails with the CI message once the owner's budget is burned.
    - My own independent probe backs the mechanism. A temporary uncommitted copy of the spec was deleted afterwards; scratch output is in `skeptic-remain-*.txt`.
    - That probe measured the shared owner's budget after both owner geometry tests: remaining=20 and 22 at CPU 1x, 25 at CPU 6x, with no 429 for any actor in any run.
    - So the deleted 6th owner test is what pushed the window over. The fix moves exactly that spending to a fresh principal.
  - **T2.** The mechanism is confirmed (`t2-stale-tap.txt`): a tap at the pre-reflow point (319,312) lands on the `+` diff chip and opens nothing. The natural race timing is honestly labelled UNCONFIRMED, as C18 requires.
  - **T3.** The CI trace shows unordered PATCHes, and the red is reproduced deterministically (`t3-red-held-mono-patch*.txt`). The cause is correctly placed in the app and reported as a follow-up.
- **AC2: 20x plain and 20x stressed.** Met for all three, per the counts above. Two caveats:
  - For T1 the reproducing burn stress is vacuous against the fixed test, which no longer uses that principal. That is inherent in the fix, not a gap.
  - T2 has no reproducing stress, as disclosed.
- **AC3: mutation red at the guarding assertion.**
  - T1: `position:absolute` is red at `status message: in flow`, and the alert regex is shown failable.
  - T2: a panel off screen is red at `right inside the viewport`.
  - T3: is red at the bounded save wait and, separately, at the other-device `data-type-style` assertion.
- **Assertions are not weakened.**
  - T1: the alert regex got stricter.
  - T2: one extra wait was added.
  - T3: one extra 200-status assertion was added. It removes the race that exposed the app defect, but the defect is logged as a follow-up per the ticket's "file it separately".

### Verdict: CONFIRM

### Non-blocking notes

- hel1791: the shared `owner` still finishes its two geometry tests with only about 20-25 of 120 requests left in its window (measured above). That is roughly 17-20 % headroom. It is fine today, but any extra page load added to the owner tests would bring back the same 429 failure. A follow-up could give each owner theme test its own principal, or reuse `measurer`.
- hel1791: the new test repeats the counter source and panel config from `beforeAll`. A shared constant would keep them from drifting (carried over from the evaluator).
- The C12 ordering deviation (the T2 and T3 reds were committed together with their fixes) is disclosed in `root-cause.md`. The content proof for T3 is the line arithmetic: the red fails at `:139` = unfixed line 126 + the 13-line hook, where the fixed spec would give `:155`. That proof is self-authenticating, and I did not rely on mtime ordering.
- App follow-up candidate: type-style `PATCH /api/users/me/preferences` writes are unordered, so the last write to arrive wins (`handleAppearanceChange` in `frontend/src/main.tsx`).

Servers I started were stopped with `stop-servers.sh` (`STOPPED ports=7258,10165`). No probe file remains in the worktree.
