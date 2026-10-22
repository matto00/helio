## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/e2e-browser-deps-install/spec.md,
specs/ci-actions-cache-budget/spec.md, skeptic-design-1.md. All are uncommitted in the worktree at
HEAD afca73bc8ac9bf039937b2d21fcef459573a3650.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/e2e-apt-deps-cache/HEL-1700`.

#### The four round-1 revisions

I checked each one against the artifact text. Each is a real change, not just new wording.

1. **One option set for every apt call after a winning attempt: addressed.**
   - Design D2 now says it in bold: "Every apt call after an attempt succeeds — the offline install and the
     `dpkg-query`-based prune — uses that winning attempt's full option set (same sources dir, same lists dir,
     same archive dir)."
   - Each attempt also has its own `Dir::State::Lists`. That removes the cause behind round 1's objection: an
     `apt-get update` can no longer drop list files that another config needs.
   - The selftest is pinned in two places: D2 ("attempt 2 wins -> install is invoked with attempt 2's options") and
     task 2.2 ("attempt 2 wins -> the offline install and prune use attempt 2's full option set").
   - Task 2.2 also requires a mutation check: "breaking ... the option-set hand-off makes it fail".
2. **Cache-key OS segment: addressed.**
   - D3 explains why `${{ env.ImageOS }}` would be empty.
   - It computes the segment in a shell step from `$ImageOS`, falls back to `/etc/os-release` `ID`+`VERSION_ID`,
     fails if the result is still empty, and passes it on as a step output.
   - Task 3.1 implements this. Task 4.5 checks that the logged key has a non-empty OS segment.
3. **Stall test is a slow trickle: addressed.**
   - Verification plan item 3 and task 4.2 run attempt 1 cold with `Acquire::http::Dl-Limit=25`. The expected
     result is attempt 1 killed at about 90 s, then attempt 2 succeeding.
   - A second run throttles both attempts and must end in the named error at about 180 s.
   - Both say explicitly: "A dead/silent mirror is not acceptable evidence."
4. **Save rule matches the spec, and the PR-ref cache entry is removed: addressed.**
   - D3 now says "Save only when `downloaded > 0` (the spec rule; pruning alone never triggers a save)".
   - `downloaded` is defined as files present after the download phase that were absent before it. The selftest
     covers both cases: prune-only -> no save, one new download -> save.
   - Verification plan item 4 and task 4.3 delete the PR-ref entry with `gh cache delete`.
   - Task 4.5 checks that `gh cache list --ref refs/pull/<N>/merge` shows no `e2e-apt-debs-*` entry. This keeps the
     MODIFIED spec scenario true at review time.

Round 1's non-blocking notes were also taken up:
- `timeout -k 10 90`.
- Copying the `ubuntu.sources` stanzas and changing only `URIs:`.
- No longer claiming a checksum reuse guarantee (D3 now says filename + size).
- Making no claim that system apt state is touched. The lists dir is redirected, so the "untouched" claim is now
  true.
- Measuring the deps step on main runs after merge (plan item 6).
- Checking `check:precommit-ci-parity` (task 3.5).

#### Fresh review

- **Ground truth for the wiring is real.**
  - `.github/actions/e2e-setup/action.yml` has the `save-node-modules-cache` input pattern, and its save condition
    is `push && refs/heads/main`.
  - ci.yml:628 passes `save-node-modules-cache: ${{ matrix.shard == 1 }}`. That is the precedent for task 3.2's
    leg-1-only input.
  - e2e-slow.yml:15 has a paths filter on `.github/actions/e2e-setup/**` (task 3.3).
  - `scripts/cache-janitor.mjs:26` has `{ name: "e2e-node-modules", re: /^e2e-node-modules-v\d+-/, keep: 1 }`.
    D6's family uses the same shape.
  - package.json:20-21 has `selftest:e2e-backend-lane` and `selftest:cache-janitor`, the wiring precedent for D5 and
    task 2.3.
- **Timeout budget.** ci.yml:678 `e2e-prod-build` `timeout-minutes: 8`, ci.yml:564 `e2e` 25, e2e-slow.yml:28 30.
  With `-k 10`, the worst case for the two attempts is 2 x 100 s = 200 s, not "3 min". It still fits:
  - Round 1 measured a healthy job at 196 s.
  - 196 - ~45 s healthy deps step + 200 s + the offline install is about 360 s, under 480 s.
  - No job timeout changes. No owner call is triggered: no timeout, image or paid-service change.
- **Coverage of the acceptance criteria and the brief.**

  | Requirement | Covered by |
  | --- | --- |
  | Both failure modes (stall, 403) | D2 + D3/D4 |
  | Before/after measurement | Plan items 1, 5, 6; tasks 4.4 and 6 |
  | 5-main-run watch item | Plan item 6, as a post-merge item |
  | CI evidence | Tasks 4.1-4.5 |

  Every task maps back to a decision. I found no scope drift: the browser cache and dropping fonts are out of scope.
- **No placeholders or contradictions.** The proposal, design, tasks and both spec deltas agree on:
  - main-only saves from one job;
  - the `downloaded > 0` rule;
  - the janitor keeping 1;
  - the named errors for a missing package list, missing sources and both attempts failing.

### Verdict: CONFIRM

The design is sound enough to implement. All four round-1 revisions are in the substance of the artifacts. The notes
below are things the executor and evaluator should watch for. None of them blocks the design.

### Non-blocking notes

- **Epoch encoding in the prune match (D3, task 2.2). This matters more than the other notes.**
  - apt names cached archives with the epoch's colon URL-encoded, for example
    `xvfb_2%3a21.1.12-1ubuntu1_amd64.deb`, while `dpkg-query` prints `2:21.1.12-1ubuntu1`.
  - xvfb (epoch 2 on noble) is in the fetched set. A naive name+version compare would prune it on every run, so:
    - every warm run would re-download it from the possibly slow mirror;
    - every main push would see `downloaded > 0` and save a new entry.
  - Add a selftest case with an epoch-bearing version. Verification plan item 4 ("zero .deb downloads") should
    catch this on CI too.
- **`partial/` directories.** apt refuses to run when `<Dir::Cache::Archives>/partial` or
  `<Dir::State::Lists>/partial` is missing, and it only creates these automatically under its standard roots. D3
  drops `partial/` before the save, so the restored dir will not have it. The script should `mkdir -p` both
  `partial/` dirs before every apt call.
- **Worst-case wording.** D4's "worst case total = 2 x 90 s = 3 min" leaves out the 10 s kill grace on each attempt.
  The true bound is 200 s. It still fits the 8-minute budget; just fix the number.
- **Sandbox warning.** apt's `_apt` sandbox warning on a runner-owned archives dir is listed as cosmetic. Make sure
  the script does not treat apt's stderr warnings as a failure.
