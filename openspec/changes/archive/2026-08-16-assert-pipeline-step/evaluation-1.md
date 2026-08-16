## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified against `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/pipeline-assert-op/spec.md`:

- All 6 acceptance criteria addressed explicitly, none reinterpreted:
  - AC1 (persist/round-trip/registry/parity): `AssertStep.scala` companion
    (`decodeConfig`/`encodeConfig`/`readFromWire`/`writeToWire`), registered in
    `PipelineStep.Registry`, `PipelineStepSpec`'s parity/exhaustiveness tests extended
    and passing.
  - AC2 (migration): `V82__add_assert_op.sql` — drop/re-add pattern, full existing op
    list preserved plus `'assert'`, confirmed V82 is the correct next number (V81 was
    the prior highest on disk) and migrates cleanly (verified live via `sbt test`'s
    Flyway log, "Successfully applied 82 migrations").
  - AC3 (analyze identity + validationError): dedicated `inferAssert` dispatch case,
    identity output schema always, aggregated `validationError` for invalid
    kind/severity/missing-or-unknown field; `rowCountMin`/`rowCountMax` correctly
    exempted from the field check.
  - AC4 (decode tolerance): `AssertConfig.decode` never throws, per-field-lenient,
    verified by both unit tests and live browser exercise.
  - AC5 (editor + Jest): `AssertConfig.tsx` add/remove rules, kind/field/params/severity
    controls, reachable from `OpDropdown`'s `OP_TYPES`; `AssertConfig.test.tsx` covers
    add/remove/hydration/per-kind field visibility/onChange payloads.
  - AC6 (`sbt test`/`npm test` pass, no FQNs): confirmed via independent fresh gate
    runs (see Phase 2).
- All 25 `tasks.md` items cross-checked against the diff — every one maps to real,
  correctly-scoped code (spot-checked in detail: 1.1-1.4, 2.1-2.4, 3.1-3.5, 4.1,
  5.1-5.5, 6.1-6.6).
- No scope creep: files touched match `proposal.md`'s Impact section exactly (32 files
  changed, all either the new step module, its ~10 mechanical touch points, tests, or
  planning artifacts).
- No regressions: full `sbt test` (2894/2894) and `npm test` (1691 frontend + 156
  helio-mcp) suites pass, including the pre-existing `PipelineStepConfigCodecSpec`,
  `PipelineStepProtocolSpec`, and `InProcessPipelineEngineSpec` regression coverage
  design.md's Risks section calls out as the safety net for the ten-plus touch points.
- API contract: `schemas/pipeline-proposal.schema.json`'s non-enforced op-list doc
  string updated to include `assert`, matching every prior op ticket's precedent (this
  schema intentionally leaves `type` unconstrained/unenumerated — the backend registry
  is authoritative — so this is documentation-only, correctly scoped).
- Planning artifacts reflect the final implementation with no drift (design.md's seven
  decisions all traced correctly into the actual code: `AssertConfig` is a wrapped case
  class not a bare vector; decode is per-field-lenient with `"warn"` default vs. the
  editor's `"error"` new-rule default; field-required-kind set matches between backend
  `inferAssert` and frontend `AssertConfig.tsx`; `inferAssert` is a dedicated dispatch
  case; no `params` shape validation).

**Verified the executor's flagged pre-commit bypass claim independently** (per the
orchestrator's request): re-ran `npm run check:openspec` myself. It fails with exactly
the single reason the commit body states — `change "assert-pipeline-step" is complete
(25/25) but not archived`. `scripts/concertino/README.md` confirms archiving is
explicitly the orchestrator's job ("Delivery (squash, archive, PR) stays in the
orchestrator"), not the executor's, at this point in the workflow. `git log --grep`
across the repo shows this identical bypass pattern (same hook, same reason, same
commit-body disclosure) on essentially every other ticket's final executor commit
(HEL-478, HEL-472, HEL-667, HEL-666, HEL-665, HEL-664, HEL-663, ...) — this is the
expected, structurally-unavoidable state of every executor's final commit in this
workflow, not a defect or a misuse of `-n`. The bypass is accurately characterized and
correctly documented in the commit body per `CONTRIBUTING.md`'s bypass-disclosure
policy.

### Phase 2: Code Review — PASS

Issues: none.

**Fresh gate re-runs (not the executor's report) — all green, matching the executor's
claimed numbers exactly:**
- `npm run lint` — clean, 0 warnings.
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm test` — 156/156 (helio-mcp) + 1691/1691 (frontend) passed.
- `npm --prefix frontend run build` — succeeded (pre-existing >500kB chunk-size
  warning, unrelated to this change).
- `cd backend && sbt test` — 2894/2894 passed, 187 suites, 0 failed. Flyway log
  confirms V82 applies cleanly on top of V81 with no gaps.
- `npm run check:scala-quality` — clean, 0 inline-FQN violations (also spot-checked
  manually via grep on all four new/heavily-touched Scala files — the one `com.helio.*`
  hit is inside a scaladoc comment, not code).
- `npm run check:schemas` — schemas in sync with JsonProtocols.

**CONTRIBUTING.md compliance (mechanical):**
- Imports & Qualifiers: no inlined FQNs (verified above).
- File-size budgets: `AssertStep.scala` (103 lines), `AssertConfig.tsx` (229 lines),
  `AssertConfig.test.tsx` (229 lines) — all well under the 250-line soft budget; the
  only budget warnings in the full `check:scala-quality` run are pre-existing files
  untouched by this change.
- Behavior-preserving: this is purely additive (new op registration + dispatch arms);
  no existing dispatch arm, config, or behavior was altered.

**DESIGN.md compliance (mechanical, frontend):** `AssertConfig.tsx` adds no new CSS —
it reuses the existing `pipeline-detail-page__aggregate-*` shared classes (the same
reuse pattern `AggregateConfig.tsx`/`PivotConfig.tsx`/`WindowConfig.tsx`/
`LookupConfig.tsx`/`UnpivotConfig.tsx` already establish), and uses the shared
`Select`/`TextField` components rather than hand-rolled controls. No hardcoded
hex/rgb, no inline `style={{}}`, no numeric `font-weight` literals. Every interactive
control carries an explicit `ariaLabel`/`aria-label`.

**Other checks:**
- DRY: matches the established per-step-file ADT pattern exactly (compared directly
  against `FilterStep.scala`); no duplicated logic invented.
- Readable: clear naming, doc comments cross-reference design.md's decisions at each
  non-obvious choice (e.g., decode-tolerance default vs. UI-default severity split).
- Modular: config/rule/step/companion cleanly separated, matching sibling steps.
- Type safety: no untyped escape hatches; `AssertConfig`/`AssertRule` are fully typed
  on both backend (Scala case classes) and frontend (TS interfaces).
- Error handling: `inferAssert` wraps parsing in `try`/`catch`, degrades to a generic
  `"assert config error"` validationError and logs the detail server-side (matches
  every sibling `infer*` function's HEL-311 pattern exactly).
- Tests meaningful: `AssertStepSpec` (decode tolerance + identity evaluate),
  `PipelineAnalyzeServiceSpec` (8 new cases: identity, empty rules, unknown field,
  invalid kind, invalid severity, rowCountMin/Max field-exemption, multi-rule
  aggregation, malformed config), `PipelineStepConfigCodecSpec` (round-trip +
  tolerance), `PipelineStepSpec` (parity), `AssertConfig.test.tsx` (18 cases covering
  add/remove/per-kind visibility/params/onChange/hydration) — these would catch a real
  regression in any of the touch points.
- No dead code: no unused imports, no leftover TODO/FIXME in the new files.
- No over-engineering: no premature abstraction; matches the exact ~10-touch-point
  mechanical pattern every sibling op follows, as design.md's Context section
  documents.

### Phase 3: UI Review — PASS

Issues: none.

Triggered by `frontend/**` changes + `schemas/pipeline-proposal.schema.json`. Started
servers via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (both reported
healthy). Exercised the feature live in the browser end-to-end:

- **Happy path**: created a static data source and a pipeline, added an `assert` step
  via the op-picker dropdown ("Assert / validate" appears exactly where AC5's spec
  scenario requires), expanded the step card, clicked "+ Add rule" — a rule row
  appeared with `kind=notNull`, `field` seeded to the first schema field, `severity`
  defaulting to `"error"` (confirming design.md Decision 3's UI-default, distinct from
  the decode-tolerance default of `"warn"`). Clicked "Preview data" — the identity
  pass-through was confirmed live: input row `{id: "1", amount: "10"}` came back
  unchanged in the output grid.
- **Per-kind field visibility**: switched `kind` to `range` — min/max number inputs
  appeared, field selector stayed visible (field-requiring kind). All 6 rule kinds
  (`notNull`/`unique`/`range`/`rowCountMin`/`rowCountMax`/`regex`) present in the kind
  dropdown.
- **Removing a rule**: PATCHed successfully (200 OK), rule row removed from the UI.
- **Unhappy paths**: the field selector is sourced from the live schema, so an
  invalid-field selection isn't reachable through the UI (by design — it's exercised at
  the API/unit-test level instead, where it's covered). No blank screens or unhandled
  exceptions observed in any exercised flow.
- **validationError surfacing**: confirmed (via `StepCard.tsx`) that `validationError`
  is currently only rendered by the `compute` op's editor project-wide — `pivot`,
  `unpivot`, and `lookup` (all of which can also emit a `validationError`) receive the
  same non-rendering treatment as `assert`. This is pre-existing, consistent behavior
  across every non-`compute` op, not a gap introduced by this ticket.
- **Console**: zero new console errors in any tested flow. One pre-existing, unrelated
  404 (`GET /api/pipelines/:id/schedule` — no schedule configured yet) appears on every
  pipeline-detail page load regardless of step type; not a regression from this change.
- **Entry points**: confirmed reachable via the "+ Add step" op-picker dropdown (the
  only entry point the spec calls out).
- **Accessibility**: every control (`Kind for rule N`, `Field for rule N`, `Severity
  for rule N`, `Remove rule N`, per-kind param inputs, `+ Add rule`) carries an
  explicit accessible name. Verified keyboard operability by tabbing through the
  expanded editor — focus advances predictably from the rule controls through "Hide
  preview"/"Remove step" with no trap.
- **Breakpoints**: 1440 (light + dark), 1100, 768, and 375(*) all render without
  layout breakage. (*) At 375px the page's internal `.pipeline-detail-page__river`
  scroll container initially clips lower controls under the sticky OUTPUT summary bar
  — this is the pre-existing mobile-PWA scroll pattern (an internal scrollable region,
  not a page-level scroll), confirmed by scrolling that specific container, after which
  every control (including the assert rule row, "+ Add rule", "Preview data"/"Remove
  step", and the preview grid) is fully reachable. Not specific to `assert` and not a
  regression — the same pattern applies to every step type's card.
- **Light/dark parity**: screenshots at 1440 in both themes show consistent token usage
  (surface/border/text colors swap correctly, orange accent unchanged), no theme-only
  breakage.

### Overall: PASS

### Non-blocking Suggestions

- None beyond the two the design-gate skeptic already carried forward as non-blocking
  (per-kind params widget shapes and the UI-default-severity spot-check) — both were
  verified live in Phase 3 above and found correctly implemented, so no further action
  needed.
