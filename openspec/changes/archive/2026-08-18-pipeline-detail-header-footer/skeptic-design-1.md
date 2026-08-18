## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`, and the two
  spec deltas (`specs/pipeline-editor-page/spec.md`, `specs/pipeline-schedule-config-ui/spec.md`)
  in full.
- Read the current implementation ground truth the plan is built against:
  `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (lines 619-780: confirmed the
  six-chrome-region DOM order the proposal describes — `BoundSourceBar`, `BoundTypeBar`,
  `PipelineScheduleBar`, river, `PipelineDetailFooter`, then a standalone `__share-bar` and
  `__meta-bar` below the footer — matches exactly), `BoundSourceBar.tsx`, `BoundTypeBar.tsx`,
  `PipelineScheduleBar.tsx`, `PipelineDetailFooter.tsx`, `PipelineDetailPage.css` (1571 lines),
  `PipelineDetailPage.css.test.ts` (the HEL-687 regression guard), `PipelineScheduleBar.css`,
  `BoundSourceBar.test.tsx`, `BoundTypeBar.test.tsx`, `PipelineScheduleBar.test.tsx`, and
  `PipelineDetailPage.test.tsx` (grepped for `source-bar`/`type-bar`/`schedule-bar`/`share-bar`/
  `meta-bar`/`Share` — confirmed its header/footer assertions are role/label-based only, no
  brittle class-selector coupling, and confirmed there is currently **zero** test coverage of
  the Share button anywhere in the suite).
- Confirmed `labelForKind`'s two external consumers (`grep -rln "BoundSourceBar\|BoundTypeBar\|
  PipelineScheduleBar" frontend/src`) — exactly `CreatePipelineModal.tsx` and
  `ShapeInstantiateStep.tsx`, matching D2's claim; no other importers of the three retired
  components exist anywhere else in the app.
- Confirmed `features/<domain>/utils/` is an established convention
  (`frontend/src/features/dashboards/utils`, `frontend/src/features/auth/utils` both exist)
  supporting D2's target path.
- Confirmed against `DESIGN.md` (§4 Breakpoints, ratified `1440/1100/768/430`; no page-header
  section exists) that the proposal's "Non-goals" claim ("DESIGN.md has no page-header
  convention yet") is accurate, and that the design's breakpoint vocabulary matches the ratified
  set.
- Diffed the spec deltas against their base specs at `openspec/specs/pipeline-editor-page/
  spec.md` and `openspec/specs/pipeline-schedule-config-ui/spec.md` line-by-line (requirement
  titles must match verbatim for MODIFIED deltas to apply cleanly) — found all touched titles
  match, but found an uncaught spec-consistency gap (Change Request 1, below).
- Read `PipelineDetailPage.css` for the `__source-bar`/`__type-bar`/`__schedule-bar` base rules
  (lines 34-142) and the `@media (max-width: 768px)` / `@media (max-width: 430px)` blocks (lines
  1532-1571) that `PipelineDetailPage.css.test.ts` locks in via a first-match `findMediaBlock`
  helper — traced a concrete collision risk the plan doesn't address (Change Request 2, below).
- Confirmed `PipelineDetailFooter.tsx` currently has **no** co-located `.css` or `.test.tsx` file
  (`ls` + `find` in `frontend/src/features/pipelines/ui/`) — its styles live in
  `PipelineDetailPage.css` and its tests live in `PipelineDetailPage.test.tsx` — contradicting a
  specific claim in `proposal.md`'s Impact section (Change Request 3, below).

### Verdict: REFUTE

The overall shape of this plan is sound — D1-D4 are well-reasoned, the AC-to-task mapping is
essentially complete, and the risk analysis is unusually careful (it already caught the
accessible-name-preservation risk and the "wrapping three unstyled bars isn't actually one bar"
trap). But three concrete, correctable gaps remain that should be closed before execution starts,
rather than discovered mid-cycle:

### Change Requests

1. **`pipeline-schedule-config-ui`'s spec delta leaves two sibling requirements internally
   inconsistent with the ones it does modify.** The delta correctly restates "Schedule bar shows
   current schedule state" and "Backward compatible — no schedule renders as today" to say "page
   header" instead of "schedule bar" / the old four-bar layout (design.md D4 explicitly scopes
   itself to exactly these two). But two *un*modified requirements in the same base spec —
   "User can set a new schedule" and "User can edit an existing schedule"
   (`openspec/specs/pipeline-schedule-config-ui/spec.md` lines 28-42) — have scenario THENs that
   literally say "the schedule bar reflects the new schedule after the call resolves" /
   "...reflects the new expression after the call resolves." After this change archives, the
   same spec file will simultaneously assert there is no separate "schedule bar" (per the
   requirements this delta does touch) and that "the schedule bar reflects..." (per the two it
   doesn't) — a direct textual contradiction within one spec file, on the exact subject this
   ticket restructures. **Fix:** extend the `pipeline-schedule-config-ui` delta to also modify
   these two requirements' scenario wording (e.g. "the header's schedule section reflects...").

2. **`PipelineDetailPage.css.test.ts`'s `findMediaBlock` helper is a first-match, not a
   merge-all, lookup — the plan's CSS-location flexibility creates a real risk of silently
   breaking the HEL-687 regression guard the design says "must keep passing."**
   `findMediaBlock(css, "max-width: 430px")` (and the 768px equivalent) returns the body of the
   *first* `@media` rule in `PipelineDetailPage.css` whose prelude contains that substring, then
   stops — it does not scan forward for a second block with the same prelude. Today that's safe
   because the file has exactly one `@media (max-width: 768px)` block and one
   `@media (max-width: 430px)` block, both near the bottom (lines 1532, 1546), both containing
   the footer/step-card selectors the test asserts on. Task 2.2 explicitly permits creating the
   new header's responsive rules by "extend[ing] `PipelineDetailPage.css`" — if the executor adds
   *new* `@media (max-width: 768px)` / `@media (max-width: 430px)` blocks near the header CSS
   (which sits earlier in the file, where `__source-bar`/`__type-bar`/`__schedule-bar` currently
   live, lines 34-142) rather than appending header selectors into the *existing* blocks at
   lines 1532/1546, `findMediaBlock` will silently grab the new (header-only) block first and
   every footer/`__run-btn`/`__history-btn`/step-card assertion in
   `PipelineDetailPage.css.test.ts` will throw "Selector containing ... not found." This is
   exactly the regression the design's own Context section calls a must-preserve guard, yet
   neither `design.md` nor `tasks.md` warns the executor about the helper's first-match
   semantics. **Fix:** add an explicit instruction to `design.md`/task 2.2 — either (a) any new
   768px/430px rules added to `PipelineDetailPage.css` for the header MUST be appended into the
   existing `@media (max-width: 768px)` / `@media (max-width: 430px)` blocks (not new blocks with
   the same prelude), or (b) put the header's responsive rules in a separate
   `PipelineDetailHeader.css` file specifically to sidestep the collision (the file
   `PipelineDetailPage.css.test.ts` reads is hardcoded to `PipelineDetailPage.css` only, so a
   separate file is immune by construction).

3. **`proposal.md`'s Impact section misstates what already exists for the footer.** It says the
   change touches "extended `PipelineDetailFooter.tsx` (+ `.css`, `.test.tsx`)" — phrasing that
   implies a `PipelineDetailFooter.css` and `PipelineDetailFooter.test.tsx` already exist and
   will be extended. Ground truth: neither file exists. `PipelineDetailFooter.tsx` has no
   co-located `.css` or `.test.tsx` today; its styles live in `PipelineDetailPage.css`
   (`.pipeline-detail-page__footer*` selectors) and its behavior is tested inside the 2614-line
   `PipelineDetailPage.test.tsx`. `tasks.md` task 5.3 correctly hedges around this ("Extend
   `PipelineDetailFooter.test.tsx` (or `PipelineDetailPage.test.tsx`, whichever currently owns
   footer-level assertions)"), but the proposal's flat, incorrect claim risks the executor
   believing there's an existing footer `.css`/`.test.tsx` to locate and extend, when there isn't
   one. **Fix:** correct the Impact section to state plainly that footer styles/tests currently
   live in `PipelineDetailPage.css`/`PipelineDetailPage.test.tsx` and are staying there (per
   task 4.1, which explicitly keeps `PipelineDetailPage.css` as the footer's CSS home) unless the
   plan actually intends to extract them — in which case that extraction needs its own task.

### Non-blocking notes

- `design.md`'s Risks section names visual crowding "at 1100/768px" as the identified risk but
  the stated mitigation only kicks in "below 768px" — there's no explicit treatment for the
  1100px gap. Given AC 3 only requires 430px and the header's mobile floor is deferred to
  Playwright screenshot verification anyway (Goals section), this is fine to leave to
  execution/skeptic-final visual judgment, but worth a one-line acknowledgment in design.md that
  1100px is being left to visual QA rather than a dedicated breakpoint rule.
- D4's claim that `pipeline-sharing`'s "a Share button is visible in the page header or actions
  menu" wording already covers the new footer placement is a stretch (footer is literally
  neither) — but this looseness predates this change (the Share button is *currently* in a
  standalone bar below the footer, already not literally "header" or "menu"), so I'm not
  requiring a delta for it. If the executor wants to tighten this while touching the file anyway,
  that would be a nice-to-have, not a requirement.
- D1's prose says "Port `labelForKind` ... into the new one," which reads as a copy, while D2
  says `labelForKind` relocates to a shared `features/sources/utils/` file. `tasks.md` task 2.1
  correctly omits `labelForKind` from its own porting list (only `formatNextRun`/
  `formatExpressionSummary`/`Toggle`), so the tasks are unambiguous even though D1's wording is
  momentarily loose — no fix required, just flagging that `tasks.md` is the more precise source
  of truth here if the executor reads D1 in isolation.
