## Evaluation Report — Cycle 1 (evaluation-1.md)

Diff base: `abe2a8fae1c827976aedf696bfaa0416b210d92c` (resolved live via
`scripts/concertino/resolve-review-base.sh`). Reviewed commit (HEAD):
`26618422460c2146589a8f6f9bd3650576d36d42`.

### Phase 1: Spec Review — PASS

- Owner ruling 1 (backend-owned group, no client-side mapping) verified directly: all 27
  `domain/steps/*.scala` companions declare `group`/`catalogDescription`; `AssertStep` is the one
  deliberate ungrouped case (no `override def group`). `frontend/src/features/pipelines/state/stepNarrowing.ts`'s
  `STEP_ICONS` is genuinely icon-only (`Record<string, LucideIcon>` derived from `OP_TYPES`, keyed
  by kind, no group/order data) — confirmed by reading the diff; `StepPalette.tsx` derives every
  group label/order/membership from the fetched `PipelineStepCatalog`, never from a local table.
- Owner ruling 2 (ungrouped allowed) verified: `PipelineStep.Companion.group: Option[StepGroup] =
  None` compiles fine with no companion touched (design intent honored); `PipelineStepCatalogProtocolSpec`
  asserts the wire key is genuinely ABSENT (not null) by inspecting `JsObject.fields.keySet`, not a
  round-tripped case class — this is the correct, non-vacuous form of that assertion.
- All 27 companions checked individually (not sampled): every kind has `catalogDescription`;
  `JoinStep`/`GroupByStep` are the only two with `authorable = false`, matching design.md D5 and
  the ticket's own corrected premises.
- All four render sites (`PipelineRiverView` gap/empty-state/bottom-row, `BranchAffordance`)
  migrated with each site's own insert callback (`onInsertStep(opType, index)`, `onAddStep`,
  `onSelect`) preserved verbatim — no cross-contamination of insert context.
- `tasks.md`'s 27 items are all plausibly implemented; no scope creep found outside the ticket
  (the `OP_TYPES`-kept deviation is disclosed in `files-modified.md` with a defensible rationale —
  it backs already-persisted step-card labeling, a concern the ticket's AC never asked to touch,
  and `STEP_ICONS` alongside it satisfies D7's actual requirement).
- Schema (`schemas/pipelines/pipeline-step-catalog.schema.json`) and specs (`pipeline-step-catalog-api`,
  `pipeline-step-palette`, `pipeline-editor-page` MODIFIED delta) present and consistent with the
  implementation read.
- No non-retired `workflow-state.md` `CONSTRAINTS` entries found violated.

### Phase 2: Code Review — FAIL

Gates (fresh, not the executor's reported numbers):
- `npm run lint` — clean (0 warnings).
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` (full suite) — **3454/3454 passed**, 321 suites, matches the executor's report.
- `npm --prefix frontend run build` — clean production build.
- `cd backend && sbt test` — **4562/4562 passed**, 308 suites, matches the executor's report.

Design-standard / CONTRIBUTING compliance is otherwise solid (DESIGN.md §6 shared-component reuse,
token usage, `.eyebrow` markup). Two findings below are substantive enough to fail this cycle —
both are exactly the categories the ticket's own review brief asked me to press hardest on (the
failable checks' actual failability, and Escape/focus-restore correctness).

**CR1 — Escape does not restore focus to the trigger control (AC violation, live-verified).**
`pipeline-step-palette` spec, "Escape closes and restores focus": *"the palette closes, no step is
inserted, and focus returns to the control that opened the palette."* This is also `tasks.md` 4.4's
own verify clause. Reproduced live against the running app (both themes, both via
`+ Add transformation step` and the gap-insert `+` control): opening the palette then pressing
Escape closes the dialog, but `document.activeElement` lands on `<body>`, not the button that
opened it. Root cause: `StepPalette`'s `open` prop is a *constant* `true` at every call site
(`{dropdownOpen && <StepPalette open ... />}` in `PipelineRiverView.tsx` and `BranchAffordance.tsx`)
— the parent unmounts the whole `StepPalette`/`Modal` tree on close rather than toggling `open` to
`false`. `Modal.tsx`'s focus-restore logic (`previouslyFocusedRef.current?.focus()`, line 115) lives
in the *else* branch of the `useEffect(..., [open])` that reacts to `open` becoming `false` — that
branch never runs on an unmount, only on a true→false prop transition. This is a real,
independently-reproducible defect, not present in the old `OpDropdown` only because `OpDropdown`
never implemented Escape-to-close at all (checked `git show abe2a8fae1c...:.../OpDropdown.tsx` —
no Escape handling existed), so this is a new capability that ships broken rather than a regression
of prior behavior. No test in `StepPalette.test.tsx` or `PipelineRiverView.test.tsx` exercises
Escape at all (`grep -n "Escape" frontend/src/features/pipelines/ui/StepPalette.test.tsx
PipelineRiverView.test.tsx` returns nothing) — the missing coverage is why this shipped undetected.
Fix: either pass `StepPalette`'s/`Modal`'s `open` prop the caller's actual boolean (keep the
component mounted, toggle `open`) rather than conditionally mounting it, or have the parent's
`onClose` handler explicitly refocus the trigger before/after unmounting. Add a test asserting
focus lands back on the trigger button after Escape, for at least one of the four render sites.
(Note: `ShapePickerModal` uses the identical `{flag && <ShapePickerModal open ... />}` pattern and
likely has the same latent defect — out of scope to fix here, but worth flagging as a pre-existing
sibling bug, not a precedent that excuses this ticket's own new Escape requirement.)

**CR2 — The two "goes red" tests for the task-6.2 failable checks don't actually invoke the checked
function against a broken scenario (weak/misleading evidence, not proof of failability).**
`frontend/src/features/pipelines/ui/StepPalette.test.tsx`, describe block "StepPalette 'All'
completeness (HEL-1136 task 6.2)":
- Test `"goes red (non-empty) when an authorable catalog entry is missing from a fixture"`
  constructs `catalogMissingAnEntry` by filtering `"select"` out of `steps`, then asserts
  `expect(missingFromAllView(catalogMissingAnEntry)).not.toContain("select")`. Since `"select"` was
  removed from the *input* entirely, `missingFromAllView` (which only compares `catalog.steps`
  against its own rendered output) can never see it — the assertion is trivially true regardless of
  whether the function works at all, and never demonstrates a red/non-empty result. The real failure
  mode this check exists to catch — an entry *present* in `catalog.steps` but silently dropped by
  `buildGroups` (e.g. an entry whose declared `group` id doesn't match any `catalog.groups` entry,
  which `buildGroups`'s `for (const group of catalog.groups)` loop would in fact drop) — is never
  exercised.
- Test `"goes red when an ungrouped entry is placed inside a group by a broken fixture"` builds
  `brokenCatalog` (assert reassigned into `group: "filter-shape"`), then only asserts
  `ungroupedEntriesInACategory(fixtureCatalog)` (the **original**, un-broken fixture) equals `[]`,
  and separately asserts a fact about `brokenCatalog`'s input data. `ungroupedEntriesInACategory`
  is never called with `brokenCatalog` at all — the test never observes the function's output on
  the broken input, so it cannot demonstrate the check going red.
  Verified directly against a hand-traced mutated fixture (entry declaring a group id absent from
  `catalog.groups`, and an entry with `group` reassigned while still appearing under a labeled
  section) that `missingFromAllView`/`ungroupedEntriesInACategory`'s *implementation* is actually
  correct and would catch both cases — so this is a test-evidence gap, not a production defect. But
  per the ticket's explicit instruction ("do not accept their existence as evidence — establish they
  actually FAIL when mutated"), the shipped tests do not meet that bar and must be corrected: call
  `missingFromAllView`/`ungroupedEntriesInACategory` directly against a fixture where the entry
  remains present in `catalog.steps` but is unreachable/mis-rendered by `buildGroups`, and assert a
  non-empty result.

### Phase 3: UI Review — PASS (independent of CR1/CR2 above, which are Phase 2 findings)

Servers started via `scripts/concertino/start-servers.sh` (reused already-healthy instances),
`assert-phase.sh servers` → `PASS servers`. Exercised the palette live against `proj-2026-flat`
(a real pipeline with steps) via Playwright MCP:

- Happy path: opened via the bottom-row "+ Add transformation step" control in both dark and light
  theme — categories render with `.eyebrow` headers exactly matching `CommandPalette`'s existing
  markup (`FILTER & SHAPE`, `AGGREGATE`, `COMBINE`, ...), no new visual dialect in either theme.
  Evidence: `.concertino/runs/HEL-1136/evidence/.playwright-mcp/step-palette-dark-eval.png`,
  `.../step-palette-light-eval.png`.
- Filtering: typed `"join"` — correctly produces the "No matching steps" empty state (join is
  unauthorable and excluded from the searchable set, not merely hidden behind a broken filter).
  Evidence: `.../step-palette-filter-join-eval.png`.
- Scroll containment: the results list scrolls within the modal body (`.command-palette__results`)
  rather than the modal overflowing the viewport — corroborates the files-modified.md claim that
  F-040's clamp is moot, not regressed.
- No console errors during any tested flow (`browser_console_messages` level=error → 0 messages).
- Escape: reproduced CR1 above live in both themes.
- Did not exhaustively test every one of the 4 breakpoints (1440/1100/768/0) — the Modal component
  is a shared, previously-hardened primitive (`ui-modal--lg`, `max-height: 90vh`) already used
  elsewhere at all breakpoints; no ticket-specific breakpoint risk was identified in the diff, and
  Phase 2's findings are the higher-value use of review time this cycle.

### Overall: FAIL

### Change Requests

1. Fix Escape-then-focus-restore for `StepPalette`: keep `Modal`'s `open` prop toggling (rather
   than conditionally unmounting `StepPalette`/`Modal`) so `Modal.tsx`'s existing
   `previouslyFocusedRef.current?.focus()` restore logic actually runs on close, for all four
   render sites (`PipelineRiverView` gap/empty-state/bottom-row, `BranchAffordance`). Add a test
   (in `StepPalette.test.tsx` or a call-site test) asserting focus returns to the trigger button
   after Escape.
2. Rewrite the two task-6.2 "goes red" tests in `StepPalette.test.tsx` (the
   `"StepPalette 'All' completeness (HEL-1136 task 6.2)"` describe block) so they actually invoke
   `missingFromAllView`/`ungroupedEntriesInACategory` against a fixture where the offending entry
   remains present in `catalog.steps` but would be dropped/mis-rendered by `buildGroups` (e.g. a
   declared `group` id with no matching `catalog.groups` entry, or an entry wrongly rendered under
   a header), and assert a non-empty result from the function under test — not merely assert facts
   about the constructed fixture's input data or re-check the unmodified fixture.

### Non-blocking Suggestions

- `PipelineStepRegistryCatalogSpec`'s `"the partition guard"` tests
  (`backend/src/test/scala/com/helio/domain/model/PipelineStepRegistryCatalogSpec.scala`) are
  largely tautological — `classified.keySet shouldBe kinds` can never fail since `classified` is
  derived from the same `Registry` the assertion compares against, and the "fake kind" test only
  asserts the default `authorable`/`group` values on an anonymous companion without exercising any
  guard logic. The real, genuinely-failable coverage-equals-registry assertion already lives in
  `PipelineStepCatalogServiceSpec` (`catalog.steps.map(_.kind).toSet shouldBe
  PipelineStep.Registry.keySet`), which is sound — consider trimming or retitling the weaker
  `RegistryCatalogSpec` assertions so a future reader doesn't mistake them for the provably-failable
  guard task 6.1 asked for.
- `ShapePickerModal` appears to share the same conditional-mount pattern that causes CR1 here and
  likely has the identical Escape/focus-restore gap — worth a follow-up ticket, out of scope for
  HEL-1136.
