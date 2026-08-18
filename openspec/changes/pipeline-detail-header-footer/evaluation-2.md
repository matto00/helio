## Evaluation Report — Cycle 2 (evaluation-2.md)

Resumed review: planning artifacts (ticket/proposal/design/tasks/specs) not re-read — stable
since Cycle 1, already reviewed in evaluation-1.md. This cycle re-reviews the diff since
evaluation-1.md (commit `1f49adc3`, "Fix header crowding/truncation at 1100px and 1440px") and
independently re-verifies both of evaluation-1.md's change requests against fresh gates and fresh
live-browser measurements.

### Phase 1: Spec Review — PASS

No change since evaluation-1.md's Phase 1 findings (still PASS) — `git show 1f49adc3 --stat`
confirms only `PipelineDetailHeader.css` plus planning-artifact bookkeeping
(`evaluation-1.md`/`files-modified.md`/`workflow-state.md`) changed; no task-scope, AC-scope, or
spec-delta drift introduced by the fix.

### Phase 2: Code Review — PASS

Fresh gates re-run in `WORKTREE_PATH` (no `CLEAN_WORKTREE` — default speed):

- `npm run lint` → 0 warnings/errors.
- `npm run format:check` → all files formatted.
- `npm test` (full suite) → **210 suites / 2260 tests passed** (unchanged from Cycle 1 — the CSS-
  only fix touches no test-covered logic; `PipelineDetailPage.css.test.ts`'s HEL-687 guard still
  green).
- `npm --prefix frontend run build` → succeeds.
- No `backend/**` files touched.

Diff reviewed (`git diff 05460783 1f49adc3 -- .../PipelineDetailHeader.css`): the fix directly
targets the root cause I'd have diagnosed independently — `.pipeline-detail-header__group-value`'s
`flex-shrink: 0` children had no `overflow: hidden` of their own, giving them an unyielding
automatic min-size that forced the one shrinkable child (`__source-name`/`__schedule-expression`)
to absorb the entire deficit down to 0px, while the container's own missing `overflow: hidden` let
oversized children visually spill into the neighbouring Edit button. The fix: (a) widened the
stacking breakpoint from `max-width: 768px` to `max-width: 1100px` (closing the exact gap
evaluation-1.md flagged — the original rule covered only half of design.md's own self-identified
"1100/768" risk range); (b) added `min-width` floors to the truncatable text so it can never hit
0px; (c) added `overflow: hidden` to `__group-value` so any residual excess clips inside its own
box rather than visually overlapping a sibling; (d) demoted the previously-rigid badges/next-run
text to lower-priority shrink targets. This is a proportionate, root-cause fix, not a cosmetic
patch — no new hardcoded colors/fonts introduced; the new `min-width` literals (20/24/40/70px) are
content-fit floors (comparable to the codebase's existing 44px tap-target-floor precedent), not
spacing values, so DESIGN.md's `--space-*` token rule doesn't apply to them.

Hook-bypass check: `git commit -n` used again, for the same disclosed, verified-accurate reason as
Cycle 1 (`check:openspec` flags complete-but-unarchived; archiving remains a distinct,
orchestrator-owned later phase). Commit body discloses it explicitly; all other hooks re-confirmed
green above.

### Phase 3: UI Review — PASS

Dev servers reused (already healthy) via `start-servers.sh` / `assert-phase.sh servers` → `PASS
servers`. Independently re-measured (not trusting the executor's self-reported probe output) via
live `getBoundingClientRect()`/`scrollWidth`/screenshots against the same fixture pipeline
(`555f4bae-7c76-4566-84eb-036bc33b4485`, "Profit (migrated)") the executor and evaluation-1.md both
used:

**Change request 1 (1100px crowding/invisibility/overlap) — CONFIRMED FIXED.**
- At exactly **1100px**: header `flex-direction: column` (stacked layout engaged — the widened
  media query is inclusive of 1100px). `__source-name` ("Profit") and `__schedule-expression`
  ("Every 1m") both render at their full natural width, no truncation, no overlap.
- Re-tested the exact previously-broken symptom (0px-width text, badge/button overlap at
  x≈955–1020 vs. button at x≈965) — no longer reproducible at 1100px.

**Change request 2 (1440px "Every 1m" → "Ever…" truncation) — CONFIRMED FIXED.**
- At **1440px**: `__schedule-expression` width = 70px = scrollWidth = 70px (no ellipsis engaged);
  text renders as the full "Every 1m", not "Ever…". `__source-name` likewise renders at full width
  (40px = scrollWidth 40px). No overlap between the "Disabled" badge and "Edit schedule" button
  (badge right edge 1293.2 vs. button left edge 1305.2).

**Disclosed residual (1101–1330px, outside DESIGN.md §4's four canonical breakpoints) — verified,
judged non-blocking.** Initial `getBoundingClientRect()` comparison at 1101px suggested an overlap
(badge rect right edge past the button's left edge), but this was a false positive from measuring
unclipped child-layout geometry against an `overflow: hidden` ancestor — `getBoundingClientRect()`
reports a child's laid-out box regardless of ancestor clipping, not what's actually painted.
Re-verified against the actual rendered screenshot instead: at 1101px the schedule expression
clips hard (down to a sliver, effectively just "E…") but **nothing overlaps or garbles** — the
"Edit schedule" button, its own text, and the other two field groups (DATA SOURCE / OUTPUT TYPE)
all render cleanly. At 1330px "Every 1m" is fully visible again with no truncation, so the tight
zone is materially narrower than the executor's "1101–1330px" framing suggests (worst near
1101px, recovering well before 1330px). This does not reproduce Cycle 1's blocking defect pattern
(0-width fully-invisible text, visually overlapping elements) — it degrades gracefully via
`overflow: hidden` clipping, exactly as `overflow: hidden` is supposed to do. It also falls outside
DESIGN.md §4's four canonical, CSS-media-query-targeted breakpoints (1440/1100/768/430), which is
what this evaluator's Phase 3 checklist scopes the "supported breakpoints" check to. Fully closing
it would require restructuring the schedule field group (e.g. dropping the Toggle/badge from the
row below some width) — a "visual redesign beyond consolidation," which proposal.md's Non-Goals
explicitly places out of this ticket's scope. Judged **acceptable, not blocking** — flagged below
as a non-blocking follow-up rather than a change request.

**Regression check (768px / 430px, previously verified good in Cycle 1) — no regression.**
Screenshots at 430px match Cycle 1's verified-good state exactly (header stacks, footer's HEL-687
mobile-floor treatment intact — Run pipeline full-width, action buttons wrap). 769px (just above
the old 768px threshold, now inside the widened ≤1100px stacking range) also correctly stacks.

No console errors/warnings during any tested width or interaction.

### Overall: PASS

### Non-blocking Suggestions

- Consider a follow-up ticket to close the ~1101–1150px tight-clipping window for the schedule
  field group specifically (e.g. drop the "Disabled"/enabled-state text badge below some
  intermediate width, since the `Toggle` control already conveys the same state) — legitimate
  scope-out per this ticket's "no visual redesign beyond consolidation" Non-Goal, not a defect in
  what was delivered.
- (Carried over from evaluation-1.md, still unaddressed and still non-blocking): a few literal px
  spacing values in `PipelineDetailHeader.css` (`gap: 12px`, `padding: 10px 20px`,
  `padding: 2px 6px`) are carryovers from the retired bar components rather than `--space-*`
  tokens — pre-existing debt, not newly introduced.
