## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `98327f763c955d67d7a85090728461b9edf29599` against the live-resolved base `fba0d78f88db1523b4afbe957fa363d4994047ae`
(`resolve-review-base.sh`, exit 0). Spawn guard: `READY ambient=/home/matt/Development/helio branch=bug/orphan-repair-e2e-flake/HEL-1289`.

### What I verified (with evidence)

- **Scope.** `git diff --stat base...HEAD` lists only `e2e/hel1260-orphan-owner-repair.spec.ts` (+25/-16) and the change dir.
  `git diff --stat` restricted to `playwright.config.ts .github frontend backend` is empty, so there is no product change, no
  config or CI change, and HEL-1294 is untouched. No quarantine entry was added.
- **Root cause, re-derived by my own classifier** (`scratchpad/skeptic-final/sk_classify.py`), run over the Planning probe's
  traces (`scratchpad/probe1/results`, 20 traces, 10 with `error-context.md`). Both `_monotonicTime` and action `startTime` are
  in ms, which I checked by printing the raw values from a trace: action 1367.417 sits next to snapshot 1368.069. The results:
  - All 10 FAILs sent the repair POST from `/` **before** the dashboard `goto` (-4.9 to -23.7 ms).
  - Of the 10 passes, 2 were a genuine explicit open (+842/+843 ms, after the new page's own `GET .../panels`). The other 8 were the
    old `/` page's in-flight POST (+0.7 to +29.8 ms, mostly status -1).
  - That gives a 20/20 correlation between failure and a pre-goto repair. The product sent exactly one repair in every run. This
    matches `probe-root-cause.md` and its round-1 correction. The red baseline is real and, by content, attributable to the race.
- **The product is correct, checked in source.** `App.tsx:175` dispatches `fetchDashboards()` on mount. `AppRoutes.tsx:108`
  renders `PanelList` at `/`. `PanelGrid.tsx:67` calls `useStoredLayoutRepair`. So an owner landing on `/` with the board
  auto-selected does "open" it, and design.md's argument (HEL-1233 D4 / HEL-1260) holds. No second product bug needs escalating.
- **Assertion strength (owner ruling).** I read the diff line by line:
  - The `expect.poll(... ,{timeout: 15_000}).toBe(1)`, both `toHaveCount(1, {timeout: 15_000})`, the four-breakpoint body-key
    check, all-breakpoints-stored, no "Unsaved changes", the 2 px reload checks, final `repairPosts` length 1, `layoutPatches`
    length 0 and the exact-id `finally` delete are all unchanged.
  - Several checks are stronger:
    - The listener is attached before login, so the count covers the whole page lifetime.
    - There is a new `expect(repairPosts).toHaveLength(0)` before the goto.
    - The repair URL is pinned to the seeded id.
    - The PATCH filter is widened to any `/api/dashboards/`.
  - No timeout was changed. The UI-create test gets the same isolation, and its `repairPosts` length-0 check now also covers the
    whole lifetime.
- **Fix mechanism.** `page.goto("about:blank")` runs after `registerAndLogin`, before any API seeding. At login the fresh user owns
  no dashboards, so `/` cannot repair anything before it is unloaded. During seeding no app document exists.
- **N>=20 consecutive green, my own run.** On this lane's servers (`start-servers.sh` reused 6721/9628; `/proc/<pid>/cwd` resolves
  to this worktree's `frontend`/`backend`; `assert-phase.sh servers` PASS) I ran
  `DEV_PORT=6721 BACKEND_PORT=9628 nice -n 19 npx playwright test e2e/hel1260-orphan-owner-repair.spec.ts --repeat-each 20 --workers 2 --trace on`.
  Result: **80 passed (3.8m), exit=0**, 80 checkmarks and 0 failed/flaky lines. That is 20 consecutive green runs of the spec file.
- **Isolation, from my own trace parse of those 80 traces:**
  - Every trace has exactly one `about:blank` goto.
  - Zero page-frame `/api/` requests fall in the window between `about:blank` and the dashboard goto, in all 80.
  - All 40 orphan traces show exactly one repair POST. Each is status 200, classified `explicit` (after the new page's own
    `GET dashboards/<id>/panels`), at +716 to +1232 ms after the goto.
  - All 40 UI-create traces show zero repairs.
  - There were 0 `pre-goto` and 0 `old-page-inflight` repairs, against 18/20 for the old ordering in the probe. So the fix now
    actually exercises the explicit owner open, which the old spec almost never did. That is a gain in what the test proves, not
    just in stability.
- **Static checks.** `npx prettier --check` and `npx eslint --max-warnings=0` on the spec both exit 0. The evaluator's
  lint/format/typecheck output is pasted and unambiguous.

### Verdict: CONFIRM

### Non-blocking notes
- Mutation (c) (the old ordering) was not reproduced red in this session, by the executor or the evaluator. I did not run it either,
  because I am read-only and a scratch spec under `e2e/` would be a worktree write. I accept the red baseline from the probe traces
  because of content-level ordering evidence, which I re-classified independently above: red is self-authenticated by request
  order inside each trace, not by mtimes. The fix removes the race's precondition structurally, since no app document exists during
  seeding, so it does not depend on load the way the red did.
- I did not re-run mutations (a) and (b), because they need product-source mutation, which is outside a read-only gate. Their
  failability follows from the whole-lifetime counter feeding `toBe(1)` and the final `toHaveLength(1)`.
- I agree with the evaluator's polish note. At spec line 88, `expect(repairPosts[0].url).toMatch(...)` would print the URL on
  failure, where the current check prints only `true`/`false`.
- Evidence persistence: `persist-evidence.sh` refused my scratchpad artifacts ("source is not inside any git working tree").
  Writing them into the worktree would breach the read-only rule, so the load-bearing numbers are inlined above. The raw files are
  at `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/skeptic-final/`
  (`accept.log`, `accept-classify.txt`, `probe1-classify.txt`, `sk_classify.py`, `accept/` traces).
- Gate-defect check: no report reviewed here discloses unsound mtimes, and no conclusion above rests on mtime ordering.
