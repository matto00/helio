## Skeptic Report — final gate (round 6, skeptic-final-6.md)

Targeted re-check of the one generated file changed since skeptic-final-5 CONFIRMed e2de6fd55.
Reviewed HEAD: 15f1b5e598d3034b149d404ea2cf2e350b090a8c (also the PR #1050 head).

### What I verified (with evidence)

- **Scope.** `git diff e2de6fd55 HEAD --stat -- . ':(exclude)openspec/changes/archive'` lists one file:
  `e2e/shard-weights.tsv` (65+/39-). The full diff adds only the archived evaluation-6 and
  skeptic-final-5 reports. `git diff e2de6fd55 HEAD --name-only -- frontend backend schemas` returns
  0 files, so the product invariants confirmed in round 5 are unchanged. The only header change is
  the `# Runs:` line, now `38982340014 38984979723`. The table went from 40 data rows to 66.
- **Provenance, from artifacts I downloaded myself.** I ran `gh run download -p 'playwright-json-shard-*'`
  for 38982340014, 38984979723 and 38987195427 into `.concertino/scratch/HEL-1573/art-sk6/`. Each
  run has 4 `results.json` files. `gh run view` gives:
  - 38982340014: main, 95b3c9fd9, push, success
  - 38984979723: this branch, 400dbd24a, pull_request, success
  - 38987195427: main, d777803c1, failure
- **Byte-identical regeneration.** `node scripts/e2e-shard.mjs weights art-sk6/38982340014 art-sk6/38984979723`
  exited 0. Its output matches the committed table under `cmp`, and both files have sha256
  `841a2926...2fa75`. The table was not hand-edited.
- **The rejection is real.** The script refuses 38987195427 with exit 1 and
  `shard playwright-json-shard-3 report has unexpected=1`, both on its own and when combined with
  the two good runs.
- **Using this PR's own run as a weight source is not circular or distorting.**
  - The weight is the median over runs, which for two runs is the mean. I summed per-file test time
    for the 64 files present in both runs: main 3965 s, PR 3942 s. The PR run shows no systematic
    inflation (the motion work did not slow the suite).
  - Per-file differences go both ways. Examples: hel813 130→182 and hel1023 83→128 went up;
    hel516 98→58 and hel1444 167→117 went down. This looks like contention from which files share
    a leg, not a bias tied to the branch.
  - The PR run is the only possible source for the two specs this branch adds
    (hel1573-motion-primitives 206 s, hel1573-motion-grid-chart 40 s), because main has neither.
    Its other effect is to smooth single-run noise, which is the purpose of the median.
- **The script and its guards are unchanged.** `git diff origin/main...HEAD -- scripts/ .github/`
  touches only `scripts/check-tokens.mjs` (+5), which predates e2de6fd55 and was reviewed in
  round 5. `git log origin/main..HEAD -- scripts/e2e-shard*.mjs` is empty. I read
  `scripts/e2e-shard.mjs` in full: `validateRunReports` (lines 172-187) and `verifyExactlyOnce`
  (90-102) are intact. `npm run check:e2e-shard:selftest` passed all 15 cases, RED cases included.
  The base, resolved live with resolve-review-base.sh, is d777803c1.
- **The plan partitions every file exactly once.** `plan 4` exited 0. The four legs hold
  14+17+19+18 = 68 files, 68 unique and none duplicated. Weighted loads are 1068, 1069, 1068 and
  1067 s. There are no stale rows. Only the two HEL-1578 specs are defaulted, which is expected
  because their only run was rejected.
- **The legs fit the 18-minute job limit (`ci.yml:553 timeout-minutes: 18`).** Real data from the
  artifacts:
  - With `fullyParallel: false` but `describe.configure({mode:"parallel"})` in hel1575, the two
    workers split each shard evenly (for example 893/898 s). Wall time is about half the summed
    test time: PR shard 1 summed 1792 s and ran 902 s.
  - Job overhead outside Playwright is about 3 min: that shard's job ran 17m56s for 902 s of
    Playwright, which is the near-cancellation case.
  - A planned leg of about 1068 s summed should take about 535 s of Playwright plus 3 min, roughly
    12.5 min.
  - Correcting the worst underweighted spec still fits (see the note below). Leg 4 at about 1270 s
    summed comes to roughly 14 min.
  - hel1575 (700 s), previously on the 17m56s leg, now shares leg 1 with only 368 s of other
    weight.
- **CI on PR #1050 at 15f1b5e59** (informational, not blocking). The PR is OPEN and MERGEABLE.
  - Passed: CodeQL (all Analyze jobs), security, docker-image.
  - In progress: frontend, backend (0-3), e2e (1-4).
  - Skipped: label-update-type.
  - I make no merge-readiness claim.

### Verdict: CONFIRM

### Non-blocking notes
- `hel1578-home-changed-dot.spec.ts` is defaulted to 35 s, but it measured 240 s in shard 2 of
  38987195427 (that shard was clean; the failure was in shard 3). Leg 4 is therefore about 205 s
  of summed time, roughly 100 s of wall time, heavier than planned. It still fits the limit. The
  HEL-1578 specs were unweighted on main as well, so this PR did not cause it. Regenerate from a
  green main run that includes HEL-1578 after merge, as evaluation-7 also suggests.
- evaluation-7.md is untracked in the worktree at review time. It is not part of HEAD.

### Evidence
- Downloaded artifacts: /home/matt/Development/helio/.concertino/scratch/HEL-1573/art-sk6/
- Regenerated table and plan: /home/matt/Development/helio/.concertino/scratch/HEL-1573/sk6-out/{regen.tsv,plan.txt}
- Both are self-authenticating (sha256 and `cmp`). No claim here rests on mtime ordering.
