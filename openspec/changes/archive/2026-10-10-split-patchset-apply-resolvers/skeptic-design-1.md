## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 6d298d5f83a56041188fb619bb0fd4ad333bb9ca (= BASE; the change dir is untracked). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/split-patchset-apply-resolvers/HEL-1479`.

### What I verified (with evidence)

- **Member-block inventory (D2/D1) is complete and correctly attached.** I read the whole BASE file (853 lines) and enumerated 34 object-body blocks: resolveAll 34-49, resolveEdit 51-92, requireTargetId 95-99, authorizeEditorOnDashboard 101-110, authorizeEditorOrOwnerOnPipeline 112-128 (doc 112-114), requireVisibleStep 130-142 (doc 130-132), decodeCreatePatch 144-152, pipelineSummaryResponse 154-166, standalone 169-173, validateEmbeddedStepReferences 175-227 (doc 175-178), panel U/D/C 230-257 / 259-282 / 284-309, rejectUnboundOrBadlyBoundForm 312-337 (doc 312-317), resolveDashboardUpdate 339-360, buildDashboardUpdateResolved 362-371, resolveDashboardDelete 373-396 (doc 373-375), resolveDashboardCreate 398-413, dataSource U/D/C 416-439 / 441-460 / 462-476, pipeline update/delete 481-511 / 513-536, prefixedWithEdit 538-542, resolvePipelineCreate 544-590, step update/delete 593-632 / 634-669, buildPipelineStepDeletePriorState 671-701 (doc 671-677), resolvePipelineStepCreate 703-753 (two stacked docs 703-710 + 711-720, contiguous, no blank between), authorizeSecondSourceForCreate 755-782 (doc 755-759), standalone 784, findOwnedOutput 786-798 (doc 786-788), output update/delete 800-827 / 829-852. Every block is claimed exactly once across D1 + D2. Each doc goes with the member below it. Both standalone blocks are assigned (169-173 to Panel, 784 to Output). The D6a member-block rule plus checker (iv) mechanically prevent a split from detaching a doc from its member. No repeat of the HEL-1463 r1 finding.
- **Cross-object dependencies.** I traced every call in every moved body. Panel calls requireTargetId, authorizeEditorOnDashboard, decodeCreatePatch and its local rejectUnbound. DataSource calls requireTargetId and decodeCreatePatch. Pipeline calls requireTargetId, decodeCreatePatch and its locals pipelineSummaryResponse and prefixedWithEdit. PipelineStep calls requireTargetId, requireVisibleStep, authorizeEditorOrOwnerOnPipeline, decodeCreatePatch and three locals. Output calls requireTargetId and its local findOwnedOutput. The kept dashboard resolvers call requireTargetId, decodeCreatePatch and a direct `ctx.accessChecker.requireAccess`. In Support, requireVisibleStep calls authorizeEditorOrOwnerOnPipeline, which is in the same object. No dependency is missed, and the 19-member widening count (5 + 14) is correct.
- **Name resolution and implicit scope after the move.**
  - None of the moved member names is defined in any protocol trait mixed into `PatchSetApplyServiceJson`: grep over `api/protocols` returned 0 hits. So named in-body imports cannot shadow, or be shadowed by, the file-level wildcard.
  - None of the six new object names exists anywhere in `backend/src`.
  - There is no package object on the `services`/`patchsets` path.
  - The request types decoded via `decodeCreatePatch[T]` have no companion-object implicits. Their formats live only in the protocol traits (`PanelProtocol.scala:242`, `PipelineStepProtocol.scala:453`, `DataSourceProtocol.scala:722`). A missing implicit import is therefore a compile error, not a silent substitution.
  - Signature types (`ResolvedEdit`, `PatchSetApplyContext`, `ResolvedAction`) are `private[services]`, which is wider than `private[patchsets]`, so there is no escape error.
  - In-body `import X._` / `import X.{...}` has precedent (`PanelCreateBuilder.scala:21` and others). Multi-object files have precedent (`PanelPacker.scala`, `LayoutPolicy.scala`).
  - `build.sbt` sets no `scalacOptions`, so there are no fatal or unused warnings.
- **External callers.** `git grep` for every one of the 31 member names outside the file finds code references only to `resolveAll` (`PatchSetApplyService.scala:76`, `PatchSetPreviewService.scala:44`, `PatchSetPreviewOutputContextSpec.scala:274`). The `authorizeEditorOnDashboard` hits in `PanelService.scala` are PanelService's own private method in another package. No reflection or source-scan test pins any moved member. I checked the other source-scanning specs (`SqlEgressSocketFactoriesSpec`, `RestSourceConstructionSiteSpec`, `ShareTokenGenerationSpec`, `CredentialSurfaceEnumerationSpec`, `SchemaFieldStructuralGuardSpec`) and none keys on this file. `openspec/specs/patch-set-preview/spec.md` names only `resolveAll`, which is kept.
- **D1 pin resolution against `ExistenceNotLeakedRoutesSpec` holds unedited.**
  - Producers: `grep Forbidden` gives exactly :108, :126, :356, :388, all in members kept in this file (two in `PatchSetResolverSupport`, two in the dashboard resolvers). `forbiddenProducerCounts` keys on file name, so the count stays `-> 4`.
  - Helper sites: the only helper calls are `requireAccess(` at :106 and :354, both kept. `filesCallingAccessHelpers` (spec :481-487) would flag any new file, and none gets a call.
  - Dispatch: all `case ("x", "y")` lines are :63-:83 inside the kept `resolveEdit`. No moved body contains a quoted tuple case. `patchSetDispatchPairs` (:497-500) still finds the same file and the same 18 pairs.
  - Failability: D6f's four scratch mutations each target the real mechanism (per-file count, a new key, file-not-in-sites, an uncovered pair). Each would go red. The driver's claim that "test edits are required" is false, and the design correctly rejects it.
- **D1 bytecode claim.** I ran `javap` on the compiled BASE class from the HEL-1465 worktree after confirming its source is byte-identical to BASE (`diff -q` reported "same").
  - `javap -p` shows every Scala-`private` member as a JVM `private` method, with no `$$`-mangled accessor.
  - Applying the D6b filter to `javap -public` leaves exactly `MODULE$`, `<clinit>` and `resolveAll` on `PatchSetApplyResolvers$`, and one static forwarder `resolveAll` on the mirror.
  - Unfiltered, the class carries many `public static final $anonfun$<member>$N` lambdas, which leave with their members. So the filter is necessary, and it is declared up front.
  - Widening in place (`private[x]` compiles to a JVM-public method with a forwarder) would change C5. A second object avoids this. The claim is correct.
  - The red run (a defaulted trailing parameter on `resolveAll`) keeps all three callers compiling and adds `resolveAll$default$N` plus a changed signature, so it is a real red.
- **D6 sufficiency.** Byte-move forward/reverse/coverage/block-rule with two red runs, javap with a red run, per-suite `testFull` parity, one behaviour mutation per new object, four guard red runs, and grep guards for C2. Given that names resolve as shown above, this is sufficient to prove behaviour preservation.
- **ExistenceNotLeakedRoutesSpec row count.** `grep -n 'PatchSetApplyResolvers.scala'` gives 14 lines: 12 `Row(` lines (412-446) plus :498 and :529. The design says 13 rows.
- **Concurrent lane HEL-1480.** Its ticket (Linear) and its planning artifacts (`.claude/worktrees/task/pipelineservice-split-followups/HEL-1480/openspec/changes/pipelineservice-split-followups/design.md` D2) plan to edit **`PatchSetApplyResolvers.scala:178`**, the `PipelineService.scala:568-597` citation in `validateEmbeddedStepReferences`'s doc. This design moves that exact line, byte-identical against BASE 6d298d5f8, into `PatchSetPipelineStepResolvers.scala`. The design names HEL-1480 only as a spec-edit collision.

### Verdict: REFUTE

### Change Requests

1. **Plan for HEL-1480's edit to a line this change moves (`PatchSetApplyResolvers.scala:178`).**
   - **The overlap.** HEL-1480 (In Progress, concurrent) plans to rewrite the doc line at :178 inside `validateEmbeddedStepReferences`. This design moves that block, required byte-identical to `git show 6d298d5f8:...`, and C4 forbids any comment edit.
   - **If HEL-1480 merges first**, the rebase conflicts on that block. Resolving to "byte-identical to BASE" would silently revert HEL-1480's fix. Resolving to HEL-1480's text would fail D6a's forward check against the pinned BASE and look like a C4 violation.
   - **If this change merges first**, HEL-1480's one-line edit has no target and must be re-applied to the new file.
   - **Required.** Add a decision covering:
     - (a) the rebase protocol: re-pin `BASE` to the new merge-base after any rebase, and regenerate D6a/D6b/D6e evidence against it, so the moved block carries the base's current text and never reverts a merged change;
     - (b) that the D6a checker reads `BASE` from one variable, not a hard-coded 6d298d5f8;
     - (c) a note for the orchestrator/driver to tell HEL-1480 where line 178 lands (`PatchSetPipelineStepResolvers.scala`) if this change merges first.
   - Also add :178 to the tasks 3.7 follow-up list, or mark it as owned by HEL-1480.
2. **Correct the factual errors in the inventory text, since the design presents them as "verified at BASE".**
   - (a) "13 route rows" should be **12**: lines 412, 421, 423, 429, 431, 433, 435, 437, 440, 442, 444 and 446 of `ExistenceNotLeakedRoutesSpec.scala`.
   - (b) D1 calls the five Support members "shared helpers called from more than one destination". That is false for `authorizeEditorOnDashboard` (called only from the Panel resolvers) and `requireVisibleStep` (called only from the PipelineStep resolvers). State the real reasons:
     - `authorizeEditorOnDashboard` must stay in this file for the pins (:106 call, :108 producer).
     - `requireVisibleStep` is placed in Support by choice, next to the `authorizeEditorOrOwnerOnPipeline` it calls. Keep it there or move it to PipelineStep, but give the true reason.
   - (c) The "prose-only mentions of moved members" list is incomplete. It misses `PatchSetUndoService.scala:245-246` (`PatchSetApplyResolvers.buildPipelineStepDeletePriorState`, which moves to `PatchSetPipelineStepResolvers`). Add it to the Context list and to task 3.7. `PatchSetPreviewProjection.scala:173` ("`resolveAll`'s own `resolvePanelCreate`") stays semantically accurate and needs only a mention, if any.

### Non-blocking notes

- **D3 "Wildcard imports are not allowed"** is placed in the cross-object-call sentence. State explicitly that it does not apply to the file-level `import PatchSetApplyServiceJson._`, which each new file should keep verbatim (it supplies the implicit `JsonReader`s for `decodeCreatePatch[T]` and the `*ResponseFormat`/`outputResponseFrom` members). This removes a second reading under which an executor hand-enumerates implicits. As verified above, a miss would be a compile error, not a silent change, so this is not blocking.
- D6d: `PatchSetDataSourceResolvers` and `PatchSetResolverSupport.requireTargetId`'s message may have thin spec coverage. The design already routes gaps to follow-ups, which is fine.
- Moved bodies keep positional words that become false, e.g. :566-567 "this file's own doc, above". These are covered by D3's no-edit rule and the 3.7 follow-up list.
- No gate defects: no mtime-ordered evidence was relied on.
