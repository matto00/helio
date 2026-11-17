## Evaluation Report — Cycle 2 (evaluation-2.md)

I reviewed HEAD `2c2b75e468f26fdfbacf393058a6f6d840d648ae` against the live base
`0c699d2633e5dedbc14cb3bddaca6147dd6b6025` (origin/main). Since cycle 1, only these changed:
- `e2e/hel1562-landing-page.spec.ts`: line 92 is now `page.waitForURL("/login", { waitUntil: "commit" })`, and the
  comment is rewrapped (lines 82-85 are at most 108 characters).
- `proofs.md`: the numbers are updated for axios 1.21.1.
- `evaluation-1.md` is now committed.

### Cycle-1 change requests
1. `toHaveURL` is replaced with `waitForURL("/login", { waitUntil: "commit" })`, with no explicit timeout. The bounce
   is back on the 30 s test-timeout budget, and the comment is accurate. **Resolved.**
2. `proofs.md` AC4 now cites the 1.21.1 measurements and the 2/10 natural failure rate. The 1.20.0 caveat is gone.
   **Resolved.**

### Fresh evidence (evaluator, cycle 2, axios 1.21.1)
I confirmed axios 1.21.1 two ways:
- `node -p "require('./frontend/node_modules/axios/package.json').version"` printed `1.21.1` in the worktree.
- The dev server's `/node_modules/.vite/deps/axios.js` serves `VERSION = "1.21.1"`.

Every run used `--workers=2 --trace retain-on-failure` under nice 19. Servers were started with `start-servers.sh`
and stopped with `stop-servers.sh`. `assert-phase servers` returned PASS.

| Run | Result |
| --- | --- |
| Committed test, `-g "stale hint" --repeat-each=40` | **40/40 passed** (46.8 s) |
| Committed body verbatim under a held `/api/auth/me` (released after the seed), fonts normal / stylesheet hung / delayed 5 s, `--repeat-each=3` each | 3/3, 3/3, 3/3 passed. `authMeBeforeSecondGoto=0` in all 9 runs (AC1, AC3) |
| Whole spec file | 24/24 passed |
| Red-first, from cycle 1 on 1.21.1 (the old body is unchanged, so still valid) | forced hold: OLD failed 5/5, NEW passed 5/5. Unforced, unmodified body: 2/10 failed |

Probe source: `/home/matt/Development/helio/.concertino/scratch/HEL-1623/eval-c2-final-hel1623.spec.ts`. I copied
it into `e2e/` only for the run, then removed it by exact path.

### Phase 1: Spec Review — PASS
- AC1: zero `/api/auth/me` requests reach the page before the second navigation.
- AC2: red-first is proven, both forced and unforced.
- AC3: the test passes with the font stylesheet hung and with it delayed 5 s.
- AC4: 40/40 on 1.21.1.
- AC5: CI is still to come.
- AC6: no product code changed.
- AC7: the hel813 CI-history scan is recorded in proofs.md.
- tasks.md matches the implementation, and there is no scope creep.
- Constraints C1-C4 are honored: no retries, no timeout was enlarged, and no other lane's specs were touched.

### Phase 2: Code Review — PASS
No changed file matches `frontend/**` or `backend/**`, so none of the required gates applies. I ran these anyway, and
all pass:
- eslint on the spec (0 warnings)
- prettier on the spec and the change dir
- `tsc --noEmit -p e2e/tsconfig.json`
- `check-openspec-hygiene` (clean)

The new comment explains why the test is shaped this way, as CONTRIBUTING's comment rules ask. The waits are
ordering-correct:
- `expect.poll` uses the default expect timeout and is ordering-agnostic: the hint clear happens in the `/home`
  document before the redirect.

### Phase 3: UI Review — N/A
No trigger path changed. The behavior is covered by the e2e runs above.

### Overall: PASS

### Non-blocking Suggestions
- none
