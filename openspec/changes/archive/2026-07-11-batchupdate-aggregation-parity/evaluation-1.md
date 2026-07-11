## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All three ticket ACs addressed explicitly, not partially:
  1. Regression test (metric + chart panel aggregation via `POST /api/panels/updateBatch`,
     re-verified via a fresh `GET /api/dashboards/:id/panels`) — independently confirmed to fail
     pre-fix and pass post-fix (see Phase 2 verification below).
  2. `replace` and `batchUpdate` now reference a single shared definition:
     `PanelRepository.configColumnsOf` / `configColumnValuesOf` — stronger than the "test asserts
     sync" alternative, matching design.md's decision.
  3. `sbt test` reported and independently re-run green (951/951).
- No AC silently reinterpreted.
- Tasks 1.1–1.3, 2.1–2.3 in `tasks.md` all marked done and match the diff exactly (shared
  helpers added to `PanelRepository` companion object; `replace` and `batchUpdate`'s config-patch
  branch both switched to use them; two regression tests added; full suite run).
- No scope creep — diff touches exactly the two files named in proposal.md's Impact section, plus
  the test file and OpenSpec artifacts. `PanelConfigCodec.applyConfigPatch` and the domain model
  are untouched, per the stated non-goals.
- No regressions to existing behavior: full `sbt test` suite green (951 tests, 0 failures), and
  `replace`'s behavior is unchanged (same column set, same values, only refactored to call the new
  helper — confirmed by reading the diff, not just trusting a description).
- No API contract / schema changes — `check:schemas` independently re-run, reports "schemas in
  sync with JsonProtocols," consistent with proposal.md's "no wire-shape changes" claim.
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the final implementation
  — the `configColumnsOf`/`configColumnValuesOf` helper names, arities, and column sets match
  design.md's decision verbatim.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Canonical code-quality compliance**: `npm run check:scala-quality` independently re-run —
  reports "clean (35 soft warning(s))"; `PanelRepository.scala` is one of the 35 (310 lines vs.
  the ~250-line soft budget), but this is explicitly informational-only per
  `CONTRIBUTING.md:24`/`package.json` script comment, was already over budget pre-change (278
  lines on `main`), and is nowhere near the ~400-line "propose a split" threshold. Not a
  mechanical violation.
- No inline FQNs introduced — `PanelMutationOps` reaches `configColumnsOf`/`configColumnValuesOf`
  via the pre-existing `import PanelRepository._` (`PanelMutationRepository.scala:18`); no new
  imports needed, no qualifiers added.
- **DRY**: this change's entire purpose is eliminating the duplication that caused the bug; the
  hand-written 8-/9-element tuples in both `replace` and `batchUpdate` are now a single call to
  `configColumnsOf(r)` / `configColumnValuesOf(row)`.
- **Readable**: helper names and the doc comment on `configColumnsOf` (`PanelRepository.scala:235-238`)
  clearly state the "single source of truth" intent and reference HEL-296.
- **Type safety**: `configColumnsOf`'s return type is an explicit `Rep[Option[T]]` tuple matching
  `PanelTable`'s column declarations 1:1 (verified against `PanelTable` at
  `PanelRepository.scala:288-305`); `configColumnValuesOf`'s return type matches `PanelRow`'s
  field types 1:1. No untyped escape hatches.
- **Error handling / security**: no new input-validation or injection surface — this is a
  write-back column list, not a new endpoint or user-controlled string.
- **Tests meaningful**: independently verified both new tests fail on pre-fix code and pass on
  fixed code (see below) — this is real regression coverage, not a test that merely re-asserts
  current behavior.
- **No dead code**: no leftover TODO/FIXME; old hand-written tuples fully removed, not left
  commented out.
- **No over-engineering**: two small companion functions, not a new case class / Shape
  abstraction — matches design.md's explicitly-considered-and-rejected heavier alternative.
- **Behavior-preserving for `replace`**: diff confirms `replace`'s column set and value order are
  unchanged (`typeId, fieldMapping, content, imageUrl, imageFit, dividerOrientation,
  dividerWeight, dividerColor, aggregation, lastUpdated`) — purely refactored to call the shared
  helper, no drive-by behavior change.

**Independent verification performed (not just trusting the executor's report):**
- Reset `PanelRepository.scala` + `PanelMutationRepository.scala` to pre-fix (`901d22c~1`) while
  keeping the new tests, ran `sbt "testOnly com.helio.api.ApiRoutesSpec -- -z \"HEL-296\""` →
  both HEL-296 tests **failed** (`succeeded 0, failed 2`), confirming the regression tests
  genuinely catch the bug. Restored `HEAD` versions of both files (clean `git status` afterward
  apart from a pre-existing unrelated `workflow-state.md` diff).
- Ran the same targeted test against the fixed code → both tests **passed**.
- Ran full `sbt test` → **951/951 passed**, matching the executor's reported count.
- Ran `npm run check:scala-quality`, `npm run format:check`, `npm run lint`, `npm run check:schemas`
  independently (since the commit used `git commit -n`, bypassing the Husky chain entirely,
  including the `npm test`/lint/format/schema steps that would otherwise have run) — all green.
  Only `npm run check:openspec` flags the expected "complete but not archived" hygiene note, which
  is the known mid-cycle state the ticket description called out, not a genuine lint/format/test
  bypass.

### Phase 3: UI Review — N/A
Backend-only change: diff touches only `PanelMutationRepository.scala`, `PanelRepository.scala`,
`ApiRoutesSpec.scala`, and OpenSpec change artifacts. No `frontend/**`, `ApiRoutes.scala`,
`schemas/**`, or `openspec/specs/**` changes — none of the Phase 3 triggers match.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `PanelRepository.scala` is now 310 lines, over the informational ~250-line soft budget (already
  278 before this change). Not required to act on now, but worth folding into a future
  decomposition pass if the file grows further.
