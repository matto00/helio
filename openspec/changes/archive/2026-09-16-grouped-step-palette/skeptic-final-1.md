## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Diff base resolved live: `abe2a8fae1c827976aedf696bfaa0416b210d92c` (matches the stated base — verified
via `scripts/concertino/resolve-review-base.sh`, exit 0). HEAD reviewed: `3fea4951251d272f41601cd0ffc77c7d4a22d546`.
Tree clean throughout (`git status --porcelain` empty except the pre-existing untracked `evaluation-2.md`
report, which I did not create).

### What I verified (with evidence)

**Owner ruling 1 (backend-owned group, no frontend mapping).**
- `StepGroup.scala` (sealed ADT, id/label/order) and `PipelineStep.Companion.group: Option[StepGroup]`,
  `catalogDescription`, `authorable` read directly.
- `PipelineStepCatalogService.catalog()` projects `Registry` into `{groups, steps}`.
- Grepped `OP_TYPES` in `stepNarrowing.ts`: contains only `{id, label, icon}` — no `group` field anywhere
  client-side. `STEP_ICONS` (the D7 deviation) is derived purely from `OP_TYPES.icon`, used only for glyph
  lookup in `StepPalette.tsx`'s `toOpType`. Grepped every `OP_TYPES` usage site: all are icon/label
  resolution for already-persisted/newly-created step cards (`pipelineStepToStep`), never the palette's
  category data. The kept-not-deleted `OP_TYPES` (files-modified.md's declared deviation) does not
  reintroduce a group mapping — confirmed by absence of any `group` key, not by the executor's claim alone.

**Owner ruling 2 (ungrouped allowed, absent not null).**
- `PipelineStepCatalogProtocolSpec.scala` inspects the raw `JsObject.fields.keySet` for the `None` case
  (`should not contain "group"`) — a genuine absent-key assertion, not a `null` check.
- Live in the running app (both themes): "Assert / validate" (the ungrouped step) renders with no group
  header, mixed in among grouped entries only while filtering (flattened), and alone under a `label: null`
  bucket in the unfiltered "All" view. Confirmed via DOM query of `.command-palette__group` — the
  ungrouped bucket carries no `.eyebrow` label.

**Mutation-proved the failable checks myself** (not accepted on the evaluator's claim):
- Reverted `PipelineRiverView.tsx`'s gap-insert `StepPalette` to the pre-CR1 conditional-mount form,
  ran `npx jest --testPathPatterns=PipelineRiverView`: the new Escape/focus-restore regression test failed
  exactly as expected (`received <body>`), 1 failed / 35 passed. Restored byte-identical (`git diff --stat`
  empty afterward).
- Stubbed `missingFromAllView` and `findUngroupedEntriesInGroups` in `StepPalette.tsx` to `return []`, ran
  `npx jest --testPathPatterns=StepPalette`: both CR2 tests failed exactly as expected (`Expected ["select"],
  Received []` and `Expected ["assert"], Received []`). Restored byte-identical.
- These are genuinely failable, not relocated vacuous assertions.

**Live keyboard/focus verification against the running app** (`DEV_PORT=6568`/`BACKEND_PORT=9475`,
`proj-2026-flat` pipeline), all three insert-context triggers, both themes:
- Gap-insert (`+`), bottom-row (`+ Add transformation step`), and `BranchAffordance`'s "Branch" pill: each
  opens its own `StepPalette`, and Escape closes it AND restores focus to that exact trigger element
  (verified via `document.activeElement` after a real focused-then-clicked open, not a synthetic click on
  an unfocused element — an earlier probe of mine that skipped `.focus()` gave a false negative in light
  theme, which I diagnosed and re-verified correctly; noting this since it's exactly the kind of
  single-anomalous-reading the review protocol requires re-running before concluding).
- Typed filter narrows live and flattens across groups (no eyebrow headers while filtering); the ungrouped
  "Assert / validate" entry appears interleaved with grouped matches, confirming D6's flatten-while-filtering
  behavior.
- ArrowDown from the last item of "Filter & shape" (9 items) correctly crossed into "Aggregate" and
  scrolled the new item into view (F-189 preserved) — screenshot evidence:
  `.concertino/runs/HEL-1136/evidence/.playwright-mcp/skeptic-crossgroup.png`.
- Enter selected and inserted a step at the trigger's own context (bottom-row insert correctly appended via
  `handleAddStep`/`handleInsertStep(opType, steps.length)`, code path unchanged by this diff — confirmed
  `usePipelineDetailPage.ts` has zero diff against base).
- Zero console errors across every check (`browser_console_messages` level=error, repeated checks).
- Light-theme screenshot: `.concertino/runs/HEL-1136/evidence/.playwright-mcp/skeptic-palette-light2.png`.
  BranchAffordance-opened palette: `.concertino/runs/HEL-1136/evidence/.playwright-mcp/skeptic-branch-palette.png`.

**F-040 retirement (moot, not regressed).** Directly measured in the running app:
`.command-palette__results` had `scrollHeight: 1524` vs `clientHeight: 432` (scrolls internally) while
`.ui-modal`'s computed `max-height` was `648px` (capped). Genuine internal scroll containment, not merely
claimed.

**Registered-but-unauthorable ops (join/groupby).** Extracted every `.command-palette__item-title` from the
live open dialog: 25 entries, matching authorable count; neither "Join tables" nor "Group by (legacy)"
appears anywhere, including while filtering (`buildGroups` filters to `authorableEntries` before either the
grouped or flattened branch runs) — confirmed by reading `StepPalette.tsx` directly, not merely by not
finding them in one screenshot.

**Dangling-group-id gap and OP_TYPES deviation — DEFER to the design gate's / prior cycle's ruling.**
Read the reasoning in evaluation-2.md and design.md D1/D5/D7 myself and independently re-derived the same
conclusion from the code: `PipelineStepCatalogService.catalog()` derives both `catalog.groups` and every
`entry.group` from the same `StepGroup.All`/`companion.group` source, so the dangling-id path is provably
unreachable through the real API today, and `missingFromAllView`'s test (which I mutation-proved above)
covers exactly the failure mode the AC asks for. I concur this is acceptable defense-in-depth, not a
required fix — three independent reviewers (design skeptic's framing, evaluator, now me) reaching the same
conclusion from the same evidence is not "agreement for its own sake" here because each of us re-derived it
from the source, not from each other's say-so.

**Gates — fresh, this cycle, by me:**
- `npm test` (frontend): **3456/3456**, 321 suites — matches reported.
- `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run build`: all clean.
- `cd backend && sbt test`: **4561/4561**, 308 suites, "All tests passed" — matches reported and the
  evaluator's arithmetic (4562→4561 from the tautological-assertion trim). Ran to completion in the
  background with `timeout 590000` per the instructions, output read directly.
- Schema (`schemas/pipelines/pipeline-step-catalog.schema.json`) and openspec deltas
  (`specs/pipeline-step-catalog-api/spec.md`) read directly and match the shipped wire shape (group not in
  `required`, arrays not objects, absent-not-null documented).

**E2E quarantine claim — independently verified, plus one gap the evaluator's report did not surface.**
- Confirmed `git diff abe2a8fa...HEAD --stat -- playwright.config.ts` and `git log abe2a8fa..HEAD --oneline
  -- playwright.config.ts` are both empty — the quarantine list was not touched by this branch.
- Read the quarantine comments directly: `hel908-tail-attach.spec.ts` (HEL-951/962, "Add tail step" button
  locator resolves to 0 elements — a pre-existing, unrelated defect) and `hel908-full-flow.spec.ts`
  (HEL-951/964, flaky, pre-existing) are both quarantined for reasons that predate and are unrelated to this
  diff.
- **New finding, non-blocking:** both of those specs (and use `getByRole("menuitem", ...)` to interact with
  the add-step surface after opening it — markup this ticket deleted (`StepPalette` uses `role="option"`/
  `role="listbox"`, not `role="menu"`/`menuitem`). `hel908-tail-attach.spec.ts` fails upstream of that call
  (at the "Add tail step" button-count assertion) so its existing quarantine reason is unaffected; but when
  HEL-962/964 eventually fix the underlying defects and un-quarantine these specs, they will fail again
  immediately on the stale `menuitem` selector, on top of whatever their original fix addressed. This ticket
  had no obligation to fix quarantined specs, and I am not treating this as a defect in HEL-1136 — but it is
  a real, disclosable gap the evaluator's report did not mention (it verified the CURRENT quarantine reason
  is unrelated, not that re-enabling would work once that reason is fixed). Flagging for whoever picks up
  HEL-962/964 next.

**Gate defect check (mtime-ordering acceptance).** Neither evaluation-1.md nor evaluation-2.md discloses an
unsound-mtime evidence directory, and I did not accept any mtime-ordering claim at face value in this
review — all load-bearing conclusions above rest on my own fresh command output, direct source reads, or
self-authenticating DOM measurements (scrollHeight/clientHeight, JSON key presence, jest failure text). No
gate defect to record here.

### Verdict: CONFIRM

All four owner-ruling-adjacent decisions (backend-owned group, no frontend mapping, ungrouped-allowed with
absent-not-null wire contract, unauthorable-ops handling, no-new-visual-dialect) verified against running
code and the running app, not accepted on report claims. Both cycle-1 CRs are genuinely fixed and
mutation-provably failable. All gates re-run fresh and green, matching reported numbers exactly. UI reviewed
live in both themes against DESIGN.md's shared-component/token standard — no new visual dialect; the palette
is visually and interactively consistent with `CommandPalette`.

### What the v0.8.2 release verification should specifically check

1. This ticket does not change `usePipelineDetailPage.ts`'s append/insert position logic (confirmed zero
   diff against base) — if anyone notices a newly-added step landing before an existing step rather than
   after it, that is a pre-existing behavior of `handleInsertStep`'s index math, not something HEL-1136
   introduced or should be blamed for. I hit this during manual testing and traced it to pre-existing code
   before concluding it wasn't a regression; worth a heads-up so it isn't rediscovered as a false regression
   against this ticket later.
2. `hel908-tail-attach.spec.ts` and `hel908-full-flow.spec.ts` will need a `menuitem`→`option` selector
   update in addition to their existing HEL-962/964 fixes before they can be un-quarantined — not required
   for this release, but avoids a surprise when that follow-up work starts.
3. `ShapePickerModal` (flagged by the evaluator, not part of this ticket) still uses the pre-CR1
   conditional-mount pattern and likely has the same latent Escape/focus-restore gap `StepPalette` just
   fixed — worth its own follow-up ticket, out of scope here.

### Change Requests

None.

### Non-blocking Suggestions

- Carried from evaluation-2.md: the one-line `buildGroups` robustness fix (route a dangling group id to the
  header-less bucket like absent) — unreachable today, already caught by `missingFromAllView` if it ever
  occurred, not required.
- File a follow-up for the `menuitem`→`option` staleness in the two quarantined add-step e2e specs noted
  above, timed to land alongside whichever of HEL-962/964 un-quarantines them first.
