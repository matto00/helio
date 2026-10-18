## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `dc43a2059c64200fc4dcb1cfb6b06ab40355a797`. Base resolved live with `resolve-review-base.sh` (exit 0): `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec`. The only untracked file was `evaluation-5.md`. I modified no tracked file.

Evidence directory: `R = /home/matt/Development/helio/.concertino/runs/HEL-1630/evidence/.concertino/scratch/HEL-1630/skeptic-final/`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.
- **Owner rulings:** each is present in `.concertino/runs/HEL-1630/events.jsonl` as a human `escalation.answered` event.
  - Line 5: `owner-or-editor`, `never-read-sources`.
  - Line 13: `row-budget`.
  - Line 18: `extend-design-gate`.
  - Line 37: `accept-2`.
  - Line 45: `structural-bound`.
  - Line 54: `extend-one-cycle-fix-here`.
  - Line 63: `extend-one-more-cycle-narrow-fix`.
  - I did not re-open any of them.
- **Limiter and its exemption (AC2):**
  - I read the diff of `ApiRoutes.scala` and `RateLimitDirective.scala`.
  - `DraftPreviewRoutes.isDraftPreviewRequest` and the route use the same `PathShape`.
  - The general `/api` wrap passes `exempt = DraftPreviewRoutes.isDraftPreviewRequest`.
  - The route applies its own `RateLimitDirective` inside `authenticate`, so `confineScopedToken` and CSRF still wrap it.
  - `DraftPreviewLimiterAuthSpec` covers the 121st request getting 429, the general probe keeping its budget of 3, near-miss paths still being counted, a scoped PAT getting 403, a missing or wrong CSRF header getting 403, and an unauthenticated request getting 401. I read it and it matches the AC.
  - I relied on evaluation-5's pasted, fresh `testFull` (9312 passed, 0 failed) for these being green, and did not re-run them.
- **Access and never-read (C1, C2):** `DraftPreviewService.start` runs `findByIdShared`, then `checkPreviewAccessInternal(requireEditor = true)`, then decode and plan, then `checkPreviewAccessInternal` a second time immediately before the stream. The engine's context is replaced by `DraftPreviewStandIns.draftContext`, and secondaries resolve only from `req.sources` that have `complete = true`.
- **Abort and the in-flight gate (AC3, C5):** I read `DraftPreviewRoutes.inFlightSlot`, `DraftPreviewGate` and `DraftPreviewService.stream`. This is where the blocking defect is (below).
- **Client:** `draftPreviewScheduler.ts` aborts the in-flight request on every new send (`:89`, `:118`, `:140`). Debounce is 350 ms and the floor is 600 ms. `draftPreviewDrag.test.ts` asserts at most 100 sends during the drag.

#### Probe: a client that resets its connection before the route completes leaks the in-flight slot permanently

- **Probe spec:** `R/SkepticLeakProbeSpec.scala`, run through the evaluator's own add, run and remove harness (`R/leak.json`, `run.py`). The file was removed afterwards and `git status` is unchanged.
- **Setup:** it extends `DraftPreviewBoundFixture`, so it runs against a real bound server, with `maxInFlight = 2` (the production default) and `maxInFlightPerPrincipal = 2`.
- **The abort:** over a raw socket it writes a complete, valid draft-preview POST, waits `delay` ms, and closes. It runs in two modes:
  - `fin`: an ordinary close;
  - `rst`: `SO_LINGER 0`, so the close sends a TCP reset.
- **The check:** after 3 aborts, a normal request is sent.
- **Run 1** (`R/run-leak.log`, the full sweep of fin and rst, rows 1 and 5000, delay 0 to 60 ms; the spec stops at the first leak):
  - **`fin`:** every combination was still `200` after the aborts.
  - **`rst`, rows 1, delay 0:**
    - after 3 aborts, `status=429 body={"message":"Draft preview busy"}`;
    - still `429` 5 s later;
    - **a different principal (`userB`) also gets `429 Draft preview busy`**;
    - `outcomesLogged=1` (the baseline only), so none of the aborted requests ever started a walk.
- **Run 2** (`R/run-leak2.log`, rst only, different parameters: rows 5000, delay 4 ms): the same result. The aborted requests' walks never ran, and both userA and userB get `429` after 5 s. **The result is stable across two runs and two parameter sets.**
- **Mechanism (code):**
  - `inFlightSlot` keeps the permit whenever the route completes with a chunked 200 (`DraftPreviewRoutes.scala`, the `result.transform` case `Success(RouteResult.Complete(resp)) if ... isChunked()`).
  - The only release after that is `watchTermination` inside `DraftPreviewService.stream`, and that runs only if the response entity `Source` is materialized.
  - When the connection is already gone by the time `service.start`'s future completes (it does two access reads plus decoding), pekko-http drops the response without materializing its entity.
  - So `watchTermination` never fires, the walk never starts and `permit.release()` is never called.
  - The permit is already in the Running stage (`startRunning()` ran after the body was read), so it holds one of the instance's two running slots for the life of the process.
- **Impact:**
  - Two such disconnects, from any authenticated principal, take draft preview out of service for **every user on that instance** until restart.
  - Two from one user lock that user out permanently.
  - This is reachable by accident: the shipped scheduler aborts every superseded request, and a client crash, network drop or proxy reset ends in a reset.
  - It is also reachable deliberately: it is a trivial denial of service by any signed-up user.
  - C5 states that "the instance slot is held only during evaluation". That is violated: this slot is held with no evaluation at all, forever.
  - No existing spec covers this path. `DraftPreviewAbortSpec` only aborts after the stream is materialized (`firstLine` has already been read).

### Verdict: REFUTE

Category: `spec-divergence`. C5 and the D5 design say the slot is released on every exit, and an AC3-adjacent abort path leaks it permanently.

### Change Requests

1. **Release the in-flight permit when the response stream is never materialized**, in `DraftPreviewRoutes.inFlightSlot` and `DraftPreviewService.stream`. Today the only post-route release is `watchTermination`, which never runs if pekko-http drops the response because the client already reset the connection. Make the permit's lifetime independent of materialization. Some acceptable shapes:
   - a materialization `Promise` plus a short scheduled fallback that calls the (already idempotent) `permit.release()` if the entity has not been materialized within N seconds;
   - or don't move to Running, and don't count the slot as held for the walk, until the entity is materialized, with the reading-stage slot released on the same fallback.

   Whichever you pick, a request whose stream is never materialized must give back both its running or reading slot and its per-principal slot.
2. **Add a failable regression spec (C3)** in the bound-server fixture:
   - Several draft-preview POSTs, each closed with a TCP reset (`SO_LINGER 0`) right after the body is written and before the response. My `SkepticLeakProbeSpec.scala` is a working template.
   - Then assert that both the same principal and a different principal get `200`, not `429 Draft preview busy`.
   - Show it red at `dc43a2059` and green after the fix. To make the window deterministic rather than a timing race, a hook that delays `service.start`'s completion (for example on the second access check) is better than a sleep.

### Non-blocking notes

- **The gate is taken before authentication-dependent access.** Any authenticated user, even one with no access to the pipeline, holds a reading slot while uploading. That is 8 instance-wide reading slots, with a 10 s `ReadTimeout`. A handful of accounts trickling bodies can keep the endpoint busy for everyone on an instance. Consider a shorter read timeout, or bounding the reading stage per principal more tightly. This is not a REFUTE on its own.
- **Requests refused by CSRF, `confineScopedToken` or authentication on the exempt path are charged to no bucket.** The general limiter skips them and the route's own limiter sits behind `authenticate`. This is consistent with HEL-837's existing gap for unauthenticated requests, but it is now a slightly wider hole for scoped-PAT refusals. Worth a line in the follow-up.
- **`EntityStreamException` is mapped to 413.** A malformed chunked body is not "too large", so 400 would be more accurate.
- **The pivot finding (evaluation-5) and the `:297` catch-all (HEL-1660)** were already routed to the owner, so I did not judge them.
- **No design-gate CONFIRM was ever recorded.** The last design verdict is REFUTE (round 6), with `DESIGN_GATE_NOTE: fixed mechanically per owner extend-design-gate ruling`. I verified that ruling (events line 18), so this is noted as process only.
- **The persisted probe spec is the rst-only version (run 2).** Run 1 used the same file with the loop at `for (mode <- Seq("fin", "rst"); rows <- Seq(1, 5000))` and `for (delay <- Seq(0, 1, 2, 4, 8, 15, 30, 60))`.
