# Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed at HEAD `ecf27651`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`, tree clean.
All gates re-run fresh by the evaluator at this commit (not trusted from the executor's report).

## Gate re-run (my own, this commit)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0) |
| `npm run format:check` | PASS (exit 0) |
| `npm run typecheck` (`tsc --noEmit`, frontend tsconfig) | PASS (exit 0) |
| `npm test` | PASS — 282 suites, 3009 tests (unchanged from Cycle 2) |
| `npm --prefix frontend run build` | PASS (exit 0) |
| `cd backend && sbt test` | **N/A this cycle** — `git diff ddbb90e9..HEAD --name-only \| grep -c backend/` → **0**. No backend file changed since my Cycle-2 run (3538 green). |
| `DEV_PORT=6340 npx playwright test e2e/hel908-*.spec.ts` | PASS — **6/6** (was 5; +1 CR9 case), prints `25 clicks` |

On the `tsc` command question: `npm run typecheck` is the authoritative gate (it is what
`package.json` defines and what the Husky pre-commit hook runs, scoped to
`frontend/tsconfig.json`). The executor's note is correct — a bare root-level `npx tsc --noEmit`
picks up the broader `e2e/`/`helio-mcp` project graph (HEL-797 scoping) and is not the gate.
I ran the gate command; it exits 0.

Dev-server currency verified before any UI evidence: `curl :9247/health` → `{"status":"ok"}`;
`curl :6340` → `200`. No backend source changed since Cycle 2, so the running backend still
matches HEAD; Vite serves the frontend from disk.

---

## CR9 re-verification — RESOLVED for the three paths the executor fixed

Verified first-hand through the real UI on a **new** pipeline (`bd29835c`), not via the e2e
fixture, and not by reading the diff.

**Step 1 — leaf tail attach.** `Add tail step` → `Group & aggregate` off the lone `filter`
leaf. **Step 2 — trunk append.** `+ Add transformation step` → `Sort rows`.
**Step 3 — read DOM and server truth together, with NO reload:**

```
DOM (live, no reload)                    server GET /api/pipelines/.../steps
section 0: trunk[Filter rows]  tails[]   filter    63b36b7e  pos 0  parent null
section 1: trunk[Sort rows]    tails[    sort      c474e6b2  pos 0  parent 63b36b7e
             Group & aggregate ]         aggregate ba5ea247  pos 1  parent c474e6b2
```

The rendered tree is now **byte-for-byte the persisted truth**: the aggregate tail sits under
**Sort**, its true owner, immediately and without a reload. In Cycle 2 this identical sequence
rendered the exact inverse (tail under Filter, Sort tail-less).

**Point 3 of the brief — persisted data was always correct.** Confirmed by live API read above:
`aggregate.parentStepId = c474e6b2` (Sort) at the same instant the Cycle-2 DOM was drawing it
under Filter. This was a client-state bug, never a data bug, exactly as my Cycle-2 diagnosis
said.

**Regression coverage is real, not vacuous.** `e2e/hel908-tail-attach.spec.ts:126` drives the
full sequence through the real UI and asserts `sections.nth(0)` has **0** tail-chain items and
`sections.nth(1)` has **1**. That assertion is the direct logical negation of the DOM I myself
enumerated pre-fix in Cycle 2 (section 0 held the tail-chain, section 1 did not), so it cannot
pass on the old code — it is a genuine red-then-green guard, not a tautology. It passes fresh in
my own run. The `PipelineDetailPage.test.tsx:1108` change is not new coverage, just a mock queued
for the new follow-up `getPipelineSteps` call — correctly labelled as such.

**Point 4 — path audit. Three of four fixed; the fourth CR9 named was silently dropped.**

| path | resynced? | verdict |
| --- | --- | --- |
| `handleInsertStep` | yes | correct — this is the trunk splice-insert that reparents |
| `handleAddTailStep` | yes | correct (symmetry, honestly justified in-comment as defensive) |
| `handleAddOutputViaAggregateTail` | yes | correct — also fixes a real secondary bug (it used to `[...prev, newStep]`, appending the tail at the end of the array rather than after its anchor) |
| `handleInstantiateShape` | no, audited | **reasoning is sound — I checked it, did not accept it** |
| `handleDuplicateStep` | **no, not audited, not even mentioned** | **DEFECT — see CR10** |

`handleInstantiateShape`'s stated reason holds up. Only the first loop entry can target a
pre-existing node (`anchorStepId`), and it already sets `attachAsTail: isFirstStep &&
anchorHasChild` — a tail-attach cannot reparent siblings, and a plain trunk-insert onto a
childless anchor has nothing to reparent. Every later entry's `realParentId` resolves through
`clientIdToRealId` to a step this same batch created moments earlier, which by construction has
no other children. The one input the argument depends on — `anchorHasChild`, read from
`stepsRef.current` (local state) — is now reliable precisely because the three create paths
resync. The audit is correct.

---

## CR10 (NEW, blocking) — `handleDuplicateStep` has the identical CR9 defect

CR9's own text told the executor to "check `handleAddTailStep` / `handleInstantiateShape` /
**`handleDuplicateStep`** for the same exposure." `handleDuplicateStep` was neither fixed nor
audited nor mentioned anywhere in the commit message or `execution-progress.md`
(`git show ecf27651 -- .../execution-progress.md | grep -i duplicate` → no match). It is
exposed, and I reproduced it live.

**Why it is exposed (root cause, read in code, not guessed):**
`PipelineService.duplicateStep` (`backend/.../PipelineService.scala:1265`) calls
`pipelineStepRepo.spliceInsertAtInternal(..., Some(existing.id), ...)` — the *same* reparenting
primitive `handleInsertStep` hits, whose own doc says it re-parents "**every** step that
currently is a direct child of `parentStepId` — both the old position-0 trunk continuation AND
any position!=0 tail roots — onto the new step."
`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:821-836` responds by splicing the
clone into the local array at `index + 1` and touching nothing else, leaving every sibling's
`parentStepId` stale — the exact pattern CR9 removed from the other three handlers.

**Live repro, continuing on the same pipeline `bd29835c` immediately after the CR9 probe above.**
Clicked `Duplicate step` on **Sort rows** (the trunk node that owns the aggregate tail):

```
server truth (live API)                     DOM rendered, NO reload
filter    63b36b7e  pos 0  parent null      section 0: trunk[Filter rows]        tails[]
sort      c474e6b2  pos 0  parent 63b36b7e  section 1: trunk[Sort rows]          tails[Sort rows]   <-- clone drawn as a TAIL
sort'     6f8ec498  pos 0  parent c474e6b2  section 2: trunk[Group & aggregate]  tails[]            <-- tail PROMOTED to trunk
aggregate ba5ea247  pos 1  parent 6f8ec498
```

Two independent misrepresentations at once: the **clone** is drawn as a tail branch off the
original (it is a trunk continuation, `position 0`), and the **aggregate tail** is drawn as a
top-level trunk step (it is a `position 1` tail of the clone). A hard reload of the same URL
renders it correctly:

```
section 0: trunk[Filter rows]  tails[]
section 1: trunk[Sort rows]    tails[]
section 2: trunk[Sort rows]    tails[Group & aggregate]
```

— which proves `buildStepTree` is right and the local step array is stale, identical in kind to
CR9.

**Severity: blocking, same reasoning CR9 used.** The user is shown a false claim about which node
their aggregate reads from and about whether the duplicated step is on the trunk or a branch —
and nothing on the page corrects it until a reload. `Duplicate step` on a tailed trunk node is
an ordinary one-click action, more reachable than CR9's own two-step sequence.

**Fix:** call the existing `syncStepsFromServer()` after `duplicatePipelineStep(stepId)` resolves
in `handleDuplicateStep` (`usePipelineDetailPage.ts:824`), replacing the local `setSteps` splice —
the helper already exists and is exactly the right tool. Add `syncStepsFromServer` to the
`useCallback` dep array (currently `[pushToast]`). Add an e2e case in `hel908-tail-attach.spec.ts`
mirroring the CR9 one: leaf tail attach → `Duplicate step` on the tail's owner → assert, with no
reload, that the tail-chain sits under the *clone's* section and that there are 3 trunk cards and
1 tail card (my repro above gives the exact pre/post DOM to assert against).

While there, restate the audit in `execution-progress.md` covering **all five** handlers
(including this one) so the record matches what was actually checked.

---

## Holistic pass over CR1–CR9

Skimmed `evaluation-1.md`, `evaluation-2.md` and the full `execution-progress.md` history. CR1–CR8
all remain resolved at this commit — nothing was reintroduced by `ecf27651` (a 3-file code change
confined to the three create handlers plus one test mock). The Cycle-2 non-blocking items stand
where they were: task 8.3's stale `dataTypes` clause is still uncorrected, the
`EMPTY_OUTPUTS as Output[]` cast is unchanged, and the file-split follow-up ticket is still
unfiled (orchestrator/human action, honestly disclosed). None of those is blocking.

Two small non-blocking notes on the CR9 fix itself:

- `handleInsertStep` no longer distinguishes "create failed" from "create succeeded but the
  resync failed" — both land in the same `catch` and toast "Failed to add step", leaving the temp
  step visible even though the row exists. Narrow window, cosmetic, but the message can now be
  false.
- `handleAddOutputViaAggregateTail` awaits `syncStepsFromServer()` outside its inner `try`, so a
  resync rejection aborts before `createOutput` with a raw rejection rather than the handler's
  own toast. Callers already handle this function's rejections (it re-throws by design), so this
  is consistency, not a bug.

## Named historical invariants — re-confirmed, none regressed

- **F-105** — `e2e/hel908-step-card-split.spec.ts` ("initial load fires /analyze once") passes
  fresh at `ecf27651`. The three added resyncs fire only on user-initiated creates, never on
  mount, so the load-time `/analyze` count is untouched.
- **F-146** — my full live session (page load, tail attach, trunk append, duplicate, two API
  reads) produced **3** console errors, the same pre-existing 3 as Cycle 2 (2× `/api/types` 404
  from `SidebarBody`, 1× `/schedule` 404 = the handled no-schedule case). Zero selector-instability
  warnings. `syncStepsFromServer` is a stable `useCallback` on `[id, dispatch]`.
- **HEL-629** — untouched this cycle; `OutputPreviewPane.tsx` not in the diff.
- **HEL-681** — no regression; keyed/reconciled fetches unchanged.
- **HEL-878 / rail-thumbnail staleness** — `hel908-full-flow.spec.ts` (which asserts the live
  post-Save thumbnail) passes fresh.
- **Backend non-goal-waiver primitives** — `git log ddbb90e9..HEAD -- backend/src/main/scala`
  returns **nothing**. `attachTailInternal` and `reorderTrunkInternal`, with their
  mutation-proven specs, are byte-identical to what I verified in Cycle 2.

---

### Phase 1: Spec Review — PASS

No spec/schema/task surface changed this cycle beyond a 4-line `tasks.md` note and the
`execution-progress.md`/`files-modified.md` handoff. CR2's reorder spec + schema + delta remain in
place. The only Phase-1 gap is documentary and rolls into CR10: `execution-progress.md`'s Cycle-3
audit claims a complete path sweep while omitting `handleDuplicateStep` entirely.

### Phase 2: Code Review — PASS

The `syncStepsFromServer` helper is the right fix at the right layer — one shared, correctly-memoized
helper replacing three divergent one-element patches, rather than three local band-aids. The
comments state the reasoning and the prior wrong belief, which is what this repo's standards ask
for. No new lint/type/format violations, no `any`, no dead code, no over-abstraction. The
`handleInstantiateShape` no-op audit is genuinely reasoned and, on my own check, correct. CR10 is
a completeness gap in *where* the fix was applied, not a defect in the fix itself.

### Phase 3: UI Review — FAIL

Triggers matched (`frontend/**`). Driven live at `localhost:6340` / `:9247`.

- CR9's happy path now renders correctly with no reload (verified against live API truth).
- No new console errors; the 3 present are the documented pre-existing ones.
- All 6 HEL-908 e2e specs green.
- **CR10: `Duplicate step` on a tailed trunk node renders a materially wrong tree until reload.**

---

### Overall: FAIL

CR9 is genuinely fixed on the three paths the executor addressed, confirmed by fresh first-hand
live evidence rather than by reading the diff, and its e2e guard is meaningful. But CR9 explicitly
enumerated `handleDuplicateStep` as a path to check, and it was neither fixed nor audited nor
mentioned — and it carries the identical defect, reproduced live. This is a half-resolved change
request, not new scope.

---

### Change Requests

10. **`handleDuplicateStep` has the identical stale-local-state defect CR9 fixed elsewhere.**
    Full root cause, live repro (pipeline `bd29835c`, exact pre/post DOM and server truth), and
    the concrete fix are in the CR10 section above. In short: apply the existing
    `syncStepsFromServer()` after `duplicatePipelineStep` resolves in
    `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:821-836`, add it to the dep
    array, add an e2e case asserting the tail follows the clone with no reload, and correct the
    `execution-progress.md` audit to cover all five handlers.

### Non-blocking Suggestions

- `handleInsertStep`'s catch now conflates create-failure with resync-failure; the toast can be
  false in the latter case.
- `handleAddOutputViaAggregateTail` awaits the resync outside its inner `try`.
- Carried from Cycle 2, still open and still non-blocking: task 8.3's stale `dataTypes` clause;
  `EMPTY_OUTPUTS as Output[]` (prefer a `readonly Output[]` return type); the unfiled file-split
  follow-up ticket for `usePipelineDetailPage.ts` (955) / `OutputEditorSheet.tsx` (569);
  `HEL-937` should name `MetricEditorForm.tsx`; the 2 pre-existing ECharts DOM-size warnings.

---

### Critical Path (final scheduled cycle — `CYCLE 3` of `EXECUTION_CYCLES 3`)

**One issue, and it is small and well-specified.** CR10 is a ~4-line change using a helper that
already exists in the file, plus one e2e case cloned from the CR9 case committed this cycle. Every
other dimension of this ticket is green: all gates pass fresh, all 6 e2e specs pass, CR1–CR9 are
resolved, and every named historical invariant is intact.

**Recommendation for the human:** grant one short extra cycle scoped strictly to CR10 rather than
failing the ticket out. The remaining work is mechanical and the fix pattern is already
established and reviewed in this same commit; there is no open design question. If an extra cycle
is not available, CR10 should ship as a filed follow-up bug (it is a display-only, reload-corrected
staleness on the duplicate action, with no data corruption — the persisted tree is always correct)
and HEL-908 can pass with that ticket referenced — but the in-cycle fix is clearly preferable
given how contained it is.
