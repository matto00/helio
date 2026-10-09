## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: d3b3b514c944967494336349faee76acfa184b17 (commits b35c5453 golden spec, d3b3b514 split).
Review base, resolved live: b409172a53ebe6f80db154847cb1b85c286293e1 (`resolve-review-base.sh`, exit 0).
Non-openspec files changed: `ChartAppearance.scala` (new), `PanelAppearance.scala` (new), `model.scala`, `domain/model/README.md`,
`PanelAppearanceWireGoldenSpec.scala` (new test).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (behaviour-preserving, MergeSpec + full suite pass with import-only changes): `git diff b409172a...HEAD -- backend/src/test`
  touches only the added `PanelAppearanceWireGoldenSpec.scala`, so there are zero edits to existing tests (C1). My own targeted run (13 suites incl.
  MergeSpec, golden, Panel/FormPanel/OutputPanel/PanelRowMapper/DashboardSnapshotValidation/PatchSet*/PanelService*/ApiRoutesSpec):
  333 succeeded, 0 failed. For the full suite I re-parsed the executor's recorded baseline/after `testFull` logs with my own parser
  (I did not use their `suite-counts.py`): 462 suites/6440 lines -> 463/6445. The only difference is `PanelAppearanceWireGoldenSpec: None -> 5`, so
  every pre-existing suite count is unchanged (C5). The logs show this worktree's paths and `All tests passed.` I did not re-run the full `testFull`, per the
  memory-cap ruling: nothing gave me a concrete reason to doubt it.
- AC2 (no wire change): I ran the golden spec against an independent extract of the base tree (`git archive b409172a backend`, with the spec
  copied in) and it was green 5/5. It is also green on HEAD. The spec uses the production `JsonProtocols`. `PanelProtocol.scala` is untouched (C2).
- AC3 (no inline FQNs): `node scripts/check-scala-quality.mjs` reports clean (exit 0). I read all six `${...}` interpolations in
  `ChartAppearance.scala` (117,121,129,137,150,154) myself and none contains an FQN. `PanelAppearance.scala` has no interpolations.
- Tasks 1.1–3.5 are all marked done and match the diff. No scope creep: the README list correction is pre-approved in the Planner Notes, and I checked
  it against `ls` of the package, which matches the 15 `.scala` files exactly.
- Constraints C1, C2, C3, C5 and C6 are honored. On C4, see the Phase 2 deviation verdict.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates:** this is a backend-only change, so the frontend gates do not apply. I still ran `npm run format:check` (pass, since the openspec md files
are Prettier-scoped), `check:openspec` (clean) and `check:scala-quality` (clean). For `sbt`, I compiled and ran the targeted suites above
under `nice -n 19 -J-Xmx3g -J-XX:ActiveProcessorCount=3` with `HEL924_TEST_GROUP_COUNT=3`, and the exit code was 0.

**C3 byte-identical move (independent check, not the executor's `move-check.py`):** I built the expected files from
`git show b409172a:.../model.scala` by line range: chart = 206-216 + 220-374; panel = 218 + 399-491; model = base minus lines 3, 7, 206-216, 218, 220-374
and 399-491. I compared the non-blank lines in order with `diff`. Results:
- `model.scala`: no differences.
- `ChartAppearance.scala`: the only extra lines are `package` and the imports `RequestValidation` and `spray.json._`.
- `PanelAppearance.scala`: the only extra lines are `package` and the imports `RequestValidation`, `LoggerFactory` and `spray.json._`.

There are no double-blank lines in any of the three files, and each ends with a newline. Each import is used in its file. `model.scala` keeps
no `RequestValidation` or `LoggerFactory` reference.

**C4 / declared javap deviation — explanation verified true; public API unchanged.**
- I independently compiled the base tree (scratch `git archive` extract; sbt-2 CAS hit, which is content-addressed on inputs) and ran
  `javap-dump.sh` over it. The result is byte-identical to the executor's recorded `javap-before`. A fresh dump of the worktree's current classes is
  byte-identical to the recorded `javap-after`. The executor's evidence inputs therefore check out.
- The raw base-vs-HEAD diff contains: 16 `Compiled from` lines, each mapped per D1 (`Chart*` -> `ChartAppearance.scala`,
  `PanelAppearance*` -> `PanelAppearance.scala`); and, in `PanelAppearance$` only, 13 `$anonfun$applyPatch$N` lines renumbered.
  That is the whole diff.
- The renumbering is exactly the bijection N -> N-14, with identical return and parameter types and the same line order. I checked this mechanically:
  `PanelAppearance$` before, with `$anonfun$applyPatch$N` rewritten to `N-14`, equals after with no other normalisation.
  At base, `ChartAppearance$` owns `$anonfun$applyPatch$1..14` in the same compilation unit, so `PanelAppearance.applyPatch`'s lambdas
  started at 15. scalac's fresh-name counter is per compilation unit and per prefix, so a separate file restarts them at 1.
  This confirms the executor's mechanism.
- Class-file name set under `com/helio/domain/model/` is identical (315 names). The red run (a trailing defaulted param on `applyPatchJson`)
  shows the dump detects a real signature change.
- These are synthetic lambda bodies that Scala source cannot reference by name. A grep of `backend/src/main/scala` for `anonfun`,
  `ObjectOutputStream` and `java.io.Serializable` finds nothing, so no persisted serialized lambda could be broken by the rename.
- **Verdict:** C4's literal text ("differs only in its `Compiled from` line") cannot be met by any file move of these objects, because it rested on a false
  premise in D6b. Its intent, an unchanged public API, is proven: every non-synthetic member is byte-identical, and the synthetic members are a
  type-preserving renumbering. I accept the deviation on its merits. The orchestrator should formally amend C4 in `workflow-state.md` so that the
  constraint record matches what was proven (see suggestions).

**Code-quality checklist:** the moved code is a byte-identical move with no logic change, so the DRY, readability, typing and error-handling items are
unchanged by construction. There are no new FQNs, no dead code and no drive-by behaviour changes. The golden spec is meaningful. The executor's red run
(legend position mutated) failed 3/5. My base-tree run confirms the goldens were captured from pre-move behaviour.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. This is a backend-only structural refactor, so I did not start dev servers.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `api-evidence.md`, "DEVIATION" paragraph: it says renumbering occurs in "`ChartAppearance$`, `ChartAppearance$Patch$`,
  `PanelAppearance$`". That is inaccurate. The raw diff (`move-check/javap-raw.diff`) shows renumbering only in `PanelAppearance$`. `ChartAppearance$`
  keeps `$1..14`, and `ChartAppearance$Patch$` has no `applyPatch` lambdas. Correct it to "`PanelAppearance$` only, N -> N-14".
  The conclusion is unaffected.
- `design.md` D6b and tasks.md C4 still claim that `$anonfun$` lines stay byte-identical. Add a one-line note recording the scalac per-unit counter and the
  N-14 bijection. The orchestrator should also amend or annotate C4 in `workflow-state.md`, so that the planning artifacts reflect what was actually proven.
