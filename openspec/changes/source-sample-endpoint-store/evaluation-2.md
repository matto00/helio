## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `a9ff8cbf825ac282edfce6bc5c8744109cb9cbbe`. Cycle 2 delta: `887bdb0f5..a9ff8cbf8`. Base resolved live as `d777803c1`.

### Phase 1: Spec Review — PASS
Issues: none.
- The delta changes no behaviour any spec describes. `capturedAt` is still ISO-8601, now with millisecond precision.
- Constraint C1 is still honoured. The seam spec and the shared-fixture equality test both pass unchanged. The fixtures use a fixed clock, so truncating to milliseconds does not affect them.
- Every acceptance-criteria conclusion from evaluation-1 still holds. I re-ran each one against the new commit (Phase 3 below).

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH against `a9ff8cbf8`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run check:scala-quality`: clean.
- `npm test` with HELIO_JEST_MAX_WORKERS=2: exit 0. Root: 61 suites, 524 tests. Frontend: 692 suites, 8,793 tests.
- `npm --prefix frontend run build`: exit 0.
- `sbt testFull` under the sbtfull flock with `-J-Xmx3g`: exit 0. 8,939 succeeded, 0 failed, 4 canceled. All 4 are the pre-existing measurement specs gated on `HELIO_MEASURE`. The corpus-agreement test `SampleRowJson vs the parity corpus` and all `SourceSampleRoutesSpec` cases passed, including the new `SUM(request_count)` assertion.

Cycle 1 change requests:
1. **Resolved.** `SampleRowJson.scala:29` is now `JsNumber(d)`. The output is unchanged: spray's `JsNumber(Double)` produces the same value, and the corpus agreement test is green. No inline `java.lang.` names remain in `backend/src/main/scala`.
2. **Resolved.** `SourceSampleLabel.tsx` now treats only `idle` and `loading` as waiting. A new component test asserts that the label reads "Sample unavailable" and not "Loading sample…" when the sources status is `failed`.

The executor also applied the cycle 1 non-blocking suggestions, all checked:
- **`role="status"` dropped:** no test or e2e depended on it (grep).
- **`compact` prop and `--compact` modifier removed:** the header test now selects `.source-sample-label`, and no e2e referenced the old class.
- **`SUM(request_count)` assertion added:** this makes the run-guard proof fail if a guard increments a counter on an existing row.
- **`capturedAt` truncated with `ChronoUnit.MILLIS`:** the import is at the top of the file.

### Phase 3: UI Review — PASS
I restarted the servers with `stop-servers.sh` and then `start-servers.sh` (7060/9967), so the backend serves `a9ff8cbf8`. `assert-phase.sh servers` printed PASS.
- **Executor e2e** (`e2e/hel1628-source-sample-label.spec.ts`): 3/3 pass in 31.5 s. These cover capture once, no fetch on edit, one fetch on refresh, a fresh capture after reload with nothing in storage, the four label cases in both themes, and the phone chip in both themes.
- **Unhappy path, sources list fails** (cycle 1 CR2): I mocked `GET /api/data-sources` to return 500 with `page.route`. The card now reads `"eval-static\nSample unavailable"`. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1628/evidence/.concertino/scratch/HEL-1628/eval1/c2-sources-list-failed.png`.
- **Unhappy path, sample capture fails (502):** the label reads "Sample unavailable" after one request. Refreshing from the keyboard recovers it with one more request.
- **Live API:** `capturedAt` is now `"2026-10-17T02:59:38.138Z"` (milliseconds).
- **Two-root pipeline:** 8 sample requests across 4 page loads, i.e. one per root per load.
- **Console:** no errors from this feature. The only failed requests were pre-existing (a 401 on `/api/auth/me` before login, a 404 on `/schedule` because none is set) or the 502 I injected.
- **Breakpoints:** no horizontal overflow at 1440, 1100, 768 or 390.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `IconButton size="xs"` on a card label: DESIGN.md describes `xs` as the dense-row exception, so this placement is a judgment call for the skeptic.
- The `$long` decode in `evaluator/wire.ts` (moved without changes from HEL-1581) uses `Number(...)`, so values above 2^53 lose precision on the client. This comes from the existing evaluator value model and is not in scope here; HEL-1631 may want to note it.
