## Evaluation Report — Cycle 5 (evaluation-5.md) — FINAL EVALUATION CYCLE

Reviewed at HEAD `ea3da445`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`, tree clean.
All gates, the live CR11 repro, and the red-then-green verification below were re-run by me
first-hand at this commit. Dev-server currency verified **before** any UI evidence:
`curl :9247/health` → `{"status":"ok"}`; `curl :6340` → `200`; `readlink /proc/<vite>/cwd` →
`.../HEL-908/frontend` (the Vite process is serving this exact worktree, so HMR reflects HEAD).

---

## 1. CR11 — VERIFIED RESOLVED (fresh first-hand live evidence, my own repro)

Driven through the real UI at `localhost:6340`, on a **new** pipeline built by me
(`8d7cb0b2-41df-499f-87d5-f6aa9de413a3`), not via the e2e fixture and not by reading the diff.

Built the exact CR11 shape: trunk `Filter` → `Sort`, with `Filter` **also** owning a
`Group & aggregate` tail — so the delete hits both server-side mutations of `deleteInternal` at
once (head child reparented, other child's subtree cascade-deleted). Pre-delete state confirmed
matching server truth:

```
DOM (pre-delete)                     server GET .../steps
trunk[Filter rows, Sort rows]        filter    648b60c9  pos 0  parent null
tail [Group & aggregate]             aggregate f34f6d54  pos 1  parent 648b60c9
                                     sort      bb24c885  pos 0  parent 648b60c9
```

Then `Remove step` on `Filter`. DOM and server read **at the same instant, with NO reload**:

```
DOM (live, no reload)                server GET .../steps
trunk[Sort rows]                     sort  bb24c885  pos 0  parent null
tails[]                              (ONE step total)
"Group & aggregate" text anywhere in document: false
```

- The cascade-deleted tail is **entirely gone from the DOM** — not rendered as a phantom
  top-level trunk card. The exact defect I reproduced in Cycle 4 is eliminated.
- The head child (`Sort`) is **reparented exactly as the backend did it** (`parent: null`,
  `pos 0`), byte-for-byte matching persisted truth.

**Point 2 — client-state-only bug, confirmed live.** The server read taken at the same instant
shows exactly one row. Persisted data was correct both before and after the fix; the defect was
never a data bug, only a stale-local-state render. Consistent with the CR9/CR10 diagnosis.

**No new console errors.** Full live session (page load, tail attach, expand, delete, several API
reads) produced **3** console errors — the same pre-existing 3 as Cycles 2/3/4 (2× `/api/types`
404 from `SidebarBody`, 1× `/schedule` 404 = the handled no-schedule case). Zero
selector-instability warnings (F-146 intact).

**Breakpoints.** The diff is hook-logic-only with no layout surface, but re-checked anyway at
768 and 360: no horizontal overflow (`scrollWidth === clientWidth` at both), no layout breakage.

---

## 2. Scope boundary — honored exactly (Point 3)

`git diff 807673b9..ea3da445 --stat` → 6 files; the only production-code file is
`usePipelineDetailPage.ts`, carrying **one hunk**, entirely inside `handleRemoveStep`
(lines 719-750) plus its dep array.

- `handleReorderSteps` — **byte-unchanged**. Still reconciles by id against
  `reorderTrunkInternal`'s full-row-set response.
- The aggregate-tail rollback delete (`usePipelineDetailPage.ts:596`) — **byte-unchanged**,
  still a bare local filter, correctly so (its target is a just-created childless leaf).
- **No backend file touched** in the entire branch since `03ceb034` (Cycle-3 `sbt test` run):
  `git diff 03ceb034..HEAD --name-only | grep '^backend/'` → empty. `sbt test` correctly N/A.

The fix itself reuses the existing `syncStepsFromServer` `useCallback` (no reinvention), keeps the
optimistic filter and the revert-on-error path intact, correctly extends the dep array, and
carries a comment stating the root cause. Consistent with the CR9/CR10 pattern. No `any`, no dead
code, no lint/format/type violations.

---

## 3. e2e case genuinely asserts PRE-reload state, and I verified red-then-green myself (Point 4)

The new case's discriminating assertions (`hel908-tail-attach.spec.ts:361-368`) all run **before**
any `page.reload()`; the reload is appended afterwards purely as a persisted-truth cross-check.

I did not take the executor's red-then-green claim on trust — I reproduced it:

```
git checkout ea3da445~1 -- frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts
DEV_PORT=6340 npx playwright test e2e/hel908-tail-attach.spec.ts -g "cascade-deleted"
  → 1 failed
    > 361 |     await expect(stepCards).toHaveCount(1);
    Expected: 1   Received: 2   (9 × locator resolved to 2 elements)
```

Fails at the **pre-reload** assertion, for exactly the right reason: 2 top-level trunk cards
instead of 1 — the phantom promoted tail. Restored the fix (`git status` clean) and it passes.
The claim is credible because I reproduced it, not because it was reported.

---

## 4. Critical evaluation of the new design.md enumeration-method documentation (Point 5)

Read as if I were the next engineer adding a step-mutating handler.

**The axis is correct.** Section "The correct axis" states it precisely: grep every step-mutating
call site → **read the actual backend service/repository body** for each → ask *"can this backend
path mutate, reparent, or delete steps OTHER than the one explicitly targeted?"* → cross-reference
against whether the handler fully resyncs or only patches local state for the one step it thinks
it acted on. It also explicitly names and repudiates the wrong axis ("does this handler's call
create a step?") and explains *why* that axis produced an incomplete list twice. Step 4 correctly
recognises the second safe reconciliation mechanism (a full-row-set response, as
`handleReorderSteps` uses) rather than mandating `syncStepsFromServer()` as the only cure — which
would have been an over-narrow rule. It closes with the right framing: *"A future handler must be
checked against the four-step method above, not against this table — the table is only ever
complete as of the review cycle that produced it."*

**Would this axis have caught CR9/CR10/CR11 from the start? Yes.** Applying step 3 to
`spliceInsertAtInternal` (reparents anchor's children) yields CR9 and CR10; applying it to
`deleteInternal` (reparents head child, cascade-deletes tails) yields CR11 — with no reliance on
whether the call happens to be a create, a duplicate, or a delete. That is exactly the property
the old axis lacked.

**Dispositions are honest and complete-as-scoped.** Eight handlers listed, each with a *reason*
rather than a bare verdict — including the three genuinely-safe ones with their specific reasons
(`handleAddTailStep` = genuine new sibling; the rollback delete = childless leaf;
`handleReorderSteps` = full-row-set response). It does not overclaim: CR11 is marked
"Was local-filter-only / Fixed this cycle", not retroactively laundered.

**One concrete flaw, which I found by applying the method myself (see §5): the step-1 grep pattern
is incomplete.** The documented pattern is
`createPipelineStep(|deletePipelineStep(|duplicatePipelineStep(|reorderPipelineSteps(|updatePipelineStepEnabled(|createOutput(`
— it **omits `updatePipelineStep(`** (the config PATCH). Note `updatePipelineStepEnabled(` does
*not* match `updatePipelineStep(` because of the literal `(`. This matters because
`PipelineStepRepository.updateInternal` → `positionScopedUpdateAction` **does renumber every
sibling** when `position` is `Some(...)` — i.e. the PATCH route *can* mutate other steps. It is
safe today only because the frontend never sends `position` on that call (verified,
`pipelineService.ts:110-118` sends `{config}` only; `updatePipelineStepEnabled` sends `{enabled}`
only). So the very step that generates the candidate set would, as written, skip the one remaining
call site with a latent hazard. Steps 2-4 are correct and would clear it once reached; only the
mechanical grep in step 1 is short. **Recommended (non-blocking) fix:** add `updatePipelineStep(`
to the pattern, and add a row to the table for `useStepCardState.ts`'s `persist()` with the
disposition *"Safe only because the client never sends `position`; if a future edit adds
`position` to this PATCH, `positionScopedUpdateAction` renumbers every sibling and this handler
must resync."* That conditional is the exact trap the document exists to prevent, and it is
currently undocumented.

---

## 5. My own independent, fresh enumeration (Point 6) — no further handler found

I did not trust the list. I re-derived the candidate set from the service layer rather than from
the documented pattern: enumerated **every exported function** in
`frontend/src/features/pipelines/services/{pipelineService,outputService,pipelineProposalService}.ts`,
selected every one that can mutate step rows, and grepped all call sites repo-wide.

Inside `usePipelineDetailPage.ts` the call sites are exactly:
`:460` insert, `:523` addTail, `:564` + `:596` aggregate-tail + rollback, `:652` instantiateShape,
`:722` remove, `:786` reorder, `:816` toggle, `:838` duplicate — **exactly the eight in the table,
none missing, none extra.**

Beyond that file, four call sites the table does not list, each checked against the backend body:

| Call site | Backend path read | Can mutate other steps? | Verdict |
|---|---|---|---|
| `useStepCardState.ts:211` `updatePipelineStep(step.id, newConfig)` | `PipelineStepRepository.updateInternal` → `positionScopedUpdateAction` | **Only if `position` is sent** — it renumbers the whole sibling group. Client sends `{config}` only | **Safe today; latent, undocumented (see §4)** |
| `OutputEditorSheet.tsx:308` `deleteOutput` | `OutputService.delete` → `panelRepo.deleteByOutputIdInternal` + `outputRepo.deleteInternal` | No — touches `panels`/`outputs` only, never `pipeline_steps` | Safe |
| `ShapeInstantiateStep.tsx:232` `createPipelineStep` | create | Panel-creation flow on another page, building a fresh pipeline; no pre-existing step tree to invalidate | Out of scope (as evaluation-4.md also noted) |
| `PipelineProposalReviewPage.tsx:83` `applyPipelineProposal` | apply-proposal | Separate page, navigates away/refetches; no in-place step-tree local state to go stale | Out of scope |

**Conclusion: there is no CR12.** The step-mutating handler set on this page is closed, and the
one out-of-file handler with any exposure (`useStepCardState`'s config PATCH) is *correct as
written* — its only gap is documentary.

---

## 6. Gate re-run (my own, fresh, at `ea3da445`)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, `--max-warnings=0`) |
| `npm run format:check` | PASS — "All matched files use Prettier code style!" |
| `npm run typecheck` | PASS (exit 0) — `tsc --noEmit`, frontend tsconfig (the authoritative gate per HEL-797 scoping) |
| `npm test` | PASS — 282 suites, 3009 tests |
| `npm --prefix frontend run build` | PASS |
| `cd backend && sbt test` | **Correctly N/A** — zero backend files changed since `03ceb034`, verified by `git diff 03ceb034..HEAD --name-only` |

**e2e (Point 8).** `DEV_PORT=6340 BACKEND_PORT=9247 npx playwright test e2e/hel908-*.spec.ts` →
**8 passed** across all five `hel908-*` specs (full-flow, step-card-split, tail-attach ×4,
reorder-drag, reorder-order). Re-ran the 5 previously-identified failures: **still the same 5, by
name** (`hel399-shape-instantiate`, `hel665-message-composer`, both `hel666-single-assistant-entry`
cases, `hel716-panel-detail-tall-viewport-footer`), failing on 30s `page.waitForResponse`
timeouts against real backend/Claude responses and unrelated visibility assertions. Confirmed
unrelated on evidence, not assertion:
`grep -l "Remove step\|deletePipelineStep"` over all four spec files → **empty**; none of them can
reach the single hunk this commit changed.

---

## 7. Holistic pass — CR1–CR10 and every named invariant

`git log 807673b9..HEAD --oneline` → exactly **one** commit. `git diff 807673b9..HEAD --name-only`
→ 2 code/test files + 4 artifact files. **No CR1–CR10 surface is touched**; all remain resolved,
and every one was verified green in the gate/e2e runs above.

- **F-105** (single `/analyze` on load) — intact. The new resync fires only on a user-initiated
  delete, never on mount; `hel908-step-card-split.spec.ts` (which asserts analyze-fires-once)
  green in my run.
- **F-146** (stable selector references / no console noise) — intact. 3 console errors in my full
  live session, the same documented pre-existing 3; zero selector-instability warnings.
  `syncStepsFromServer` remains a stable `useCallback`.
- **HEL-629** — `OutputPreviewPane.tsx` not in the diff. Untouched.
- **HEL-681** — keyed/reconciled fetches unchanged; not in the diff.
- **HEL-878 / rail-thumbnail staleness** — `resetRunScopedState` wiring untouched;
  `hel908-full-flow.spec.ts` (live post-Save thumbnail) green in my run.
- **Backend non-goal-waiver primitives** — zero backend files changed since Cycle 2;
  `attachTailInternal` / `reorderTrunkInternal` / `deleteInternal` byte-identical to what I read
  and verified in Cycles 2-4.

### tasks.md final pass

Three unchecked boxes, all correctly and precisely explained rather than silently dropped:

- **2.5** (`dataTypesSlice` removal) — blocked on 5.1-5.4; the note names the exact remaining call
  sites (`CollectionEditor`/`MarkdownEditor`/`TimelineEditor`/`TextContentEditor`/`BindingEditor`)
  and why removing them ahead of the sheet would strip UI or duplicate logic. Genuine, specific,
  correctly deferred (HEL-937 / PanelDetailModal surface).
- **5.9** (delete unused editor files) — blocked for the same reason, with a per-file enumeration
  of what is still live and why (their own test suites still exercise them; no caller was removed
  because only a NEW parallel Output-editing surface was added).
- **1.1** (dev-server currency) — a process checkbox whose note is stale ("neither server is
  running") but harmless: the servers *were* running for this cycle, I verified their currency
  myself before taking any UI evidence, and the evidence is recorded here. Cosmetic only.

6.4 / HEL-676-not-reproducible / 4.3-out-of-scope-per-ticket.md are all checked with their stated
justifications, unchanged since Cycle 4's pass.

### Documentary gap found this cycle (non-blocking)

`execution-progress.md` received **no Cycle-5 entry** for the CR11 fix. Its final paragraph is
still Cycle 4's, which asserts *"All five step-mutating handlers are now accounted for... No CR11
regression found."* — a statement the shipped commit disproves. This reads as a point-in-time
cycle log (it is explicitly prefixed "HEL-908 Cycle 4:"), and the corrected record **does** exist
in three other artifacts (`tasks.md` 3.11, `design.md`'s new section, `files-modified.md`'s
Cycle-5 entry), all of which state plainly that the five-handler audit was on the wrong axis and
missed a sixth. So the record is corrected, just not in this one file. Not blocking; a one-
paragraph Cycle-5 entry would close it.

---

### Phase 1: Spec Review — PASS

No spec/schema surface changed. `tasks.md` gains 3.11 with an accurate root-cause statement;
`design.md` gains the enumeration-method postmortem the human requested; `files-modified.md`
gains an accurate Cycle-5 entry. Planning artifacts reflect implemented behavior. No scope creep:
the one code hunk is precisely the change CR11 asked for.

### Phase 2: Code Review — PASS

Minimal, pattern-consistent fix reusing an existing helper; optimistic filter and revert-on-error
preserved; dep array correct; comment states root cause. DRY, typed, no dead code, no
over-engineering. All five gates green on my own fresh run. Scope boundary respected exactly
(`handleReorderSteps` and the rollback delete byte-unchanged). Behavior change is exactly the
intended one and is covered by a test I independently confirmed red-then-green.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`). Driven live at `localhost:6340` / `:9247` on servers I verified
current first.

- CR11's exact scenario now renders correctly with no reload, verified against live API truth at
  the same instant.
- Persisted data confirmed correct — client-state-only bug, now fixed.
- No new console errors (3 pre-existing, documented).
- All 8 `hel908-*` e2e cases green; the 5 unrelated failures confirmed unrelated on evidence.
- No layout breakage at 768 / 360.

---

### Overall: PASS

**HEL-908 IS READY FOR THE FINAL SKEPTIC GATE (dimension-split, parallel opus skeptics on
independent axes) AND DELIVERY.**

This unblocks HEL-909 / HEL-910 and the v0.7.8 tag. Stating the basis plainly, since I have
FAILed this ticket three cycles running on completeness grounds:

- CR11 is fixed, and I verified it by **building the scenario myself in the live UI** and by
  **independently reproducing the red-then-green**, not by reading the diff or trusting the
  handoff.
- The defect class is now **closed, not merely enumerated**. I re-derived the candidate set from
  the service layer from scratch, checked four call sites the table does not list against their
  actual backend bodies, and found **no further exposed handler**. There is no CR12.
- All five gates pass on my own fresh run; all 8 `hel908-*` e2e cases pass; CR1-CR10 and every
  named invariant (F-105, F-146, HEL-629, HEL-681, HEL-878) are intact and untouched.

The two items below are documentation polish only. Neither is a code defect, neither affects
runtime behavior, and neither is a reason to hold delivery — but both are worth handing to the
skeptic, since the first is a latent trap in exactly the class this ticket spent three cycles
closing.

### Change Requests

None. (PASS.)

### Non-blocking Suggestions

1. **design.md step-1 grep pattern omits `updatePipelineStep(`** — the config-PATCH call site
   (`useStepCardState.ts:211`), whose backend path (`positionScopedUpdateAction`) *does* renumber
   every sibling when `position` is sent. Safe today only because the client sends `{config}`
   only. Add the token to the pattern and add a table row recording that conditional. This is the
   one place a future edit could silently reintroduce the CR9/CR10/CR11 class, and it is currently
   undocumented. **Recommended before merge**; see §4 for exact wording.
2. **`execution-progress.md` has no Cycle-5 entry**, leaving Cycle 4's "no CR11 found" as the
   file's last word. One paragraph closes it; the truth is already recorded in `tasks.md` 3.11,
   `design.md`, and `files-modified.md`. See §7.
3. `handleRemoveStep`'s single `.catch` now covers both `deletePipelineStep` and
   `syncStepsFromServer`, so a resync-only failure reverts to `previousSteps` (restoring the
   already-deleted step) and toasts "Failed to delete step". Reload-corrected, error-visible, and
   the *same* conflation already carried as non-blocking for `handleInsertStep` — consistent, not
   new.
4. Carried and still open, still non-blocking: `handleAddOutputViaAggregateTail` awaits its resync
   outside the inner `try`; task 8.3's stale `dataTypes` clause; `EMPTY_OUTPUTS as Output[]`;
   the unfiled file-split follow-up for `usePipelineDetailPage.ts` (now ~970 lines) /
   `OutputEditorSheet.tsx` (569); `HEL-937` should name `MetricEditorForm.tsx`;
   `handleRemoveStep` still discards `DeletePipelineStepResponse.removedTailStepCount`, which the
   backend computes specifically so a caller can tell the user how many steps a delete took with
   it — surfacing it would turn a silent destructive cascade into a visible one.
