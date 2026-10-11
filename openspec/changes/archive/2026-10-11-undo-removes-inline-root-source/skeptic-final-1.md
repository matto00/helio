## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `f0927874af1a9fc4e58e25701db4fa196929d2ab`. Diff base resolved live by `resolve-review-base.sh`: `02dc11abdc28577c8071a61d1e7295eacbdfee1c` (origin/main).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/undo-removes-inline-source/HEL-1493`.

### What I verified (with evidence)

**Option B is delivered safely. Backend: no defect found.**

- **Only apply-created sources are journaled.**
  - `InlineRootPairing.pair` (InlineRootPairing.scala:99-117) journals only roots with `type` set. That is the same predicate `PipelineCreateWrites.scala:184` uses to record which sources a create made.
  - The roots are paired by position, and only when the counts agree. `CountMismatch` journals `None`, so undo behaves as it does today.
  - `PatchSetApplyService.journaledInlineSources` (:205-219) does this only for `ResolvedAction.PipelineCreate`.
- **Deletion is double-guarded.**
  - `deleteIfUnreferenced` (InlineSourceCleanup.scala:367-402) reads through `findByIdOwned`, so it is owner-scoped. It then deletes through `DataSourceService.delete`, keeping the 409 reference guard.
  - It deletes the Connector only after `Right` from that delete, and only through `deleteIfAuto`. `deleteIfAuto` checks the exact `Auto: <name>` name and the dependents guard.
  - If the user renamed the source since the apply, the Connector name no longer matches, so the Connector is kept. That errs on the safe side.
- **The legacy path is unchanged.**
  - `restorePipelineCreateUndo` (PatchSetUndoService.scala:319-329) calls the same `restoreCreateUndo(pipelineService.delete)` as before.
  - For `inlineSources` `None` or empty, it returns that exact outcome unchanged. `EditUndoOutcome.inlineSources` defaults to `None`, and spray-json omits it.
  - The `Left` path passes through untouched. The edit status stays `restored` regardless of the per-source results.
- **Rollback is unchanged.** I read `PatchSetApplyRollback.deleteInlineRootSources` before and after. It has the same branch order, the same log strings and the same outcomes, and the pairing is a verbatim move.
- **Wire.** The new format is declared before the format that uses it. The schema adds `$defs.InlineSourceUndoOutcome` with `additionalProperties:false` and `minItems:1`. The frontend and helio-mcp types match.

**Red evidence proves the behaviour.**

- The evaluator's log `.concertino/runs/HEL-1493/evidence/eval1-red-on-base.log` shows 4 runtime-assertion failures on base. The failures are at the committed line numbers :23/:39/:52/:62, and the `[hel1468-guard]` count is `failed=4`.
- The assertions do exercise the fixed path:
  - the source count is 1 → 0;
  - `inlineSources` is `Vector()` versus `kept`;
  - the existing source in the mixed test is asserted to survive (`sourceCount(existing) shouldBe 1`);
  - the connectors count is 5 versus 4.
- The two guards are labelled as guards. One is the legacy row, a literal pre-change JSON passed through `journaledEditFormat.read`. The other is a create where every root names an existing source.
- My own fresh run at HEAD: `testOnly PatchSetUndoInlineSource* PipelineCreateInlineSourceCleanupSpec` gave `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` and `Tests: succeeded 25, failed 0`, exit 0. Log: `.concertino/runs/HEL-1493/evidence/skeptic1-targeted-specs.log`.
- The evaluator's full testFull log confirms that all 6 behavioural specs passed (lines 4805-4811) and shows `Tests: succeeded 6984, failed 0`.
- The jest tests for `fetchSources` cover both directions: a refetch on removed or alreadyGone, and no refetch on kept or absent.

**UI judgment: the kept-source toast copy.**

I judged the evaluator's durable screenshots: `.concertino/runs/HEL-1493/evidence/eval1-undo-kept-toast-dark.png` and `eval1-undo-kept-toast-light-390.png`. I did not re-start servers. The copy follows deterministically from `undoToast.ts:533-537` plus `DataSourceService.referenceConflict` (:702-709) and `SourceReferences.describe` (DataSourceReferenceRepository.scala:163-177), and the screenshots show exactly that string. The finding is about copy, not rendering, so a fresh capture would show the same text.

- **Structure is acceptable.** Each kept line starts on a new line. It uses the warning intent, a 12 s duration and a dismiss button, and the token-based `Toast` component.
- **Content is a defect.**
  - Each line embeds raw pipeline UUIDs, e.g. `'Holder of HEL1493 Sales inline' (430cda43-47ce-43f2-b334-7790d65a55cb; as root)`.
  - Each line also carries the delete-flow remediation `Remove each reference first (detach it in the pipeline editor).`
  - With two kept sources this is about 13 wrapped lines at desktop width. On 390 px the toast covers most of the viewport, and there is no bound on the number of lines.
- **This contradicts the established sibling pattern.** `frontend/src/features/sources/ui/SourceDeleteConflictNotice.tsx:35-40, 52-53` renders the same conflict. It says outright that the server `message`/`reason` "carries ids meant for API/MCP agents and is NOT shown". The UI composes its own copy from structured fields there. This toast is the first UI surface to show that agent-oriented string verbatim.
- **The remediation is wrong for this context.** The user did not ask to delete the source. Keeping it is the designed safe outcome of option B. Telling the user to "Remove each reference first" tells them to dismantle the pipeline they built since the apply. That is not the action undo implies.

### Verdict: REFUTE

### Change Requests

1. **Kept-source toast copy must not show the agent-oriented 409 reason.**
   - Location: `frontend/src/features/patchSets/ui/undoToast.ts:533-537`, and/or the `KeptReferenced` reason built in `backend/src/main/scala/com/helio/services/sources/InlineSourceCleanup.scala:381`.
   - Evidence: `eval1-undo-kept-toast-dark.png` and `eval1-undo-kept-toast-light-390.png`.
   - What to change: for a source kept because it is referenced, the toast line must:
     - contain no ids or UUIDs;
     - drop the delete-flow remediation ("Remove each reference first ...");
     - say briefly that it was kept because it is still in use, naming the visible referencers where that is practical. For example: `Kept data source "Sales": still used by pipeline "Holder of Sales".` Hidden referencers stay counts only, as `SourceReferences` already does.
   - Two acceptable implementations, and the executor picks one:
     - (a) The backend builds a UI-safe `reason` for `KeptReferenced` from the conflict's structured `pipelines`/`panels` names and hidden counts. Keep the HEL-1252 rule that hidden referencers are counts only.
     - (b) Add a structured discriminator so the frontend composes the copy, mirroring `SourceDeleteConflictNotice`. This needs a matching schema, protocol and type update.
   - Either way:
     - the `Failed` and no-helper lines keep their fixed sentences;
     - D5's "no hardcoded still-in-use wording for a failure" stays true, so a failure is never shown as "in use";
     - update `undoToast.test.ts`, and the backend spec asserting `reason`, to pin the new copy. Add an assertion that no UUID-shaped token appears in the kept line.
   - Re-verify in the running app in both themes plus 390 px, per C4, and record the screenshots.
2. **Fold in the cheap evaluator nits in the same round.**
   - Remove the unused `StaticDataSourceRequest` import at `backend/src/test/scala/com/helio/services/patchsets/PatchSetInlineSourceFixture.scala:6`. It is imported, with exactly one occurrence in the file.
   - At `PatchSetUndoInlineSourceWireSpec.scala:34`, either add an unknown-extra-property case or rename the test to match what it checks. Today the name claims "or an unknown field" but only the unknown `result` value is exercised.
   - In `red-evidence.md`, add one line mapping the stale `:169/:185/:198/:208` to the committed `:23/:39/:52/:62`. The cause is that the red run predates the fixture extraction.

### Non-blocking notes

- **Stale "Used by" column.** `/sources` still shows a stale "Used by" count after an undo, because `fetchSources()` does not refetch references. This is pre-existing: main did no refresh at all. It is acceptable to file it as a follow-up rather than fold it in. If folded in, it is a one-line dispatch next to `fetchSources()` in `patchSetsSlice.ts:216`.
- **Global `white-space: pre-line`.** On `.toast__message` this is a global change. It is fine: single-line messages are unaffected, and a `\n` in a server message is better broken than collapsed. No action is needed.
- **Connectors list.** It is not refreshed after undo. This is an accepted gap in design.md Risks.
- **Gate-defect check.** The evaluator states that its screenshots were saved directly into the durable evidence directory and that no claim rests on mtimes. My judgment also rests on image content and code, not ordering. No gate defect to record.
