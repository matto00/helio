## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `136cef6a08510b990a16d885516a06b42f566122`. I resolved the base live with `resolve-review-base.sh` (exit 0): `cd23c664a76f9e51ad0d934bf0f860684ca47ba1`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/hel1791-hel1582-e2e-hardening/hel-1830`.

### What I verified (with evidence)

- **Scope.** `git diff --stat BASE...HEAD` shows only three files outside the change dir:
  - `e2e/hel1791-compact-counter-stack-height.spec.ts`
  - `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts`
  - `e2e/support/apiRequestCounter.ts`

  There is no product code and no migration. `git status --short` shows only the untracked `evaluation-3.md`, so no app mutation was left behind.
- **Red-first ordering, from git history (not mtimes).**
  - Item 1: the counter and the red `t1-red-burn-unfixed.txt` came in `21a4c7d6f`, before the owner fix in `e61b89e49`.
  - Item 2: the stale-tap probe came in `e61b89e49`, before the wait in `bb0f438a2`.
  - Fold-in: the red `t6-red-burn-shared-editor.txt` came in `7202c4d80`, before the editor change in `da3992796`.
- **The counter counts what it claims.**
  - I read `/home/matt/Development/helio/node_modules/playwright-core/lib/client/fetch.js:88-120`. `get`, `post`, `put`, `patch`, `delete` and `head` each call `this.fetch(...)`, so the instance-level `api.fetch` wrapper sees every setup call.
  - Page traffic comes from `context.on("request")`. The committed probe `t1-probe-context-request-events.txt` shows that `context.request.*` does not fire that event, so nothing is counted twice.
  - My runs show `uncharged=1` (register) on every principal, and `uncharged=2` on owner-live-regions (register plus the routed submit). That is the Decision 9c behaviour.
- **AC1: each owner test's count is logged, and the highest is well under the limit.** I ran the full hel1791 file twice (`--workers=2`, `nice -n 19`, lane servers 7262/10169, lane DB): **10 passed (48.5 s)** and **10 passed (44.5 s)**, both exit 0. Every owner test logs a `REQUEST-COUNT` line:

  | Principal | Run 1 max-60s | Run 2 max-60s |
  | --- | --- | --- |
  | owner-light/dark-390 | 29 | 29 |
  | owner-light/dark-768 | 29 | 29 |
  | owner-light/dark-1100 | 30 | 30 |
  | owner-live-regions | 13 | 13 |

  The highest is 30 of 120, with zero 429s. The per-(theme, width) shape goes beyond the ticket's wording. It is justified by the recorded pre-fix projection (`t1-count-unfixed-shared-owner.txt`: 17 + 43 = 60 > 50) under Decision 1's fallback. The geometry assertions moved into `checkCounterCard` unchanged; I compared them line by line in the diff. **Met.**
- **Fold-in AC: one editor principal per theme test, each logged, highest at most 60 at 1x and 4x.**
  - In code, each editor test does `newActor(browser, "editor-${theme}")` and is granted `editor` on the beforeAll board through `boardOwner.context.request`. The shared `editor` principal is gone, and the editor-only caption check still runs.
  - In my runs, editor-light/editor-dark were 41/41 and 40/41, the board owner 19, and the measurer 37/38.
  - Committed evidence, per-principal tallies I grepped myself:
    - `t6-1791-20x.txt`: 20/20 runs passed, editor max 41.
    - `t6-1791-throttle4x.txt`: 51 STRESS-ACTIVE lines, editor max 41.
    - The board owner is 19 throughout.

  **Met.**
- **AC2: a deterministic stale-tap probe shows the wait matters.**
  - `t2b-probe-log-1x.txt` traces the sheet's fresh `GET .../steps/:sid/preview`. `step-preview__count` appears, the trigger's centre x moves 188 -> 249, and the step-card box does not change, so the count is the mover.
  - `t2b-stale-tap.txt`, at 375 and 390 wide: a tap at the pre-reflow point hits `span.step-preview__count` and gives `opened=false`. A tap after the count is visible gives `opened=true`.
  - I checked this against `frontend/src/features/pipelines/ui/spine/StepPreviewTable.tsx:204-209,303`: the count renders once the preview's row count is known and there is no error. On this seeded pipeline the wait therefore has a real precondition.
  - The wait is bounded and has a message (`${theme}: sheet preview header settled`), and it mirrors HEL-1826's tap (a).
  - `t2b-mutation-sheet-cell.txt` shows the cell still reds.

  **Met.**
- **AC3: both files pass 20 times in a row.**
  - hel1791: `t6-1791-20x.txt` has 20/20 passes after the fold-in.
  - hel1582: `t4-1582-20x.txt` runs 12-31 are 20 consecutive passes. Run 11 was the disclosed unrelated `:527` timeout, and Decision 11 discards it.
  - `git diff --stat bb0f438a2 HEAD -- e2e/hel1582-... e2e/support/apiRequestCounter.ts` is empty, so that 20x still describes the code under review.
  - My fresh full hel1582 run: **8 passed (2.6 m)**, exit 0.

  **Met.**
- **Residue.** After my runs, a lane DB query counts `hel1791%` users, `HEL1791%` dashboards, `HEL1791%` pipelines and `HEL1791%` data sources: 0|0|0|0. The global teardown reported "deleted 11 recorded throwaway user(s)".
- **Static gates (fresh).** All exit 0:
  - `eslint --max-warnings=0` on the 3 files
  - `prettier --check`
  - `npm run check:e2e-types` (`tsc -p e2e/tsconfig.json`)
- **UI judgment.** Not applicable: there are no UI or app changes.
- **mtime evidence.** No conclusion here rests on mtimes. evaluation-3 orders its control run after its mutation run using throwaway-user ids embedded in content, and corroborates that independently (the caption-visible assertion passes in the control). So there is no gate defect.

Logs (main checkout): `.concertino/scratch/HEL-1830/skeptic2-1791-run1.txt`, `skeptic2-1791-run2.txt`, `skeptic2-1582-run1.txt`.

### Verdict: CONFIRM

### Non-blocking notes

- The hel1582 `:527` contrast-test timeout stays an untraced one-off (Decision 11). It deserves a follow-up only if it recurs.
- Six seeded boards per hel1791 run add a pipeline run each. The file still finishes in about 45-50 s, so this is acceptable.
