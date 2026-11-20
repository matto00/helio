## Evaluation Report — Cycle 4 (evaluation-4.md, driver C6 extra round, narrow scope)

Reviewed HEAD `015ac6d3674738687df9aecaccdc9ec56ef48653`.

The `frontend/` tree hash is `1469911a8093dee44260246f2c3edbffd6c66729`, unchanged since `c6bd8d5a8`. Commit
015ac6d36 changes only `e2e/support/modalScrollExtent.ts` (+11 lines), the change dir's evidence, and inventory.md.

### Phase 1: Spec Review — PASS

- **Evaluation-3 CR1 (vacuous phone tests): resolved.**
  - `registerModalScrollSuite` now computes `applicable` per viewport and calls
    `test.skip(applicable.length === 0, "<reason>")` before any register or seed.
  - The filter matches the loop filter exactly:
    - at 1000 px or wider, cases with `phoneOnly` are excluded;
    - below 1000 px, cases with `desktopOnly` are excluded.
  - So the skip can only fire when the loop would have measured nothing. A test that is not skipped always measures at
    least one case.
  - Per-group skip/run counts from my full run on the fix:

    | Group | Passed | Skipped | Why |
    | --- | --- | --- | --- |
    | dashboard-dialogs | 2 | 4 | only group with no phone case |
    | dashboard-panels | 6 | 0 | `panel-detail-edit` runs at all viewports |
    | pipeline-dialogs | 6 | 0 | share/schedule at all viewports, plus run-history on desktop and mobile-step-sheet on phone |
    | pipeline-editor | 6 | 0 | |
    | pipeline-palettes | 6 | 0 | |
    | shell | 6 | 0 | |

    The 2 popover guards also pass.
  - Running dashboard-dialogs alone with `--reporter=json` gives `{"expected":2,"skipped":4,"unexpected":0}`. Each
    skipped test carries the annotation `skip: no modal of group dashboard-dialogs is reachable at 375px|390px
    (desktop-only cases)`.
- **Evaluation-3 CR2 (inventory maxima): resolved.**
  - inventory.md:22 now reads "74 shell desktop, 70 shell phone, 63 palettes desktop".
  - That matches my run: the overall max window is 74, and phone shell is 70.
  - The new cycle-4 bullet explains that the earlier "6 green" in the unfixed run counted the 4 tests that are now
    skipped.
- **C15 holds:**
  - The vacuous tests are now skipped with a reason, not reported as passes.
  - Every case that is green on the rule-removed run is a labelled guard: step-palette, command-palette and the popover
    tests.

### Phase 2: Code Review — PASS

Gates:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `npx tsc --noEmit -p e2e` | exit 0 |
| `npm test` and `npm --prefix frontend run build` | run fresh in cycle 2 against this identical `frontend/` tree (617 + 10304 tests, build exit 0) |

- The settle plus `requestAnimationFrame` before `listPositioned` affects logging only. It runs after the natural
  assertion and before the injection, so neither the measured geometry nor any verdict changes. See the re-scored runs
  in Phase 3.
- The `listPositioned` timing gap is closed. In my fixed run the output-history canvas is logged at all 6 configs,
  where cycle 3 had missed 2.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on 7206/10113 against `helio_hel1774?user=matt`, with
`ANTHROPIC_API_KEY` empty and no `RATE_LIMIT_*` overrides. I stopped them with `stop-servers.sh` afterwards.

- **Fix, all six files:** 34 passed, 4 skipped, 0 failed, in 3.5 min.
  - Every `[HEL-1774 api]` line logs 0 x 429, and the max 60 s window is 74.
  - Re-scored from the logged geometry: no natural case is red, and 0 of 106 injected cases are red.
  - Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/eval4-c4-fixed.txt`.
- **Rule removed** (`Modal.css:193` deleted, then restored with `git checkout`; `git status` clean): 32 failed,
  4 skipped, 2 passed. The 2 passes are the popover guards.
  - Re-scored from the logged geometry, no natural case is red and 94 of 106 injected cases are red.
  - The injected case is red at every applicable configuration on all 20 discriminating modals.
  - The 12 green injected cases are step-palette (0/6) and command-palette (0/6), both labelled GUARD only.
  - There were no 429s.
  - Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/eval4-c4-mutA.txt`.
- **dashboard-dialogs JSON run:** `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/eval4-dashboard-dialogs.json`.
- The verdicts match cycle 3 exactly, so the settle change altered nothing.

### Overall: PASS

### Non-blocking Suggestions

- The skip reason hard-codes "(desktop-only cases)". If a future group were all `phoneOnly`, its desktop skip message
  would be wrong. Derive the wording from the viewport, or make it neutral.
- The committed evidence has no rule-removed run made after the settle change. My
  `eval4-c4-mutA.txt` (persisted above) covers it, and the executor could cite it in inventory.md.
- When opening the PR, note that `e2e/shard-weights.tsv` should be regenerated after the first CI runs. All six
  hel1774 files are at the 50 s default, against 49-116 s actual.
