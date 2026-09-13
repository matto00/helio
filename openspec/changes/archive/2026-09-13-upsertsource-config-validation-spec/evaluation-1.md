## Evaluation Report — Cycle 1 (evaluation-1.md)

Retroactive first genuine evaluator pass for HEL-1099 (PR #657). Reviewed diff against
resolved review base `0fd32ab46b8591cb54c0d7225ad649029744b39f`...HEAD (`323f49dc`).

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: config model (`target`/`mode`), write-path `validateRawConfig`
  strictness, ownership pre-flight, and an openspec spec exist.
- The ticket's own stale premise ("no step kind currently gets `validateRawConfig`") is
  correctly *not* taken at face value by the implementation — `UpsertSourceConfig` ships as a
  free-standing object precisely because `upsertsource` is not registered in
  `PipelineStep.Registry`/`PipelineStepKind.All`, so there is no `Companion` to attach a
  generic hook to yet. Confirmed by grep: no reference to `"upsertsource"` anywhere under
  `backend/src/main/scala/` outside `UpsertSourceConfig.scala` itself — it is genuinely
  unreachable through any running route, matching design.md Decision 1's claim.
- Confirmed the pinned test `PipelineCreateTransactionalSpec.scala:167-188` (parameterized over
  `upsertsource`/`convertformat`/`analyzewithai`/`generatetext`) still rejects `upsertsource`
  with a 400 "Invalid step type" and was left standing, not flipped. Ran it directly — 25/25
  pass, rejection case included.
- Scope-decision (non-registration) is well-reasoned and independently verifiable, not just
  asserted in the design doc — verified directly against code and the pinned test rather than
  trusting the doc's claim.
- No scope creep: diff touches only the new config file, its spec, and openspec archive
  artifacts. No `.husky/**` files touched (grep confirmed).
- Planning artifacts (proposal/design/tasks, all archived) match the shipped behavior; tasks.md
  items are all checked and correspond to real shipped work (config+codec, write-path
  validation, tests, spec, documentation of the registry seam).
- No regressions: `PipelineCreateTransactionalSpec` full suite (25 tests) green; nothing else in
  the read path (`PipelineStepRepository.rowToDomain`) is touched by this diff.
- No `workflow-state.md` CONSTRAINTS entries found needing separate application (fresh cycle-1
  eval, no accumulated constraints beyond the diff-level checks already covered).

### Phase 2: Code Review — PASS

Ran fresh gates myself (not trusting executor's report):
- `sbt "testOnly com.helio.domain.steps.UpsertSourceConfigSpec"` — 24/24 pass.
- `sbt "testOnly com.helio.services.pipelines.PipelineCreateTransactionalSpec"` — 25/25 pass
  (includes the pinned rejection case).
- `node scripts/check-scala-quality.mjs` — clean (pre-existing soft warnings elsewhere in the
  repo unrelated to this diff; none newly introduced by the changed files).
- `npm run check:openspec` — "openspec/ is clean".
- No `scalafmtCheckAll` task exists in this project's sbt build (confirmed: "Not a valid
  command") — formatting is not a distinct backend gate here, consistent with CLAUDE.md's
  documented backend command set (`sbt test` only).

Code-quality findings:
- **Write-path/read-path never diverges toward over-strictness.** Traced both paths:
  `decode` treats absent `target`/`mode` as defaults, raises `StepConfigTypeMismatch` only for
  a present-but-wrong-typed value. `validateRawConfig`'s `decodeErrorFor` performs the
  structurally identical checks (reusing `UpsertTarget.format.read` for `target`, an inline
  type check for `mode`) and `modeError` only adds the *closed-enum* check that `decode`
  deliberately does not perform (by design, since `decode` must tolerate any string it might
  later need to re-validate). Write-path strictness is therefore a proper superset that never
  rejects anything `decode` would accept as a *valid, present* value — confirmed by the round-trip
  and "accept absent" test pairs in `UpsertSourceConfigSpec`.
- **DRY**: `decodeErrorFor`'s `target` check literally re-invokes `UpsertTarget.format.read`
  rather than re-implementing shape logic — good reuse. Minor: `jsonKindNameOf` is duplicated
  verbatim between `UpsertTarget` (private, line 117) and `UpsertSourceConfig` (private, line
  214) — same 8-line pure function, same purpose, in the same file. Not a violation of any
  [mechanical] CONTRIBUTING.md rule I could cite (no explicit "no duplicate private helpers"
  rule), so this is a non-blocking suggestion, not a Change Request.
- **Design mirrors precedent** (`SecondaryInput`'s discriminated-union convention,
  `StepConfigTypeMismatch` wording) — reduces the wire-shape-lock-in risk the design doc itself
  flags.
- **No dead code / no TODO-FIXME** in the new files.
- **Type safety**: no untyped escape hatches; `UpsertMode` is a closed `Vector[String]` set
  rather than a real Scala enum, but this matches the stated precedent
  (`UnionConfig.mode`) and is documented as deliberate in a scaladoc comment.
  Not a regression relative to existing patterns.
- **Error handling**: malformed top-level JSON returns `None` from `validateRawConfig` (deferred
  to the pre-existing "invalid config" category the calling surface already reports) — this is
  explicitly documented and tested (`"return None (not raise) for malformed JSON"`), not a
  silent failure.
- **Tests meaningful, not evidence-shaped**: verified the three specific traps called out in the
  brief.
  - Absent-vs-null (spray-json's `Option=None` omission): `UpsertSourceConfigSpec` tests both
    "absent target" (`{"mode":"replace"}`, no `target` key at all) and "absent mode"
    (`{"target":{...}}`, no `mode` key at all) — genuinely omitted fields, not `null` literals,
    matching HEL-860's actual production shape.
  - Wrong-typed field rejection (HEL-871 class): six distinct wrong-typed-field tests
    (`target` as a number, `mode` as a number, `target.name` as a number, `target.dataSourceId`
    as a boolean, unrecognised `target.kind`, unsupported `mode` value) — each assigns to a
    real, differently-shaped JSON literal and asserts `problem shouldBe defined`, not a single
    generic "invalid input" fixture reused six times.
  - No cross-tenant existence oracle, under a real Postgres instance: `UpsertSourceConfigSpec`
    spins up `EmbeddedPostgres` + runs real Flyway migrations (through V107) + a real
    `DataSourceRepository`; the "same message" test seeds a genuine second-owner row
    (`seedOwnedSource(ownerB)`) and asserts the exact string equality of both problem messages,
    not just "both defined" — this would catch a regression that leaked owner info in either
    message.
- No PR-visible design-standard ([mechanical] frontend rules) concerns — no `frontend/**` files
  touched, DESIGN.md is not binding on this diff.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/.../ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`-route
files changed in a way that exposes a new UI surface — the new spec directory is a *step config*
capability spec (not a route/schema change), and `upsertsource` is deliberately unreachable
through any route in this diff. No dev servers were started; none were needed.

### Overall: PASS

### Non-blocking Suggestions
- Consider hoisting the duplicated `jsonKindNameOf` helper (currently defined identically in
  both `UpsertTarget` and `UpsertSourceConfig`, `UpsertSourceConfig.scala:117-124` and
  `:214-221`) into a single shared private method or a small `StepCodecUtil` addition, next time
  this file is touched (e.g. by HEL-1100). Not a CONTRIBUTING.md violation as filed; purely DRY
  hygiene.
