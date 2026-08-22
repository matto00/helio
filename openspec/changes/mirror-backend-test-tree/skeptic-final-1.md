## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed cold against the live worktree at commit `292cd15d`. Every conclusion below
is derived from a command I ran myself; the executor's `files-modified.md` and the
evaluator's `evaluation-1.md` were read only as claims to refute.

### What I verified (with evidence)

**1. Build + full test suite (re-run by me, not trusted from the PASS)**
- `sbt -batch Test/compile` → `[success]` (clean).
- `sbt -batch test` → `Total number of tests run: 3346` / `Suites: completed 212, aborted 0` /
  `Tests: succeeded 3346, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed.`
  `[success] Total time: 158 s`.
  This matches `files-modified.md`'s claimed 3346 tests / 212 suites exactly. No regression.

**2. File-count parity — 218, confirmed on both sides**
- Post-change live tree: `find backend/src/test/scala -name '*.scala' | wc -l` → **218**.
- Pre-change baseline recomputed independently from git rather than read from the doc:
  `git ls-tree -r main --name-only | grep '^backend/src/test/scala.*\.scala$' | wc -l` → **218**.
  Parity holds against ground truth, not just against design.md's recorded number.

**3. `testutil` fully retired**
- `rg 'com\.helio\.testutil'` returns exactly one hit, in
  `openspec/changes/mirror-backend-test-tree/files-modified.md` — prose describing the move,
  not code. Zero hits in `backend/`.
- `backend/src/test/scala/com/helio/testutil/` does not exist.
- `testsupport/` contains `JsonLogCapture.scala`, `JsonSchemaValidation.scala`, `PdfFixtures.scala`
  — the D6 merge plus the pre-existing file. Correct.

**4. Diff scope — nothing outside test tree + openspec**
- `git diff --name-only main...HEAD | grep -v '^backend/src/test/' | grep -v '^openspec/changes/'`
  → empty.
- `git diff --name-only main...HEAD | grep '^backend/src/main/'` → empty. **No main-tree edits.**
- Zero frontend files in the diff, so the UI/design-judgment section is not applicable to this ticket.
- Of the 11 `A` (added) entries, **all 11 are openspec change docs** — no new test files were
  introduced under the cover of a move.

**5. No assertion / test-name / behavior changes crept in — checked exhaustively, not sampled**
Rather than eyeball a handful, I filtered the entire test diff for any changed line that is not a
`package` or `import` statement:
```
git diff main...HEAD -- backend/src/test | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE '^[+-]\s*(package|import)\s' | grep -vE '^[+-]\s*$'
```
→ **zero output.** Of 841 changed `+/-` lines in the test diff, 25 are blank-line churn and the
remaining 816 are all `package`/`import` lines. This is stronger than a sample: it proves no
assertion, spec name, string literal, or logic changed anywhere in the 190 moved files.
- I additionally inspected the lowest-similarity rename (`R086 DashboardModelSpec.scala`) directly and
  diffed it against `main:` — content is byte-identical apart from the `package` line (it is an
  11-line scaffold spec, which is why the similarity score is low; low score here is an artifact of
  tiny file size, not of content edits).

**6. design.md's twice-REFUTEd corrections actually shipped (checked against the live tree)**
- **D3 base-class domain split — landed correctly.** `api/routes/proposals/` holds
  `ApplyProposalSpecBase.scala` + `CombinedApplyProposalSpecBase.scala` alongside the 5
  `DashboardApplyProposal*`, 3 `CombinedApplyProposal*`, 2 `DashboardContentsReplace*`, and
  `DashboardGetOrCreateSpec`. Separately, `api/routes/pipelines/` holds exactly the three
  `PipelineApplyProposalSpec`, `PipelineApplyProposalRollbackSpec`, `PipelineApplyProposalSpecBase` —
  i.e. the round-2 correction (Pipeline proposal routes live in `pipelines/`, not `proposals/`)
  is what actually shipped, not round 1's wrong single-package claim.
- **D4 shape-engine moves — landed.** All four `*ShapeEngineSpec` files
  (`SingleRow`, `TopN`, `TimeSeries`, `PivotMatrix`) are in `domain/shapes/`, sitting beside their
  `*ShapeSpec` counterparts. `domain/` root contains no `.scala` files at all.
- **D5b no-op placements — landed as no-ops, and are genuinely still there.**
  `api/routes/ResourceTaggingSpec.scala` and `api/protocols/AggregatorRegressionSpec.scala` both
  remain at their root packages, as the round-2 correction specified (round 1 had wrongly moved
  both). `DataTypeDataSourceAclSpec` likewise at `api/routes/` root.
- **D5 grep-resolved placements — spot-checked and correct.** `StructuredJsonLoggingSpec` at
  `infrastructure/` root; `PaginationSpec`, `DatabaseConnectionTimeoutSpec`, all five `*MigrationSpec`,
  all four `Rls*Spec`, `PipelineSharingAclSpec` in `infrastructure/persistence/`;
  `DataFieldTypeSpec`/`PanelTypeSpec`/`PanelAppearanceMergeSpec`/`DashboardModelSpec` in `domain/model/`;
  `NewConnectorInferenceSpec` in `domain/connectors/`; `UserTierSpec` in `services/auth/`;
  `AggregateStepSpec` in `domain/steps/`.
- **Structural mirror assertion, verified independently.** For every directory under
  `test/scala/com/helio`, I checked a same-named directory exists under `main/scala/com/helio`.
  The only package without a main counterpart is `testsupport` — which is expected and by design.
  (My first run of this check reported ~60 mismatches; that was a wrong relative path in my own
  command. I re-ran it with an absolute path before drawing any conclusion — the stable, reproduced
  result is the single expected `testsupport` exception. Flagging this explicitly because a single
  anomalous reading is a re-run trigger, not a verdict.)
- **No stragglers.** `com/helio/` root and `domain/` root contain zero `.scala` files. Remaining
  root-level specs under `api/`, `api/routes/`, `api/protocols/`, `infrastructure/`, `ai/` are
  exactly the set `files-modified.md` documents as intentional no-ops or D1 same-package matches
  (`ApiRoutesSpec` → `ApiRoutes.scala` at `api/` root; the five `ai/*Spec` files → main's `ai/` root).

**7. Commit / PR material**
- Single commit `292cd15d "HEL-634 Mirror backend test tree onto the domain-subpackaged main layout"`
  — correct `HEL-N` prefix, squash-ready, one logical change.
- Working tree is clean except untracked `evaluation-1.md` (an expected in-flight workflow artifact).
- `files-modified.md`'s headline numbers check out: 218 → 218 file parity (verified),
  3346/212 tests (verified by my own run), 190 moved + 28 no-op = 218 — and git's own rename
  detection independently reports exactly **190** renames (153×R099, 31×R098, 3×R097, 1 each
  R096/R095/R086), corroborating the 190/28 split.

### Verdict: CONFIRM

This is a genuinely mechanical relocation. The strongest evidence is item 5: an exhaustive filter over
the whole test diff shows *not one* changed line outside `package`/`import`, so the risk this ticket
actually carried — silent behavior drift hidden inside a large move — is ruled out by measurement
rather than by sampling. Test count, suite count, and file count are all unchanged against baselines
I recomputed myself, and the two design-gate REFUTE rounds' corrections are present in the shipped
tree, not merely in the design doc.

### Non-blocking notes

- `files-modified.md` says the 190 moves have "no rename-detected pairs since content also changed
  via import fixes". That is inaccurate as written — `git diff -M` *does* pair all 190 as renames
  (R086–R099). The count it reports is right and the conclusion is unaffected; only the parenthetical
  explanation is wrong. Worth a one-line fix if the PR body reuses this text.
- Same file lists `infrastructure` alongside `testsupport` as a package "excepted" from
  main-tree correspondence. `main/scala/com/helio/infrastructure/` does exist; the only true
  exception is `testsupport`. The underlying point (that `StructuredJsonLoggingSpec` has no
  main-tree Scala subject) is correct — the wording just overstates it.
- Environment note, not a defect in this work: `scripts/concertino/next-report-number.sh` and the
  other `scripts/concertino/*.sh` helpers are untracked/gitignored in the root checkout, so they are
  absent from every worktree. I satisfied the collision-safe-naming requirement by scanning the change
  directory directly (no pre-existing `skeptic-final-*.md`, so `-1` is safe). Worth tracking these
  scripts in-repo so worktree-scoped agents can call them.
