## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `e2fb7aa72cc06da0cfb2ad7347e8018250d1af6c`. I resolved the base live with `resolve-review-base.sh` (exit 0): `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`, the same base as round 1.

The round-2 delta, `git diff dc43a2059 HEAD`, touches only these files:
- `DraftPreviewRoutes.scala`
- `DraftPreviewConfig.scala`
- the new `DraftPreviewResetLeakSpec`
- `DraftPreviewBoundFixture` (the `accessCheckHold` latch)
- design.md and tasks.md

I modified no tracked file. Every probe was added, run and removed by a script. The routes file was restored and checked with `sha256sum -c`, which returned OK, and `git status --short` was empty after each run.

Evidence directory: `E = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/scratch/HEL-1630/skeptic-final-2/`. I ran everything with `testOnly`, one sbt at a time, under the sbtfull lock with `nice -n 19` and `-Xmx3g`. Load average was 4 to 7.

### What I verified (with evidence)

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.

- **CR1 from round 1 (the leak on a reset before materialization) is resolved.**
  - `releasedIfNeverMaterialized` (`DraftPreviewRoutes.scala:93-106`) works as follows:
    - It is a `Pending/Materialized/Expired` compare-and-set.
    - A `mat.scheduleOnce(materializeGraceMillis)` fallback calls the idempotent `Permit.release()` (`DraftPreviewGate.scala:39-45`, `getAndSet(Released)`).
    - The service source is wrapped in `Source.lazySource`. Its factory hands over the real source only if it wins `Pending -> Materialized`; otherwise it returns `Source.empty`.
  - The walk starts only inside the inner `Source.queue`'s `mapMaterializedValue` (`DraftPreviewService.scala:101-104`). So after expiry no walk can start without a slot.
  - My `E/green.log` run passed `DraftPreviewResetLeakSpec`, `DraftPreviewAbortSpec` (3 tests) and `SkepticGraceProbeSpec`.
  - `SkepticGraceProbeSpec` used a 1 ms grace and 40 sequential requests against maxInFlight 2: `empty=0 full=40 other=0`.
    - That run never hit the expiry path.
    - It also never produced a 429, so the extra timer and the double release did not over-release or leak.

- **CR2 from round 1 (a regression spec that can fail, C3) is resolved, and I re-derived it myself.**
  - `DraftPreviewResetLeakSpec` holds `checkPreviewAccessInternal` on a latch. That is a deterministic window, not a sleep race.
  - **M1, guard removed** (`fromData(NdJson, source)`, as at `dc43a2059`): red, `429 was not equal to 200 (DraftPreviewResetLeakSpec.scala:56)` (`E/m1.log`).
  - **M2, only the grace fallback's `permit.release()` removed:** red with the same failure (`E/m2.log`). So the spec pins the fallback itself, not just the outer `watchTermination`.
  - The executor's `red-c9-reset-leak.log` and `green-c9-reset-leak.log` agree.

- **The new code adds no double release or C5 miscount.**
  - `Permit.release` is idempotent. When the timer, the outer `watchTermination` and the inner `onTerminated` all fire, only one decrement happens.
  - After the guard's releases, a third request from a principal with no access is still refused 429 while two walks hold both slots. That was the first half of `SkepticCapacityProbeSpec`. Its second half was confounded by the pekko client's 1 s entity-subscription timeout, so I do not rely on it; see the finding below.
  - **`Source.empty` after the grace period:** this path is reachable only if pekko-http materializes the entity more than 5 s after the route completes. The server is HTTP/1.1 only (`HttpServer.scala:12`, no h2 setting), and I did not observe the path in 40 tries even at a 1 ms grace. The consequence would be a silent empty 200 (non-blocking note 1).

- **Unchanged since round 1:** the ACs and C1 to C8 outside the in-flight gate.
  - The base is unchanged, and the delta touches only the route shell, the config and tests.
  - I re-read the route's ordering:
    - rate limit, then `inFlightSlot`, then the bounded read;
    - then `startRunning`, then `service.start`;
    - `service.start` itself runs `findByIdShared`, the first access check, `prepare`, then the second access check.
  - Round 1's traces of AC1, AC2, AC4, AC5, AC6, AC7 and AC8 still apply. AC3 (the server observes the abort) still holds: `DraftPreviewAbortSpec` was green in `E/green.log`.
  - The executor's full suite at this head shows 9313 passed, 0 failed (`green-cycle9-sbt-testFull.log`).
  - A separate loaded run shows 4 `DraftPreviewHeapSpec` failures (`loaded-cycle9-sbt-testFull-heap-timeouts.log`). The executor labels it as a run under load and discloses it. I did not re-run the full suite.

- **No UI views changed.** The frontend changes are services and types only, so I did not start servers. None are running.

#### Finding: a cancelled request's running slot is freed while its walk is still evaluating, so more than `maxInFlight` evaluations run at once

- **Probe:** `E/SkepticOverlapProbeSpec.scala`. It runs on the bound server with production counts (maxInFlight 2, 2 per principal).
  1. req1 is a 2-step draft. The fixture's `nodeDelayMs` makes its node b take 4 s.
  2. The client reads the first step line, then closes with `SO_LINGER 0` while node b is running.
  3. Then req3 and req4 come from the same user, held after node 1.
- **Result** (`E/overlap1.log` and `E/overlap2.log`, two runs, the same both times):
  - req3 and req4 both get `200` and emit a step line while req1's walk has not finished. There are 0 outcome lines at that moment, and req1 later logs `durationMs=4012` and `durationMs=4010`.
  - The assertion fails with `3 was not less than or equal to 2`: **three evaluations run at once on an instance whose gate is 2.**
- **Control:** with an ordinary FIN close (`E/fin/overlap1.log`), the server noticed the close only at a later write. So req1 kept its slot and req4 got 429.
- **Mechanism:**
  - The only releases are stream-termination callbacks: the inner `watchTermination` at `DraftPreviewService.scala:106-110`, and the new outer one at `DraftPreviewRoutes.scala:102-104`.
  - A cancel releases the permit at once.
  - But the walk only stops at the next node boundary (`shouldContinue`), and design.md says so: "A long node cannot be interrupted mid-node".
  - So the slot is given back for the whole rest of the node in progress, with that node's frames still live.
- **Impact:**
  - The shipped scheduler aborts every superseded request (round 1: `draftPreviewScheduler.ts:89/118/140`), at up to one send per 600 ms.
  - So during a drag over a draft whose slow node takes T seconds, one user can have about 2 + T/0.6 walks alive. Several users on one instance add up.
  - Each walk is bounded at 96 MB (C6), but the `accept-2` heap guarantee (C5, C6: 2 x 96 MB within the 192 MB budget) no longer bounds the instance.
  - This contradicts what the change says about itself:
    - design.md D7 note: "A third concurrent evaluation ... gets an immediate `429`";
    - CLAUDE.md `DRAFT_PREVIEW_MAX_IN_FLIGHT`: "Max draft-preview evaluations running at once on one instance";
    - C6: "keeps C5 accept-2 as a guarantee".
- **Not introduced this round.** The inner release-on-cancel has existed since cycle 1, and the new outer `watchTermination` releases at the same moment. No earlier gate measured it. Several owner escalations bought the heap bound this violates, so I treat it as blocking.

### Verdict: REFUTE

Category: `spec-divergence`. The C5 and C6 accept-2 guarantee, and the change's own documented contract ("Max ... evaluations running at once", "a third concurrent evaluation ... 429"), are violated on the common path: an abort that the server observes mid-node.

### Change Requests

1. **Hold the running slot (and the per-principal slot) until the walk has actually ended, not just until the stream ends.**
   - Where: `DraftPreviewService.walk` / `stream` and `DraftPreviewRoutes.releasedIfNeverMaterialized`.
   - How: release from the walk Future's `onComplete` (`DraftPreviewService.scala:198`, next to `finish()`) once the walk has started.
   - Keep the stream-termination release only for the case where the walk never started. That is the `Expired` and `Source.empty` path, plus a cancel before the lazy factory ran.
   - The cancel flag must still be set at stream termination, so the walk stops at the next boundary.
   - Keep `release()` idempotent.
2. **Add a failable spec (C3) on the bound server with production counts.**
   - Start with a request whose node is mid-evaluation (`nodeDelayMs`) and reset it with `SO_LINGER 0`.
   - Assert that, until that walk has logged its outcome, a second and a third evaluation cannot both be admitted. A third request must get `429 Draft preview busy`.
   - `E/SkepticOverlapProbeSpec.scala` is a working template.
   - Show it red at `e2fb7aa72` and green after the fix.
   - Re-run `DraftPreviewResetLeakSpec`, `DraftPreviewAbortSpec` and `DraftPreviewReadingPoolSpec` with it. CR1 must not bring back the round-1 leak: a walk that never starts must still give its slot back via the grace fallback.

### Non-blocking notes

1. **A silent empty 200.** If the lazy factory runs after expiry, the client gets a 200 with no lines. `readDraftPreviewStream` (`draftPreviewClient.ts`) treats that as success with nothing delivered. Emitting `DraftPreviewFailedLine` instead of `Source.empty` would let (e) show "preview failed" rather than nothing. This is unlikely on an HTTP/1.1 server.
2. **The timer is not cancelled on early cancel.** When the outer `watchTermination` releases before the lazy factory runs, the timer is left to fire a no-op. That is harmless.
3. **A FIN close is only noticed at the next write.** With an ordinary close, the server sees the abort only on a later line write (`E/fin/overlap1.log`: req1 ran to `completed`). AC3's spec aborts through the pekko client, which the server does see. Whether a browser abort through Cloud Run's front end reaches the backend as a reset or a FIN is unmeasured. That is worth an e2e check in (e).
4. **Round 1's other notes still stand:** a reading slot is taken before access, and 413 is returned for `EntityStreamException`.
5. **The pivot finding (evaluation-5) and HEL-1660** were already routed to the owner, so I did not judge them.
6. **Probe scope.** The persisted `SkepticOverlapProbeSpec.scala` is the RST version. The FIN control used the same file, with a plain `s1.close()`.
