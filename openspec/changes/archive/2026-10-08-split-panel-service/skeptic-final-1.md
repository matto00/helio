## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `95cc80977689d0f357122f5a698cec64fcc53ff1` against the live-resolved base
`24f6de4cf290c216c8ba94359f82d1d35ae88f2a` (`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY`.

### What I verified (with evidence)

- **Diff scope** (`git diff --stat BASE...HEAD`): only `services/panels/PanelService.scala` (709 -> 320), 7 new files in
  the same package, the panels `README.md`, and change-dir artifacts. `git diff BASE HEAD -- backend/src/test` is empty
  (zero test diff). `ApiRoutes.scala` is untouched.
- **Read in full**: the base `PanelService.scala` (709 lines) and every new file (`PanelService`, `PanelBindingChecks`,
  `PanelCreateBuilder`, `PanelFormFileSubmission`, `PanelUpdateValidation`, `PanelBatchWrites`,
  `PanelLifecycleWrites`, `ResolvedPanelPatch`). The moved bodies match the base text line by line.
- **Move detection, re-run by me**: `move-match.py` against the base file prints `RESULT ALL MATCH`. As my own red
  check, I made a scratch copy and changed `acc :+ built` to `built +: acc` in `buildAllForCreate`. The script then
  printed `DIFF buildAllForCreate ... RESULT 1 DIFF`, so it can fail.
- **Constructor and signatures**: the constructor parameter list matches the base byte for byte, including
  `auditService = null` before the required `outputRepo` and every comment. `require(outputRepo != null, ...)` is still
  the first statement. `findById`, `submitForm` (with `files = Map.empty`), `create`, `delete`, `duplicate`,
  `batchUpdate`, `batchCreate` and `update` keep identical signatures. The `private[services]` methods
  `buildForCreate`/`buildAllForCreate` are delegates with identical signatures, and `itemLabel` keeps its
  `_ => None` default. `ResolvedPanelPatch` keeps the same package and shape.
- **Construction-time safety**: modules are built after `require`, and the `val` order (bindingChecks -> createBuilder
  -> formFiles -> updateValidation -> batchWrites/lifecycleWrites) refers only to vals that are already initialised. No
  module dereferences a nullable dependency in its body, because every dependency is used only inside a `def`.
  Passing the eta-expanded `audit` is safe: it is a method, and `auditService` is read when it is called.
- **Future-chain semantics**:
  - `update`: `.recover { case ex: IllegalArgumentException => ... }` wraps only `patchApplier.apply(...).map{...}`
    (PanelService.scala:299-306), never the Future from `updateValidation.validate`. The HEL-1203
    `resolvePatch`/`patchedConfigOf` decode runs synchronously inside `validate`, which is called from inside
    `authorizeEditorOnDashboard(...).flatMap`'s `Right` branch. So it still runs after the 404/403 checks and before
    any further read or write, and a throw there is still a failed Future in the same callback. The only structural
    change is one extra pure `.map` (Left->Left, Right->Right(spec)) in place of the old fourth `flatMap`'s Left
    branch. The values are the same; it adds only one scheduling hop.
  - `batchUpdate`: `Instant.now()` is still taken after `batchValidation` and before `batchControlsCheck`
    (PanelBatchWrites.scala:48). `.recover { case ex => ... }` still wraps only `panelRepo.batchUpdate(...).map{ audit;
    Right }`, and the `panel.batch_update` audit is still inside that `.map`.
  - Audit default metadata: `PanelBatchWrites` always passes metadata explicitly. `PanelLifecycleWrites` wraps
    `auditFn` in a local `audit(..., metadata: JsValue = JsObject.empty)`, so the `panel.create`/`panel.delete` calls
    keep the base default. `panel.duplicate` still passes `sourcePanelId`.
  - Logger category: `LoggerFactory.getLogger(classOf[PanelService])`. I checked this in the live test log:
    `ERROR ... c.helio.services.panels.PanelService - batchUpdate failed for dashboard d-1`, which is the same
    category and message as before.
  - Import shadowing: the in-class `import bindingChecks._` / `createBuilder._` / `PanelBindingChecks._` share no names
    with `PanelServiceHelpers` (I grepped every `def` in it), so no name resolves to a different target.
- **ExistenceNotLeakedRoutesSpec guards across the whole tree**: I computed the file set for the access-helper regex and
  the per-file `ServiceError.Forbidden(` counts over all of `backend/src/main/scala` at the base and at HEAD. The md5
  digests are identical (`bdf42d49...` / `2a6c1aa2...`). In panels, only `PanelService.scala` (5 producers) and
  `AutoLayoutService.scala` (1) appear, the same as before. The guard suite itself ran and passed.
- **Full suite, run fresh** (`nice -n 19 sbt testFull`, exit 0):
  `Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0`, `Suites: completed 443`. This equals the
  baseline the executor recorded (6180/443). The test diff is empty, so equal counts are what I expected.
- **No inline FQNs**: `node scripts/check-scala-quality.mjs` exits 0 ("clean"). I grepped every `${...}` in the touched
  files: `${dashboardId.value}`, `${idx + 1}`, `${items(idx).title.getOrElse("")}` and
  `${UUID.randomUUID().toString}`. None contains an FQN (`UUID` is imported). The only `com.`/`java.`/`scala.`
  matches in non-import lines are `package` declarations.
- **D8 line floor**: `wc -l` gives 320 (the quality script reports 321 because it counts the trailing empty split). That
  is above the living spec's 300 and below the 400 trigger, and every new file is 128 lines or fewer. I checked
  whether 300 is reachable without breaking a design pin:
  - Removable lines: the 3-line HEL-1253 wiring comment, the inherited double blank line (230-231) and the two
    one-line delegate docs, about 6 lines in total (~314).
  - Further reduction: collapsing the two delegate signatures onto single lines saves about 7 more (~307).
  - Anything beyond that means moving D2/D3-pinned ACL/404 preambles, the `submitForm` no-file branch or the `update`
    apply/audit/recover tail (D5a), or cutting the class scaladoc or constructor comments.

  So 320 is an honestly measured floor under the design CONFIRMed at the design gate. The recorded reason ("all guard-
  or signature-pinned") is slightly overstated, as the evaluator also noted (some blocks are design-pinned, not
  guard-pinned). That is a wording issue, not a defect.
- **UI**: no `frontend/**` changes, so Step 4 (visual review) does not apply and no servers were started.

### Verdict: CONFIRM

### Non-blocking notes

- `test-count-evidence.md` says the remaining blocks are "all guard- or signature-pinned". More precisely: the D2
  ACL/Forbidden preambles are guard-pinned, the `submitForm` no-file branch and the `update` tail are pinned by design
  D3/D5a, and about 6 to 13 lines (wiring comment, double blank line, delegate docs and multi-line delegate
  signatures) are formatting. The living spec's `PanelService.scala SHALL be <=300` is still unmet (320). That should
  be filed as a follow-up, as D8 intends.
- Pointer sweep follow-up (already in design Planner Notes): comments in `OutputControlsValidator.scala`,
  `PanelPatchApplier.scala`, `DashboardContentsService.scala` and `PanelMutationRepository.scala` still describe the
  moved methods as `PanelService` members.
- `ResolvedPanelPatch.scala` imports `com.helio.domain.model._`, which looks unused (the fields use
  `domain.panels` and spray types only). It is harmless because the compile emitted no warnings for it.
- `evaluation-1.md` is untracked in the worktree. The orchestrator must commit it with the delivery artifacts.
