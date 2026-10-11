## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `0ac44e1a36b937faa417f8de239ff7b1e9466702`. The diff base was resolved live by `resolve-review-base.sh` (main/origin) as `64e374bb7519262655370bc8c0e210dba930f251`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/undo-removes-inline-source/HEL-1493`.

### What I verified (with evidence)

**AC1: the owner decision is recorded through the escalation mechanism.**
- `.concertino/runs/HEL-1493/events.jsonl` contains `escalation.raised`, then `escalation.answered` with `answer_source:"human"` and the sub-answers `B`, `keep-source-legacy` and `wire-field-and-toast`.
- `workflow-state.md` `OWNER_DECISIONS` matches it, and so does proposal.md:7.

**AC2: option B is implemented, red-first.**
- My round-1 backend review still holds. The only main-code change to the backend since then is `InlineSourceCleanup.inUseReason`, which is used solely for the `KeptReferenced` reason.
- The merge of origin/main (f67177ffd) does not overlap the HEL-1493 files.
- C5 holds: `PatchSetApplyService.scala:162-164` warns and leaves out unpaired roots.
- C3 holds: only roots with `type` set are journaled, and a legacy row keeps the source.

**AC3 (prod orphan cleanup) is out of scope.** There is no migration and no cleanup job in the diff.

**Round-1 CR1 (C6 toast copy) is resolved.**
- `InlineSourceCleanup.inUseReason` builds the reason from the structured conflict fields only:
  - it names visible pipelines and form panels;
  - it caps the named list at 3 and adds "N more";
  - it shows hidden referencers as a count only;
  - it carries no id and no "Remove each reference first" advice.
- The failure reasons are still fixed sentences (`PatchSetUndoInlineSources.ReasonFailed` / `ReasonUnavailable`), so a failure is never worded as "in use".
- The integration spec pins the exact wire string through the real undo path on embedded Postgres: `PatchSetUndoInlineSourceSpec` asserts `still used by pipeline "Holder of inline source".`, no "Remove each reference", and no UUID-shaped token.

**Round-1 CR2 nits are resolved.**
- The unused import is removed.
- The wire spec has a separate extra-property case, labelled as a guard.
- `red-evidence.md` has the line mapping.
- The "Used by" refresh I noted as non-blocking in round 1 is folded in: `fetchSourceReferences()` is dispatched whenever an outcome lists any inline source. Jest covers it in both directions, including 0 dispatches when there are no inline sources.

**Fresh gate runs (mine):**
- **Run 1.** `sbt testOnly` on PatchSetUndoInlineSource{,Cleanup,Wire}Spec, all 3 of which ran (a fourth class I named matched nothing). Result: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 27, failed 0`, exit 0. Log: `.concertino/runs/HEL-1493/evidence/skeptic2-targeted-specs.log`.
- **Run 2.** `sbt testOnly` on `pipelines.PipelineCreateInlineSourceCleanupSpec`, `patchsets.PatchSetUndo*` and `*PatchSetApply*`. That is 13 suites, including the rollback-adjacent `PatchSetApplyServiceSpec` and every existing undo spec. Result: `failed=0 aborted=0 unreadable=0`, `Tests: succeeded 120, failed 0`, exit 0. Log: `.concertino/runs/HEL-1493/evidence/skeptic2-targeted-specs-2.log`.
- **Frontend:**
  - jest `src/features/patchSets`: 6 suites, 64 tests passed;
  - `tsc --noEmit`: exit 0;
  - eslint `--max-warnings 0` on `src/features/patchSets` and `src/shared/ui`: exit 0.
- **Not re-run by me:** full testFull and full jest. For those I rely on the evaluator's pasted cycle-2 run at f67177ffd (7135 succeeded, guard failed=0; jest 5887). The only change since then is a ScalaTest name string, which my targeted run executed.

**UI judgment (C4/C6), from screenshots.**
- I looked at `.concertino/runs/HEL-1493/evidence/exec2-undo-kept-toast-dark.png`, `-light.png` and `-light-390.png`.
- I did not start servers. The rendering code (`undoToast.ts`, `toast.css`, `PatchSetReviewPage.tsx`) is unchanged since the evaluator's live round-1 verification. The only changed input is the backend string, which the integration spec above pins exactly. A fresh capture would therefore show the same text.
- **Findings:**
  - Each kept source starts its own line.
  - It uses the warning intent, with the tokenised border and icon.
  - It has no ids and no delete advice.
  - It reads clearly in both themes.
  - At 390 px it is now 7 lines for two sources, against about 13 before. It sits above the mobile nav without covering the page.
  - It matches the sibling `SourceDeleteConflictNotice` principle: the UI-safe copy is composed from structured fields, and the agent-oriented `reason` is not shown.
- **On "N you cannot access":** it is grammatical but terse. It matches existing product copy verbatim: `frontend/src/features/sources/utils/sourceReferences.ts:56` uses `${hidden} you cannot access` on the Sources "Used by" surface. So it is consistent, not off-pattern, and not a REFUTE.

**Gate-defect check.** No claim here rests on mtime ordering. My judgment rests on image content, code, and fresh test output.

### Verdict: CONFIRM

### Non-blocking notes
- **Copy polish (optional follow-up):**
  - "1 you cannot access" could become "1 other you cannot access". Alternatively, split the count by kind as `SourceDeleteConflictNotice.plural` does ("a pipeline you cannot access").
  - Doing that would also mean updating `sourceReferences.ts:56` for consistency, so it is better as its own small ticket than folded in here.
- **Stale fixture text:** two older cases in `undoToast.test.ts` still use agent-style reasons ("Referenced by pipeline P (p-1).", "Remove each reference first.") as pass-through fixtures. They are harmless, because the toast prints whatever reason it is given, but they model wording the backend no longer sends. Consider swapping them for an `inUseReason`-shaped string next time this file is touched.
- **Separation between kept sources:** with two or more kept sources whose names wrap, the only boundary between entries is a line start. That is acceptable at today's volume, since one undo usually involves one or two inline roots.
