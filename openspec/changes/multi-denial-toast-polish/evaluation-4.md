## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed HEAD: ded407461e2e2e86030bd43a3da85c38dc7e75cf. Base: 8abb826b745e81afc13419ea26772c71faf0652a (origin/main), resolved live. This cycle's delta is 046206108..ded407461.

### Phase 1: Spec Review — PASS
- The delta touches test code only: `e2e/support/multiDenialSeed.ts`, `e2e/hel1172-multi-denial-toast.spec.ts`, and evidence files.
- `git diff 046206108..HEAD -- frontend backend schemas` is empty. No product CSS or TSX changed, so cycle 3's live and pixel verification of the cue still applies unchanged. No live re-check was needed.
- All acceptance-criterion coverage carries over from evaluation-3.

### Phase 2: Code Review — PASS
**CR1 from evaluation-3 (the spec's runtime risked a CI shard-leg timeout) is resolved.**
- Each pipeline is now created by one transactional `POST /api/pipelines` carrying the root, 21 `assert` steps (each with a `clientId`) and the table Output. The per-step and per-output POSTs are gone.
- I measured this myself, single worker on the lane DB: "Running 16 tests using 1 worker", 16 passed in 1.7 min. The test durations sum to 100.1 s, against 575.5 s in cycle 3.
- No test now pauses on the rate limit; each six-pipeline test takes about 5–6 s. This matches the executor's `evidence/timing-after-single-worker.txt`.

**The denial still fires.** Every test depends on the multi-denial toast appearing. Test 1 also asserts the "Run to update" control's accessible description matches `/too many steps/`, which is the `steps-above-bound` copy, and it passed.

**Every test and assertion is kept.**
- The same 16 test titles passed in cycle 3 and in this cycle (a sorted diff of the titles is empty).
- The only removed `expect` line is the weak `not.toContain(cue.surface)`. It is replaced by a channel comparison: the shadow's `color(srgb …)` against the card's `rgb(…)`, which must differ by more than 0.3.
- In my run the measured gap is about 0.87 in light (shadow 0.129 vs surface 1.0) and about 0.80 in dark (0.949 vs 0.149). The check would fail if the shadow used the surface colour, so it is now a real check.

**Gates (my own fresh runs on ded407461):**
- `npm run lint`, `npm run typecheck`, `npm run format:check` and `check:e2e-types`: all exit 0.
- jest (3 workers) on the toast and denial files plus `elevationTokenGuard`: 14 suites, 176 tests passed.
- Full spec at `--workers=2`: 16/16 passed in 1.8 min. Servers were restarted fresh with `DATABASE_URL` set to the lane DB, `DB_USER`, and an empty `ANTHROPIC_API_KEY` exported in the same command, and every Playwright run used the same environment.
- Teardown deleted all 19 recorded users on both runs, and no registry directory is left behind.

**Issues:** none.

### Phase 3: UI Review — PASS (carried over)
No UI file changed since 046206108. Evaluation-3's live checks still hold for this HEAD:
- the pixel-diff proof of the cue in both themes at 390x844, 1366x640 and 1440x900, including a clip falling in an inter-row gap;
- focus staying clear of the fade;
- first-row alignment;
- no paint over the toast border.

### Overall: PASS

### Non-blocking Suggestions
- `e2e/shard-weights.tsv` still has no row for this file, so the shard planner gives it the 61 s default. At about 100 s of test time that is now close enough to be harmless. Regenerate the row from CI artifacts at the next routine weights refresh.
- For the skeptic, carried over: the shadow band stops about 45 px short of the card's right edge, because it spans the list frame only. The icon now sits below the close button at 390 px.
