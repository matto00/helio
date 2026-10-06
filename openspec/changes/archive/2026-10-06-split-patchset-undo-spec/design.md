## Context

`backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoServiceSpec.scala` on main f78b4c518: 805 lines,
19 tests in three `should` blocks. Lines 1-201 are fixture (imports, `var` repos/services, `beforeAll` booting
EmbeddedPostgres + Flyway, `afterAll`, `await`, `seedUsers/seedDashboard/seedPanel/seedOutput/seedDatasetSource/
seedPipeline/seedPipelineStep/applySuccessfully`). Lines 710-714 hold `undoServiceWithoutOutputRepo`, used only by the
null-`outputRepo` block; `assertUnavailable` is a local `def` inside that block. Precedent for a shared fixture
trait: `backend/src/test/scala/com/helio/api/routes/firstrun/FirstRunRoutesFixture.scala`, `testsupport/*Fixtures.scala`.

## Goals / Non-Goals

**Goals:** four concern specs, one shared fixture trait, zero change to any test name, test body or assertion.

**Non-Goals:** fixing bugs (spinoff note only), renaming tests, changing fixture behaviour, editing production code,
`PatchSetApplyResolvers`, CI config, or `test-suite-weights.tsv`.

## Decisions

**D1 — Grouping (by the original `should`-block order; tests keep their relative order within each file).**
- `PatchSetUndoPanelDashboardSpec` (subject `"PatchSetUndoService.undo"`): 5.3a update restore; 5.3b panel
  create/delete; 5.5 output-kind placement; HEL-1295 refuse-recreate-missing-Output; 5.3b-dashboard.
- `PatchSetUndoLaneSpec` (subject `"PatchSetUndoService.undo"`): 5.3c step delete; 5.8 step delete + Output/placement;
  add-lane create cascade; refuse create referenced by a lane secondaryInput; HEL-766 original parentStepId.
- `PatchSetUndoRefusalSpec` (subject `"PatchSetUndoService.undo"`): 5.3d unrecoverable; 5.3e conflict; 5.3f Phase-2
  failure reporting; 5.3g other user's application; 5.3g nonexistent id. Carries the trailing HEL-904 4.5 note.
- `PatchSetUndoRepoWiringSpec`: both original HEL-1256 blocks with their original subject strings
  (`"PatchSetUndoContext parity (HEL-1256)"`, `"PatchSetUndoService.undo with a null outputRepo (HEL-1256)"`) plus
  `undoServiceWithoutOutputRepo` (private to this spec, not the trait — only it uses it).
Counts 5+5+5+4 = 19. Alternative (3 files, refusals merged into panel spec) rejected: panel file would exceed ~300
lines and mix happy-path restore with whole-undo refusal semantics.

**D2 — Fixture trait.** `trait PatchSetUndoServiceFixture extends AnyWordSpec with Matchers with HelioRouteTest with
BeforeAndAfterAll with JsonProtocols with TempDirectorySupport` in the same package; each spec is `class X extends
PatchSetUndoServiceFixture`. Fixture body moves verbatim, except `private` → `protected` (required for subclass access)
and the class doc comment moves to the trait. `beforeAll`/`afterAll` stay as written (they call `super` exactly as
today). Mixing `HelioRouteTest` (not `ScalatestRouteTest`) keeps `RouteTestBaseGuardSpec` green. Alternative (self-type
trait over a separately-declared spec base) rejected: more surface for no benefit. Copying setup per file is
forbidden by the ticket.

**D3 — Test names preserved exactly.** Each test's full name `"<subject> should <name>"` is unchanged because the
subject strings are reused verbatim; only the suite class differs. The temp-dir prefix in `newTempDir` stays
`"patch-set-undo-service-spec"` (fixture behaviour unchanged).

**D4 — Verbatim moves.** Each `"..." in { ... }` block, and the comment block immediately above it, moves byte-for-byte
with no re-indentation (every test stays at 4-space depth inside its `should`). Imports are trimmed per file to what
that file uses (pre-commit Scala quality check).

**D5 — Mechanical equivalence evidence** (written by the executor to
`openspec/changes/split-patchset-undo-spec/split-equivalence.md`; script kept in the session scratchpad and its source
pasted into the evidence file). Base = `git show <merge-base>:<old path>`. All lines are whitespace-trimmed.
1. Test names: list `"<subject> should <name>"` for every `"..." in {` block (subject = enclosing `should` string),
   base vs the four new files; sorted lists identical (19 = 19). Allowed delta: none.
2. Assertion multiset, scoped to test bodies only (from each `"..." in {` line through its matching close brace;
   subject lines and fixture lines excluded): every line matching `shouldBe|should |shouldEqual|should be|fail\(|
   assert|withClue|theSameInstanceAs|contain|include|defined|empty`, as a sorted multiset with counts. Allowed delta:
   none.
2b. Comment-line multiset (added after design-gate round 3, stricter only): every `//` or `*`-led comment line from
   base lines 203-805 vs the four spec files' `should` regions, sorted multiset; identical. Catches section dividers
   (e.g. line 590) and the trailing HEL-904 4.5 note that 3. does not cover. Allowed delta: none.
3. Per-test body: each test block's full text — the contiguous comment lines immediately above its `"..." in {` line
   (if any) plus the block through its matching close brace — keyed by full test name; identical. This mechanically
   checks D4's comment move too. Allowed delta: none.
4. Fixture: blank lines are dropped on both sides and `private ` → `protected ` is normalized on both sides.
   Base side = base lines 53-200 (the `class PatchSetUndoServiceSpec` header through the end of `applySuccessfully`;
   imports 1-47 and the doc comment 48-52 excluded) + 710-714 (`undoServiceWithoutOutputRepo`) + 750-754
   (`assertUnavailable`). New side = the trait file from its `trait PatchSetUndoServiceFixture` header line through
   the line before its final closing `}` (imports and the trait's doc comment, which sits above the header, excluded)
   + `undoServiceWithoutOutputRepo` and `assertUnavailable` as they appear in `PatchSetUndoRepoWiringSpec`. Allowed
   delta, enumerated in advance and nothing else: (i) the class header line ↔ the trait header line (same mixin list,
   same order). The class doc comment is outside both ranges by construction. Anything else — a reordered
   `beforeAll` statement, a dropped `seedUsers()`, a changed temp-dir prefix — is a failure.
5. Runtime count: `testOnly com.helio.services.patchsets.PatchSetUndoServiceSpec` on the base commit reports 19
   succeeded; `testOnly` of the four new suites reports 19 succeeded in total; full `sbt testFull` green.
Any non-empty diff outside the allowed deltas is reported as a failure, never fixed by adjusting the check.

**D7 — Dangling pointers.** Comment-only edits, no code/assertion change, to name the spec that now holds the cited
coverage: `api/routes/patchsets/PatchSetUndoRoutesSpec.scala:44` and `services/patchsets/PatchSetUndoInverseSpec.scala:19`
→ the four `PatchSetUndo*Spec`s (restore/conflict coverage spans Panel/Lane/Refusal); `PatchSetApplyServiceSpec.scala:186`
(`seedPipelineStep` `parentStepId`) → `PatchSetUndoServiceFixture`; `PatchSetApplyServiceSpec.scala:290` (HEL-766
test) → `PatchSetUndoLaneSpec`. Carve-out, left unchanged: `services/pipelines/Hel914Ac1EndToEndSpec.scala:63`, a
historical record of a probe against the spec as it existed then. Verify: `grep -rn PatchSetUndoServiceSpec
backend/src` returns only that line.

**D6 — Isolation.** Each spec now boots its own DB, so tests that used to share one DB no longer see each other's
rows. If any moved test fails in isolation, that is an order dependency (a latent bug): do not alter the assertion —
stop and report it to the orchestrator as a spinoff/escalation candidate.

## Risks / Trade-offs

- [Three extra EmbeddedPostgres boots per testFull, ~1-2 s each] → accepted; CI shards pack new suites at median
  weight (`backend/project/TestShards.scala` `lpt`), no config change.
- [A stale `PatchSetUndoServiceSpec` row stays in `test-suite-weights.tsv`] → harmless: `select` only packs defined
  suite names; the file is regenerated by `gen-test-suite-weights.py`.
- [Order-dependent test exposed by the split] → D6.

## Planner Notes

- Self-approved: four-way grouping, trait name, `private`→`protected`, leaving the weights file alone.
- Premise drift (773 → 805 lines) is minor-staleness; persisted at `.concertino/runs/HEL-1293/evidence/premise-validation.md`.

## Rebaseline (cycle 2, after HEL-1337 b2a0d8088 merged to main)

Driver instruction, verified against origin/main: HEL-1337 removed the whole `"PatchSetUndoService.undo with a null
outputRepo (HEL-1256)"` block (3 tests, plus `undoServiceWithoutOutputRepo`/`assertUnavailable`) from the old spec and
reworded the `seedOutput` doc comment (lines 152-154). Base for every D5 check and count becomes the post-b2a0d8088
`PatchSetUndoServiceSpec.scala` (742 lines, 16 tests). Merge `origin/main` into the branch (no rebase, no force-push);
resolve the modify/delete conflict by keeping the deletion and porting main's changes into the split files:
`PatchSetUndoRepoWiringSpec` keeps only the parity test (1 test, 5+5+5+1 = 16); the fixture takes the new `seedOutput`
comment. D5.4's base ranges are re-derived from the new base (class header through `applySuccessfully`); the
`undoServiceWithoutOutputRepo`/`assertUnavailable` terms drop out. Both the pre-merge (19) and post-merge (16)
measurements are reported.
