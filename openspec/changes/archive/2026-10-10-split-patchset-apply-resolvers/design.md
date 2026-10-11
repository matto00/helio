## Context

See proposal.md. File: `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala`, 853 lines
at base 6d298d5f8 (`BASE` below; the file is byte-identical at 1b765f59d). Shape: package + imports (1-18), object
doc (20-31), one `private[services] object PatchSetApplyResolvers` (header 32, body 33-852, closing brace 853). Every
member except `resolveAll` is `private def`. Line numbers below are locators; spans are defined by D6a's member-block
rule, never by "this def to the next def minus 1" (which attaches a doc to the previous member, the HEL-1463
design-gate r1 finding).

**The three `ExistenceNotLeakedRoutesSpec` pins (verified at BASE; spec lines 412-447, 497-500, 529):**
- `expectedForbiddenProducers` has `"PatchSetApplyResolvers.scala" -> 4`. The four code lines containing
  `ServiceError.Forbidden(` are :108 (`authorizeEditorOnDashboard`), :126 (`authorizeEditorOrOwnerOnPipeline`), :356
  (`resolveDashboardUpdate`), :388 (`resolveDashboardDelete`). The count is per FILE name over every `.scala` under
  `src/main/scala`, so any new file containing a producer appears as a new map key and fails the pin.
- `filesCallingAccessHelpers()` requires every file calling `requireOwnerOnly(`/`requireAccess(`/
  `authorizeResourceWithSharing(`/`authorizeResource(` to be named in some row's `sites`. This file's only helper
  calls are two `requireAccess(` calls, :106 (`authorizeEditorOnDashboard`) and :354 (`resolveDashboardUpdate`).
- `patchSetDispatchPairs()` reads `case ("<kind>", "<op>")` code lines of the file NAMED
  `PatchSetApplyResolvers.scala` (`.get`, so the file must exist) and requires the set to equal row `patchKinds` plus
  `patchKindExemptions` (both directions). All 18 dispatch pairs are in `resolveEdit` (:63-:83).
- 12 route rows (spec :412-:446; the ticket says "about 15") name `PatchSetApplyResolvers.scala` in `sites`. `sites` has exactly one
  mechanical consumer: the helper-caller guard above (`rows.flatMap(_.sites)` is a set; it only has to contain every
  helper-calling file).

**Callers outside the file:** only `resolveAll`: `PatchSetApplyService.scala:76`, `PatchSetPreviewService.scala:44`,
and `PatchSetPreviewOutputContextSpec.scala:274` (test, same package). No other member is referenced in code
anywhere (all are `private`). Prose-only mentions of moved members (stale after the move, NOT edited, D3):
`PatchSetPreviewProjection.scala:355` (`PatchSetApplyResolvers.pipelineSummaryResponse`),
`RefinementEditShapeSpec.scala:31` (`.resolvePipelineStepUpdate`/`validateEmbeddedStepReferences`),
`PatchSetPreviewServiceSpec.scala:504` (`.validateEmbeddedStepReferences`), `PatchSetUndoService.scala:245-246`
(`PatchSetApplyResolvers .buildPipelineStepDeletePriorState`, split across two doc lines). `RefinementGrounding.scala:30`
(`.resolveDashboardUpdate`) stays accurate (D1 keeps it).

**Bytecode surface (Scala 2.13.15):** the object compiles to `PatchSetApplyResolvers$` (module) and
`PatchSetApplyResolvers` (mirror with static forwarders for public members). Scala `private` object members compile to
JVM-private methods and get no forwarder; `private[x]` members compile to JVM-public methods and DO get forwarders.
So widening a member that stays in `PatchSetApplyResolvers` would add public methods to C5's javap. D1 avoids that.

## Goals / Non-Goals

Goals: concern-focused files; identical behaviour; zero test-source diff; all three spec pins hold unedited and
remain failable; reviewers can see moves vs edits. Non-goals: proposal.md.

## Decisions

**D1 — Pin resolution: the ticket's first branch (no test edits).** Keep the dispatch, all four Forbidden producers
and both `requireAccess(` calls in `PatchSetApplyResolvers.scala`. This is reachable because those six sites live in
only five members: `resolveEdit`, `authorizeEditorOnDashboard`, `authorizeEditorOrOwnerOnPipeline`,
`resolveDashboardUpdate`, `resolveDashboardDelete`. Rejected alternative: moving them and editing the spec's pins.
That would need owner approval, collide with HEL-1480 (editing the same spec), and change what three security guards
read, for no gain in file size that D1 doesn't already get (the kept file is ~250 lines). The driver's claim "test
edits are required" is therefore not adopted; D6f shows each guard still fails red post-split.

The file keeps:
- `PatchSetApplyResolvers` (header, doc, modifier `private[services]` unchanged): `resolveAll`, `resolveEdit`
  (dispatch text byte-identical; the called resolvers reach it via named imports, D3), and the dashboard resolvers
  `resolveDashboardUpdate`, `buildDashboardUpdateResolved`, `resolveDashboardDelete`, `resolveDashboardCreate`, all
  still `private` (only called inside this object).
- A second top-level object in the same file, declared after the first, `private[patchsets] object
  PatchSetResolverSupport` with a one-line scaffold doc, holding five shared helpers: `requireTargetId` (:95), `authorizeEditorOnDashboard` (:101), `authorizeEditorOrOwnerOnPipeline`
  (:112-doc), `requireVisibleStep` (:130-doc), `decodeCreatePatch` (:144), each `private` -> `private[patchsets]`.
  Why each is here: `requireTargetId` and `decodeCreatePatch` are called by the dashboard resolvers (kept) and by
  several destinations; `authorizeEditorOrOwnerOnPipeline` by `requireVisibleStep` and `resolvePipelineStepCreate`;
  `authorizeEditorOnDashboard` is called only by the panel resolvers but holds producer :108 and helper call :106,
  so C2 keeps it in this file; `requireVisibleStep` is called only by the pipelineStep resolvers but must sit next to
  `authorizeEditorOrOwnerOnPipeline` (producer :126, which it calls) in a shared object, and moving it alone to
  `PatchSetPipelineStepResolvers` would still need that object's widened helper, so it stays with it for locality.
  Putting them in a separate object (not widening them in place) keeps `PatchSetApplyResolvers`/`$`'s public bytecode
  unchanged (C5); putting that object in THIS file keeps producers :108/:126 and call :106 here (C2). Multiple
  top-level definitions per file have precedent in `services/` (e.g. `PanelPacker.scala`, `LayoutPolicy.scala`).

**D2 — Destinations** (same package, one new file each, each a `private[patchsets] object X` with a one-line
scaffold doc, members in their original relative order):
- `PatchSetPanelResolvers` — standalone comment block 169-173 (HEL-904, about removed panel-binding validators),
  `resolvePanelUpdate` (:230), `resolvePanelDelete` (:259), `resolvePanelCreate` (:284), `rejectUnboundOrBadlyBoundForm`
  (:312-doc, stays `private`).
- `PatchSetDataSourceResolvers` — `resolveDataSourceUpdate` (:416), `resolveDataSourceDelete` (:441),
  `resolveDataSourceCreate` (:462).
- `PatchSetPipelineResolvers` — `pipelineSummaryResponse` (:154, stays `private`), `resolvePipelineUpdate` (:481),
  `resolvePipelineDelete` (:513), `prefixedWithEdit` (:538, stays `private`), `resolvePipelineCreate` (:544).
- `PatchSetPipelineStepResolvers` — `validateEmbeddedStepReferences` (:175-doc, stays `private`),
  `resolvePipelineStepUpdate` (:593), `resolvePipelineStepDelete` (:634), `buildPipelineStepDeletePriorState`
  (:671-doc, stays `private`), `resolvePipelineStepCreate` (:703-doc; its block includes BOTH stacked doc comments
  703-720, which are contiguous with the declaration), `authorizeSecondSourceForCreate` (:755-doc, stays `private`).
- `PatchSetOutputResolvers` — standalone section comment :784 (`// ── output (HEL-907 ...`), `findOwnedOutput`
  (:786-doc, stays `private`), `resolveOutputUpdate` (:800), `resolveOutputDelete` (:829).
Every `resolve<Kind><Op>` member moved to a collaborator is called from `resolveEdit`, so it becomes
`private[patchsets]`; every other moved member is called only inside its own new object and stays `private`. The
executor may move a member elsewhere only to resolve a real dependency this inventory missed, recording it and why
in `move-evidence.md`. Object names are self-approved; none reuses an existing file name in the package.

**D3 — Bodies move byte-identical.** Members keep their 2-space object-body indentation. Cross-object calls keep
their unqualified text via named member imports at the top of each object body (e.g. `import
PatchSetResolverSupport.{requireTargetId, authorizeEditorOnDashboard, decodeCreatePatch}` in
`PatchSetPanelResolvers`; in `PatchSetApplyResolvers`, named imports of every collaborator resolver the dispatch
calls, plus `requireTargetId`/`decodeCreatePatch`). Wildcard member imports are not allowed (they hide which names cross); this does not apply to the file-level
`import PatchSetApplyServiceJson._`, which every file that needs the JSON formats keeps exactly as BASE has it.
A receiver-qualified call is allowed only where an import would be ambiguous, each one listed in the evidence. The
only other permitted non-move lines: package/imports (each file imports only what it uses; the kept file's import
list is pruned), object scaffolding (header, one-line doc, member imports, closing brace), `private` ->
`private[patchsets]` on the declaration lines D1/D2 name, and the package README "Holds" list. **No edits inside
moved or kept comments at all**: positional words the move made false ("above"/"this file") and stale doc links
(`[[x]]`, `PatchSetApplyResolvers.x` in prose) are left as-is and listed as follow-up candidates.

**D4 — No state, no wiring.** Every destination is a stateless `object` like the original (it takes collaborators
via `PatchSetApplyContext` parameters), so there is no construction order, no logger (the file has none), and
initialisation of each module is trivially side-effect-free. Implicit `ExecutionContext` parameters are carried as-is.

**D5 — Output rows' `sites` label is not edited.** After the move the output owner check (`findOwnedOutput`) lives in
`PatchSetOutputResolvers.scala`, while the four output rows keep naming `PatchSetApplyResolvers.scala`. That label's
only mechanical consumer is the helper-caller guard; `findOwnedOutput` calls no access helper, so the guard is
unaffected, and the dispatch the rows exercise still lives in the named file. Recorded as a documentary follow-up
candidate rather than a test edit (C1; avoids the HEL-1480 collision).

**D6 — Evidence** (in this change dir; scripts under `move-check/`, adapted from
`openspec/changes/archive/2026-10-10-split-pipeline-service/move-check/`).
(a) `move-evidence.md`: an inventory table assigning EVERY block of the BASE object body to exactly one destination,
with its exact BASE span and whether its declaration line is widened. **Member-block rule:** a member block is the
contiguous run of comment lines (`/**`, ` *`, `//`) immediately above a declaration (no blank line between) through
the declaration's last body line. A comment-only block separated from the next declaration by a blank line is a
standalone block and must be assigned explicitly (here: 169-173 and 784). Checker, in BOTH directions: (i) forward:
each block's BASE text (`git show BASE:<path>`) equals its text in its destination file, only D1/D2's declared
`private` -> `private[patchsets]` substitutions allowed; (ii) reverse: every non-blank line of the six resulting files
is consumed POSITIONALLY by the next expected item (a member block or an allow-listed scaffold line tagged with its D3
category); any extra/missing/altered line fails; (iii) coverage: every non-blank BASE line 20..853 (object doc,
header, body, closing brace) is claimed exactly once (header/doc/brace by the kept file's scaffold-from-BASE
entries); (iv) block rule: each block's first line is a comment or its declaration and the BASE line before it is
blank or the last line of another claimed block. Red runs on scratch copies: one token changed inside a moved body
(forward fails); a copy of an existing line inserted outside any member (reverse fails). Plus a `git diff
--color-moved=plain BASE` summary for the PR.
(b) `api-evidence.md`: `javap -public` of `com.helio.services.patchsets.PatchSetApplyResolvers` and
`PatchSetApplyResolvers$` (sbt class output dir) before vs after. **Normalisation, declared up front:** drop every
line matching `\$anonfun\$|\$deserializeLambda\$|\$\$` (Scala 2.13 lambda bodies are public static
`$anonfun$<method>$<N>` methods that leave the class when their enclosing method moves; `$$`-mangled accessors) and
nothing else. The filtered diff must be empty. Record raw line counts and dropped-line counts before/after. Red run
(must still compile): temporarily add a trailing defaulted parameter to `resolveAll`, rebuild, show the filtered diff
non-empty, revert.
(c) Grep guards (recorded): no new file (the five D2 files) contains `ServiceError.Forbidden(` or an access-helper
call; `PatchSetApplyResolvers.scala` still has exactly 4 producer code lines and 2 `requireAccess(` code lines (by the
spec's own `codeLines` filter); no inline FQN (`com.helio.`, `spray.json.`, `java.`, `scala.`, `org.`) outside
import/package lines in any new or edited file; `npm run check:scala-quality` passes.
(d) Behaviour mutations: one per new object (six: the five D2 files and `PatchSetResolverSupport`), each changing an
observable result in a moved body (a status/message) that an existing spec asserts; run the affected specs, show each
red with a failure attributable to it, revert, show green. Record spec + assertion hit. A destination no existing
spec observes is recorded as a coverage gap + follow-up candidate; do NOT write a test (C1).
(e) `test-count-evidence.md`: baseline `nice -n 19 sbt -J-Xmx3g testFull` on the unmodified worktree at BASE (total
succeeded/failed/ignored, per-suite counts for every suite, `[hel1468-guard]` present); the same after the change
must match per suite and pass. Known flakes named, not hidden (a failure on either side is re-run alone and both runs
recorded). `git diff BASE...HEAD -- backend/src/test` empty. Run backgrounded to a log under the run evidence dir and
poll with `scripts/concertino/await-sentinel.sh`; at most one full `testFull` on the machine at a time (check `ps`
for another lane's before starting); shut down every sbt server started.
(f) Spec-guard failability after the split (ExistenceNotLeakedRoutesSpec's guards, run alone, on scratch edits
reverted afterwards): (1) add a `ServiceError.Forbidden()` producer line to one NEW collaborator file -> the
producer-count test fails naming that file; (2) change one producer line in `PatchSetResolverSupport` (in the kept
file) so it no longer contains `ServiceError.Forbidden(` -> the same test fails with count 3; (3) add a code line
calling `ctx.accessChecker.requireAccess(` to one NEW collaborator file -> the helper-site test fails naming that
file; (4) add a `case ("panel", "rename") =>` dispatch line to `resolveEdit` -> the dispatch-coverage test fails.
Each red is recorded with its failure message, then the spec is shown green. These are scratch-only; nothing is
committed from them.

**D7 — Concurrent-change protocol (HEL-1480).** HEL-1480 (in progress) edits exactly one line of this file: the doc
line :178 inside `validateEmbeddedStepReferences` (its design.md D2, C3), which this change moves byte-identical to
`PatchSetPipelineStepResolvers.scala`. Rules:
- `BASE` is never hard-coded: every evidence script reads it from one variable/argument (`BASE=<sha>`), and every
  evidence file states the SHA it was generated against.
- If HEL-1480 merges first: merge `origin/main` into this branch (no rebase of history needed), resolve the conflict
  by taking HEL-1480's text for :178 inside the MOVED block in `PatchSetPipelineStepResolvers.scala` (never by
  reverting to this change's old BASE text), re-pin `BASE` to the new merge-base (`git merge-base HEAD origin/main`), re-run D6f,
  and regenerate D6a (move check, both red runs) and D6b (javap) against it. Re-run `ExistenceNotLeakedRoutesSpec`
  and the `com.helio.services.patchsets` specs; re-run the full `testFull` only if the reconciled upstream diff
  touched non-comment backend code, comparing per suite against a re-baselined BASE.
- If this change merges first: HEL-1480's :178 edit no longer applies to this file. The orchestrator reports to the
  driver (final report + before merge) that the line now lives in `PatchSetPipelineStepResolvers.scala`
  (`validateEmbeddedStepReferences` doc), so the driver relays it to the HEL-1480 lane.
- Either way, the auditor verifies `origin/main` is an ancestor of the PR head before merging.

## Risks / Trade-offs

- Two top-level objects in one file is less conventional than one-per-file. Accepted: it is the only arrangement that
  keeps the spec pins and the entry's public bytecode both unchanged; precedent exists in `services/`.
- Widening 19 members (5 support helpers + 14 dispatched resolvers) to `private[patchsets]` exposes them inside the package. Accepted (HEL-1371/1463 precedent);
  the objects themselves are `private[patchsets]`.
- `PatchSetPipelineStepResolvers` will be ~270 lines, slightly over the 250 soft budget. Accepted; named in
  follow-ups.

## Planner Notes

- Driver claims checked: HEL-1463 merged as 6d298d5f8 (#922) and did not touch this file; the spec pins exist as
  described except 12 rows, not ~15. The "test edits are required" claim is not adopted (D1).
- No gate-chain (`.husky/**`) impact.

## Standing Constraints

- [C1] Zero diff under `backend/src/test`; per-suite test results equal the BASE baseline.
- [C2] `PatchSetApplyResolvers.scala` keeps exactly 4 `ServiceError.Forbidden(` code lines, 2 `requireAccess(` code lines and every `case ("kind", "op")` dispatch line; no new file contains a producer or access-helper call.
- [C3] Moved bodies are byte-identical apart from D3's listed categories; defects found become follow-ups, not fixes.
- [C4] No edits inside any moved or kept comment; the only in-member substitution is `private` -> `private[patchsets]` on D1/D2's named declarations.
- [C5] Filtered (D6b) `javap -public` of `PatchSetApplyResolvers` and `PatchSetApplyResolvers$` is unchanged.
