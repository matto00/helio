# Move evidence (HEL-1253, design D7a/D7e)

Base: `24f6de4cf` (`PanelService.scala`, 709 lines). Script: `move-match.py` in this directory
(`python3 move-match.py <orig PanelService.scala> <services/panels dir>`; original from
`git show 24f6de4cf:backend/src/main/scala/com/helio/services/panels/PanelService.scala`).
For each moved unit it whitespace-normalises the original text and checks it appears, whitespace-
insensitively, in the named new file. `def` units are compared from the signature-ending `=` onward
(signature modifier changes are listed below, not reported as DIFF); scaladoc/comments and chain-
extracted blocks are compared verbatim.

## Green run (current tree)

```
MATCH  ResolvedPanelPatch (class+doc)  (orig 26-40 -> ResolvedPanelPatch.scala, doc)
MATCH  submitFormWithFiles doc  (orig 144-153 -> PanelFormFileSubmission.scala, doc)
MATCH  submitFormWithFiles  (orig 154-176 -> PanelFormFileSubmission.scala, def)
MATCH  foldFilePlaceholders doc  (orig 178-181 -> PanelFormFileSubmission.scala, doc)
MATCH  foldFilePlaceholders  (orig 182-192 -> PanelFormFileSubmission.scala, def)
MATCH  storeFormFiles doc  (orig 194-200 -> PanelFormFileSubmission.scala, doc)
MATCH  storeFormFiles  (orig 201-214 -> PanelFormFileSubmission.scala, def)
MATCH  defaultSizesFor doc  (orig 246-249 -> PanelBindingChecks.scala, doc)
MATCH  defaultSizesFor  (orig 250-264 -> PanelBindingChecks.scala, def)
MATCH  HEL-904 removal note (rejectCompanionBinding)  (orig 614-617 -> PanelBindingChecks.scala, doc)
MATCH  rejectMissingOutput doc  (orig 619-624 -> PanelBindingChecks.scala, doc)
MATCH  rejectMissingOutput  (orig 625-636 -> PanelBindingChecks.scala, def)
MATCH  rejectMissingDataSource doc  (orig 638-639 -> PanelBindingChecks.scala, doc)
MATCH  rejectMissingDataSource  (orig 640-644 -> PanelBindingChecks.scala, def)
MATCH  outputIdOf/controlsOf doc  (orig 646-647 -> PanelBindingChecks.scala, doc)
MATCH  outputIdOf  (orig 648-651 -> PanelBindingChecks.scala, def)
MATCH  controlsOf  (orig 653-656 -> PanelBindingChecks.scala, def)
MATCH  patchedConfigOf doc  (orig 658-661 -> PanelBindingChecks.scala, doc)
MATCH  patchedConfigOf  (orig 662-666 -> PanelBindingChecks.scala, def)
MATCH  formConfigOf doc  (orig 668-669 -> PanelBindingChecks.scala, doc)
MATCH  formConfigOf  (orig 670-673 -> PanelBindingChecks.scala, def)
MATCH  effectiveFormConfig doc  (orig 675-679 -> PanelBindingChecks.scala, doc)
MATCH  effectiveFormConfig  (orig 680-685 -> PanelBindingChecks.scala, def)
MATCH  rejectInconsistentForm doc  (orig 687-689 -> PanelBindingChecks.scala, doc)
MATCH  rejectInconsistentForm  (orig 690-694 -> PanelBindingChecks.scala, def)
MATCH  HEL-904 removal note (rejectUnresolvableMetric)  (orig 696-698 -> PanelBindingChecks.scala, doc)
MATCH  buildForCreate doc  (orig 266-276 -> PanelCreateBuilder.scala, doc)
MATCH  buildForCreate  (orig 277-322 -> PanelCreateBuilder.scala, def)
MATCH  buildAllForCreate doc  (orig 324-337 -> PanelCreateBuilder.scala, doc)
MATCH  buildAllForCreate  (orig 338-357 -> PanelCreateBuilder.scala, def)
MATCH  update validation chain (HEL-1203 decode .. rejectInconsistentForm)  (orig 566-597 -> PanelUpdateValidation.scala, block)
MATCH  update HEL-1203 comment (see D4 allowed edit)  (orig 562-565 -> PanelUpdateValidation.scala, doc)
MATCH  batchUpdate post-ACL body  (orig 427-459 -> PanelBatchWrites.scala, block)
MATCH  batchCreate post-authorize body  (orig 491-521 -> PanelBatchWrites.scala, block)
MATCH  create tail  (orig 233-242 -> PanelLifecycleWrites.scala, block)
MATCH  delete tail  (orig 368-373 -> PanelLifecycleWrites.scala, block)
MATCH  duplicate tail  (orig 387-393 -> PanelLifecycleWrites.scala, block)
RESULT ALL MATCH
```

## Red run (failability): one token altered in a scratch copy

`"Output not found"` -> `"Output not founds"` in a scratch copy of `PanelBindingChecks.scala`:

```
DIFF   rejectMissingOutput  (orig 625-636 -> PanelBindingChecks.scala, def)
RESULT 1 DIFF
```

## git color-moved summary

`git diff --color-moved=plain --color-moved-ws=allow-indentation-change -- backend/src/main/scala`:
453 added lines are detected as moved, 187 added lines are new (class/object scaffolding, imports,
module scaladoc headers, delegates, wiring, README), 407 removed lines are detected as moved, 15 removed lines are
not moved (imports dropped from `PanelService`, the old `log`, replaced call sites, and the
rewritten `update` tail).

## Non-moved changed lines (D4), each justified

Signature-line modifiers (all on moved `def`s; no module member is public at package level):
- `submitFormWithFiles`: `private def` -> `def` (member of `private[panels] final class PanelFormFileSubmission`).
- `defaultSizesFor`, `rejectMissingOutput`, `rejectMissingDataSource`, `rejectInconsistentForm`: `private def` -> `def` (members of `private[panels] final class PanelBindingChecks`).
- `outputIdOf`, `controlsOf`, `patchedConfigOf`, `formConfigOf`, `effectiveFormConfig`: `private def` -> `def` (members of `private[panels] object PanelBindingChecks`).
- `foldFilePlaceholders`, `storeFormFiles` keep `private def`.
- `buildForCreate`/`buildAllForCreate` keep `private[services] def` verbatim (inside `private[panels] final class PanelCreateBuilder`; `PanelService` keeps `private[services]` delegates with identical signatures incl. `itemLabel: Int => Option[String] = _ => None`).

Receiver qualification / imports (instead of editing moved bodies): modules use `import bindingChecks._`,
`import createBuilder._`, `import PanelBindingChecks._` inside the class so moved bodies call
`rejectMissingOutput(...)`, `defaultSizesFor(...)`, `outputIdOf(...)`, `buildAllForCreate(...)` unqualified,
byte-identical to the original. In `PanelService` the remaining call sites are qualified
(`formFiles.submitFormWithFiles`, `createBuilder`/`lifecycleWrites`/`batchWrites`/`updateValidation`).

Audit plumbing (D5): `PanelService.audit` is unchanged and passed as a 4-arg function value to
`PanelBatchWrites` (all its calls pass `metadata` explicitly) and `PanelLifecycleWrites`. `create`/`delete`
call `audit(...)` with the default metadata, so `PanelLifecycleWrites` has a local `private def audit(action, resourceId, user, metadata: JsValue = JsObject.empty)` wrapper with the same default
(skeptic-design-2 note); the moved bodies are therefore byte-identical.
Logger (D5): `LoggerFactory.getLogger(classOf[PanelService])` in `PanelBatchWrites`, same category
`com.helio.services.panels.PanelService`, same message. `PanelService` itself no longer has a `log` (unused).

Chain-extraction edits:
- `update`: the validation chain (orig 562-597) moved to `PanelUpdateValidation.validate`, re-indented, with
  an appended pure `.map { Left(err) => Left(err); Right(_) => Right(spec) }`; `PanelService.update` keeps
  `patchApplier.apply(...).map{...}.recover{ IllegalArgumentException }` as the `Right(spec)` branch of
  `updateValidation.validate(...).flatMap` (the old fourth `flatMap` is now that branch).
- positional word: the HEL-1203 comment "lookups above" -> "lookups in PanelService.update" (the only text
  edit in a moved comment; the script applies this substitution explicitly to the original).
- `batchUpdate`/`batchCreate`/`create`/`delete`/`duplicate`: post-ACL bodies moved to `PanelBatchWrites` /
  `PanelLifecycleWrites` as listed in the green run, with the call site replaced by one delegating line
  (`batchWrites.updateValidated(items, panels, dashboardId, user)`, `batchWrites.createValidated(request, dashboardId, user)`,
  `lifecycleWrites.createPlaced/deleteRow/duplicatePlaced`).
- Boundary note (design allowed adjusting names): create/delete/duplicate tails live in a new `PanelLifecycleWrites`
  (D3's optional tail move), not in `PanelCreateBuilder`, to keep the builder a pure no-write module.

## Ordering and scope claims (D7e), checked on the final code

- HEL-1203 decode: `updateValidation.validate` is called from inside `authorizeEditorOnDashboard(...).flatMap`'s
  `Right(_)` branch; `resolvePatch`/`patchedConfigOf` run synchronously inside `validate`, so they still run after the
  404 (`findById`) and 403 (`authorizeEditorOnDashboard`) lookups and before any further read/write.
- `update`'s `.recover { case ex: IllegalArgumentException => ... }` wraps only `patchApplier.apply(panelId, spec).map{...}`;
  the Future returned by `validate` is never wrapped (a throw there stays a failed Future).
- `batchUpdate`'s `.recover { case ex => ... }` wraps only `panelRepo.batchUpdate(items, now).map{ audit; Right }`
  inside `batchControlsCheck`'s `Right` branch (`PanelBatchWrites.updateValidated`); `panel.batch_update` audit is inside that `.map`.
- `Instant.now()` in `batchUpdate` is still taken after `batchValidation` and before `batchControlsCheck`.
- No `.recover`/`.transform`/`try`/`Future(...)` added anywhere (grep of the new files: only the two pre-existing `.recover`s).
- Constructor and the first-statement `require(outputRepo != null, ...)` unchanged; modules are constructed after it, none dereferences a nullable dep at construction.
