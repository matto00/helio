## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `9bbb7907b62b2a1abe3c74e81ab4514a5080d980` against live-resolved base `afc2a687286a73b22660e613adef2dbb85d0d517`
(commits 2204a8009 red demonstration, 9bbb7907b fix). Diff: `e2e/hel1790-hover-probe.spec.ts` plus change-dir artifacts
and evidence. `e2e/support/hel1790Rest.ts`, `frontend/**` and `backend/**` are untouched (`git diff --quiet` on
hel1790Rest.ts: unchanged).

All of the runs below are my own. Lane servers came from `start-servers.sh` with `DATABASE_URL=...helio_hel1813`,
`DB_USER=matt` and `ANTHROPIC_API_KEY` empty. The backend log's Flyway line confirms the connection to
`jdbc:postgresql://localhost:5432/helio_hel1813`. Playwright ran with `--workers=2` under `nice -n 19`, one batch at a time,
and its global teardown deleted every recorded throwaway user. Raw outputs are in the main checkout:
`.concertino/scratch/HEL-1813/eval1-*.txt`. I did not test whether the backend fails without `DB_USER`. It came up healthy
with both variables set, and no .env was read.

### Phase 1: Spec Review — PASS
- AC1 (the root cause, with evidence): supported. I tallied the `PROBE` lines in `evidence/red-probe-run.txt` and they match
  root-cause.md exactly: cpu x1 had 0/16 misses; dark x4 4/8, light x4 2/8, light x8 1/8, dark x8 0/8. The miss series
  409 -> 298 jumps right over the 38 px band. I checked the CI trace myself
  (`scratch/HEL-1813/ci-main/tr/1-trace.trace`): click `call@15808` ended at 612014.789, `waitForFunction` `call@15810`
  started at 612026.778 and has no `after` event, and the screencast frames run every 18-45 ms through the slide. That
  agrees with the stated mechanism. The data shows misses in both themes, so the claim that theme is not the
  discriminator holds.
- AC2 (20 consecutive passes, bounded): I got 20/20 with `--repeat-each=10 --workers=2` under `nice -n 19`. The slowest
  test took **7.4 s** (dark, first per worker) and the whole run 55.0 s. The test timeout is now 60 s and every wait is
  bounded at 10 s.
- AC3 (mutation still red): yes. The `settleToRest` no-op mutation failed 10/10 (5 dark, 5 light). The `settleToRest`
  -> `noAnimations`-only mutation also failed 10/10 (5 dark, 5 light). Every one of the 20 failures is at
  `expect(early).toBe(settled)` (spec line 116, "rest read taken once the control is at rest equals the settled rest
  border"). Both mutations were reverted and the tree is clean.
- `expect(early).toBe(settled)` and its message are unchanged by the diff. There are no retries, skips or fixme. The
  per-test timeout went down (240 s -> 60 s), not up.
- The forced condition still holds. I instrumented the spec temporarily and ran 6 passing runs, then reverted. Every run
  logged `hoverAtHold=true` with `held={"top":341,"bottom":385,"state":"paused"}`, and the `top <= 250` stall fired at
  top=249 each time.
- Red first: 2204a8009 commits the probe output and the probe source as `.txt`. It does not run in CI because it is not
  a `*.spec.ts`.
- Tasks are all checked and match the implementation. There is no scope creep, and CONSTRAINTS C1-C14 were honored in
  the diff.

### Phase 2: Code Review — PASS
- Gates: `npm run lint` clean, `npm run format:check` clean, `npm run typecheck` clean and `tsc --noEmit -p e2e` clean.
  Jest and the frontend build do not apply, because no `frontend/**` or `backend/**` file changed.
- Fail-fast: I mutated the seek's animation name so the slide can never be found. Both tests failed in 14.1 s and 14.5 s
  with "the step sheet's bottom-sheet-in slide was never captured paused (motion setting or selector changed?):
  page.waitForFunction: Timeout 10000ms exceeded." Reverted.
- Design: the paused-at-start rule is installed before the click, so capture has no race. Its selector
  (`.ui-modal.bottom-sheet[open]`) matches the selector in `BottomSheet.css:23-25`. The bisection seek is deterministic,
  and the code explicitly asserts the straddle and the `paused` state before the mouse event. The waits have no leftover
  unbounded path.

### Phase 3: UI Review — N/A
None of the changed files match the Phase 3 triggers. The change is test-only. Servers were started only to run the e2e
gates, and I stopped them with `stop-servers.sh`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `evidence/root-cause.md` cites `probe-run.txt`, but the committed file is `evidence/red-probe-run.txt`. Fix the
  filename.
- `evidence/root-cause.md` says the per-frame travel at the band is "50-110 px even at natural speed". The cpu x1 data
  shows 66/50/36 px around the band, and the ~111 px jump appears only under x4 throttle. Say "36-66 px natural, up to
  111+ px throttled".
