## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9bbb7907b62b2a1abe3c74e81ab4514a5080d980` against the live-resolved base `afc2a687286a73b22660e613adef2dbb85d0d517`
(`resolve-review-base.sh`, exit 0). The diff touches one code file, `e2e/hel1790-hover-probe.spec.ts`, plus change-dir artifacts.
`e2e/support/hel1790Rest.ts`, `frontend/**` and `backend/**` are unchanged.

### What I verified (with evidence)

**Environment.** `start-servers.sh` started fresh servers (new pidfiles at 12:11) with `DATABASE_URL=...helio_hel1813`,
`DB_USER=matt` and `ANTHROPIC_API_KEY` set to empty. `assert-phase.sh servers` printed `PASS servers`. The backend log's Flyway
line reads `Database: jdbc:postgresql://localhost:5432/helio_hel1813`. So the claim that the backend needs `DB_USER=matt` is
consistent: it came up healthy with that variable set. I did not test what happens without it, and I read no .env file.
Every Playwright run used `--workers=2` under `nice -n 19`, one batch at a time. Each global teardown deleted its recorded
throwaway users. I stopped the servers with `stop-servers.sh` (`STOPPED ports=7245,10152`). Raw outputs are in the main
checkout's `.concertino/scratch/HEL-1813/skeptic-*.txt`.

**AC1: root cause stated with evidence. Met.**
- I re-tallied `evidence/red-probe-run.txt` myself: cpu x1 had 16/16 hits; dark x4 missed 4/8, light x4 2/8, light x8 1/8,
  and dark x8 0/8. That matches `root-cause.md`.
- The CI trace is in the main checkout at `scratch/HEL-1813/ci-main/tr/1-trace.trace`. `call@15810` is the sweep
  `waitForFunction`, with the predicate `top <= 360 && bottom >= 366`. It starts at 612026.778, and the trace has only 2
  records for it (the start and the before-snapshot), with no `after`. So the wait never resolved.
- The mechanism holds: the condition is sampled once per frame against a band about 38 px wide that the slide crosses, and
  the trigger then rests at top 247, where the condition can never be true again.

**AC2: 20 consecutive passes, bounded runtime. Met.**
- `--repeat-each=10` over the 2-test file gave `20 passed (55.8s)`, exit 0. The slowest single test took 7.1 s.
- The test timeout is now 60 s (it was 240 s). The diff bounds every wait in the spec at 10 s: the seek, `toBeVisible`,
  the `:hover` poll and `noAnimations`. `settleToRest` has its own 10 s reject.
- The evaluator's fail-fast evidence (`evidence/failfast.txt`) shows a broken selector failing in about 14 s with the
  diagnostic message.

**AC3: the HEL-1790 mutation still goes red, and for the right reason. Met.**
I wrote a temporary instrumented copy of the spec (`e2e/hel1813-skeptic-tmp.spec.ts`, deleted afterwards). Per run, it logged
four things: `:hover` right after the mouse move onto the held trigger, `:hover` and `top` at the moment the `top <= 250`
stall fires, `:hover` right after the early read, and the early and settled border colors.

| Variant (5 per theme each) | Result | Forced condition |
| --- | --- | --- |
| `settleToRest` -> `noAnimations` (run 1) | 9/10 red | red runs: `hoverAtHold=true`, stall fired at top 249.0x with `hover=true`. The one green run (dark) had `stall.hover=false` |
| `settleToRest` -> `noAnimations` (run 2) | 10/10 red | all 10 runs: `hover=true` at the stall |
| `settleToRest` -> no-op | 10/10 red | all 10 runs: `hover=true` at the stall, and still `:hover` at the read |
| Control: mutation, mouse moved to (195, 20), off the trigger | 10/10 green | `hoverAtHold=false`, `stall.hover=false`, early equals settled |
| Unmutated (`settleToRest`) | 10/10 green | `hover=true` at the stall, and early equals settled (the helper waits the hover out) |

- Every red run fails at `expect(early).toBe(settled)`. The early read is the hover or mid-transition border; settled is the
  rest border:
  - dark: 0.153 to 0.18 alpha against 0.09 at rest
  - light: 0.157 to 0.2 alpha against 0.11 at rest
- The off-trigger control removes only the hover. It goes fully green with the stall still firing. So the red comes from the
  HEL-1790 mechanism (the trigger is `:hover` when the slide lands), not from the hold, the seek or the release.
- The seek-then-release path therefore still creates both forced ingredients:
  - the trigger is `:hover` when it lands, because the mouse event arrives while the paused trigger is under the pointer;
  - the 150 ms stall fires at top 249 as the trigger lands.
- Combined rate for the `noAnimations` mutation: 19/20. That is above the HEL-1790 baseline of 7/10, and the evaluator also
  measured 10/10. For the no-op mutation: 10/10.

**Guard not weakened.**
- `expect(early).toBe(settled)` and its message are unchanged.
- There are no retries, `skip` or `fixme`, and the test timeout went down, not up.
- The seek asserts straddle (`top <= 360 && bottom >= 366`) and `state === "paused"` before the mouse event, so a geometry
  drift fails loudly instead of quietly removing the hover ingredient.
- The hold rule's selector, `.ui-modal.bottom-sheet[open]`, is installed before the click, so the capture cannot race the
  slide.

**Gates on the changed file.**
- `prettier --check` exit 0
- `tsc --noEmit -p e2e` exit 0
- `eslint --max-warnings=0` exit 0

**Red first.**
- 2204a8009 commits the probe source as `.txt` together with its output. It is not a `*.spec.ts`, so CI never runs it.
- 9bbb7907b is the fix.

**UI / design judgment:** not applicable. This change is test-only, with no `frontend/**` diff.

**Worktree.** I deleted the temporary spec. `git status` shows only the evaluator's untracked `evaluation-1.md` and this report.

### Verdict: CONFIRM

### Non-blocking notes
- The `noAnimations` mutation was not red on every run: 1 of my 20 runs went green, a dark run where hover had already
  cleared when the stall fired. Design Decision 5's fallback bar (at least the 7/10 baseline) covers this. The evaluator's
  claim of "every run red" is a 10-run sample, not a guarantee.
- The evaluator's notes still apply:
  - `root-cause.md` cites `probe-run.txt`, but the committed file is `red-probe-run.txt`.
  - The per-frame travel should read "36-66 px natural, up to 111+ px throttled".
