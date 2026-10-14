## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed the revised, still uncommitted planning artifacts in `openspec/changes/processed-width-wait-grid-split/`:
ticket.md, proposal.md, design.md, tasks.md, `.openspec.yaml` (`skip_specs: true`) and workflow-state.md. I checked
them against the worktree at HEAD `9c569fc6074d1d2296ad1a1f5fc91ee6b580a564` (= origin/main 9c569fc60). The change
dir is the only untracked path.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned
  `READY ambient=/home/matt/Development/helio branch=task/processed-width-wait-grid-split/HEL-1418`.

#### Round-1 change requests

- **CR1 (hel1023's box poll): addressed.**
  - D1 now picks option (a). The box poll stays in hel1023 as an assertion ahead of the helper and is a named AC2
    exemption. hel1023 is therefore semantics-identical.
  - Ground truth: the poll is now at hel1023 l.250-252 (design says 255-257, a small line drift). It is ordered before
    the processed-width wait at l.263-271, so lifting only l.260-274 into the helper keeps the order exactly.
- **CR2 (concrete grep): addressed.** Task 2.5 names both commands. I ran them on the current tree.
  - The `--panel-grid-processed-width` grep returns exactly hel1392-burst:76 and hel1023:268, the two inline copies
    the migration removes.
  - The box grep returns hel1023:251 (the exempted poll), hel1023:298 (`colW` arithmetic from `container.w`) and
    hel1028:185-187 (the exempted pre-load range assertion).
  - So the pattern is not vacuous. It does hit something not on the allowed list (see notes).
- **CR3 (archived evidence nits): addressed, and the ground truth checks out.**
  - evidence.md l.18 is the item-1 "bad=4/8" sentence.
  - The archived `skeptic-final-1.md` l.10-15 says "all 8 items read pixel-identical to the pre-resize lg read" and
    "only 4 fall outside the md bounds".
  - l.24 and l.28 are passing-run reads and verbatim probe output, and are correctly left alone.
  - `dev-db-residue.txt` has 305 `example.test` rows. Their `created_at` sorts from 15:30:39.352883 to
    16:04:07.588553, and evidence.md l.74 still says "to 16:22:40". The 16:04:07 correction is grounded.
- **CR4 (red per migrated spec): addressed.**
  - D3 says every audit-marked "migrate" spec other than hel1023 is a semantic change and gets its own red probe,
    recorded per spec.
  - Task 2.3 applies that to "hel1392-burst AND every other spec 1.1 marks migrate".
  - Where no red can be obtained, the plan says so plainly rather than claiming one, which is consistent with C1.
- **CR5 (effect-order mechanism): addressed.**
  - D4 binds the split: `useCommitFlag` is called before `useLayoutSave`, and `useGridLayoutInteraction` after it with
    plain arguments.
  - The call order is fixed: title, detail, `useCommitFlag`, `useLayoutSave`, interaction, processed width.
  - The proof is a recorded argument plus the existing tests, with no new order test. C3 records this, and task 3.2
    carries the acceptance signal.

#### Ground truth behind D4

- `DesktopPanelGrid.tsx` is 436 lines, and I read all of it.
- The effects today are the editingTitleRef sync (l.113), the HEL-651 auto-close (l.142) and the commit-flag cleanup
  (l.185), followed by `useLayoutSave` (l.187).
- In the new order, the title hook carries the l.113 effect and the detail hook carries the l.142 effect, so the
  relative order is preserved.
- `useGridLayoutInteraction` and `useProcessedWidth` contain no effects, so placing them after `useLayoutSave` cannot
  reorder any effect.
- `markLayoutChanged` (`[dispatch]`) and `commitInteractionLayout` (`[]`) are stable (useLayoutSave.ts:334-351).
  `latestLayoutRef` is a ref. Passing them as plain arguments therefore adds no stale-callback window.
- The unmount flush `useEffect(() => () => persistLayoutRef.current(), [])` (useLayoutSave.ts:332) still runs after
  the commit-timer cleanup.
- Under 250 lines is feasible: the 24-line header, about 42 lines of imports and the props block, about 64 lines of
  JSX and the hook calls come to roughly 190 lines.

#### I1, rebase-on-409 and tests

- I1 and rebase-on-409 live only in `useLayoutSave.ts`, which C2, D5 and task 3.3 keep unmodified.
- `useLayoutSave` is imported by non-test code only in `DesktopPanelGrid.tsx`. The other `useLayoutSave.ts` hits in my
  grep are the hook itself and comments.
- The tests the plan relies on exist:
  - the HEL-306 unmount-flush suite at PanelGrid.test.tsx:692-814
  - 8 `DesktopPanelGrid*.test.tsx` files plus the skeleton test

#### Audit scope (AC2)

- `setViewportSize` occurs 78 times across 31 files in `e2e/`. Task 1.1 classifies every site, and its acceptance
  signal is that the grep count matches the table rows.
- The design's own live-resize list is explicitly marked as untrusted.

#### Scope, contract, constraints

- All three ticket items and AC1-AC5 map to tasks: AC1 to 2.1/2.2/2.4, AC2 to 1.1/2.5, AC3 to 2.3/2.4, AC4 to
  3.1-3.3/5.1, and AC5 to 4.1.
- No backend or backend-test-infra work is planned, which respects HEL-1544.
- No API or schema contract is touched, so `skip_specs: true` is justified.
- The `npm run check:e2e-types` gate is now named in task 2.1, and the timeout message must carry the observed value.

### Verdict: CONFIRM

### Non-blocking notes

1. **hel1275 is a likely "migrate" the design's list misses.**
   - `e2e/hel1275-metric-delta-sparkline.spec.ts` `resizeAndSettle` (l.58-75) resizes live after `goto`
     (1440 → 1100). It then gates on a `.react-grid-item` `boundingBox().width` change and a 4-read box settle.
   - Under D2 that is "resizes after load AND reads desktop-grid geometry", so the task 1.1 audit should mark it
     migrate and give it a red probe.
   - Neither the design's list nor task 2.5's grep pattern names it, because it never touches `.panel-grid`.
   - The audit table, not the grep, has to be what catches it.
2. **Task 2.5 also hits hel1023:298.** `colW = (container.w - ...)` is geometry arithmetic, not a gate. List it with
   that reason so the "allowed" list doesn't read as exhaustive and get violated.
3. **D3 fallback for hel1392-burst.** If the delayed-RO probe gives no red, consider a cheap honest alternative before
   settling for "no red obtained": a temporary local mutation that makes `processedWidth` report a stale or wrong
   value (for example `useState(0)`). It shows the old `/^\d+px$/` wait accepts it while the exact-width helper fails.
   It must never be committed. Either way, the final gate should accept "no red obtained" only with the observation
   that explains it.
4. **D4 leaves `handleStartEdit`'s home loose.** It clears confirm and detail state and seeds the title state.
   Composing it in the component (or in the hook that owns both setters) with unchanged `[]` deps keeps its identity
   stable. Pick one and say so in the evidence.
5. **D1 vs Risks on the expected-width source.** D1 lets the executor choose between caller-passed and read from the
   zoom container. The Risks line assumes caller-passed. Either way the gate is the processed width; state the choice
   once.
6. No mtime or positional evidence was relied on, and there is no gate defect to record.
