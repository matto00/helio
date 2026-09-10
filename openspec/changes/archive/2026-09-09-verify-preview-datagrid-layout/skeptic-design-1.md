## Skeptic Report — design gate (round 0, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `.openspec.yaml`, `workflow-state.md`.
- Confirmed the ticket's structural premises against ground truth, not narrative:
  - `frontend/src/shared/ui/DataGrid.css:12` — `.ui-data-grid__frame { display: flex; flex-direction: column; ... }`; `:36` `.ui-data-grid__frame--full { flex: 1; min-height: 0 }` is `--full`-scoped, so preview takes no frame-level flex rule. Matches the "layout-neutral by design" claim.
  - `DataGrid.css:74-75` — `.ui-data-grid--preview { margin-top: var(--space-3); }` exists, so the named margin risk is real as stated (a hypothesis, not a confirmed defect).
  - All three call sites exist as cited: `StepCard.tsx:382`, `SourceDetailPanel.tsx:288`, `SqlTab.tsx:223`; `SourcePreviewSkeleton.tsx:30` does hand-roll `ui-data-grid ui-data-grid--preview ui-data-grid--condensed` with **no** `__frame` wrapper.
- `git show --stat` on the four relevant commits: between `a6bde0d3` (HEL-451) and this branch's base there are **three further substantial `DataGrid` commits** — `dae1117e` HEL-465 (CSS +208, TSX +221), `3baa1ebf` HEL-458 (CSS +18, TSX +196), `9d1734fa` HEL-1065 (CSS +78). This is the basis of CR2.

Design strengths (real, not boilerplate): the plan insists on live measurement over CSS/Jest inference, requires confirming the HEL-904 403 hypothesis via response body/logs before acting on it rather than assuming the driver's claim, mandates a DOM-level skeleton diff rather than a source read, and pre-commits to "no regression, recorded" as a complete outcome. Those are the right calls.

### Verdict: REFUTE

Two defects would corrupt the ticket's single deliverable — a number that can be trusted — and one hazard needs closing.

### Change Requests

1. **`design.md` "Comparison method" does not define a measurement datum that survives the reframe, which is the exact thing being measured.** It says measure `getBoundingClientRect().top` of `.ui-data-grid--preview` "relative to its previous sibling, plus the computed `margin-top`" — but the reframe *changed what the previous sibling is*. Post-reframe the grid's siblings are frame chrome inside `.ui-data-grid__frame`; pre-reframe they were the consumer's own preceding content (e.g. `.add-source-modal__preview-hint` at `SqlTab.tsx:219`). Measuring "relative to previous sibling" on both checkouts compares two different distances and yields a meaningless delta — the fifth flavour of the evidence-shaped non-evidence this ticket exists to end. Fix the design (and `tasks.md` 2.1/2.2/3.2) to pin a **call-site-stable datum present in both trees**: the bottom of the nearest preceding consumer-owned element (name it per call site) to the top border-box of `.ui-data-grid--preview`, at a fixed viewport size, with `margin-top` reported as a secondary diagnostic rather than the primary number.

2. **The comparison baseline is confounded: `current branch` vs `a6bde0d3^` does not isolate the reframe.** `tasks.md` 3.1-3.3 and `design.md` compare HEAD against `a6bde0d3^`, but three later `DataGrid` commits (`dae1117e`, `3baa1ebf`, `9d1734fa` — evidence above) sit in between and touch `DataGrid.css`/`DataGrid.tsx` heavily. Any delta measured that way is unattributable, so the ticket's AC ("the `margin-top` question is answered explicitly: unchanged, or changed with the delta stated" about *the reframe*) cannot be met. Require the **isolating pair `a6bde0d3` vs `a6bde0d3^`** as the attributing measurement, plus HEAD as the third data point for today's shipped geometry. State in tasks that if HEAD differs from `a6bde0d3` the cause is a later commit, not the reframe.

3. **Forbid the `git stash` + checkout fallback outright.** `design.md` offers "a `git stash`+checkout if a second worktree is impractical". Executed in the delivery worktree that mutates the very tree under review mid-run and risks losing planning artifacts; it is the same class of hazard as the recorded cleanup-mid-review incident. Require a separate throwaway worktree only (task 3.4's teardown already assumes one), and have 3.4 verify teardown with `git worktree list` output, not an assertion.

### Non-blocking notes

- `SourcePreviewSkeleton` has *already* structurally diverged: the real `variant="preview"` render now emits `__frame > .ui-data-grid`, the skeleton emits a bare `.ui-data-grid`. Task 2.3 will surface this; the design should pre-state that a missing frame wrapper is expected output of the diff and needs an explicit ship/no-ship judgement (skeleton→resolved swap jump), not just a pass/fail.
- The zero-row preview path renders no frame at all (`DataGrid.css:7` comment). Worth measuring the empty state at one call site so the "frame is neutral for preview" claim covers all three preview structural states.
- `tasks.md` 2.3 does not specify a theme; AC "both themes" should be explicit for the skeleton diff too.
- `skip_specs: true` is correctly self-approved — no capability is added or changed.
