## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read all planning artifacts: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/table-panel-column-pinning/spec.md`, `workflow-state.md`.
- Base tree is `3baa1ebf` (`git log --oneline -1`), matching the pre-fix tree the ticket cites.
- `frontend/src/shared/ui/DataGrid.css:414-424` — the three `--pin-reserve` rules really are
  `padding-right: calc(var(--space-N) + var(--space-9))`, i.e. the 48px reservation is *already*
  subtracted from the `<th>`'s content box.
- `frontend/src/theme/theme.css:51` — `--space-9: 3rem` (48px). Confirms the arithmetic below.
- `frontend/src/shared/ui/DataGrid.css:605,635` — `min-height: 48px` on `.ui-data-grid__table thead th`
  inside `@media (max-width: 430px), (pointer: coarse)`; the `.ui-data-grid__pin-toggle-btn`
  44px floor is in the same block. AC2's target is exactly as described. AC2/D3 are sound.
- `frontend/src/shared/ui/SortableTh.css:4-15` — the real `.sortable-th__btn` rule:
  `display: inline-flex; align-items: center; gap; background; border; padding; margin; font;
  color; cursor`. It contains **none** of `overflow: visible`, `white-space: nowrap`,
  `text-overflow: clip`, and it is not "a flex item filling the header cell".
- `frontend/src/shared/ui/SortableTh.tsx:33-41` — the button's children are
  `<span>{children}</span>` + a FontAwesome glyph. A label wrapper element **already exists**
  (unclassed).
- `frontend/src/shared/ui/DataGrid.test.tsx:1487-1539` — read the two tests D4 dispositions.
- `e2e/hel813-mobile-touch-target-floor.spec.ts`, `e2e/support/touchTargetProbe.ts`,
  `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` exist; hel910 shows a working
  register-then-API-seed path (`/api/data-sources` → `/api/pipelines` → `/api/pipelines/:id/outputs`
  → place on dashboard) for a **fresh** account.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:683` is the only live `onPinToggle`
  caller, so any e2e must reach a real table panel.

### Verdict: REFUTE

Issue 2 (AC2) and its spec scenarios are sound and I have no objection to D2/D3/D6. The
label-side fix (D1/task 1.1) rests on two factually wrong premises about the code it targets, and
as written it will not produce the behavior the spec delta requires.

### Change Requests

1. **D1's stated basis for the CSS is false; correct it before implementing.** design.md D1 says
   "`SortableTh.css` already renders `.sortable-th__btn` as a flex item filling the header cell
   (per `overflow: visible; white-space: nowrap; text-overflow: clip` cited in the ticket)". The
   actual rule (`frontend/src/shared/ui/SortableTh.css:4-15`) declares none of those three
   properties and uses `display: inline-flex` (shrink-to-fit, not filling the cell) — those values
   in the ticket are *computed/initial* values, not authored declarations. Re-state D1 against the
   real rule.

2. **`text-overflow: ellipsis` on `.sortable-th__btn` cannot ellipsize the label — the target
   element is wrong.** `.sortable-th__btn` is a **flex container**; its text is not inline content
   of that box but lives in a child `<span>` flex item (`SortableTh.tsx:35`). `text-overflow`
   applies to the block container holding the overflowing inline content, so putting
   `overflow: hidden; text-overflow: ellipsis` on the flex container yields a **hard clip with no
   "…"**. The spec delta this change adds explicitly requires "the label **ellipsizes** before
   reaching the pin-toggle icon's bounding box" — the planned CSS cannot satisfy its own spec
   scenario. Additionally the `<span>` is a flex item with `min-width: auto`, so it will not shrink
   below its content width at all unless `min-width: 0` is set **on the span**. The constraint set
   (`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) belongs on the
   label element, with `min-width: 0` also on the button so it can shrink.
   Note that D1's rejected alternative ("wrap the label in a new `<span>` — an unnecessary DOM/JSX
   change") is moot: the wrapper already exists. It is merely unclassed, so decide and record
   whether to add a class in `SortableTh.tsx` (preferred, greppable) or select
   `.sortable-th__btn > span` from CSS — and drop the artefactual "CSS-only, no markup change"
   framing if a class is added.

3. **`max-width: calc(100% - var(--space-9))` double-reserves the icon's 48px.** A percentage
   `max-width` resolves against the containing block's **content** width, and the `<th>`'s content
   width has *already* had `var(--space-9)` removed by the `--pin-reserve` `padding-right`
   (`DataGrid.css:414-424`, confirmed `--space-9: 3rem` = 48px, sized as "`right: var(--space-6)`
   + 24px icon = 48px"). Keeping both (D2) therefore reserves ~96px and truncates every pinnable
   header label ~48px earlier than needed — not "harmless defense-in-depth" but a visible
   regression on narrow columns. Resolve explicitly: either the label constraint is plain
   `max-width: 100%` (relying on the existing padding reservation) or the padding reservation is
   dropped in favour of the calc — not both. Record the decision in design.md and reconcile D2.

4. **D4 misdescribes what deleting the `min-height: 48px` test removes.** That test
   (`DataGrid.test.tsx:1529-1539`) asserts *two* things: the `min-height: 48px` row rule **and**
   that `.ui-data-grid__pin-toggle-btn { min-height: 44px }` lives in the **same** media query —
   the co-location/drift guard, which is a still-true structural fact of exactly the kind D4's own
   rationale says is worth keeping ("only the tests whose only claim was 'the ineffective rule's
   text is present' are removed" is not true of this test). Amend D4 and task 4.1 to retain the
   same-media-query 44px assertion (updating the row-height line to `height: 48px` or dropping it),
   rather than deleting the whole test.

5. **Name the e2e's route to a rendered, pinnable table — tasks 3.1/3.2 are unimplementable as
   written.** D5 says "plain desktop context + `pinnedColumns` fixture data" with no mechanism, and
   `ticket.md` states the dev user owns zero Outputs and every write 403s, which reads as "there is
   no way to render one". Ground truth says otherwise for a *fresh* account:
   `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:57,215-253` registers a user and seeds
   dashboard → data-source → pipeline → output → panel via API. Specify that (or another concrete)
   seeding path in design.md/tasks.md, including how the fixture guarantees **≥3 pinned columns**
   and at least one **genuinely truncating** label (the ticket's `labelUnderPinIcon === 0` check is
   vacuous if nothing truncates), and how pins are applied (UI clicks on the toggle vs. seeded
   `pinnedColumns` appearance state).

### Non-blocking notes
- Task 1.1's "(scoped appropriately)" is the only unspecified word in the plan; once CR2/CR3 are
  settled, state the literal selector (e.g. `.ui-data-grid__th--pin-reserve .sortable-th__btn`) so
  a non-pinning `DataGrid`/other `SortableTh` consumer is provably unaffected.
- D6's stash-based red-before-green will also need the *test* file present while the *CSS* is
  reverted; `git stash push -- frontend/src/shared/ui/DataGrid.css` (path-scoped) is the safe form.
