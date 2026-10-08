## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: HEAD `95cc80977689d0f357122f5a698cec64fcc53ff1` against live-resolved base `24f6de4cf290c216c8ba94359f82d1d35ae88f2a` (resolve-review-base.sh, origin/main).
Scope: backend-only structural split of `services/panels/PanelService.scala` + 7 new modules + README.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (size): PanelService.scala is 320 newline-terminated lines (`wc -l`); `check-scala-quality.mjs` reports 321
  because it counts the trailing empty split. That is above the spec's 300 target and below the 400 trigger. Each new file is 21–128 lines (≤ 250).
  D8 floor claim checked against the final file. The only blocks still movable without breaking a D2 guard or a
  D3 design pin are the 3-line HEL-1253 wiring comment, the 2 one-line delegate docs and one stray double blank
  line (230–231, already in the base file), about 6 lines total. Removing them gives about 314, which is still over 300. The no-file
  `submitForm` branch and the `update` apply/audit/recover tail stay in PanelService under design D3, not under a test guard.
  The class scaladoc and the constructor comments may stay under D8. So the floor claim holds. One wording
  issue is listed under suggestions.
- AC2 (behaviour-preserving): no route, message, status, ACL, audit-action/metadata, logger category or query change was found (see
  Phase 2 for each detail checked).
- AC3 (source compatibility): constructor matches the base byte for byte, including the `auditService = null` default before the
  required `outputRepo`. `require(outputRepo != null, ...)` is still the first statement in the class body. Every public
  signature is unchanged, `submitForm` keeps `files = Map.empty`, and the `private[services] buildForCreate` /
  `buildAllForCreate` delegates keep `itemLabel: Int => Option[String] = _ => None`. `ResolvedPanelPatch` keeps the same
  package and shape. ApiRoutes and the 18 test files that construct the service are untouched and compile.
- AC4 (recent work): HEL-1295 `require` kept. HEL-1260 `defaultSizesFor` + `insertPlaced`/`insertBatchPlaced`/`duplicate`
  were moved verbatim. HEL-1203 decode still runs inside `authorizeEditorOnDashboard`'s `Right` branch: `validate` is
  called synchronously from that callback, so a throw is still a failed Future in the same callback. HEL-1189 controls
  checks and the HEL-1086/1087 submit paths were moved verbatim.
- AC5 (proof): checked independently. Results are under Phase 2.
- Tasks: all items are `[x]` and match the diff. `PanelLifecycleWrites` is the optional tail move allowed by D3, and the
  boundary choice is recorded in move-evidence.md.
- Scope: only `services/panels/` + change dir. No scope creep.
- CONSTRAINTS C1/C2/C3: honoured (see guard scan, test diff, signature check below).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (my own fresh runs):
- `cd backend && nice -n 19 sbt testFull`: exit 0. Total tests run 6180, 443 suites, succeeded 6180, failed 0,
  canceled 4. This matches the executor's 24f6de4cf baseline exactly. The run took 8m35s, so the tests actually executed and were not served from cache.
  `ExistenceNotLeakedRoutesSpec`'s two completeness guards ("name every source file that calls a shared access helper"
  and "pin the per-file count of ServiceError.Forbidden producers") ran and passed. So did
  PanelServiceBuildAllForCreateSpec, PanelServiceBatchUpdateErrorSpec, PanelControlsValidationSpec and
  DashboardContentsReplaceSpec. The log has no failed tests: the only "FAILED" matches are inside test names.
- `node scripts/check-scala-quality.mjs`: "clean (214 soft warning(s))". The only new-file-related soft warning is
  PanelService at 321, which is expected.
- `git diff 24f6de4cf...HEAD -- backend/src/test`: 0 lines (C2).

Move verification (independent):
- Re-ran the executor's `move-match.py` against `git show 24f6de4cf:...PanelService.scala`: RESULT ALL MATCH (37 units).
  I ran my own red test with different mutations from the executor's (`"Batch update failed"` → `...X` in PanelBatchWrites, an inserted
  `; ()` after `Instant.now()` in PanelCreateBuilder). Each produced a DIFF on the expected unit, so the script can fail.
- That script only checks that each original unit is contained in its new file. It does not prove that nothing else
  changed. So I also wrote my own multiset line check (trimmed lines) between the base file and the 8 current
  files. Every added line that is not in the base is one of these: imports, `package`, class/object
  headers, module scaladoc headers, constructor params, the 6 module `val`s and their wiring comment, the delegate lines,
  access-modifier changes on moved `def` signature lines (all listed in move-evidence.md), the
  `PanelLifecycleWrites.audit` default-metadata wrapper, the `classOf[PanelService]` logger, the comment fix
  "lookups above" → "lookups in PanelService.update" (allowed under D4), and the `update` chain change (`.map { Left→Left;
  Right(_)→Right(spec) }` + `case Right(spec) =>`). The only base lines missing from the new tree are the dropped
  import, the old `log`, the replaced call site, the original `private def` modifiers, the fourth `.flatMap`, and that
  comment word. The new tree contains no other new logic.
- `git diff --color-moved=plain --color-moved-ws=allow-indentation-change` over backend/src/main/scala (excluding .md):
  453 added lines moved, 179 new, 407 removed moved, 14 removed not moved. This matches the executor's summary of 187/15
  once README lines are excluded.

Semantic invariants (D5/D5a/D6), checked by reading the code:
- `update`: `.recover { case ex: IllegalArgumentException => ... }` wraps only `patchApplier.apply(panelId, spec).map{...}`
  (PanelService.scala:299–306) and never the Future from `updateValidation.validate`. The added pure `.map` in
  PanelUpdateValidation.scala:64–67 cannot throw. It adds one Future hop with no change in exception behaviour.
- `batchUpdate`: `.recover { case ex => ... }` wraps only `panelRepo.batchUpdate(items, now).map{ audit; Right }`
  (PanelBatchWrites.scala:51–68). The `panel.batch_update` audit is still inside that `.map`. `Instant.now()` is still taken after
  `batchValidation` and before `batchControlsCheck` (line 48).
- Logger: `LoggerFactory.getLogger(classOf[PanelService])` (PanelBatchWrites.scala:30). The old `getClass` on a
  `final class PanelService` gives the same category, and the message is unchanged.
- Audit: `PanelService.audit` is unchanged and passed as an eta-expanded 4-arg function. PanelBatchWrites always passes
  metadata. PanelLifecycleWrites restores the `JsObject.empty` default through its local wrapper, so `panel.create` / `panel.delete`
  still record the empty-object metadata and `panel.duplicate` keeps `sourcePanelId`.
- No module dereferences a nullable dependency at construction. Modules are built after the `require`, once per
  PanelService instance.
- No `.recover`/`.transform`/`try`/`Future(...)` was added (grep).

ACL guards (C1), recomputed with the spec's exact `codeLines`/`helperCall`/`Forbidden(` logic per file:
PanelService helper-call lines 4, Forbidden producers 5. Every new module has 0 and 0. No indirection
passes `accessChecker` into a module, because no module receives it.

Inline FQNs (HEL-1386 eye check): every `s"${...}"` in the new files is `${UUID.randomUUID().toString}`,
`${dashboardId.value}`, `${idx + 1}`, `${items(idx).title.getOrElse("")}` or `$label`. None is an FQN.

Quality: DRY/modularity are improved. Each module has its own scaladoc header. There are no new escape hatches, no TODO/FIXME, and no new
dead code.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- test-count-evidence.md calls the remaining blocks "all guard- or signature-pinned". The `submitForm` no-file branch
  and the `update` apply/audit/recover tail stay because of design D3, not because of a test guard. About 6 lines (the wiring comment, the two
  delegate one-liners and the inherited double blank line at PanelService.scala:230–231) are not pinned at all. The floor still holds
  (about 314 > 300), but a follow-up should state it precisely. The 321 vs 320 figure is only a counter difference (the quality script vs `wc -l`).
- Follow-up candidate (already noted in design Planner Notes): comments in other files still name moved methods as
  PanelService members (`OutputControlsValidator.scala`, `PanelPatchApplier.scala`, `DashboardContentsService.scala`,
  `PanelMutationRepository.scala`). Sweep these pointers in a separate ticket.
