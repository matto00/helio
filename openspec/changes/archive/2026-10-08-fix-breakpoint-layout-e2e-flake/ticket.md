# HEL-1413: Flaky e2e: hel1023-breakpoint-layout-derivation C_lg_coords_everywhere (pixel geometry) — failed on main ce08a75a1 and a PR

## Description

`e2e/hel1023-breakpoint-layout-derivation.spec.ts:394` "C_lg_coords_everywhere: no overlap, inside the container, no PATCH on view, at every width" is intermittent:

* main CI run 37850786693 on ce08a75a1 (a comment-only merge), e2e (3): `Error: C_lg_coords_everywhere light @1500 (md) P8 Divider right`. The next main run (7e1df62a6) passed.
* HEL-1299's lane saw it fail on 2 of 3 attempts on one PR head, then pass on later heads.
  It hits main as well as PRs, so it reds `ci-complete` on random merges and wastes reruns.

Iron Law: reproduce at a measured rate (cap 3–4 workers, nice -n 19), find the root cause (a race on layout settle vs measurement at width 1500/md, a resize transition, a font-load reflow, or a real layout bug), fix it, and show red→green at a sample size sized to the observed rate. Don't loosen the geometry assertion unless the root cause proves the tolerance is wrong (that's a coverage call → owner). Check HEL-1300's isolateLivePage pattern and HEL-1392 (resize remount refetch) for interaction.

## Acceptance Criteria

1. The failure is reproduced locally at a MEASURED rate (N runs, k failures stated), under contention capped at 3–4 workers, `nice -n 19`.
2. The root cause is probe-confirmed (systematic-debugging Iron Law) — named, with the evidence that confirms it and refutes the alternative candidates (layout-settle vs measurement race, resize transition/animation, font-load reflow, ResizeObserver timing, a real product layout bug for divider panels, HEL-1392 resize remount/refetch interaction).
3. A fix lands at the root cause: a PRODUCT fix if the product renders a wrong layout (stated as such); a test fix only if the product is correct and the test measures too early.
4. The geometry assertion and its ±2px tolerance are NOT loosened, and no retries / blind sleeps are added — unless the root cause proves the tolerance itself wrong, which is escalated to the owner first.
5. Red→green shown: the failure rate before, and a post-fix run count sized from the measured rate (enough runs that zero failures is statistically meaningful) with zero failures.
6. If the fix is product-side, a regression guard exists that fails with the fix reverted.

## Driver-provided evidence (claims, verified at Setup)

* Failed assertion detail from the CI log: `Expected: <= 1478, Received: 1876` for the P8 Divider right edge at window 1500 (container 1212px). 1876 = the container's right edge at window 1900 (lg, container x≈264 + 1612) — i.e. the divider was measured at its lg pixel geometry after the resize to 1500, while the container had already re-measured to 1212.
* Playwright trace + error-context from that failed run, downloaded to: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1413-artifacts/home/runner/work/helio/helio/test-results` (trace extracted alongside in `trace-x/`) (see tasks.md).
* Precedents: HEL-1300 isolateLivePage; HEL-1215 (settle render before measuring — test-only, root-caused); HEL-1298 (load-sensitive e2e; cap concurrency).
* CI: 4 weighted shards (HEL-1361); this spec runs in leg 3 with 2 workers.
* Concurrent lanes: HEL-1299 (ci.yml — do not edit), HEL-1402 (backend pipeline create validation).
* Driver follow-up (claims, partly verified): HEL-1299's PR #860 (merged) saw the same `@1500 (md) P8 Divider right` failure in 3 of ~8 e2e (3) attempts — twice on head 8fdbc0bf, once on 55e0989; reruns passed. Verified: run 37831042947 (8fdbc0bfa, failure) and run 37849903434 (55e0989bc, final attempt success) exist on that branch — the failing attempts are earlier attempts of those run ids (`gh run view <id> --attempt <n> --log-failed`). Unverified claim: failing attempts finished the test in ~11.5 s vs ~26 s when passing (it fails EARLY — suggests the assertion fires before layout settles or a different code path, not a slow timeout). The same shard passed on the last 11 main runs before ce08a75a1.
