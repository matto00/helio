## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth read fresh (no reliance on executor/evaluator narrative):**
- `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-editor-page/spec.md`,
  `specs/pipeline-schedule-config-ui/spec.md` — all read in full.
- `git diff main...HEAD --stat` (29 files, +1918/-840) and full diffs of
  `PipelineDetailHeader.tsx`, `PipelineDetailHeader.css`, `PipelineDetailFooter.tsx`,
  `PipelineDetailPage.tsx`, `PipelineDetailPage.css`, `CreatePipelineModal.tsx` read directly.
- `evaluation-1.md` and `evaluation-2.md` read as claims, then independently re-verified.

**Acceptance criteria traced to evidence:**
- **AC1 "One header region, one footer region; no more than one info bar above the step
  list"** — confirmed structurally (single `.pipeline-detail-header` div wired in
  `PipelineDetailPage.tsx`; single `.pipeline-detail-page__footer-region` wrapper in
  `PipelineDetailFooter.tsx` absorbing the former standalone `__share-bar`/`__meta-bar`) and
  visually via live screenshots at 1440/1100/768/430px (dark + light) against
  `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485` ("Profit (migrated)") — one continuous
  bordered/backed region above the step list, one below. `git diff` confirms
  `__source-bar`/`__type-bar`/`__share-bar`/`__meta-bar` selectors removed from
  `PipelineDetailPage.css`.
- **AC2 "All existing actions ... remain reachable with no loss of function"** — live
  accessibility snapshot at 1440px shows: `button "Edit source"`, `button "Edit type"`,
  `button "Edit schedule"`/`"Set schedule"`, `switch "Enable schedule"`/`"Disable schedule"`,
  `button "Share"`, `button "Open run history"`, `button "Preview"`, `button "Dry run"`,
  `button "Run pipeline"` — all present with their pre-existing accessible names. Diffed
  `PipelineDetailFooter.tsx` against `main`'s pre-extraction footer to confirm the
  "Edit pipeline name"/"Pipeline name" labels are pre-existing (not renamed by this change).
- **AC3 "Works cleanly at 430px"** — live-measured all six action buttons
  (`edit-btn`×3, `run-btn`, `share-btn`, `history-btn`, `preview-btn`, `dry-run-btn`) via
  `getBoundingClientRect()` at 430px: every one is exactly 44px tall (HEL-687 tap-target floor
  intact). Header stacks to 3 full-width rows, footer stacks/wraps per the pre-existing
  treatment. `PipelineDetailPage.css.test.ts` re-run fresh: passes (see below).

**Fresh gates re-run myself (not trusted from the report):**
- `npm run lint` (frontend) → 0 warnings/errors, reproduced fresh.
- `npx jest --testPathPatterns="PipelineDetailPage|PipelineDetailHeader|PipelineDetailFooter"` →
  **3 suites / 129 tests passed**, including `PipelineDetailPage.css.test.ts` (HEL-687 guard).
- `grep -rl "BoundSourceBar\|BoundTypeBar\|PipelineScheduleBar" frontend/src` → only doc-comment
  mentions in `PipelineDetailHeader.tsx`/`.test.tsx`/`labelForKind.ts` — no dead references, no
  stray imports.
- Diffed `CreatePipelineModal.tsx`/`ShapeInstantiateStep.tsx` — `labelForKind` import path
  correctly updated to `../../sources/utils/labelForKind`.

**Breakpoint sweep (DESIGN.md §4 canonical set: 1440/1100/768/430), independently re-measured
via live `getBoundingClientRect()`/`scrollWidth` + screenshots, dark and light theme:**
- **1100px**: `flex-direction: column` engaged, `__source-name` and `__schedule-expression`
  render at full natural width (40px/70px, no truncation), `__schedule-disabled-badge` (516.4px
  right edge) does not overlap `Edit schedule` (965.2px left edge). Cycle-1's blocking defect
  (0-width text, badge/button overlap) is genuinely fixed — reproduced evaluation-2's exact
  numbers independently.
- **768px / 430px**: clean, matches evaluation-1/2's screenshots; no regression.
- **1440px — a real, reproducible defect evaluation-2 missed.** Live-measured on the fixture
  pipeline (interval schedule "1m", disabled): `.pipeline-detail-header__schedule-disabled-badge`
  renders at **41.36px width against a 63px `scrollWidth`** — the "Disabled" text is
  ellipsis-truncated to "Dis…" (confirmed both numerically and visually, see zoomed screenshot).
  Reproduced identically on a second, fresh page load (41.36/63, viewport confirmed 1440) — not
  measurement noise. This is the same failure category (short label ellipsis-truncated to a
  few characters at the widest canonical breakpoint) evaluation-1 flagged as **blocking** for
  the sibling `__schedule-expression` element ("Ever…", CR2) — that specific element is now
  fixed (`min-width: 70px`), but `__schedule-disabled-badge` only got `min-width: 20px`
  (`PipelineDetailHeader.css:154`), well below its ~63px natural content width, so it silently
  absorbs the group's real width deficit instead. Confirmed the deficit is real (not a bug where
  slack exists but isn't used): at 1440px the schedule group's natural content
  (Toggle 34px + 2×8px gap + "Every 1m" 70px + "Disabled" 63px = 191px) exceeds its 161px
  available box by ~22px — some element genuinely must yield, and the CSS's own comment
  documents this as a deliberate choice ("this text badge can safely yield first"). The badge
  has no `title` attribute fallback, so the truncated word is not recoverable by hover/keyboard
  either. evaluation-2 measured this exact badge's coordinates (`badge right edge 1293.2 vs
  button left edge 1305.2`) and correctly concluded "no overlap" — but never checked
  `width` vs `scrollWidth` on the badge itself, so it certified CR2 "CONFIRMED FIXED" at 1440px
  without catching that a sibling element in the same row still truncates at that exact,
  canonical, primary-desktop breakpoint.
- Verified this is not a universal min-width-floor problem: a schedule-less pipeline
  ("Popover Test Pipeline") renders "No schedule set" / kind badges fully legible at 1440px —
  the defect is specific to the (very plausible, real-world) interval+disabled schedule
  combination, which happens to be the exact fixture pipeline both evaluation reports used.
- Confirmed reproducible in both dark and light theme (screenshot: light theme shows the same
  "DIS…" truncation) — not a theme-specific rendering artifact.

**Environmental note (not blocking, disclosed for the record):** this worktree's
`scripts/concertino/` is missing `next-report-number.sh`/`emit-event.sh`/`persist-evidence.sh`
(present on `main` but absent from this worktree's branch history — a stale branch-point, not
something this change touched). I invoked the main checkout's copy of `next-report-number.sh`
against this worktree's change directory (read-only scan, no worktree files modified) to get a
collision-safe report filename, and will do the same for `persist-evidence.sh` next.

### Verdict: REFUTE

The three literal ticket ACs are met, and Cycle 1's genuine blocking defect (1100px
invisibility/overlap) is confirmed fixed. But evaluation-2's Phase 3 sign-off explicitly claims
"Change request 2 (1440px ... truncation) — CONFIRMED FIXED" and states the fix makes "Every 1m"
render in full "at the widest supported breakpoint" — that claim is incomplete: a sibling element
in the same schedule field group still ellipsis-truncates at that exact breakpoint, on the same
schedule state (disabled interval) both evaluators already used as their test fixture. Given this
exact failure pattern (short label truncated to a few characters at 1440px) was already treated
as a blocking defect once in this ticket's own review history, treating it as acceptable now for
a different element in the same row would be an inconsistent bar.

### Change Requests

1. **`frontend/src/features/pipelines/ui/PipelineDetailHeader.css:154`
   (`.pipeline-detail-header__schedule-disabled-badge`)** — at 1440px (DESIGN.md §4's widest
   canonical breakpoint), with the fixture pipeline's schedule state (interval, disabled), this
   badge renders "Disabled" ellipsis-truncated to "Dis…" (`width: 41.36px` vs
   `scrollWidth: 63px`) because its `min-width: 20px` floor is far below its ~63px natural
   content width, while the group's real ~22px width deficit at 1440px has nowhere else to go.
   Fix by giving this badge a legibility floor sized to its content (mirroring the treatment
   `__schedule-expression` already got at `min-width: 70px`) and letting a genuinely
   lower-priority sibling absorb the deficit instead — e.g. the badge is redundant with the
   Toggle's own on/off state, so consider hiding the "Disabled" text badge below some width (the
   Toggle alone still conveys the state unambiguously) rather than truncating it to an
   unreadable fragment; alternatively, add a `title="Disabled"` fallback if truncation is kept
   as an intentional trade-off. Re-verify at exactly 1440px with `scrollWidth` vs
   `getBoundingClientRect().width` (not just an overlap check) that no header text is
   ellipsis-truncated below its full word.

### Non-blocking notes

- Carried-over literal px spacing values in `PipelineDetailHeader.css` (`gap: 12px`,
  `padding: 10px 20px`, `padding: 2px 6px`) — verified these are byte-identical carryovers from
  the retired `BoundSourceBar`/`PipelineScheduleBar` (checked against `main`), not new debt.
  Already flagged non-blocking in both evaluation reports; agree.
- The disclosed 1101–1330px tight-clipping window (outside DESIGN.md §4's four canonical,
  media-query-targeted breakpoints) — reproduced at 1101px ("Every 1m" clips to a sliver, no
  overlap/garbling). Agree with evaluation-2's judgment this is acceptable/non-blocking given
  the ticket's explicit "no visual redesign beyond consolidation" non-goal and that it falls
  outside the canonical set DESIGN.md's mechanical rule actually binds.
- Structural/code quality (labelForKind relocation, footer absorption, spec deltas, test
  porting) is clean and well-reasoned throughout — no further concerns there.
