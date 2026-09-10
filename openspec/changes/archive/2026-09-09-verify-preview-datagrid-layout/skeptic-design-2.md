## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Spawned cold. Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `skeptic-design-1.md`, then
verified every load-bearing claim against the repo rather than against the revision narrative.

### What I verified (with evidence)

**CR1 (measurement datum) — genuinely resolved, and the fix is verifiably sound.**
- `design.md` "Comparison method, datum" now discards "previous sibling" explicitly and pins the
  datum to *the bottom of the nearest preceding consumer-owned element → top border-box of
  `.ui-data-grid--preview`*, at a fixed 1280x800 viewport, with `margin-top` demoted to a secondary
  diagnostic. `tasks.md` 2.1/2.2 and 3.2 all reference that datum; no task still says "previous sibling".
- The datum is only valid if the consumer markup is identical across the compared trees. Verified:
  `git show --stat a6bde0d3 -- frontend/src/features/sources frontend/src/features/pipelines
  frontend/src/shared/ui` touches **only** `DataGrid.{css,tsx,test.tsx}` and two `outputEditor` files —
  **none** of `StepCard.tsx`, `SourceDetailPanel.tsx`, `SqlTab.tsx`. The preceding consumer elements
  are therefore the same nodes on both sides of the isolating pair, which is exactly what CR1 required.
- Spot-checked the one datum named by class: `.add-source-modal__preview-hint` exists at
  `SqlTab.tsx:219` in `a6bde0d3^` and at the same position in HEAD.

**CR2 (baseline isolation) — genuinely resolved.**
- `design.md` "Comparison method, baseline isolation" now mandates the isolating pair
  `a6bde0d3` vs `a6bde0d3^` as the attributing measurement, with HEAD as a third data point;
  `tasks.md` 3.1/3.2/3.3/3.4 implement exactly that split, and 3.3 is explicitly named as "the number
  that answers the ticket's margin-collapse question, attributed to the reframe specifically".
- Re-confirmed the confound is real: `git log --oneline a6bde0d3..HEAD -- frontend/src/shared/ui/DataGrid.css
  frontend/src/shared/ui/DataGrid.tsx` returns six commits (`9d1734fa`, `3baa1ebf`, `dae1117e`,
  `f20ea8f6`, `153f6714`, `fcce99b1`). `git merge-base --is-ancestor a6bde0d3 HEAD` → yes.

**CR3 (worktree hygiene) — genuinely resolved.**
- `design.md` states `git stash`+checkout in the delivery worktree is **forbidden**; `tasks.md` 3.1
  repeats "never `git stash` in the delivery worktree", and 3.5 requires teardown verified by
  `git worktree list` **output, not an assertion**. Matches CR3 verbatim.

**Prior non-blocking notes** were also folded in, not just acknowledged: the skeleton
frame-divergence is now pre-stated as an *expected* finding with a required explicit ship/no-ship
judgement (task 2.3), the empty-state third structural case is a new task 2.4, and 2.3 now says
"in both themes".

**Independent hazard probe (not raised in round 1):** a throwaway worktree at `a6bde0d3^` booting an
older backend against the shared dev DB is this repo's recorded Flyway-collision trap. Checked:
`git diff --stat a6bde0d3^ HEAD -- backend/src/main/resources/db/migration` is **empty** — zero
migration drift across the compared range, so the hazard does not apply to this pair. Recording it
here so the executor does not have to rediscover it.

### Verdict: CONFIRM

The three required revisions are each addressed at the level of the mechanism, not the wording, and
each survives a ground-truth check. The plan is sound enough to implement.

### Non-blocking notes

- `design.md` offers "SqlTab with an empty inferred-fields result" as an empty-state candidate for
  task 2.4. That path cannot produce an empty preview grid: `SqlTab.tsx:218` guards the `DataGrid`
  with `inferredFields.length > 0` and renders a plain `.add-source-modal__empty` paragraph instead.
  Use the offered alternative — `SourceDetailPanel` (`emptyText="Source returned no rows."`) or
  `StepCard` (`emptyText="No rows to preview."`).
- `tasks.md` 3.4 attributes any HEAD-vs-`a6bde0d3` delta to "HEL-465/HEL-458/HEL-1065". Three more
  commits in that range also touch `DataGrid.css`/`DataGrid.tsx` (`fcce99b1` HEL-469, `153f6714`
  HEL-1048, `f20ea8f6` HEL-866). Treat 3.4's list as non-exhaustive when naming a cause.
- Two of the three datums are described rather than selected (`StepCard`: "the step's header/summary
  row immediately preceding the preview block"; `SourceDetailPanel`: "the preview section's own
  heading/control row"). Since a6bde0d3 did not touch those files the delta stays valid either way,
  but the report should state the exact selector actually measured at each call site so a future
  reader can reproduce the number.
- Since there is zero migration drift and the measurement is frontend geometry only, the throwaway
  worktrees can point their Vite dev servers at the already-running backend rather than booting two
  more — cheaper, and avoids touching shared dev-DB state a second and third time.
