# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `698961e1` ("Defer (not drop) suppressed analyze; rewrite refuted spec"),
on top of cycle 1's `b992e937`.

Every self-reported number below was re-derived independently, as in cycle 1.

**Headline: cycle 2 fixed the spec (CR1), the comment (CR3) and the follow-up ticket (CR4)
correctly, and CR2's diagnosis of my own instruction was right. But CR2's remedy is
incomplete, and I proved it: the commit ships a self-sustaining infinite `/analyze` dispatch
loop that fires whenever an analyze round trip takes longer than the 300ms debounce.**

---

## The four questions asked of me

### 1. Was my cycle-1 CR2 wording wrong? — **Yes, partly. Recorded as a correction.** But the executor's remedy does not fully work.

**The loop is real.** My CR2 said to add `analyzeStatus` to the effect's dependency array.
That instruction, taken literally, does create a self-triggering cycle: dispatching sets
`analyzeStatus` to `"loading"`, and its settling sets it back — so `analyzeStatus` is
simultaneously one of the effect's dependencies *and* a side effect of the dispatch the effect
performs. The executor identified this correctly and caught it with a genuinely red test.
**Its deviation from my instruction was a correction, and I want that recorded as such** — the
executor was right and I was incomplete. It should not be marked down for departing from a
change request that did not survive contact with the code.

**But `lastAnalyzedFingerprintRef` does not break the cycle. It only hides it when
`/analyze` resolves in under 300ms.** Trace the shipped code
(`usePipelineDetailPage.ts:297-322`):

1. Edit → debounce fires → guard clear, fingerprint new → dispatch. `last = F`, `pending = false`.
2. `analyzeStatus → "loading"` → the effect re-runs (it now depends on `analyzeStatus`) → new 300ms timer.
3. **If the analyze is still in flight when that timer fires** (i.e. round trip > 300ms), the guard
   branch runs and sets `pendingAnalyzeRef.current = true` — *unconditionally*, even though no new
   edit occurred and fingerprint `F` was already dispatched.
4. Analyze settles → `analyzeStatus → "succeeded"` → effect re-runs → timer fires → guard now clear
   → the `last === fingerprint && !pending` bail-out **does not fire, because `pending` is true** →
   dispatch again.
5. → step 2. Forever.

The `lastAnalyzedFingerprintRef` check is defeated by `pendingAnalyzeRef`, which step 3 sets
spuriously. The loop is only avoided when the analyze resolves before the re-armed timer fires —
i.e. under 300ms, which is exactly what happens on this fast local box and nowhere else.

**Probe (temporary test, appended then removed; tree restored and verified clean).** Every
`/analyze` mocked to take 600ms. One step edit, then **five seconds of complete idleness — no
further user action at all**:

```
analyzePipelineMock.mockImplementation(
  () => new Promise((resolve) => setTimeout(() => resolve(emptyAnalyzeResponse), 600)),
);
...
EVALPROBE dispatches after ONE edit + 5s idle: 6
Expected: 1   Received: 6
```

**Six dispatches from one edit, ~one every 830ms (600ms analyze + 300ms debounce), still
climbing when the probe ended.** This is an unbounded request loop, not a one-off duplicate.

**A/B against the pre-CR2 commit, same probe, same file:**

| Hook version | dispatches after 1 edit + 5s idle |
|---|---|
| `b992e937` (cycle 1, pre-CR2) | **1** — correct |
| `698961e1` (cycle 2, shipped) | **6** and rising |

So this is a **regression introduced by cycle 2**, not a pre-existing condition. Severity is
high: `/analyze` exceeding 300ms is the normal case against a real backend (network + pipeline
analysis), not an edge case. Any user leaving a pipeline detail page open after a single step
edit would generate continuous `/analyze` traffic indefinitely — and it degrades worst under
exactly the backend load this entire ticket exists to reduce, which makes it self-amplifying.

**I verified a minimal remedy.** Setting `pendingAnalyzeRef` only when there is genuinely
something new to analyze:

```ts
if (sseActiveRef.current || analyzeStatusRef.current === "loading") {
  if (lastAnalyzedFingerprintRef.current !== stepsFingerprint) {
    pendingAnalyzeRef.current = true;
  }
  return;
}
```

With that one change: my probe returns **1** dispatch, and the **full `PipelineDetailPage.test.tsx`
suite passes 117/117** — including both of the executor's CR2 tests, so the deferral semantics
they encode are preserved intact. (Applied temporarily to verify, then reverted; `git diff HEAD`
confirmed empty.)

Note this also fixes a quieter sibling defect on the `sseActive` arm: today a run lasting >300ms
sets `pending` even with no edit at all, so a spurious `/analyze` fires after *every* run
completion. The same conditional removes that.

### 2. Regression in the numbers? — **No. My tally is 59/60, identical to cycle 1.**

```
npx playwright test e2e/hel912-lanes-rejoin.spec.ts --repeat-each=60 --workers=1
→ 1 failed, 59 passed (8.7m)
```

| Measurement | tally | target-signature rate |
|---|---|---|
| cycle 1, `b992e937` (mine) | 59/60 | 1.7% (1 × `Run status: succeeded`) |
| cycle 2, `698961e1` (mine) | **59/60** | **0% — see below** |
| cycle 2, `698961e1` (executor's claim) | 58/60 | 3.3% |

**The deferral did not reintroduce the contention.** The executor's 58/60 is within noise of my
59/60 at this N; I see no evidence of a correctness-for-contention trade.

**However, my single failure was a different signature, and it is worth your attention.** It was
*not* `Run status: succeeded`:

```
Error: page.waitForResponse: Test timeout of 90000ms exceeded.   (spec.ts:95)
Error: locator.click: Test timeout of 90000ms exceeded.
  - waiting for getByRole('menu').getByRole('menuitem', { name: 'Group & aggregate' })  (spec.ts:103)
```

That is **HEL-991's click-timeout signature** — and `hel912-lanes-rejoin.spec.ts` had never
reproduced it before, across ~150 iterations in cycle 1 (the executor's ~140 plus my 90). Its
first appearance on this spec being on the commit that introduces an unbounded `/analyze` loop is
a suggestive coincidence: a client hammering `/analyze` every ~830ms would starve exactly the kind
of request this failure timed out on. **I am flagging this as a lead, not asserting causation** —
one occurrence is not a measurement, and HEL-991's defect is independently real. The right move is
to re-run the N=60 loop after fixing the loop and see whether it recurs; if it vanishes, HEL-991
may have a cheaper explanation than anyone currently thinks.

### 3. The fixture edit — **a genuine correction, not a workaround.**

Verified independently against the source rather than the executor's description.
`handleInsertStep` (`usePipelineDetailPage.ts:542-583`) awaits `createPipelineStep(...)` and then
calls `syncStepsFromServer()`, which at `:524-528` replaces local `steps` wholesale with whatever
`getPipelineSteps` returns.

The test's `beforeEach` set `getPipelineStepsMock.mockResolvedValue([persistedRename, persistedFilter])`
— two steps — for **every** call, including the post-insert resync. So the fixture modeled a server
that accepts a step creation and then reports the step does not exist. **No real backend behaves
that way**; a successful 201 is followed by a resync returning three steps. The old fixture was
wrong about reality before this ticket existed.

The new wiring (`mockResolvedValueOnce` 2-step for the mount fetch, then 3-step for the post-insert
resync) is exactly what the real endpoints return, in the real call order.

The sharper point in the executor's favour: under the old fixture the test named
*"an insert changes stepsFingerprint and the existing debounced analyze re-dispatches"* but passed
for the wrong reason — the fingerprint churned 2 → 3 → **back to 2**, and the old unconditional
dispatch fired on the *revert*. The corrected fixture makes the test finally test its own name.
**This is a fixture corrected because it never reflected reality — a fix.** It is the one case
where the "a fixture edit is a defect symptom" heuristic resolves in the editor's favour, and it
does so on evidence.

### 4. CR1's spec rewrite — **confirmed done, and not softened. One gap.**

- Both refuted requirements ("The open op picker survives ancestor re-renders", "The open picker
  holds a stable screen position") and **all five of their scenarios are gone.** Only two
  requirements remain.
- `## Purpose` no longer mentions menu-click stability; it describes the analyze/run-contention
  contract and states the refutation explicitly, including that `OpDropdown.tsx` is untouched and
  that any picker DOM contract belongs to HEL-991.
- The lanes-rejoin scenario now reads *"at a measured residual well below the pre-fix rate"*, cites
  the real numbers (~10% pre-fix vs ~1.7-3.3% post-fix), and states outright: *"This requirement
  does NOT claim every iteration passes."* That is the honest bar, not a softened restatement.
- The new contention requirement matches what the diff implements.

**Gap:** the spec specifies only what must *not* happen. The whole substance of CR2 — that a
suppressed analyze must eventually **resume** — is unspecified, despite now being the central
behavior and having a dedicated test. A future change could reinstate cycle 1's silent drop and
still satisfy this spec word for word. It also does not constrain the loop the code now has. See
CR6/CR7.

---

## Gates (my own fresh run)

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm test` (frontend) | PASS — 256 suites, **2648 tests** (2647 + the new CR2 test) |
| `npm test` (helio-mcp) | PASS — 24 suites, 238 tests |
| `npm --prefix frontend run build` | PASS |

No `backend/**` changes, so `sbt test` is not applicable.

**HEL-962 / HEL-964 untouched — confirmed.** `git diff main...HEAD --name-only` contains zero
`hel908` files, and both quarantine entries survive in `playwright.config.ts`:
`"**/hel908-tail-attach.spec.ts"` (line 47, HEL-962) and `"**/hel908-full-flow.spec.ts"`
(line 65, HEL-964).

**CR3 and CR4 confirmed addressed.** The false comment is gone, replaced by an accurate statement
that `state.analyzeResult` is written only by `analyzePipeline.fulfilled`. HEL-992 is filed
(Helio Platform, Medium) with a real probe-first investigation plan and acceptance criteria that
require a probe-confirmed cause — a deferral naming a real task, not prose.

---

## Phase 1: Spec Review — **PASS**

All five ticket ACs hold (AC1 un-quarantined and passing repeatedly at my measured 59/60; AC2
probe-confirmed; AC3 `roots` fixture correct; AC4 **now satisfied** — this was cycle 1's FAIL and
the rewrite fixes it; AC5 HEL-962/964 untouched). Tasks are all marked done and match what
shipped. `probe-findings.md`'s Cycle 2 section is an accurate account of the work — every claim
in it that I checked held up, including the ones that were inconvenient to the executor.

## Phase 2: Code Review — **FAIL**

Gates pass and the code is otherwise clean and well-commented. The failure is the proven
unbounded dispatch loop (question 1 above), plus the missing coverage that let it ship.

## Phase 3: UI Review — **N/A this cycle**

No UI-affecting surface changed relative to cycle 1 (the diff is a hook guard, tests, and
planning artifacts). Cycle 1's Phase 3 passed and nothing in this diff alters rendering, markup
or styling. The 60-iteration e2e run above exercises the page end-to-end.

## Overall: **FAIL**

Cycle 2 did good work: three of four change requests are fully and correctly addressed, the spec
rewrite is honest rather than softened, the fixture edit is a real correction, and the executor
was right to push back on my CR2 wording. The FAIL is for one defect — but it is a production
request loop, it is a regression this commit introduces, and it is a one-line fix I have already
verified.

## Change Requests

1. **Stop `pendingAnalyzeRef` from being set when there is nothing new to analyze**
   (`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:305-308`). The guard branch sets
   `pendingAnalyzeRef.current = true` unconditionally, including when it is re-entered purely because
   the effect re-armed on its *own* dispatch's `analyzeStatus → "loading"`. That flag then defeats the
   `lastAnalyzedFingerprintRef` bail-out on the next pass, and the cycle repeats indefinitely for any
   analyze slower than the 300ms debounce. Verified remedy:

   ```ts
   if (sseActiveRef.current || analyzeStatusRef.current === "loading") {
     if (lastAnalyzedFingerprintRef.current !== stepsFingerprint) {
       pendingAnalyzeRef.current = true;
     }
     return;
   }
   ```

   I confirmed this returns the probe to 1 dispatch and keeps `PipelineDetailPage.test.tsx` at
   117/117 (both CR2 tests still green). Adopt this or an equivalent that provably terminates —
   the requirement is that a *deferral* is only recorded for an edit that has not yet been analyzed.

2. **Add the regression test that would have caught it, and prove it RED first.** The existing CR2
   tests cannot catch this because their analyze mocks resolve immediately, so the re-armed timer is
   always cleared before it fires. The test must make the analyze round trip **longer than the 300ms
   debounce** — e.g. `analyzePipelineMock.mockImplementation(() => new Promise((r) => setTimeout(() => r(emptyAnalyzeResponse), 600)))`
   — then perform **one** edit, idle for several seconds with no further interaction, and assert
   exactly one dispatch. Demonstrate it RED against `698961e1` (it will report ~6) before applying CR1.
   Also cover the `sseActive` arm: a run lasting >300ms with no edit at all must not produce a
   post-run `/analyze`.

3. **Re-run the N=60 e2e loop after CR1 and report the tally**, and say specifically whether the
   `locator.click` / `page.waitForResponse` 90s signature I hit at repeat 57 recurs. If it does not
   reappear across N=60, note that in `probe-findings.md` and add a line to **HEL-991** recording that
   an unbounded `/analyze` loop existed transiently on this branch and is a candidate contributor to
   that signature — HEL-991's investigation should not chase a DOM mechanism for something a request
   flood may explain. Do not overstate it: flag it as a lead with one observation behind it, not a
   finding.

4. **Add the resume property to the spec delta.** `specs/pipeline-op-picker-stability/spec.md`'s
   contention requirement states only what must not happen, so cycle 1's silent-drop behavior would
   satisfy it verbatim. Add a scenario to the existing requirement:
   *"**WHEN** a step edit's analyze was suppressed by either guard and the guard subsequently clears
   **THEN** the deferred `analyzePipeline` is dispatched exactly once, and `state.analyzeResult`
   reflects the edited step list."*

5. **Add a termination scenario to the same requirement**, so the defect in CR1 is specified against
   and cannot silently return: *"**WHEN** no step edit has occurred since the last completed analyze
   **THEN** no further `analyzePipeline` request is dispatched, regardless of how long any individual
   analyze request takes."*

## Non-blocking Suggestions

- The `analyzeStatus`-in-deps hazard is subtle enough that it has now caught two of us (my CR2
  wording, and the shipped `pendingAnalyzeRef` interaction). The comment block at `:158-168` explains
  the loop well; it would be worth one added sentence naming the *surviving* precondition — that the
  guard must never record a deferral for an already-analyzed fingerprint — so the next person to touch
  this effect sees the invariant rather than re-deriving it.
- Cycle 1's note stands: `usePipelineDetailPage.ts` is now ~1170 lines, well past `CONTRIBUTING.md:24`'s
  ~400-line "propose a split" threshold. The run/analyze orchestration block — now five refs and two
  effects — has become the natural extraction candidate. Worth a line in the PR description rather than
  a change here.
