## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD e1b5c1046524f31af4fa9e32ce5673a46bd1fd7b (PR #1068). The diff base was resolved live with
`resolve-review-base.sh`: d0c600fbf (origin/main).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/home-phone-timeline-shift/HEL-1665`.
- **The merge is clean.** d0865a84d has parents c2c3a52be and d0c600fbf. `git show --remerge-diff d0865a84d` is empty, so
  there was no manual conflict resolution. The branch's diff against the merge-base before the merge (28 files,
  +2169/-15) is the same as `git diff d0c600fbf d0865a84d`, so nothing from main leaked in.
- **Round delta (d0865a84d..e1b5c1046).** It changes the ghost's `white-space: nowrap` and the 768px `normal` override
  (HomePage.css), makes the slot hold `All 0 →` (DashboardShelf.tsx), adds a CSS guard test, removes the
  `fontSwapSpread <= 4.5` assertion, and updates the docs (design.md, item2-owner-handoff.md, both spec copies,
  ticket.md).
- **Gates, re-run by me.** Home jest: 15 suites, 99 tests pass. `typecheck`, eslint (`src/features/home`, zero
  warnings), prettier on the changed files and `check:e2e-types` are all clean. e2e under the lock, 2 workers,
  `--trace retain-on-failure`, against the canonical servers on 7097/10004: hel1665, hel1642, hel1572, hel1583 and
  hel1578 gave **80/80 passed**. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final-4/e2e-sk4.log`.
  - In all 32 shift cases, `runsTopSpread`, `contentTopSpread` and `shelfTopSpread` = 0, and they are still asserted
    (spec lines 149-151, at most 0.5).
  - Local `fontSwapSpread` was 4px, and 3px at 1280. This matches the "HEAD local" column of the handoff table.
  - The C1 1280 pinned-box tests pass in both themes.
  - The 40ch/25em test logs `settledMax 600px = ch40 600px`, with 2 lines for the long sentence.
  - hel1572 is green.
- **Is the removed swap assertion honest?** Yes, for the cold-load web-font swap. The owner explicitly approved option
  (b) of escalation HEL-1665-1792365401573-a26436: "replace the fixed 4.5px assertion with a recorded measurement plus
  an honest spec bound". The data-load series still runs with web fonts loaded and is still asserted at 0px. The
  measurement is still computed, logged and written to evidence JSON. Both spec copies now disclose that HEAD is worse
  than base under a DejaVu fallback (6-8px against 4px, and 24px at 620). That residual is cold-load and
  fallback-font only. On base every load moved by the ~31px link shift plus the ~34px legend shift, so it is a net
  improvement. **Shipping that residual as disclosed would be acceptable on its own.**
- **Docs.** design.md Decision 0 now says C3. The ticket.md scope heading says "item 2 resolved by owner ruling C3".
  The two spec copies match each other.
- **Gate chain observation.** No evaluator verdict exists after fec0a6562 (event 43). In cycle 5, `phase.enter
  Evaluation` went straight to `agent.spawn skeptic` (events.jsonl, after event 92). I re-ran the gates myself (above)
  instead of relying on a PASS.
- **Visual check (settled).** Screenshots, all looked at:
  - 1280 light: `.../skeptic-final-4/home-1280-light.png`
  - 375×667 dark: `.../skeptic-final-4/home-375x667-dark.png`
  - 620 light: `.../skeptic-final-4/home-620-light.png`

  All are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final-4/`.
  The settled layout is consistent with round 3: the "All N →" link is aligned, the sentence is one line at 620 and
  1280 and two lines at 375, the cards are consistent, and there is no horizontal overflow (scrollWidth = viewport).
  This round only changes hidden elements, so there is no settled visual change.
- **Does the new nowrap keep ghost/real parity? NO, for the Mono type style (the HEL-1572 user preference).** At
  1280 with `data-type-style="mono"` the real default sentence is 2 lines (60px; 40ch of JetBrains Mono = 576px). The
  ghost is now 1 line (30px; scrollWidth 765 inside a 600px box), because `white-space: nowrap` stops it wrapping.
  - Live load probe: home-summary held, web fonts warm, rAF series of `.home-runs` top. HEAD as shipped:
    **394 → 424, a 30px shift on every load**, reproduced twice from fresh loads.
  - Control: same procedure with `.home-opening__ghost{white-space:normal}` injected (the behaviour before this
    commit): 424 → 424, 0px.
  - Sans and serif keep parity (30/30).
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1665/evidence/.concertino/scratch/HEL-1665/skeptic-final-4/mono-shift-1280.json`.
  - The same mechanism applies at every width above 768px, because the 768px block restores `normal`.
  - This is a warm, data-load shift, which is exactly what AC1 and the spec's 0px rule cover. Round 3 had it at 0px.
    e1b5c1046 introduced it, and no test covers a non-default type style, so the green suite does not see it.
  - The new comment in HomePage.css ("Above 768px the default sentence is one line with the web font") is false for
    the Mono style.

### Verdict: REFUTE

### Change Requests

1. **frontend/src/features/home/ui/HomePage.css, lines 57-59 (the ghost `white-space: nowrap`).** This breaks
   ghost/real line parity under the Mono type style: a 30px shift on every Home load at widths above 768px (measured
   394 → 424 at 1280, and 0px with the nowrap removed).
   - **The fix:** make the ghost one line only where the real default sentence provably is one line. For example,
     exclude `:root[data-type-style="mono"]`, or drop the nowrap and accept the disclosed cold-load residual. Then
     correct the CSS comment.
   - **The test:** add an e2e case in `e2e/hel1665-home-phone-stability.spec.ts` that loads Home held at 1280, under
     Mono through `seedTypeStyle(request, "mono")` plus `assertTypeStyleActive`. It must assert `runsTopSpread`
     ≤ 0.5 against Mono's own settled line count, and must be shown red on e1b5c1046. Serif may share the case.
   - **The docs:** keep the spec, design.md and handoff swap numbers accurate for whichever option you choose. If the
     nowrap goes, re-measure the DejaVu column.

### Non-blocking notes

- Removing the hard swap assertion is honest: owner-approved, the 0px data series is still asserted, and the swap is
  still recorded in evidence. The disclosed cold-load residual (HEAD worse than base under DejaVu, 24px at 605-768px)
  is acceptable to ship as disclosed. It is outside the warm 0px guarantee, and Home moved far more on base on every
  load.
- The slot holding `All 0 →` has a redundant nested `aria-hidden` (the parent is already `aria-hidden`). It is
  harmless.
- Gate chain: there is no evaluator PASS for any head after fec0a6562. The orchestrator should be aware of this
  before merge.
- PR CI for e1b5c1046 was still running when I checked (e2e shards queued or in progress).
