# HEL-1273 evidence

Every guard below was proven by a mutation: the production line was altered, the named spec(s) run
(`cd backend && nice -n 19 sbt "testOnly <spec>"`), the red observed, and the line restored from a
backup (`git diff` afterwards shows only the intended change). The specs were written together with the
implementation, so "red first" is established by mutation of the guarded line rather than by a
pre-implementation run; every mutation exercises the exact guard named.

Specs: `OutputCompareSpec` (C), `OutputHistoryRoutesSpec` (R), `OutputHistoryPublicRoutesSpec` (U),
`OutputCompareWriteValidationSpec` (W), `OutputHistoryQueryCountSpec` (Q).
Fixtures (C7): newest point T = now - 3d - 5h; points T-9d, T-8d, T-6d, T (target T-7d picks T-8d; a
now-relative target picks T-6d); no-baseline fixture earliest = T-3d, earliest+7d = T+4d, current+7d = T+7d.

| # | Guard | Mutation (production line changed) | Spec | Observed |
|---|-------|------------------------------------|------|----------|
| 4.1a | strict custom-duration regex | `if (CustomDuration.findFirstIn(d).isEmpty)` -> `if (false)` | C | RED: "reject every invalid shape" (lowercase/signed/W/M/Y reach `Duration.parse`) |
| 4.1b | `Try` around `Duration.parse` | `Try(Duration.parse(d)).toOption` -> `Some(Duration.parse(d))` | C | RED: "reject every invalid shape" (overflow/bare P throw) |
| 4.1c | 365-day cap | drop `&& dur.compareTo(MaxWindow) <= 0` | C | RED: "accept exactly 365 days and reject anything longer" |
| 4.1d | positive duration | `!dur.isZero && !dur.isNegative` -> `!dur.isNegative` | C | RED: "reject every invalid shape" (P0D/PT0S) |
| 4.2a | window target from LATEST point | `head.capturedAt.minus(w)` -> `Instant.now().minus(w)` | R | RED x3: T-8d test, limit=1 test, custom/1d test (selects T-6d) |
| 4.2b | not earliest-relative | target from `recent.last.capturedAt` | R | RED x3 (same tests) |
| 4.3a | availableFrom = earliest + w | `e.map(_.plus(w))` -> `e` | R | RED: "null baseline and availableFrom = earliest + w" |
| 4.3b | not current + w | `e.map(_ => head.capturedAt.plus(w))` | R | RED: same test |
| 4.4 | previous_run = second-newest | `recent.lift(1)` -> `recent.lift(0)` | R | RED x5 (previous_run, single point, zero/negative baseline, no-value) |
| 4.5a | `since` filter | drop `.filter(... since ...)` | R | RED: "newest limit points and honour since" |
| 4.5b | `limit` narrows points | `recent.take(limit).filter` -> `recent.filter` | R | RED x2: limit=1 test, limit/since test |
| 4.5c | sparkline oldest first | drop `.reverse` | R | RED: "points newest first and the sparkline oldest first" |
| 4.6 | non-grantee 404 byte-identical (ACL) | `outputRepo.findById(id, user)` -> `findByIdInternal(id)` | R | RED: "owner and viewer grantee, 404 a non-grantee byte-identically" |
| 4.6b | app pool really is NOSUPERUSER/non-BYPASSRLS | harness `SET ROLE` init SQL replaced by `SELECT 1` (superuser pool) | R | RED: posture test ("not bypass row-level security") and the grantee/non-grantee test (assertion throws before any 200/404) |
| 4.7a | create validates compare | `OutputService.create`: `validateConfig` -> `validateFieldMapping` | W | RED: "POST ... 400 every invalid compare" |
| 4.7b | update validates MERGED compare | `OutputService.update`: `validateConfig` -> `validateFieldMapping` | W | RED x2 (PATCH invalid; stored-invalid not bypassed by unrelated patch) |
| 4.7c | preview agrees with apply | `PatchSetPreviewProjection.outputUpdateAfter`: `validateConfig` -> `validateFieldMapping` | W | RED: preview test |
| 4.7d | PipelineService single-call + proposal grounding | drop the `OutputCompare.validateConfig` call in `validateOutputFieldMapping` | W | RED x2 (single-call create, proposal grounding) |
| 4.7e | compare check runs even with NO fieldMapping (design D2) | check guarded by `config.fields.contains("fieldMapping")` | W | RED x2 (same). A first attempt at this mutation (check moved into the `case None` arm) was mis-aimed and stayed green; it did not exercise the guard and is not counted. |
| 4.8 | explicit nulls on the wire | `common(...)` result `.filterNot(_._2 == JsNull)` | R | RED x12 incl. all three schema-seam tests and the REAL-run seam (PipelineRunService, 2 real runs) |
| 4.9 | public allow-list | public point writer gains `"triggerSource"` | U | RED: exact-key / leak-marker / schema test |
| 4.10a | count independent of history size | one extra `earliest` read per listed point | Q | RED x3: auth 3 pts app=4 priv=6 vs 150 pts app=4 priv=33; public 3 pts priv=12 vs 150 pts priv=39 |
| 4.10b | numeric bound | one constant extra `findById` | Q | RED x2: auth app=6 priv=3 = 9 > 7 (equal at 3 and 150 points, so only the bound catches it) |

## Query-count measurement vs derivation (C8, design D3)

Counting proxy on BOTH pools (app Hikari pool wrapped outermost so its `SET ROLE` init SQL is not
counted; privileged pool wrapped directly), one request after a warm-up, route scope with an
already-resolved caller. Green run output:

```
[HEL-1273 count] authenticated: 3 points app=4 priv=3; 150 points app=4 priv=3     (bound <= 7)
[HEL-1273 count] public:        3 points app=0 priv=9; 150 points app=0 priv=9     (bound <= 9)
```

Authenticated = findById 2 + findConfigById 2 (app pool) + 3 history reads (privileged) = 7. Public =
ACL owner resolution 1 + `hasPublicViewerGrant` 1 + `findAllByDashboardId` 2 + `findByIdInternal` 1 +
`findConfigsByIdsInternal` 1 + 3 history = 9 (all privileged pool). Measurement equals the derivation
exactly; no bound was changed.

## CI heap probe (cycle 2)

CI backend job OOM'd (`Java heap space`, sbt server `max 1.00GB`). Local probes in `backend/` with no server
running (`Runtime.getRuntime.maxMemory`; local default 16651386880):

- `SBT_OPTS=-Xmx3g` and `JAVA_OPTS=-Xmx3g` -> 16651386880 (not applied locally)
- thin client `sbt -J-Xmx3g` -> 3221225472; `sbt -batch -J-Xmx3g` -> 3221225472; a `.jvmopts` with `-Xmx3g` -> 3221225472

First CI attempt (21cd9f10, thin client + `-J-Xmx3g`) still printed `ans: Long = 1073741824` on the runner and
OOM'd (run 37341661099, job 111869966251): the local result did not transfer to CI's sbt runner. Retry: batch
mode plus a CI-only `.jvmopts` plus `-J-Xmx3g`, with the eval line kept as proof. The earlier statement here that
`-J` was proven by the local probe is superseded: it was proven locally only. Owner ruling
`ci-only-heap-in-this-pr` verified in the main checkout's `.concertino/runs/HEL-1273/events.jsonl`.
