## Skeptic Report — final gate (round 5, skeptic-final-5.md)

Reviewed head: cf96dd8788e3e9c6d5802183f8aed6ca425c7622. Delta under review: 0d225e632..cf96dd878 (the last CONFIRM was skeptic-final-4 on 0d225e632).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/live-output-draft-column/HEL-1632`.
- **Base:** `resolve-review-base.sh` gives 0f194882f, the same as `git merge-base HEAD origin/main`. The merge 9563a9f0a has parents 0d225e632 and 0f194882f, and `git show --remerge-diff 9563a9f0a` is empty, so the merge resolved without conflicts.
- **The merge does not undo the cycle-5 fixes.** For every file in the branch's own diff (`git diff --name-only $BASE...HEAD`), I compared the count of changed lines before the merge (old merge-base..0d225e632) with the count now (0f194882f..HEAD). They match for every file except three:
  - `e2e/hel1632-live-output.spec.ts` (376 vs 380). This is ea6b7f99a's re-indent plus the tag, and nothing else.
  - The two new report files.

  So the branch's own changes to frontend, backend and schemas arrive unchanged on the new base. The branch touches no `package*.json` and no `ci.yml`.
- **ea6b7f99a follows the @prod-build convention.** `git show ea6b7f99a` changes one file. It turns the latency test into `test(title, { tag: "@prod-build" }, async ({page, request}) => {...})` and leaves the body unchanged apart from re-indentation and one Prettier line-wrap. That is the form in e2e/README.md:89-97 and CONTRIBUTING.md (`{ tag: "@prod-build" }` and nothing else). The budgets are unchanged: `counts[0] < 100` and `max(counts[1..]) < 50`. Both CONTRIBUTING.md and README forbid relaxing a budget by moving a test to the tag, and this commit does not.
- **The tagged test is not in a serial describe (HEL-1691's rule).** The enclosing block at spec:199 is a plain `test.describe(...)`. It has no `describe.serial` and no `describe.configure` (grep finds no hits). Its `beforeEach`/`afterEach` run per test (spec:204-214), and it has no `beforeAll` and no shared mutable state other than the per-test `counter`. The test registers and seeds its own user, so it stands alone when the prod-build project splits it from its siblings.
- **Partition check:** I ran `npm run check:e2e-prod-build-projects`. Output: "clean (env unset -> dev only; env set -> guard + tagged prod-build only)".
- **CI on this exact head (run 39711300255):** the `e2e-prod-build` job ended **cancelled**. Its annotation reads "The job has exceeded the maximum execution time of 8m0s". It ran out of time during `npm --prefix frontend ci`, before Playwright started, so no test ran. The same job on main took about 3.5 min on 0f194882f and 26f6a1ede, both successful. This branch changes no package manifest, lockfile or workflow file. I read this as a runner/registry timeout, not a defect in this change. It still means CI has **not yet measured** the prod-build latency for this head.
- **Local prod-build attempt (environmental, not a verdict):** I ran `scripts/concertino/start-servers.sh` then `assert-phase.sh servers` (PASS), then under the flock `DEV_PORT=7065 BACKEND_PORT=9971 npm run e2e:prod-build`. The guard passed. Both tagged tests (the hel1631 control and hel1632) failed in their setup, before any measurement:
  - The backend log shows `CORS request rejected: invalid origin 'http://localhost:7065'`. The backend's allowed origin is pinned to the lane's DEV_PORT 7064, so the "free DEV_PORT" alternative in the script header does not work in a lane.
  - The backend was then shut down by an external JvmExitReason at 19:36:21, which gave the ECONNREFUSED/502.

  The control test fails the same way as hel1632, which confirms these are environmental. This reproduces evaluation-6's finding that a local prod-build run cannot be done within this run's rules. I stopped the servers with `stop-servers.sh`. The only throwaway user created (hel1631) was deleted by the suite's own cleanup. hel1632's registration returned 502, so it created no user.
- **Evaluator claims:** I re-derived from source everything in evaluation-6 about the tag, the describe shape and the partition. Its prod-build latency numbers (1.3-6.7 ms) are the executor's and are not reproduced, as evaluation-6 itself says. I do not rely on them.
- **Code/UI:** ea6b7f99a and cf96dd878 change no product code or UI, so no new design judgment is needed. The UI verdict from skeptic-final-4 still applies, because the branch's frontend diff is identical (line-count parity above).
- **mtime evidence:** none was used or accepted.

### Verdict: CONFIRM

The delta is correct: the merge is clean, every cycle-5 fix survives, and the tag follows both the convention and the no-serial rule with the budget unchanged.

**Merge precondition (not a change request):** CI's `e2e-prod-build` job must be re-run and come back green on this head before merge. It is the only independent measurement of the hel1632 burst against the production build. On run 39711300255 it was cancelled during `npm ci` by the 8-minute job timeout and measured nothing.

### Non-blocking notes

- `scripts/e2e-prod-build.mjs` tells lanes to "use a free DEV_PORT instead" of stopping the servers. In a lane that cannot work, because the backend's CORS allow-list is pinned to DEV_PORT. This is upstream (HEL-1691/main) documentation and should be a follow-up, not part of this ticket.
- The `e2e-prod-build` job's 8-minute timeout leaves little headroom for a slow `npm ci`. This also belongs to main.
