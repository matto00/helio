## Context

`backend/src/main/scala/com/helio/services/panels/PanelService.scala`, 709 lines at 24f6de4cf. Constructed in one
production place (`ApiRoutes.scala:365`, all nine args positional) and 22 times across 18 test files; `DashboardContentsService` calls
`panelService.buildAllForCreate` (`private[services]`), `PanelServiceBuildAllForCreateSpec` tests it directly.
`ResolvedPanelPatch` (top of the file) is used by `PanelServiceHelpers` and `PanelPatchApplier`.

Hard constraints found in tests (verified by reading `ExistenceNotLeakedRoutesSpec`):
- "name every source file that calls a shared access helper" (`filesCallingAccessHelpers`, regex
  `\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|authorizeResource)\(` over non-comment lines): the
  panel rows name only `PanelService.scala`. Any moved code line calling `requireAccess(` fails the guard.
- `expectedForbiddenProducers` pins `"PanelService.scala" -> 5` (non-comment lines containing
  `ServiceError.Forbidden(`): submitForm (133), create (231), batchUpdate (425), authorizeEditor (544),
  authorizeEditorOnDashboard (706). Moving any of them, or adding one elsewhere, fails the guard.
Both guards must stay green with zero test edits, so every ACL call and Forbidden producer stays in `PanelService.scala`.

## Goals / Non-Goals

**Goals:** `PanelService.scala` <= 300 lines and every new file <= 250 (living spec
`openspec/specs/backend-file-size-compliance/spec.md` requires PanelService and each split file <= 300; CONTRIBUTING's
400 is the hard trigger); verbatim moves; identical behaviour; zero test diff (import-only only if unavoidable).
**Line-budget fallback (D8):** the D2 guards pin a floor. If, after every D3 move, `PanelService.scala` is still
> 300, the executor records the measured floor and why each remaining block must stay (guard-pinned ACL/Forbidden
preamble, constructor + its wiring comments, class doc), and it becomes a follow-up candidate; it must still be < 400.
**Non-Goals:** see proposal.md. No change to `PanelServiceHelpers`, `PanelPatchApplier`, `BatchControlsCheck`,
`OutputControlsValidator`, `FormBindingValidator` beyond nothing (they are not edited).

## Decisions

**D1 — Entry point keeps name, package, constructor and signatures.** The constructor (order, names, defaults incl.
`auditService = null` before the required `outputRepo`), the `require(outputRepo != null, ...)` as the FIRST statement
of the class body, and every public method (`findById`, `submitForm` incl. `files = Map.empty`, `create`, `delete`,
`duplicate`, `batchUpdate`, `batchCreate`, `update`) plus `private[services] buildForCreate` / `buildAllForCreate`
(incl. `itemLabel: Int => Option[String] = _ => None`) keep identical signatures; the two `private[services]` methods
become one-line delegates. Their full scaladoc MOVES with the bodies to `PanelCreateBuilder`; each delegate keeps only a
one-line `/** Delegates to [[PanelCreateBuilder.buildForCreate]]. */`-style pointer (no duplicated doc).

**D2 — ACL and Forbidden lines stay put.** Kept in `PanelService.scala`, textually: the `findById`+owner check of
`submitForm`, `create`'s `requireAccess`/Viewer branch, `batchUpdate`'s 404/same-dashboard/`requireAccess`/Viewer
preamble, the 404+`authorizeEditorOnDashboard` preambles of `delete`/`duplicate`/`update`, `batchCreate`'s
empty/dashboardId/`authorizeEditor` preamble, and both `authorizeEditor` + `authorizeEditorOnDashboard`. No moved
module may contain a non-comment `requireAccess(`/`requireOwnerOnly(`/`authorizeResource...(` call or a
`ServiceError.Forbidden(` producer. No indirection that hides an ACL call from the scan (e.g. passing
`accessChecker.requireAccess _` into a module) is allowed either.

**D3 — Modules** (same package `com.helio.services.panels`, `final class`es built once in `PanelService`'s body from
its own constructor params, after the `require`, so instance cardinality and null-tolerance are unchanged; no module
dereferences a nullable dependency at construction):
- `ResolvedPanelPatch.scala` — the case class + scaladoc, verbatim.
- `PanelFormFileSubmission` — `submitFormWithFiles`, `foldFilePlaceholders`, `storeFormFiles` verbatim (deps:
  `dataSourceRepo`, `dataSourceService`, `fileSystem`). `submitForm` keeps its no-file branch and calls it.
- `PanelBindingChecks` — `rejectMissingOutput`, `rejectMissingDataSource`, `rejectInconsistentForm`,
  `defaultSizesFor` (deps: `outputRepo`, `dataSourceRepo`); companion `object` (or the same file) holds the pure
  extractors `outputIdOf`, `controlsOf`, `patchedConfigOf`, `formConfigOf`, `effectiveFormConfig`, verbatim. The
  HEL-904 removal-note comments (lines 614-617, 696-698) move with their neighbours.
- `PanelCreateBuilder` — `buildForCreate` and `buildAllForCreate` bodies verbatim (deps: binding checks,
  `outputControlsValidator`).
- `PanelUpdateValidation` — `update`'s post-authorize validation chain (resolvePatch/patchedConfigOf → output/
  dataSource existence → controls → form consistency), ending where `patchApplier.apply` begins; returns
  `Future[Either[ServiceError, ResolvedPanelPatch]]` with the identical `ServiceError.BadRequest(err)` on a decode
  failure. `PanelService.update` keeps the apply/audit/`.recover { case ex: IllegalArgumentException => ... }` tail.
- `PanelBatchWrites` — `batchUpdate`'s post-ACL body (type-match/chartType validation → `batchControlsCheck` → write
  → audit → `.recover`) and `batchCreate`'s post-authorize body (map items → labeled `buildAllForCreate` → sizes →
  `insertBatchPlaced` → audit).
- To reach <= 300 the executor MAY also move the post-ACL tails of `create` (buildForCreate → defaultSizesFor →
  `insertPlaced` → audit), `delete` and `duplicate` into the module owning that concern, under the same D5/D6 rules,
  leaving every `requireAccess`/Forbidden/404 line in `PanelService`.
Names are self-approved; the executor may adjust names but not boundaries without recording why.

**D4 — Verbatim moves.** Method bodies and their scaladoc move unchanged, at the same indentation (class-member
level). Allowed non-moved changes, each listed in evidence: class/object scaffolding and imports; access modifiers on
moved signature lines (`private def` → `private[panels] def`, or plain `def` on a `private[panels] final class` /
`private[panels] object`; never public at package level) — each changed modifier listed in `move-evidence.md`; receiver
qualification of a moved helper (`defaultSizesFor(p)` → `bindingChecks.defaultSizesFor(p)`) or an `import x._` that
avoids it; the `audit`/`log` plumbing of D5; positional words in comments ("below"/"above") made false by a move.
Chain extraction in D3's last two modules may re-indent a block; that block must be whitespace-insensitively identical.

**D5a — `.recover` scopes are pinned.** In `update`, `.recover { case ex: IllegalArgumentException => ... }` wraps
ONLY `patchApplier.apply(panelId, spec).map { ... }` inside the validation-success branch — never the Future returned
by `PanelUpdateValidation` (a throw in the validation chain stays a failed Future → 500, not a 400). In `batchUpdate`,
`.recover { case ex => ... Batch update failed }` wraps ONLY `panelRepo.batchUpdate(items, now).map { audit; Right }`
inside `batchControlsCheck`'s `Right` branch — never `batchControlsCheck` or the validation before it. No `.recover`,
`.transform`, `try` or `Future(...)` wrapper is added anywhere.

**D5 — Audit and logging semantics.** `audit` stays defined on `PanelService`; modules that need it receive it as a
function value and call it at the identical position in the Future chain (in particular `panel.batch_update`'s audit
stays INSIDE the `.map` that `.recover` wraps, so a throwing audit still becomes `BadRequest("Batch update failed")`).
`batchUpdate`'s `log.error` keeps the logger category `com.helio.services.panels.PanelService` (e.g.
`LoggerFactory.getLogger(classOf[PanelService])`) and the same message.

**D6 — Evaluation order and Futures.** No new eager evaluation: every validation/DB call happens in the same order and
inside the same `flatMap`/`map` it did (e.g. `Instant.now()` in `batchUpdate` taken at the same point; the HEL-1203
decode still runs after the 404/403 preamble and before any further read/write). No added `Future` hops that change
exception-to-failed-Future behaviour: a synchronous throw that formerly occurred inside a callback still does.

**D7 — Evidence (mechanical, failable)**, written in this change dir:
(a) `move-evidence.md`: `git diff --color-moved=plain --color-moved-ws=allow-indentation-change` summary over the
split, plus a scratchpad script that, for each moved method, compares the original body (from 24f6de4cf) to the new
one whitespace-normalised and prints MATCH/DIFF; list and justify every remaining non-moved changed line (D4).
Red run: show the script prints DIFF on a scratch copy with one token altered.
(b) `test-count-evidence.md`: baseline `nice -n 19 sbt testFull` on unmodified 24f6de4cf (total "Tests: succeeded N"
+ counts for `ExistenceNotLeakedRoutesSpec`, `PanelServiceBuildAllForCreateSpec` and every `*Panel*Spec`), after the
change the same totals; `git diff <base>...HEAD -- backend/src/test` empty (or import-only, each justified).
(c) Guard scan: both D2 guard sets computed on the new tree match the old (`PanelService.scala` only; count 5).
(d) `node scripts/check-scala-quality.mjs` passes; new files grepped by eye for inline FQNs inside `s"${...}"`
(HEL-1386 blind spot); line counts of every touched file recorded against the spec's 300 (and 400) figures.
(e) Ordering claims, checked by reading the final code and stated in `move-evidence.md`: the HEL-1203 decode runs
inside `authorizeEditorOnDashboard`'s `Right` branch; each `.recover` scope matches D5a; `Instant.now()` positions
unchanged. The MATCH script compares bodies from the first `=` of each `def` onward (signature-line modifier changes
are reported separately by the D4 list, not as DIFF), plus each moved scaladoc block verbatim.

## Risks / Trade-offs

- [Implicit/import drift] modules need `ExecutionContext` and spray-json implicits; compile + full suite catch it.
- [Constructor-time null deref] modules hold nullable deps; D3 forbids dereferencing at construction.
- [Entry file ~300-350 lines, over the 250 soft budget] accepted: D2's ACL preambles must stay in this file for the
  guards; the soft budget is a warning only.
- [Subtle chain change in D3's extracted chains] D5/D6 invariants + full suite; skeptic reviews these by hand.

## Planner Notes

- Self-approved: module names/boundaries (D3), keeping ACL preambles in the entry point (D2, guard-driven).
- Premise: 709 lines, not ~730. HEL-1304 (60fdb87de) did not touch PanelService (it calls only
  `FormPanelConfig.applyPatch`, not `PanelAppearance.applyPatch`). HEL-1260 did touch it (placement); its owner-repair
  half lives in `services/dashboards/DashboardLayoutRepair.scala`, untouched here. HEL-1233 likewise dashboards-side.
- Out of scope / spinoff candidates are recorded in the evaluation, never fixed (refactor discipline).
- No spec delta: the living file-size spec already states the target; this change moves toward it, adds no
  requirement. Other files it lists (`DashboardService` 473, `PanelRepository` 426) are out of scope (HEL-1234 etc.).
- Comments in OTHER files naming `PanelService` methods (`OutputControlsValidator.scala:11,34`,
  `PanelPatchApplier.scala:11-17`, `DashboardContentsService.scala:21,115-119`, `PanelMutationRepository.scala:158`)
  are left untouched to keep the diff to `services/panels/PanelService.scala` + new files + README; a pointer sweep is
  a follow-up candidate.
