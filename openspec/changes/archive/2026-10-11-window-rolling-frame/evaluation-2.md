## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `09f57f7ce38582ff3ee996380724dc7938e424ee` (base `e8161b17bdb969eae5b844f7cdd0b753ab1023ac`, resolved live). Cycle-2 delta reviewed: `d1643d6fb..09f57f7ce`.
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1316/evidence/eval-2/`.

### Fresh gate runs (evaluator, in WORKTREE_PATH)

| Gate | Result | Evidence |
|---|---|---|
| `npm run lint` / `format:check` / `check:scala-quality` | all exit 0 (WindowStep.scala now 364 lines, soft-budget note only) | `eval-2/lint-format.txt` |
| `npm test` (`nice -n 19`) | exit 0; frontend 5468, helio-mcp 433 | `eval-2/npm-test.txt` |
| `npm --prefix frontend run build` / `typecheck` | exit 0 / exit 0 | `eval-2/build.txt` |
| `cd backend && sbt testFull` (`nice -n 19`) | exit 0; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`; `Tests: succeeded 6748, failed 0, canceled 4`; the new spec name "…run for real to the expected materialized Output rows" ran | `eval-2/testfull.txt` |

I checked the executor's claim that no frontend files changed. `git diff --name-only d1643d6fb..HEAD | grep -c '^frontend/'` gives `0`. The only file outside the backend that the frontend reads is `shared-test-fixtures/window-rolling-seam.json`. Its `config` change is Prettier reformatting only (`orderBy`/`columns` expanded), with identical values. The frontend seam test reads it and passes in my `npm test` run. I also ran the build myself, and it passes.

### Phase 1: Spec Review — PASS

All cycle-1 findings are resolved.
- **P1-1 / CR 1 (real run): resolved.** `WindowRollingSeamSpec` now does all of the following:
  - creates an Output on the window step;
  - submits `POST /pipelines/:id/run` (a non-dry run);
  - reads `GET /outputs/:id/rows`;
  - asserts `materialized == true`;
  - asserts the row count;
  - asserts that `rolling_v` equals `expected`.

  The fixture now includes an unparseable date (`"nope"`, which yields null) and a null `v` (2026-01-07, which yields 9). The unused-wiring finding is resolved because the run routes are now used. `files-modified.md` is updated.
- **P1-2 / CR 2 (palette label): resolved.** I fetched `GET /api/pipeline-step-catalog` from the live backend on 9655: `{"kind":"window","label":"Window (rank / running / rolling)","description":"Compute a windowed value, like a rank, running total or rolling average, over ordered rows."}` (`eval-2/catalog-window.txt`). This catalog is the palette's source, as established in cycle 1. It now matches the step-card label.
- CONSTRAINTS C1–C11:
  - **C8:** honored. There are no inline FQNs (`JBigDecimal`, `JDouble`, `JInteger` imports). `VerifiedEmbeddedPostgres.start` is used, `[hel1468-guard]` is present, and there is no migration.
  - **C7:** unchanged. The only `RefinementEditShape` hunk is still the one from cycle 1, and there is no compute or `ExpressionEvaluator` change.
  - **C6:** met (see Phase 2).

### Phase 2: Code Review — PASS

- **CR 3 (FQNs): resolved.** `WindowRolling.scala:5` imports `java.math.{BigDecimal => JBigDecimal}`, and `WindowRollingAnalyzeSpec.scala:8` imports `java.lang.{Double => JDouble, Integer => JInteger}`.
- **CR 4 (split and indentation): resolved.**
  - The rolling algorithm moved verbatim into `WindowRolling.scala` (`private[steps] object WindowRolling`, 94 lines). The only behavioural edit is `frameSize.getOrElse(1)` → `.get`, which is safe because `apply` already threw on a missing `frameSize`. This also addresses my cycle-1 suggestion.
  - `WindowStep.rowOrdering` was widened to `private[steps]`. `WindowStep.scala` is now 364 lines, below the 400-line threshold.
  - The `else {}` block is re-indented.
- **CR 5 (C6 mutation proofs): resolved.** `mutation-record.md` records each mutation diff, the names of the red tests with their assertion lines, and the restore:
  - (a) `usesField` reverted: two seam tests red.
  - (b) `frameUnit` spread dropped: two seam tests red.
  - (d) `toRolling = false`: the "fills 7 / rows" test and a seam test red.
  - (c) `decode` ignores `frameUnit`: both seam tests red.

  Record (c) shows no assertion message. Ignoring `frameUnit` would also break the earlier `created.fields("config") shouldBe config` check, so (c) alone does not prove that the new run assertion can fail.

  **I verified it independently.** I made a throwaway detached worktree at `09f57f7ce`, applied a compute-only mutation (`WindowRolling.scala:38`, `dates(p) - (size - 1)` → `dates(p) - size`, which widens the day frame by one), and ran `testOnly WindowRollingSeamSpec`. The run test went red at the run assertion: `Vector(1.0, 6.0, 10.0, 6.0, 9.0, 9.0, 30.0, null, 9.0) was not equal to Vector(1, 6, 10, 6, 4, 9, 30, null, 9) (WindowRollingSeamSpec.scala:156)`. The 422 test stayed green. Evidence: `eval-2/mutation-e-diff.txt`, `eval-2/mutation-e-red.txt`. I removed the throwaway worktree afterwards (`git worktree list` shows it gone), and WORKTREE_PATH is still clean.
- The extraction preserves behaviour: the moved body matches the cycle-1 code apart from the `.get` change and the `JBigDecimal` alias, and the full suite stays green.

### Phase 3: UI Review — PASS

- The full UI pass (editor, both themes, breakpoints, accessible names, a real run, the draft error) was done in cycle 1. This cycle changed no frontend files.
- The one UI-visible change this cycle was the palette label. I verified it through the live backend catalog endpoint on 9655, which is the data the palette renders.
- I did not take a browser screenshot of the palette. The shared Playwright browser was logged in as another lane's user (the session from another lane's `.playwright-mcp/page-2026-10-11T08-21-59-318Z.yml`), so I made no clicks or edits as that user. I moved only my own four snapshot/console files to `eval-2/playwright-mcp/`.
- Residue: my throwaway user `76cf8d3b-eb3c-46a3-bd8e-f8801d167a74`, its data source and its pipeline were deleted by exact id. The dev servers I started (backend 2640060/2639601/2639546, frontend 2640679/2640664) were stopped by exact PID, and both ports are free.

### Overall: PASS

### Non-blocking Suggestions
- `WindowStep.scala:220`: the arrows in the `cfg.function match` are not aligned (`case "running_sum" =>` is offset from its neighbours). This is cosmetic.
- `mutation-record.md` (c): if it is revisited, quote the failing assertion line. That would show which check went red, as the compute-only mutation above does.
