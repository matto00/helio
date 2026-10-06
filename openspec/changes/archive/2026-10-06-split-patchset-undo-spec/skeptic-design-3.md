## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD f78b4c5187a42ead6bf71eb6dce9070b020eda63 (branch task/split-patchset-undo-spec/HEL-1293). The change dir is untracked and there is no code change yet.

### What I verified (with evidence)
- **Spawn-cwd guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-patchset-undo-spec/HEL-1293`.
- **Premise.** `wc -l` on `PatchSetUndoServiceSpec.scala` gives 805. `grep '" in {\|should {'` finds 19 tests in three `should` blocks (203, 716, 749).
- **D1 grouping, traced again.** The test start lines are:
  - Panel/Dashboard: 207, 249, 301, 356, 386
  - Lane: 408, 436, 478, 516, 546
  - Refusal: 592, 614, 643, 683, 697
  - RepoWiring: 718, 756, 776, 791

  That is 5+5+5+4 = 19, with nothing missing and nothing duplicated. It covers the ticket's example concerns.
- **Round-2 CR2 (D5.4 ranges), resolved.** I checked the pinned ranges against the live file:
  - Line 53 is the `class PatchSetUndoServiceSpec ... with TempDirectorySupport {` header.
  - Line 199 is the closing `}` of `applySuccessfully`, and line 200 is blank. Blank lines are dropped on both sides, so ending at 200 is benign.
  - Lines 48-52 are the doc comment and sit outside the range.
  - Lines 710-714 are exactly `undoServiceWithoutOutputRepo`.
  - Line 750 is blank and 751-754 are `assertUnavailable`.

  The trait side now explicitly ends before its final `}` and excludes the trait's doc comment. The only remaining delta is the header line. A perfect split therefore diffs empty, while a reordered `beforeAll`, a dropped seed call or a changed `newTempDir("patch-set-undo-service-spec")` prefix (base line 106) would fail. `private ` → `protected ` normalization is applied to both sides: the base range has 32 `private ` occurrences, none `private[`. That keeps it symmetric even though `undoServiceWithoutOutputRepo` stays `private` in RepoWiringSpec.
- **Round-2 CR1 (dangling pointers), resolved.** `grep -rn PatchSetUndoServiceSpec backend/src backend/project` on the live tree returns exactly the lines D7 names: Routes:44, Inverse:19, ApplyService:186 and :290, and the carved-out Hel914Ac1EndToEndSpec:63, plus the weights tsv:323, which is an explicit non-goal and harmless (round-1 check of `TestShards.lpt`). Outside `backend/`, the only hits are under `openspec/changes/archive/` (historical). Task 2.7 has the zero-hit-except-carve-out verify step, and proposal.md Impact now names the out-of-package files.
- **Round-2 non-blocking note (D5.3 comments), adopted.** D5.3 now includes the contiguous comment lines above each test, so D4's comment move is checked mechanically.
- **Equivalence check discriminates in both directions.**
  - D5.1 (names): identical subject strings mean identical full names.
  - D5.3 (per-test full text) fails on any changed assertion or body line.
  - D5.2 is redundant with D5.3 but body-scoped, so it no longer fails by construction.
  - D5.4 covers the fixture.
  - D5.5 is the runtime count: 19 on base vs 19 across the four suites.

  This meets the AC "passes on a perfect split and fails on a real change".
- **D2 trait legality.** `HelioRouteTest` is `trait HelioRouteTest extends ScalatestRouteTest { this: Suite => }` (`testkit/HelioRouteTest.scala:23`). Scala 2.13.15 allows a trait to extend `AnyWordSpec` (a class). The existing precedent `FirstRunRoutesFixture` uses the same `override def beforeAll` / `super` pattern in a trait.
- **No hook will reformat the header.** There is no scalafmt config (`.scalafmt.conf` is absent). `check-scala-quality.mjs` only warns over 250 lines and does not fail, so no hook will reformat the header out from under delta (i).
- **Scope and discipline.** The change is test-only and touches no production code, `PatchSetApplyResolvers`, CI config or `.gitignore`. D6 routes order-dependency failures to escalation, not a fix. I found no placeholders or TBDs. Tasks carry the binding sbt env, timeout and shutdown rules.

### Verdict: CONFIRM

### Non-blocking notes
- **Section-divider comments are not covered by D5.** Comments separated from the next test by a blank line fall outside D5.3's "contiguous above" rule and outside the D5.4 ranges. Examples: line 590 `// ── 5.3d: ... ──` and the trailing HEL-904 4.5 note at 704-706. These could be dropped or moved without detection. Because they are not behaviour this is not a blocker, but the executor could add a cheap test-region comment-line multiset check, or at least eyeball them.
- **D2 shape differs from the precedent.** D2's trait extends `AnyWordSpec with Matchers` directly, whereas the `FirstRunRoutesFixture` precedent extends `Suite` and lets each spec mix `AnyWordSpec with Matchers`. Both compile, and D5.4 delta (i) pins the "same mixin list" choice, so stay with D2 as written. Do not switch shapes mid-execution, or delta (i) will no longer hold.
- **New files will exceed the warn threshold.** The Panel/Dashboard file (test region about 200 lines plus imports and subject) will likely exceed `check-scala-quality`'s 250-line warn threshold. That is a warning only and well under CONTRIBUTING's ~400.
- **Design numbering.** D7 appears before D6 in design.md. This is cosmetic.
