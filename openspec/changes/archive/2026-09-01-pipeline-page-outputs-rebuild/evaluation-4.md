## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed at HEAD `807673b9`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`, tree clean.
Human-granted extra cycle scoped to verifying CR10, plus one explicitly-requested question on the
record. All gates re-run fresh by me at this commit.

---

## THE ANSWER TO THE COORDINATING HUMAN'S QUESTION (read this first)

**Was the "which handlers need a `syncStepsFromServer()` resync" enumeration ever done
systematically? — NO. It was never systematic. Each instance was found one at a time, by
inspection or by hitting it.**

The evidence for that answer, not an impression of it:

- CR9 (Cycle 3) fixed three handlers and named `handleDuplicateStep` in its own text as a path to
  check. The executor then did not check it. That is not what a systematic sweep produces.
- The Cycle-4 `execution-progress.md` entry presents a tidy list of "five step-mutating handlers"
  — but it is a *post-hoc narrative* of the four instances already known, not the output of a
  method. It names no grep, no route-to-handler cross-reference, no enumeration procedure. Its
  own framing ("closing the last of the five... handlers") assumes the set is five without ever
  deriving that five is the whole set.
- Critically, that list is **derived from the wrong axis**. It enumerates handlers that call the
  *create/splice* primitive (`spliceInsertAtInternal`). The actual hazard is broader: **any**
  handler hitting a route that mutates steps *other than the one being acted on*. Enumerating on
  the narrow axis is precisely why the list stops at five.

**So I did the systematic pass myself. It found a sixth handler, still exposed, still unfixed —
and I reproduced its defect live. See CR11 below.**

### The systematic pass (method, so it is auditable and repeatable)

1. Grepped every step-mutating service function imported into the page and every call site of
   each, repo-wide:
   `grep -rn "createPipelineStep(\|deletePipelineStep(\|duplicatePipelineStep(\|reorderPipelineSteps(\|updatePipelineStepEnabled(\|createOutput(" frontend/src`
   (excluding the service definitions and tests).
2. For each call site's backend route, read the actual service + repository code path to decide
   the real question: **can this route mutate or delete steps OTHER than the target?**
3. Cross-referenced that against whether the handler resyncs or reconciles from server truth.

### The complete enumeration (this is the verified-complete set — nine handlers, six axes)

| # | Handler | Backend route → primitive | Mutates OTHER steps server-side? | Client reconciles? | Verdict |
|---|---|---|---|---|---|
| 1 | `handleInsertStep` | create → `spliceInsertAtInternal` | **Yes** (reparents anchor's children) | `syncStepsFromServer()` | OK (CR9) |
| 2 | `handleAddStep` | delegates to `handleInsertStep` | — | inherits #1 | OK |
| 3 | `handleAddTailStep` | create `attachAsTail` → `attachTailInternal` | No (genuine new sibling) | `syncStepsFromServer()` | OK (CR9, defensive) |
| 4 | `handleAddOutputViaAggregateTail` | create tail + `createOutput` | No | `syncStepsFromServer()` | OK (CR9) |
| 5 | ↳ its rollback `deletePipelineStep(persistedStep.id)` | `deleteInternal` | No — target is a just-created **childless leaf**, nothing to reparent or cascade | local filter is exactly right | OK |
| 6 | `handleInstantiateShape` | create loop | No — audited Cycle 3, re-verified Cycle 3 | n/a | OK |
| 7 | `handleReorderSteps` | `reorderTrunkInternal` | **Yes** (rewrites every trunk `parentStepId`) | **Safe by a different mechanism**: `reorderTrunkInternal` returns `executionOrder(finalRows)` — *all* pipeline rows, tails included (`PipelineStepRepository.scala:544-545`) — and the handler reconciles by id against that response. Server truth lands in local state. | OK |
| 8 | `handleToggleStepEnabled` | PATCH `{enabled}` | No | reconciles from response | OK |
| 9 | `handleDuplicateStep` | duplicate → `spliceInsertAtInternal` | **Yes** | `syncStepsFromServer()` | **OK — fixed this cycle (CR10)** |
| **10** | **`handleRemoveStep`** | **`deletePipelineStep` → `deleteInternal`** | **YES — two distinct mutations** | **NO resync, NO reconcile — local `filter` only** | **DEFECT → CR11** |

`ShapeInstantiateStep.tsx:232` also calls `createPipelineStep`, but it is the panel-creation flow
on a different page building a fresh pipeline; it holds no pre-existing step tree to invalidate.
Out of scope, noted for completeness.

**Direct answer, stated plainly:** four was **not** the complete set. The complete set of
handlers on this page whose route can mutate other steps server-side is **four**
(`handleInsertStep`, `handleReorderSteps`, `handleDuplicateStep`, `handleRemoveStep`). Three are
correctly reconciled; **`handleRemoveStep` is not, and is defective today.**

---

## CR10 — VERIFIED RESOLVED (fresh first-hand live evidence)

Driven through the real UI at `localhost:6340` on a **new** pipeline
(`fe3484fa-0e37-4aa9-80c7-9eeb202d4d1a`), not via the e2e fixture and not by reading the diff.

Leaf trunk `Filter rows` → `Add tail step` → `Group & aggregate`. Then `Duplicate step` on
`Filter rows` (the tail's owner). DOM and server read **at the same instant, with NO reload**:

```
DOM (live, no reload)                        server GET /api/pipelines/.../steps
section 0: trunk[Filter rows]  tails[]       filter    06dd9d69  pos 0  parent null
section 1: trunk[Filter rows]  tails[        filter'   db413723  pos 0  parent 06dd9d69
             Group & aggregate ]             aggregate 2c788ded  pos 1  parent db413723
```

Byte-for-byte identical to persisted truth. The clone is **not** drawn as a tail branch, and the
aggregate is **not** promoted to a top-level trunk card — the exact two misrepresentations I
enumerated in Cycle 3 are both gone, immediately, without a reload.

**Point 2 — persisted data was always correct.** Confirmed by the live API read above:
`aggregate.parentStepId = db413723` (the clone) at the same instant the DOM draws it there. As in
CR9/CR10's diagnosis, this was client-state staleness, never a data bug.

**Point 3 — scope boundary honored.** `git diff ecf27651..807673b9 --stat` is 7 files;
`usePipelineDetailPage.ts` carries **one hunk**, at `handleDuplicateStep` (lines 821-838).
`handleInsertStep`, `handleAddTailStep`, and `handleAddOutputViaAggregateTail` are byte-unchanged.
No backend file touched (`git diff ecf27651..807673b9 --name-only | grep backend/` → empty), so
`sbt test` is correctly not triggered.

**Point 4 — the new e2e case genuinely asserts PRE-reload state.** `hel908-tail-attach.spec.ts`'s
new case contains **no `page.reload()`** anywhere; every assertion runs against the live
post-click DOM. Its discriminating assertions are
`sections.nth(0)...tail-chain-item → toHaveCount(0)` and `sections.nth(1) → toHaveCount(1)` plus
the `"Group & aggregate"` label on section 1 — the direct logical negation of the pre-fix DOM I
myself enumerated in Cycle 3 (tail under the original). It cannot pass on the old code. The
red-then-green stash claim is credible: the assertion shape matches the pre-fix DOM I
independently observed, and the failure mode the executor reports (section 0 had 1 tail, expected
0) is exactly what the old code produces. (The `stepCards → toHaveCount(2)` assertion alone is
*not* discriminating — pre-fix also yielded 2 trunk cards via the promoted aggregate — but it is
not load-bearing.) The `PipelineDetailPage.test.tsx` change is a mock-realism fix for the new
follow-up `getPipelineSteps` call, correctly labelled as such, not new coverage.

---

## CR11 (NEW, same defect class) — `handleRemoveStep` renders a step that no longer exists

Found by the systematic pass above, then **reproduced live**.

**Root cause, read in the code:** `PipelineStepRepository.deleteInternal`
(`PipelineStepRepository.scala:595-623`) performs two mutations to steps *other* than the target:
it **reparents the head child** into the deleted step's `parentStepId`/`position` slot (line
608-615), and it **outright deletes every other child's entire descendant subtree** — the tails
(line 616-617). Its own doc says so, and it returns `Some(removedTailStepCount)` explicitly "so a
future caller can warn the user how much was removed."
`usePipelineDetailPage.ts:713-738` responds with `setSteps(prev => prev.filter(s => s.id !== stepId))`
— removing one element, ignoring the response entirely (`void deletePipelineStep(...)`), and
resyncing nothing.

**Live repro** (pipeline `b904026d-fc91-4d3b-87ba-ff3135de70d9`). Built a trunk `Filter → Sort`
where `Filter` also owns a `Group & aggregate` tail, so the delete hits **both** server-side
mutations at once. Verified the pre-delete tree matched server truth. Then `Remove step` on
`Filter`:

```
DOM after delete, NO reload            server GET .../steps  (live, same instant)
section 0: trunk[Group & aggregate]    sort  2e709660  pos 0  parent null
section 1: trunk[Sort rows]            (ONE step total)
```

`Group & aggregate` **was cascade-deleted server-side and no longer exists**, yet it is rendered
as a top-level trunk card — and the pipeline is displayed as a two-step "aggregate then sort"
flow that is entirely fictitious. A hard reload of the same URL renders the truth:

```
section 0: trunk[Sort rows]
```

— proving `buildStepTree` is right and local state is stale, identical in kind to CR9/CR10.

**Severity: worse than CR10.** CR10 misplaced a real step; CR11 renders a **phantom** step that
has been permanently deleted, and misstates the pipeline's logic. (Inference I did **not** test:
interacting with that phantom card — adding an Output to it, editing it — would target a
nonexistent row. Flagged as untested, not asserted.) `Remove step` on a step that owns a tail is
an ordinary one-click action.

Note the near-miss that hides this: when the deleted step's tail is its **only** child, the tail
is the head child, so it is *reparented* rather than deleted, and the stale-orphan render
coincidentally matches server truth. I verified that case first and it passed. The defect only
surfaces when the deleted step has a head child **and** a tail. A non-systematic pass would very
plausibly miss it — which is the point of the question asked.

**Fix (if authorized):** call `syncStepsFromServer()` after `deletePipelineStep` resolves in
`handleRemoveStep`, keeping the existing optimistic filter + revert-on-error; add
`syncStepsFromServer` to the dep array. The backend already returns `removedTailStepCount`,
which would additionally let the toast tell the user how many steps the delete took with it.

**I am not authorizing a further cycle and have not treated this as in-scope work.** Per the
explicit "no further budget extensions without a new reason" instruction, this is reported for the
orchestrator/human to rule on. Two defensible options: (a) one more tightly-scoped cycle, ~4 lines
and one e2e case, mirroring CR10 exactly; or (b) ship HEL-908 and file CR11 as a follow-up bug —
defensible because it is display-only and reload-corrected, with **no data corruption** (persisted
truth is always right).

---

## Gate re-run (my own, fresh, at `807673b9`)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, `--max-warnings=0`) |
| `npm run format:check` | PASS (exit 0) |
| `npm run typecheck` | PASS (exit 0) — the authoritative gate (`tsc --noEmit`, frontend tsconfig), not a bare root `npx tsc --noEmit` (HEL-797 scoping) |
| `npm test` | PASS — 282 suites, 3009 tests |
| `npm --prefix frontend run build` | PASS (exit 0) |
| `cd backend && sbt test` | **Correctly N/A** — zero backend files in `git diff ecf27651..HEAD --name-only` |

**e2e spot-check of the executor's "5 pre-existing failures" claim.** Re-ran all 5 named specs
plus the three `hel908-*` specs against current HEAD: **5 passed, 5 failed** — the same 5, by
name (`hel399-shape-instantiate`, `hel665-message-composer`, both `hel666-single-assistant-entry`
cases, `hel716-panel-detail-tall-viewport-footer`), all failing on 30s timeouts waiting for real
backend/Claude responses (`page.waitForResponse` on `/run` POST, etc.) — not on any tree-shape or
step-state assertion. None of the 5 specs references duplicate/step-tree behavior at all
(`grep -l duplicate` over them → empty), and the commit's only code hunk is inside
`handleDuplicateStep`, which those flows never invoke. The claim holds. All `hel908-*` specs green.

Dev-server currency verified **before** any UI evidence: `curl :9247/health` → `{"status":"ok"}`;
`curl :6340` → `200`. No backend source changed since Cycle 2, so the running backend still
matches HEAD.

---

## Holistic pass — CR1–CR9 and named invariants

`git log ecf27651..HEAD --oneline` → exactly **one** commit. `git diff ecf27651..HEAD --name-only`
→ 3 code/test files + 4 artifact files. No CR1–CR9 surface is touched; all remain resolved.

- **F-105** — untouched. The new resync fires only on a user-initiated duplicate, never on mount;
  load-time `/analyze` count unchanged. `hel908-step-card-split.spec.ts` green in my run.
- **F-146** — my full live session (3 pipelines, page loads, tail attaches, a duplicate, a delete,
  several API reads) produced **3** console errors — the same pre-existing 3 as Cycles 2 and 3
  (2× `/api/types` 404 from `SidebarBody`, 1× `/schedule` 404 = the handled no-schedule case).
  Zero selector-instability warnings. `syncStepsFromServer` remains a stable `useCallback`.
- **HEL-629** — `OutputPreviewPane.tsx` not in the diff. Untouched.
- **HEL-681** — keyed/reconciled fetches unchanged.
- **HEL-878** — `hel908-full-flow.spec.ts` (live post-Save thumbnail) green in my run.
- **Backend non-goal-waiver primitives** — zero backend files changed since Cycle 2;
  `attachTailInternal` / `reorderTrunkInternal` byte-identical to what I verified then.

---

### Phase 1: Spec Review — PASS

No spec/schema/task surface changed beyond a 1-line `tasks.md` note and the handoff artifacts. The
Cycle-3 documentary gap is closed: `execution-progress.md` now states the handler audit explicitly
— though, per the question answered above, that audit's *set* is enumerated on the wrong axis and
is incomplete (CR11).

### Phase 2: Code Review — PASS

The fix is minimal, reuses the existing `syncStepsFromServer` helper rather than reinventing it,
correctly extends the dep array, and carries a comment that states the root cause and the prior
wrong belief — what this repo's standards ask for. No `any`, no dead code, no over-abstraction, no
lint/format/type violations. Scope boundary respected exactly. Nothing in the code *as written* is
wrong; CR11 is a completeness gap in a handler this commit deliberately did not touch.

### Phase 3: UI Review — FAIL

Triggers matched (`frontend/**`). Driven live at `localhost:6340` / `:9247`.

- CR10's path now renders correctly with no reload, verified against live API truth.
- No new console errors; the 3 present are the documented pre-existing ones.
- All `hel908-*` e2e specs green.
- **CR11: `Remove step` on a step owning both a head child and a tail renders a permanently
  deleted step as a live top-level trunk card, until reload.**

---

### Overall: FAIL

**CR10 is genuinely and completely resolved** — confirmed by fresh first-hand live evidence, scope
boundary honored, all gates green, all invariants intact. If CR10 were the only question, this
would be a clean PASS.

It fails only because the systematic enumeration the human explicitly asked for **found a sixth
handler with the same defect**, and I reproduced it live. I am applying the same standard I applied
when CR9's pass left CR10 behind; calling this PASS would be inconsistent with that, and would
certify a completeness claim I now know to be false.

To be explicit about the gate the human asked about: **HEL-908 is not yet ready for the final
skeptic gate** — not because of CR10, but because of CR11. Should the human rule that CR11 ships
as a follow-up bug (a defensible call: display-only, reload-corrected, no data corruption), then
everything else in this ticket is verified green and it is ready for the skeptic immediately.

### Change Requests

11. **`handleRemoveStep` has the same stale-local-state defect as CR9/CR10, and renders a
    cascade-deleted step as a live trunk card.** Root cause
    (`PipelineStepRepository.deleteInternal:595-623` reparents the head child and deletes tail
    subtrees), live repro with exact pre/post DOM vs. server truth, and the concrete fix are in
    the CR11 section above. In short: call `syncStepsFromServer()` after `deletePipelineStep`
    resolves in `usePipelineDetailPage.ts:713-738`, keep the optimistic filter and the
    revert-on-error, add the dep, and add an e2e case asserting — with no reload — that deleting a
    step which owns both a head child and a tail leaves exactly one trunk card.
    **Decision required from the orchestrator/human: fix in a further scoped cycle, or file as a
    follow-up bug and ship.** I am not assuming authorization for either.

### Non-blocking Suggestions

- `handleRemoveStep` discards `DeletePipelineStepResponse.removedTailStepCount`, which the backend
  computes and documents specifically so a caller can warn the user how many steps a delete took
  with it. Surfacing it in the toast would turn a silent destructive cascade into a visible one.
- Carried and still open, still non-blocking: `handleInsertStep`'s catch conflates create-failure
  with resync-failure (toast can be false); `handleAddOutputViaAggregateTail` awaits the resync
  outside its inner `try`; task 8.3's stale `dataTypes` clause; `EMPTY_OUTPUTS as Output[]`;
  the unfiled file-split follow-up for `usePipelineDetailPage.ts` (now 956 lines) /
  `OutputEditorSheet.tsx` (569); `HEL-937` should name `MetricEditorForm.tsx`.

### Critical Path

**One issue, and the cheapest possible shape of it.** CR11 is a ~4-line change using a helper that
already exists in the file, plus one e2e case cloned from the CR10 case committed this cycle —
the identical shape as the CR9→CR10 fix, twice now proven mechanical. Every other dimension of
HEL-908 is green: all five gates pass fresh, all `hel908-*` e2e specs pass, CR1–CR10 are resolved,
every named historical invariant is intact, and the handler enumeration is now — for the first
time — **systematically derived and complete**, so there is no CR12 lurking behind this one.

**Recommendation for the human:** the enumeration is now closed on evidence rather than on
inspection, which is what was asked for. Either resolution is sound. If throughput matters more
than polish, ship HEL-908 now and file CR11 as a follow-up bug — it cannot corrupt data. If
correctness-at-merge matters more, one last ~30-minute scoped cycle closes the last known instance
of a defect class that has now cost three review cycles, and would let the ticket reach the
skeptic with the class provably eliminated rather than provably enumerated.
