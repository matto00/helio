## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `01fad7a22064ded8710876ef59a3630a75b1e18a` against the live-resolved base `626cf9852948bc5743320cf93a77f92c921f239a` (resolve-review-base.sh, exit 0).

### What I verified (with evidence)

- **Spawn guard.** assert-cwd.sh printed READY, and the branch matched.
- **AC1: the red run was committed before the fix.**
  - `git show --stat 529752708` touches only the two e2e support files and the change dir, with no CSS.
  - The committed red logs (`evidence/red-*.txt`) name the row, the actions trigger and "Test connection" failing at 1.0539 (light) and 1.0574 (dark):
    - at 1440 and 1100, all three controls;
    - at 768 and 390, the row and the trigger.
  - "Test connection" is not mounted below `TEST_CONNECTION_MENU_BREAKPOINT_PX = 1100` (`ConnectorsPage.tsx:43`), and the guard asserts that it is absent there (`toHaveCount(0)`).
- **AC2: green after the fix, both themes. I re-ran it myself.**
  - Run: all five guard spec files in full, Playwright 2 workers, `nice -n 19`, lane servers on 7237/10144.
  - Result: `40 passed (3.3m)`, exit 0.
  - The `[HEL-1805 guard] connector controls probed` line appears for each of 1440, 1100, 768 and 390, in both themes.
  - The scroll-region exemption is logged as hover-only at 390.
  - Log: `/home/matt/Development/helio/.concertino/runs/HEL-1805/evidence/.concertino/scratch/HEL-1805/skeptic-guard-all.log`.
- **The coverage assertion is real.**
  - `assertConnectorControlsCovered` checks the sampled set, which `probeView` now fills from `candidates`. It does not check the visible `docIds`.
  - The evaluator's cap=4 experiment showed it goes red at HEAD and passed vacuously at c07dd1c64. I read the code path and it agrees: `sampledDocIds` is filled only from `candidates`.
- **Mutations.** `evidence/mutations.txt` shows that reverting each rule alone turns the guard red for exactly that control in both themes.
- **AC3: CI time.**
  - `ci-impact.md` states a per-file before/after and a delta within noise. It openly says each number comes from a single run.
  - My full five-file run took 3.3 min, which is consistent with that.
  - The AC asks for the time to be measured and stated, and it is.
- **C2 (owner ruling).**
  - The `[connectors-page__scroll]` exemption is its own `isExempt` entry, with a written reason, under the `forced === "hover"` gate. Focus is still asserted.
  - The Credential/Dependents headers were root-caused with a probe (`evidence/header-rootcause.md`): `elementFromPoint` landed on the sticky `th--actions`, `:hover` was false, and the probe showed them hit-testing correctly once scrolled into view. That makes it a probe artifact, so the probe was fixed and SortableTh.css was left alone, as C2 prescribes.
  - At 390 the headers no longer fail in my run.
  - No other exemption was added.
- **CSS against DESIGN.md §5 and A.2.**
  - All three rules sit inside `@media (hover: hover)`.
  - The row moves to `--app-surface-raised`. That is the same `--app-bg` rung as the sibling `.source-list-table__row` and `.pipeline-list-table__row`, and DESIGN.md's sticky-column recipe text names raised for it.
  - "Test connection" gets the Secondary hover (border-strong, raised and full text). The trigger gets the Secondary hairline hover.
  - Both are scoped to `.connectors-page__row-actions`, so the modal's "Replace credential" is untouched (`evidence/edit-modal-replace-credential.txt`).
  - There are no hardcoded values and no new tokens.
  - `featureHoverGating` and the connectors jest suites pass (7 suites, 45 tests).
- **Probe change: is it sound for the whole guard?**
  - The change is `scrollIntoView({block:"nearest", inline:"center"})` before a forced hover. It runs only on the hover branch.
  - `backdrop` and `base` are both read before the scroll, and the verdict compares the candidate's own computed bg/pseudo/border, so the scroll changes no colour inputs.
  - Playwright's own hover already scrolled elements (edge-aligned), so this replaces one scroll with a centred one and adds no new class of side effect.
  - The only scroll-dependent style involved is the connectors sticky `td--actions` (`--left`/`--right`). That cell is not a candidate, and the trigger's backdrop is `--app-bg` in every scroll state.
  - All 40 cells in all five guard files stayed green, so it introduced no regression or new false pass that the suite can see.
  - I judge it sound.
- **Design judgment: a hovered control inside a hovered row** (live app, real mouse pointer, a two-connector account I created and then removed).
  - Dark, 1440: the hovered "Test connection" shares the row's raised fill but reads clearly through the strong border and the full-ink text, against the resting muted button in the next row.
  - Light, 1440: a white button on a white row band, outlined by the strong border, with darker text. It is distinguishable and matches how sibling tables behave.
  - The trigger hover is subtler but visible.
  - At 390 in both themes, the hovered row band runs continuously through the sticky Actions cell, with no seam. I checked the pixels at 1440 and the band has no gap either.
  - Acceptable, and consistent with the source and pipeline tables.
  - Screenshots, under `/home/matt/Development/helio/.concertino/runs/HEL-1805/evidence/.concertino/scratch/HEL-1805/`: `skeptic-dark-1440-testconn-hover.png`, `skeptic-light-1440-testconn-hover.png`, `skeptic-dark-1440-trigger-hover.png`, `skeptic-dark-390-trigger-hover.png`, `skeptic-light-390-trigger-hover.png`.
- **Other gates.** `npm run lint` (0 warnings), `format:check` and `check:e2e-types` all pass.
- **Clean-up.**
  - My throwaway user was deleted by exact id through `buildUserDeleteSql`. A count of 0 confirms it.
  - Servers were stopped with stop-servers.sh (`STOPPED ports=7237,10144`).
- **Evidence timing.** No mtime-ordering evidence was relied on. Red-before-fix rests on commit content (`git show --stat`).

### Verdict: CONFIRM

### Non-blocking notes

- `state-surface-contrast-guard.ts` around lines 390-408: the cycle-4 comment now sits above the `scrollIntoView` call rather than above the parent hover it describes. Moving the call directly under the HEL-1805 comment would tidy this, as the evaluator also noted.
- `ci-impact.md` rests on single runs. If the CI artifacts show a real delta, regenerate the shard weights from them as usual.
- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit it with the delivery artifacts.
