## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Round 2 of the amendment-scoped design gate. Verifying whether round 1's two change requests
(skeptic-design-3.md) are genuinely resolved. Ground truth re-derived from scratch; prior reports
(including skeptic-design-3.md itself) read as claims to verify, not fact.

### What I verified (with evidence)

- Read `design.md` in full, including the new **D8** and the annotated D3. Read `tasks.md` in
  full, including task groups 6-8. Read `ticket.md`'s Scope Amendment + Acceptance Criteria and
  `proposal.md`'s Scope amendment section. Read both spec deltas
  (`specs/pipeline-editor-page/spec.md`, `specs/pipeline-schedule-config-ui/spec.md`) in full.
- `openspec validate pipeline-detail-header-footer --strict` → reproduced **twice**: `Change
  'pipeline-detail-header-footer' is valid` both times.
- `git diff --stat main...HEAD -- frontend/src` confirms only D1-D4/Cycle-1-3 code has shipped
  (`PipelineDetailHeader.tsx/.css`, `PipelineDetailFooter.tsx`, `BoundSourceBar`/`BoundTypeBar`/
  `PipelineScheduleBar` deletion, `labelForKind` relocation) — tasks 6.1-8.6 are still `[ ]`
  unchecked, so no amendment code exists yet. This is a pure design-doc re-review, as expected.

**CR1 (dead-CSS-selector contradiction) — verified resolved.**
- Read `PipelineDetailPage.css` directly: confirmed the base rules D8 describes exist exactly as
  claimed — `.pipeline-detail-page__edit-btn` (line 42, standalone), `.pipeline-detail-page
  __preview-btn, .pipeline-detail-page__history-btn` (lines 650-651, combined, standalone block),
  `.pipeline-detail-page__dry-run-btn` (line 992, standalone), `.pipeline-detail-page__share-btn`
  (line 1416, standalone) — and the `@media (max-width: 768px)` combined-selector list at lines
  1468-1480 containing all of `history-btn`/`preview-btn`/`dry-run-btn`/`run-btn`/`save-btn`/
  `cancel-btn`/`cancel-confirm-btn`/`edit-btn`/`share-btn`. Every rule block D8 targets for removal
  is self-contained (no shared block with a selector that must survive), so D8's four-selector
  removal plan is mechanically clean, not just plausible.
- Read `PipelineDetailPage.css.test.ts` directly: the `it.each` list at lines 82-86 is exactly
  `[".pipeline-detail-page__history-btn", ".pipeline-detail-page__preview-btn",
  ".pipeline-detail-page__dry-run-btn"]` as D8 describes — task 8.4's planned edit (drop the first
  two, keep `__dry-run-btn`) is accurate against the real file.
- Read `ActionsMenu.css.test.ts` directly: confirms real, already-existing, independently-verified
  44px coverage for `.actions-menu__trigger`/`.actions-menu__item` inside its own
  `@media (max-width: 768px)` block — D8's claim that this is a legitimate substitute for the
  deleted page-local assertions (not hand-waved) is accurate.
- D3 now carries an explicit "Superseded for `__history-btn`/`__preview-btn`/`__share-btn` by the
  amendment's D8 below" note; D8 itself explicitly calls out that "task 4.1's inclusion of
  `__edit-btn` in the same list ... is now superseded." tasks.md 8.4 mirrors D8's four-selector
  removal + test-update plan verbatim. The contradiction round 1 found (D3/task-4.1's "keep
  unchanged" vs. D5/D7's `ActionsMenu` reuse making these selectors structurally dead) is
  genuinely closed with a concrete, code-grounded plan — not just asserted.

**CR2 (D6's fallback wasn't a committed fix) — verified resolved.**
- Read `PipelineDetailHeader.css` directly: confirmed the actual current shrink-priority scheme
  D6's fallback (b) proposes to reverse is real and correctly characterized —
  `.pipeline-detail-header__schedule-expression` has `min-width: 70px` (higher floor, shrinks
  later) while `.pipeline-detail-header__schedule-next-run` has `min-width: 24px` (lower floor,
  shrinks/truncates first), with an inline comment confirming this is deliberate ("this badge is
  ... low priority shrink target ... ellipsis-truncates before `__schedule-expression` does").
  D6's fallback (b) — "reprioritize so `__schedule-expression` yields before
  `__schedule-next-run`" — is a real, concrete reversal of a real, currently-existing priority
  scheme, not an abstract gesture.
- Read `PipelineDetailHeader.tsx` directly: confirmed `formatNextRun` currently uses
  `dateStyle: "medium", timeStyle: "short"` (e.g. "Aug 17, 2026, 3:04 PM") — fallback (a)'s
  "drop the year / abbreviate the month" proposal is concretely actionable against this real
  formatter, and the `title="Disabled"` precedent it cites for the badge (line 153) is real,
  confirming the recoverability pattern it proposes to mirror actually exists in this codebase.
  tasks.md 6.3 mirrors D6's two-step fallback order verbatim.
- This is now a committed default next step ("if it isn't fully closed, apply ... in order: (a) ...
  (b) ..."), not "keep cycle 2's scheme" (the status quo that triggered the escalation) as round 1
  correctly flagged.

**Non-blocking item from round 1 (aria-label) — verified resolved.** D5 now states
`aria-label="Pipeline actions"` explicitly; task 6.1 matches. Confirmed against
`ActionsMenu.tsx` (the `label` prop is rendered as `aria-label` on both trigger and panel, lines
99/135) and the codebase's existing `${subject} actions` convention (`PanelCard.tsx` line 287:
`label={\`${panel.title} panel actions\`}`) — consistent with precedent.

**Spec deltas already reflect the amendment.** Both `pipeline-editor-page/spec.md` and
`pipeline-schedule-config-ui/spec.md` already describe the menu-based header actions and the
footer's pinned/overflow split (e.g. "Header actions consolidate into one menu",
"Footer pins primary actions and collapses the rest into an overflow menu" requirements) — no
leftover reference to the old per-button structure that would contradict D5-D8.

### One residual soft spot (non-blocking)

- Design.md's **Context** section (top of file, unchanged since before the Scope Amendment was
  added) still states `PipelineDetailPage.css.test.ts`'s assertions on `.history-btn`/
  `.preview-btn`/`.dry-run-btn` "must keep passing since nothing in this change touches
  viewport-geometry behavior" — literally true only of the original D1-D4 consolidation this
  sentence describes, and now superseded for two of those three selectors by D8. Unlike round 1's
  CR1 (D3 is a standing *directive* the amendment structurally violates), this is background/
  motivation prose, and D8 is explicit and specific enough (it even names D3/task 4.1 by number)
  that a reader working through the whole document would not be misled. Worth a one-line
  parenthetical in Context for polish, not blocking.

### Verdict: CONFIRM

Both round-1 change requests are genuinely resolved with concrete, code-grounded plans (verified
against the actual CSS/test/component files, not just re-asserted in prose), and no new
contradiction was introduced. `openspec validate --strict` passes reproducibly. The amendment is
sound enough to resume execution.

### Non-blocking notes

- Add the one-line Context-section parenthetical noted above, acknowledging D8's supersession of
  two of the three cited selectors, for a reader who stops at Context without reading D8.
- Task 4.1 itself (already `[x]` complete, a historical task) is not directly annotated with a
  pointer to D8 — the supersession is explained in design.md (D3's note + D8's own text) instead.
  Sufficient given D8 is unambiguous and task 8.4 in the same tasks.md file directs the actual
  removal, but a direct one-line annotation on 4.1 would remove any last doubt for a reader who
  only skims the task checklist.
