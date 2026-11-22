## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 8723eea65751b9ecb152c47bfbf0f5442a825709. The review base is c405b68179c46b59e3f7f06940e3acc5d2031999, resolved live with resolve-review-base.sh (exit 0).

### What I verified (with evidence)

- **Only tags and comments change in the spec.** `git diff -w base...HEAD -- e2e/hel1683-regex-main-thread.spec.ts` shows three things:
  - three `{ tag: "@prod-build" }` second arguments, plus the matching re-indent of each test body;
  - one header comment, which now says "host noise" and has a HEL-1816 note added;
  - the HEL-1697 comment, which now credits 1.1-1.3 s to the dev build and 561 ms to the production build.

  No assertion, bound, pattern, frame or wait changed. `git diff --exit-code base HEAD -- frontend backend` is clean, so there is no app change.
- **AC1, production build in CI.**
  - `playwright.config.ts:176-188`: the `prod-build` project has `grep: /@prod-build/` and depends on `prod-build-guard`. `dev` has `grepInvert: /@prod-build/`.
  - `.github/workflows/ci.yml:781` onward: the `e2e-prod-build` job runs `npm --prefix frontend run build`, serves it with `vite preview`, then runs `HELIO_E2E_PROD_BUILD=1 npx playwright test --project=prod-build`. Tagged tests are therefore picked up with no CI change.
  - My own listing: `HELIO_E2E_PROD_BUILD=1 ... --list` shows 3 hel1683 tests. The dev listing shows 0 of them, total 1077 tests in 142 files. The committed red list had 1080 in 143. Outputs are in `.concertino/scratch/HEL-1816/skeptic-list-*.txt`.
  - The margin is honestly stated as a lower bound of at least 50 ms (`evidence/margin.md`). This is correct for the Long Tasks API: it reports only tasks over 50 ms, and every window in all 5 committed prod runs and in the evaluator's own `eval-prod-run.txt` printed `(tasks: )`, with `4 passed`.
  - The PR statement and CI cost are task 4.1, the orchestrator's job after push. They are expected to be unchecked.
- **AC2, mutations red on the production build.** I read the raw runs.
  - `mutation-M1-run.txt`: the guard passed, which proves this was the production build. The HEL-1683 probe failed with `Received: 373` against `<= 100` at spec:291, which is the bound and not a timeout. HEL-1697 failed with `Received: 561` at spec:374. Result: 2 failed, 2 passed. LoAF attribution shows the hashed chunk `app-BGfXG1Qq.js`.
  - `mutation-M2-run.txt`: only HEL-1807 failed. It failed on the no-draft-preview assertion, not on timing, and this is disclosed plainly.
  - The diffs' context lines match the current sources: javaRegex.ts:196, javaRegexCost.ts:208 and stringOps.ts:138. The tree is clean now (`git status`: only the untracked evaluation-2.md).
- **AC3, the rest of the suite is unchanged.**
  - The dev list minus hel1683 is identical before and after: I diffed the committed red and green lists, and the only difference is the Total line.
  - Shard plan max leg load went from 1465 s to 1464 s.
  - The stale weight row for the moved file is reported and ignored, which is the documented behavior. `shard-weights.tsv` was not hand-edited.
- **Gates re-run by me, all exit 0:**
  - `npm run check:e2e-prod-build-projects`: "clean";
  - its `:selftest`: 11 cases passed;
  - `npm run check:e2e-types`;
  - `eslint --max-warnings=0` on the spec;
  - `prettier --check` on the spec, README and CONTRIBUTING.
- **Docs.** The e2e/README.md and CONTRIBUTING.md lines that name `@prod-build` users are accurate.
- **UI judgment:** not applicable. There are no `frontend/**` changes.
- **Not re-run by me:** a fresh production-build Playwright run. The spec's executable content is unchanged since the evaluator's cycle-1 run, whose pasted output (`4 passed`) is unambiguous. That output is backed by 3 executor runs and a recorded throttled run.

### Verdict: CONFIRM

### Non-blocking notes
- The HEL-1807 test's timing bound has no mutation that turns it red on the production build. Its own mutation, M2, reddens the routing assertion instead. That matches the original HEL-1807 mutation and the design, and it is disclosed. Still, the bound for that test is a guard that has not been shown failable.
- The throttled run has no in-output proof that the CDP throttle took effect (the evaluator noted the same). It is not load-bearing.
- On this host neither the dev baseline nor production showed any long task. The real margin evidence is the CI `e2e-prod-build` timing from task 4.1. The PR body should say the margin is a lower bound of at least 50 ms, not a precise figure.
