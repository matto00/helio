## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Fresh design-soundness review of the human-directed scope amendment (D5/D6/D7) only. D1-D4 and
the already-implemented Cycle 1-3 code are not in question here (that ground has already passed
two design-gate rounds and two final-gate rounds). Ground truth re-derived from scratch; prior
reports (`skeptic-design-1.md`, `skeptic-design-2.md`, `skeptic-final-1.md`, `skeptic-final-2.md`)
read as claims to verify, not fact.

### What I verified (with evidence)

- Read `ticket.md` (incl. "Scope Amendment" section), `proposal.md` (incl. "Scope amendment"
  section), `design.md` (incl. "Scope Amendment" section + D5/D6/D7), `tasks.md` (task groups
  6-8), both spec deltas, and `workflow-state.md` in full.
- `openspec validate pipeline-detail-header-footer --strict` → reproduced myself: `Change
  'pipeline-detail-header-footer' is valid`. (Confirms the structural-validity claim; does not
  validate cross-file code consistency — that's this review's job.)
- Read `frontend/src/shared/chrome/ActionsMenu.tsx` and `ActionsMenu.css` in full (the reuse
  target for D5/D7) to check the amended docs' claims against its actual props/behavior:
  - `ActionsMenuItem = { label, onClick, disabled?, danger? }` — **no `className` field**, and
    the rendered `<button role="menuitem">` always gets a fixed class
    (`actions-menu__item`/`actions-menu__item--danger`), never a caller-supplied one.
  - WAI-ARIA menu-button pattern genuinely implemented (focus-follows-open via `useLayoutEffect`,
    Arrow/Home/End navigation, portal rendering, `aria-expanded`/`aria-haspopup="menu"` on the
    trigger, `role="menu"` + `aria-label` on the panel) — the accessibility claims in
    design.md/proposal.md/Risks are accurate, not hand-waved.
  - `ActionsMenu.css`'s own `@media (max-width: 768px)` block already lifts
    `.actions-menu__trigger` to `min-width/min-height: 44px` and `.actions-menu__item` to
    `min-height: 44px` (HEL-308/HEL-314), independently verified covered by
    `ActionsMenu.css.test.ts`. So D5/D7's reuse of `ActionsMenu` genuinely gets the HEL-687
    tap-target floor "for free" for both new triggers — this part of the amendment's technical
    premise is sound.
  - Gating (omit vs. disable menu items) is correctly implemented via conditional array
    construction at the call site in the existing precedents (`PanelCard.tsx`,
    `DashboardList.tsx`, `SidebarItemList.tsx` — all use `label={`${item} actions`}` naming), not
    via `ActionsMenuItem.disabled`. D5/D7's plan to omit "Edit source"/"Edit type" items when
    ungated (rather than disable them) matches this established, correct pattern.
- Confirmed `pipeline-sharing`'s spec (`openspec/specs/pipeline-sharing/spec.md:140`, "a Share
  button is visible in the page header or actions menu") — D4's claim that no delta is needed
  there for the Share button's new overflow-menu placement is accurate (unchanged from round 2's
  finding, not a new issue).
- Confirmed `openspec/specs/pipeline-dry-run-ui/spec.md` and `pipeline-run-status-ui/spec.md`
  place "Dry run"/"Run pipeline" in the footer alongside each other, consistent with the amended
  `pipeline-editor-page` delta's claim that pinning them "per pipeline-dry-run-ui's and
  pipeline-run-status-ui's own requirements" is accurate.
- Read `PipelineDetailHeader.tsx`/`.css` and `PipelineDetailFooter.tsx` (current, pre-amendment
  code) to ground D5/D6/D7 against the real DOM/CSS they modify, and to check the
  next-run-truncation root-cause claim.
- **Traced the CR1 (skeptic-final-2.md) fix path**: D6 correctly identifies that removing the
  per-group `<button>` (currently a `flex-shrink: 0` rigid-width sibling of `.group-value` inside
  each `.pipeline-detail-header__group`) plausibly frees meaningful width for
  `__schedule-next-run`, and correctly hedges this as "expected, not guaranteed," mandating
  re-measurement (task 6.3) rather than assuming success. This does not foreclose fixing CR1, and
  the mandated fallback ("keep cycle 2's shrink-priority scheme... rather than reintroducing an
  unbounded truncation") is at least safe against regressing past cycle 2's floor-based behavior.

### Two concrete, code-verified gaps in the amended plan

**1. A direct, mechanically-provable contradiction between the still-standing D3/task 4.1 and the
new D5/D7 — `PipelineDetailPage.css.test.ts`'s existing `it.each` assertions cannot be satisfied
once the amendment ships, and nothing in the amended docs resolves this.**

- Design.md's own Context section (unchanged, still standing) says `PipelineDetailPage.css.test.ts`
  statically asserts `.history-btn`/`.preview-btn`/`.dry-run-btn` "must keep passing." D3 (still
  standing — "D1-D4 above still stand") explicitly directs: "Keep the existing `__footer`,
  `__footer-right`, `__run-btn`, `__history-btn`, `__preview-btn`, `__dry-run-btn`, `__save-btn`,
  `__cancel-btn`, `__cancel-confirm-btn`, `__share-btn` class names unchanged so
  `PipelineDetailPage.css.test.ts`'s selectors keep resolving without modification." Task 4.1
  (already `[x]` complete) adds `__edit-btn` to that same "keep unchanged" list.
- I read `PipelineDetailPage.css.test.ts` directly: it does a **static, file-content** check (not
  DOM-based) — `it.each([".pipeline-detail-page__history-btn", ".pipeline-detail-page__preview-btn",
  ".pipeline-detail-page__dry-run-btn"])` asserts each selector's CSS rule body contains
  `min-height: 44px` inside the 768px block (lines 84-88).
- I read `PipelineDetailFooter.tsx`: today, `Run history`/`Preview`/`Share` render as
  `<button className="pipeline-detail-page__history-btn">` / `__preview-btn` / `__share-btn`
  (lines 266-286). D7 moves exactly these three into a second `ActionsMenu` instance. Because
  `ActionsMenuItem` has no `className` field (confirmed above), the rendered `menuitem` elements
  for these three actions **can never carry** `__history-btn`/`__preview-btn`/`__share-btn` again
  — by construction of the component being reused, not an implementation choice the executor
  controls. The identical situation applies to `__edit-btn` under D5 (all three header edit
  buttons disappear, replaced by generic `actions-menu__item` elements).
- This leaves the executor with two options, **neither of which the amended design/tasks
  acknowledge or choose between**:
  (a) Remove the now-dead `.pipeline-detail-page__history-btn`/`__preview-btn` CSS rules (correct
  cleanup, consistent with this ticket's own established convention — task 4.1 did exactly this
  for `__source-bar`/`__type-bar`/`__schedule-bar`/`__share-bar` in the original consolidation) —
  but this **breaks** `PipelineDetailPage.css.test.ts`'s existing `it.each` assertions
  (`findRuleBody` throws "Selector containing ... not found"), i.e. it fails the very guard task
  8.5 says must be re-run and pass.
  (b) Leave the CSS rules in place to keep the test green — but then the test is asserting
  properties of CSS that renders nothing (dead selectors), silently losing its meaning as a real
  HEL-687 regression guard for exactly the elements (Run history/Preview) it was written to
  protect. This is worse than a merely cosmetic dead-code nit: it's a **regression-guard
  integrity loss** for the tap-target floor on two of the three actions being relocated.
- The correct resolution — updating `PipelineDetailPage.css.test.ts`'s `it.each` list to drop the
  now-nonexistent `__history-btn`/`__preview-btn` assertions (keeping `__dry-run-btn`, which stays
  a real always-visible button per D7) and relying on the already-existing, independently-verified
  `ActionsMenu.css.test.ts` coverage for the new triggers' tap targets — is neither mentioned in
  `design.md` nor scheduled as a task anywhere in task groups 6-8. Task 8.5 only says "re-run...
  confirm no stray references," which under scenario (a) is precisely what will fail, and under
  scenario (b) silently passes on dead code.
- This is a genuine internal contradiction between a still-standing decision (D3/task 4.1: "keep
  these class names unchanged") and a new decision (D5/D7: replace these buttons with a
  reused-component's own generically-classed elements) — exactly the class of issue this ticket's
  own round-1 design gate already treated as blocking (skeptic-design-1.md's Change Request 2, a
  `findMediaBlock` collision of comparable mechanical concreteness).

**2. D6's fallback plan for "compaction alone doesn't close the gap" doesn't commit to an actual
fix, only to not regressing.** D6's last sentence: "If the compaction alone does not fully close
the gap, keep cycle 2's existing shrink-priority scheme (min-width floors, lowest-priority
elements yield first) rather than reintroducing an unbounded truncation." Cycle 2's existing
scheme is the *exact* floor/ellipsis mechanism already in place today — the one that produces the
"next r…" truncation skeptic-final-2.md found blocking. "Keep it" is not a fix; it's the status
quo the amendment was supposed to resolve. skeptic-final-2.md's own CR1 named three concrete
alternative levers (a more compact date format, a `title` hover/keyboard fallback, or
reprioritizing the group's shrink order so `__schedule-next-run` — which, per design.md's own D6
prose, "has no redundant equivalent anywhere else on the page" — yields *after* the now-hidden
disabled badge rather than before it). None of these is adopted as a committed Plan B; the
amendment only measures and hopes button-removal is sufficient. This is a real completeness gap,
though a smaller one than #1: task 6.3 does at least mandate "resolve... CR1," not merely
"measure," so the onus to actually fix it is on the executor, and a fresh final-gate budget
(confirmed via `workflow-state.md`'s AMENDMENT note: `SKEPTIC_FINAL_ROUNDS` resets once this gate
CONFIRMs) exists as a safety net if the executor's chosen fix is insufficient.

### Non-blocking notes

- Neither `design.md` nor the spec deltas specify an accessible name/`aria-label` for the
  header's new `ActionsMenu` trigger (D7's footer instance is explicit: `aria-label="More
  actions"`; D5's header instance is not). The codebase's existing `ActionsMenu` call sites all
  use a consistent `label={`${subject} actions`}` convention (`PanelCard.tsx`, `DashboardList.tsx`,
  `SidebarItemList.tsx`) — a competent implementer has an obvious precedent to follow (e.g.
  `"Pipeline actions"`), so this is not blocking, but worth an explicit line in design.md/tasks.md
  for consistency with how precisely everything else in this amendment is specified.
- Placement of the single header trigger relative to the three field groups (a fourth
  header-level element vs. living inside one specific group) is left to implementation judgment —
  reasonable, in the same spirit as D1's explicit "the executor may choose either" flexibility for
  the original consolidation.

### Verdict: REFUTE

### Change Requests

1. **Resolve the D3/task-4.1 vs. D5/D7 contradiction over `PipelineDetailPage.css.test.ts`
   before execution starts.** Add an explicit decision (a new D8, or fold into D5/D7) plus a task
   in group 6-8 directing: remove the now-dead `.pipeline-detail-page__edit-btn` CSS (base rule +
   its entry in the `@media (max-width: 768px)` combined-selector list) and the now-dead
   `.pipeline-detail-page__history-btn`/`__preview-btn`/`__share-btn` CSS (same two places) from
   `PipelineDetailPage.css`; update `PipelineDetailPage.css.test.ts`'s `it.each` list (lines
   84-88) to drop the `__history-btn`/`__preview-btn` assertions (keep `__dry-run-btn`, which
   remains real), relying on `ActionsMenu.css.test.ts`'s already-existing, independently-verified
   44px coverage for the new triggers instead of duplicating it page-locally. Update D3's/task
   4.1's now-stale "keep unchanged" framing so a future reader doesn't reasonably conclude (as I
   initially had strong grounds to) that these class names must survive verbatim.

2. **Give D6 a committed fallback, not just a non-regression floor.** If task 6.3's measurement
   shows button-removal + compaction doesn't fully close the `__schedule-next-run` gap at 1440px,
   name which of skeptic-final-2.md's three concrete levers (compact date format / `title`
   fallback / shrink-order reprioritization favoring next-run over the now-hidden badge) is the
   default next step, rather than leaving "keep cycle 2's scheme" (i.e. the status quo that
   triggered the escalation) as the only named fallback.

### Non-blocking notes (repeated for visibility)

- Specify an explicit `aria-label` for the header's `ActionsMenu` trigger in design.md/tasks.md
  (e.g. `"Pipeline actions"`, matching the codebase's `${subject} actions` convention).
