# CI evidence, PR #860 (HEL-1299)

Head under test for 1.3 / 2.3: 8fdbc0bf. Base main run: 37827833632 (6caba6b1, push, success). Prune ran on every PR backend leg
before `compile; testFull`.

## 1.3 sbt cache composition (restored `sbt-42d9636a...`, PR shard 0 report step)

| Path | Size |
| -- | -- |
| `~/.sbt` | 364 MB |
| `~/.ivy2/cache` | does not exist (`du: cannot access`) |
| `~/.cache/coursier` | 668 MB |

`~/.ivy2/cache` is absent in the restored runner in all runs observed, so it contributes nothing; no path is trimmed here (it is
harmless in the key list and the restore/save globs; a trim of the empty path is an optional later cleanup, not needed for the budget).

## 2.3 / C2: prune result (identical on all four legs, run 37831042947)

`prune-sbt-cas.sh prune` on the restored `backend-compile-v3-Linux-3596f24b...` (exact hit):

- cas: total=458 kept=258 dropped=200 dangling_links=0, 1,971,240 KB -> 94,812 KB
- ac: total=2033 kept=1899 dropped=134 (93% kept, so the task cache survives pruning), 8,476 KB -> 7,940 KB
- prune step time: 10 s / 11 s / 11 s / 10 s (legs 0..3)
- post-prune `du`: ac 7.8 MB, cas 93 MB, proc 92 KB, `backend/target/out` 174 MB, so **S = ~275 MB uncompressed** (pre-prune cas alone was 1.97 GB)
- with a changed key (later runs, restore-key fallback to the newest unpruned main entry): cas 471 -> 265 blobs, 2,034,448 KB -> 95,960 KB; ac 2155 -> 2017 kept

### "Compile and test" step seconds, legs 0/1/2/3 (job order as returned; same leg index on both sides)

| Run | leg 0 | leg 1 | leg 2 | leg 3 |
| -- | -- | -- | -- | -- |
| base main 37827833632 (unpruned restore) | 174 | 193 | 186 | 179 |
| PR attempt 1 (8fdbc0bf) | 189 | 200 | 200 | 210 |
| PR attempt 3 (re-run, 8fdbc0bf) | 195 | 196 | 208 | 183 |

Attempt 1 deltas vs base: +15 (8.6%), +7, +14, **+31 (17%)**. Leg 3 on attempt 1 was just over the C2 line (>10% and >30 s). Per skeptic note 3 it was
re-run once: attempt 3 deltas are +21 (12%), +3, +22 (12%), +4, all under 30 s, so C2 does not trip. Context: the same step on the six most recent main runs
ranges 138..233 s per leg (run 37831750269: 233/187/212/183; 37823520744: 208/196/178/195; 37821598167: 138/182/187/188; 37819723261: 213/234/220/165;
37817362940: 149/153/210/205), so single-run differences of this size are within main's own run-to-run noise. No full recompile (exact key hit on 8fdbc0bf; no
compile lines), all four legs green, S far below the 5 GB projection threshold.

### Steady-state projection (recomputed, design.md formula)

compile 2 x S (0.28 GB uncompressed, compressed entry is smaller) + sbt deps 0.9 GB + CodeQL 2 x 0.16 + 2 x 0.005 + npm main keys ~0.3 + setup-sbt 0.05 +
transient ~= **~2.1 GB** (limit for C2: 5 GB; target 6 GB).

## Flake note (not caused by this change)

e2e (3) failed `e2e/hel1023-breakpoint-layout-derivation.spec.ts` (pixel-geometry assertions, e.g. "A_lg_only light @1500 (md) P8 Divider right", later
@400/@1200 variants) on attempts 1 and 3 of run 37831042947 and passed on attempt 2 (and on the two later PR runs). Main runs on 6caba6b1 and earlier passed that shard. The
change only touches cache steps, so no mechanism connects it; flagged for the driver rather than fixed here.

## 6.1a AC3: PR touching `backend/build.sbt` (commit 7ac2dcec, run 37834820053, all green)

All legs restored `sbt-42d9636a...` (partial, restore-key) and a `backend-compile-v3` fallback entry; none saved anything. `gh api ... caches?ref=refs/pull/860/merge`
after that run (`ac3-pr860-cache-listing.txt`): exactly one entry, `Linux-X64-java21...-sbt-diskcache-1.5.3-...` 51,298 bytes, written by `sbt/setup-sbt` (its key
includes the build.sbt hash; 4 legs raced and 3 logged "Unable to reserve cache"). No `sbt-<hash>` and no `backend-compile-v3-*` entry, and nothing 900 MB-class.
The setup-sbt entry is 51 KB and is deleted by cache-cleanup-pr on close.

## 6.1b incremental compile from a pruned entry (commit ed1f679c, run 37836314086, all green)

Comment added to `backend/src/main/scala/com/helio/domain/package.scala`. Every backend leg: restored the fallback entry, pruned (cas 471->265, ac 2155 -> 2017 kept), then
`[info] compiling 1 Scala source to .../helio-backend/classes ...` / `done compiling` (all four legs). Incremental, not a full recompile. Compile and test
seconds that run: 215/177/182/187 (build.sbt run) and 175/123/205/217 (src run).

## Revert

Both temporary commits are reverted (aba0086d, 41de83ec); `git diff 8fdbc0bf -- backend` is empty.
