## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cafed670cd4732c9d205ba269c4203878f56eec3`. Base resolved live with `resolve-review-base.sh` (exit 0): `cd23c664a`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/hel1791-hel1582-e2e-hardening/hel-1830`.

### What I verified (with evidence)

- **Scope.** `git diff cd23c664a...HEAD --stat`: the only non-change-dir files are the three e2e files
  (`e2e/hel1791-compact-counter-stack-height.spec.ts`, `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts`,
  `e2e/support/apiRequestCounter.ts`). No product code and no migration. `git status --short` after my runs shows only
  the untracked `evaluation-2.md`, so no app mutation is left in the tree.
- **Item 1, the shape.** The diff replaces the shared `owner` loop with 6 owner tests, one per (theme, width). Each
  test calls `newActor` for its own principal, runs `seedBoard` on its own seven-panel board and waits for the run to
  reach a terminal state. In `finally` it calls `logRequestCount` and `deleteBoard`: dashboard first, then pipeline,
  then sources. `checkCounterCard` keeps the original geometry assertions and messages unchanged (diffed line by
  line; only the indentation and the explicit `target` changed). `openStack` no longer has a default target, so no
  owner test can fall back to the shared board. The editor tests and `measurer` stay on the `beforeAll` board.
  This goes further than the ticket's "own user per owner theme test". The pre-fix projection in
  `t1-count-unfixed-shared-owner.txt` justifies it under design Decision 1's fallback: seeding costs 17 and the first
  theme test reaches 60 cumulative, above the threshold of 50.
- **Item 1, does the counter count?** I read `playwright-core/lib/client/fetch.js`, which the worktree resolves from
  the main checkout's `node_modules`. `get`/`post`/`put`/`patch`/`delete`/`head` all call `this.fetch(...)`, so
  wrapping `api.fetch` sees every setup call. `t1-probe-context-request-events.txt` shows that
  `context.request.*` does not fire the context `request` event, so nothing is counted twice. The one-window
  cross-check in `t1-window-crosscheck.txt` gives charged 29 + remaining 89 = 118 of 120, with no rollover. That is
  an independent server-side confirmation that the counter is close to what the limiter charges; it under-counts by
  2 at most, which is conservative in the wrong direction by only 2.
- **AC1 (each owner test's count is logged; the highest is well under the limit).** I ran the full hel1791 file twice
  myself (`--workers=2`, `nice -n 19`, lane servers 7262/10169, lane DB): **10 passed** both times. The logged
  owner counts were the same in both runs:

  | Principal | max-60s |
  | --- | --- |
  | owner-light-390 | 29 |
  | owner-light-768 | 29 |
  | owner-light-1100 | 30 |
  | owner-dark-390 | 29 |
  | owner-dark-768 | 29 |
  | owner-dark-1100 | 30 |
  | owner-live-regions | 13 (uncharged=2: register plus the routed submit, as Decision 9c requires) |

  The highest is 30 of 120. The committed 20x and CPU 4x evidence reports the same: 30 at 1x and 31 at 4x.
  Logs: main checkout `.concertino/scratch/HEL-1830/skeptic-1791-run1.txt` and `skeptic-1791-run2.txt`.
  **Met.**
- **Item 1, red first.** `t1-red-burn-unfixed.txt` shows the deterministic red on the unfixed spec. The proof line is
  `STRESS-ACTIVE burn: spent 57 remaining owner requests ... 429 Retry-After=51s`, and the failure is at a
  `toHaveCount` assertion. Under the fix, `t1-isolation-control.txt` is the isolation control, and
  `t1-mutation-owner-geometry.txt` shows that the moved owner tests still red under an app mutation.
- **AC2 (a deterministic stale-tap probe shows the wait matters).** `t2b-probe-log-1x.txt` traces the reflow frame by
  frame:
  - The sheet's fresh `GET .../steps/:sid/preview` lands.
  - `step-preview__count` (152,x, 49x16) appears in the header.
  - The trigger's centre moves from x=188 to x=249.
  - The step card box does not change, and the trigger's box moves only sideways once the sheet has settled. So the
    count is the mover, not anything outside the header.

  I checked this against `StepPreviewTable.tsx:303`: the count renders only when `countText !== null`.

  `t2b-stale-tap.txt`, at both 375 and 390 width: a tap at the pre-reflow point hits `span.step-preview__count` and
  opens nothing (`opened=false`). A tap after the count is visible opens the panel (`opened=true`).

  The wait is bounded and has a message: `expect(...).toBeVisible()` with the message
  `${theme}: sheet preview header settled`. It mirrors HEL-1826's tap (a) fix a few lines above.
  `t2b-mutation-sheet-cell.txt` shows that the `step sheet` cell still reds (`dark step sheet: right inside the
  viewport`), with `git status` clean of app files afterwards. **Met.**

  Caveat, inherited from HEL-1826: as the evidence itself states, there is no natural red for the race; the
  coordinate stand-in is the evidence. I accept that standard because the ticket asks for "the way HEL-1826's did".
- **AC3 (both files pass 20 times in a row).**
  - hel1791: 20/20 in `t4-1791-20x.txt`, and my 2 fresh runs passed.
  - hel1582: runs 12-31 are 20 consecutive passes in `t4-1582-20x.txt`. My fresh full-file run gave **8 passed
    (2.7m)** (`skeptic-1582-run1.txt`).

  The first hel1582 streak was broken at run 11 by the unrelated `:527` contrast test, which hit its 240 s timeout.
  The streak was then restarted. The evidence and `root-cause.md` disclose this openly rather than hiding it. The
  diff does not touch `:527`; it touches only the `:244` test's tap (b). **Met as written.** See the notes below.
- **Static gates.** I re-ran them myself: `npx eslint --max-warnings=0` on the 3 files exits 0, and
  `npx prettier --check` is clean. The `tsc` evidence is pasted in `t4-lint-typecheck-prettier.txt` (frontend and
  `e2e/tsconfig.json`, both exit 0).
- **UI judgment.** Not applicable: there are no UI or app changes.
- **mtime evidence.** No conclusion here rests on mtime or directory ordering.

### Verdict: CONFIRM

### Non-blocking notes

- **The shared editor principal is still the next shared-window risk.** I measured max-60s of 72 in both of my runs;
  the evidence reports 73-80 at 4x. The ticket scopes the change to owner tests, and the lane reports this rather
  than changing it silently, which is correct. The follow-up candidate is one editor principal per theme test.
- **hel1582 `:527` contrast test.** One 240 s timeout under host load 11-13, with no trace kept. It is not on the C11
  list. It is a follow-up candidate if it recurs.
- **The cross-check's 2-request gap (118 vs 120) is not explained.** It is within tolerance and does not change the
  30-of-120 margin.
