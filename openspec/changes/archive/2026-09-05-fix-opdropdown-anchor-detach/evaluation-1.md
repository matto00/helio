# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `b992e937` on `bug/opdropdown-anchor-detach-race/hel-972`.
Evaluated against the **rescoped** goal (debounced-analyze / in-flight-run contention),
per the product owner's endorsed `split-into-two-tickets` ruling — not the original
DOM-detach framing.

Every executor self-reported verification claim was re-run independently. Results below
are **my own measurements**, not the executor's.

---

## Independent verification (all re-run from scratch)

### E1. `e2e/hel912-lanes-rejoin.spec.ts`, post-fix, N=60

```
npx playwright test e2e/hel912-lanes-rejoin.spec.ts --repeat-each=60 --workers=1
→ 1 failed, 59 passed (7.0m)
```

**My tally: 59/60 (1.7% residual).** The single failure is the target signature:

```
Error: expect(locator).toBeVisible() failed
Locator:  getByLabel(/Run status: succeeded/i)
Timeout:  15000ms
> 240 | await expect(page.getByLabel(/Run status: succeeded/i)).toBeVisible({ timeout: 15000 });
```

The executor claimed 57/60 (2 target-signature + 1 unrelated layout assertion). My run
came out slightly *better* than claimed. The claim is corroborated and, if anything,
conservative. `retries: 0` confirmed in `playwright.config.ts:39`, so this tally is honest.

### E2. Pre-fix baseline, measured by me (the claim's control arm)

The executor's 4/20 baseline was itself unverified, so I re-measured it. I reverted the
fix hunk only (`git checkout main -- frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`),
leaving the fixture fix and the un-quarantine in place, and re-ran on the same machine,
same servers, same session:

```
--repeat-each=30 --workers=1 → 4 failed, 26 passed (4.0m)
```

Of the 4: **3 are the target `Run status: succeeded` signature** (10% target-signature
rate), 1 is the unrelated `expect(received).toBe(expected)` layout/pixel assertion the
executor also saw.

**Head-to-head on target signature, both measured by me under identical conditions:**

| | target-signature failures | rate |
|---|---|---|
| pre-fix (N=30) | 3 | 10.0% |
| post-fix (N=60) | 1 | 1.7% |

≈6x reduction — the same order the executor reported. **The fix demonstrably works.**
The working tree was restored afterwards and verified clean (`git diff HEAD` empty).

### E3. The new unit test, demonstrated RED by me

With the fix hunk reverted (same state as E2):

```
npx jest --config jest.config.cjs src/features/pipelines/ui/PipelineDetailPage.test.tsx \
  -t "skipped while a run is in flight"

● PipelineDetailPage › a reorder's debounced analyze is skipped while a run is in flight
    expect(received).toBe(expected)
    Expected: 1
    Received: 2
    > 874 | expect(analyzePipelineMock.mock.calls.length).toBe(callsBeforeRun);
Tests: 1 failed
```

**RED confirmed, exactly as claimed (2 calls vs expected 1).** GREEN post-fix confirmed
via the full suite in E4. This is a real guard, not a green-only test.

### E4. Gates (my own fresh run, in `WORKTREE_PATH`)

| Gate | Result |
|---|---|
| `npm run lint` | PASS (`--max-warnings=0`, clean) |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS ("All matched files use Prettier code style!") |
| `npm test` | PASS — **256 suites, 2647 tests**, plus helio-mcp 24/238 |
| `npm --prefix frontend run build` | PASS (PWA precache generated) |

The executor's "256 suites, 2647 tests" figure matches mine exactly. No `backend/**` files
changed, so `sbt test` is not applicable.

---

## Accuracy findings F1 / F2

### F1 — **The charge does not hold. The executor's report was TRUE when written.**

The orchestrator's halt report asserted: *"the `sseActiveRef` fix was already in the working
tree"* when the executor said no fix code had been written. I traced the executor's own
transcript (`~/.claude/projects/-home-matt-Development-helio/2179eccd-.../subagents/agent-a664362b0a8507960.jsonl`)
and the run event log. Timeline, all timestamps from the transcript itself:

| Time (UTC) | Event |
|---|---|
| 21:53:33 | Edit to `usePipelineDetailPage.ts` — the D2 probe (dispatch commented out) |
| 21:56:11 | Edit reverting the D2 probe |
| 21:56:15 | `git diff --stat` on that file → **empty output** (clean) |
| 22:02:48 | `git status --short` → ` M e2e/hel912-lanes-rejoin.spec.ts`, ` M OpDropdown.tsx`, ` M playwright.config.ts` — **`usePipelineDetailPage.ts` is NOT listed** |
| 22:02:54 | `git checkout -- OpDropdown.tsx` (probe instrumentation reverted) |
| **22:04:03** | **SendMessage — the escalation containing the disputed claim** |
| 22:09:02 | Edit adding `sseActiveRef` — **5 minutes AFTER the escalation** |
| 22:09:14 | Edit adding the guard inside the `setTimeout` |

The `git status` at 22:02:51 — 72 seconds before the escalation was sent — is direct,
contemporaneous evidence that `usePipelineDetailPage.ts` was unmodified, and `OpDropdown.tsx`
was reverted 67 seconds before it. **The executor's statement was accurate. The
"already in the working tree" assertion was itself incorrect.** Recording it here so the
record is corrected in the same direction the finding was raised: one of the three alleged
false statements was not false.

### F2 — **Confirmed as a real reporting defect, already corrected.**

HEL-991 as originally filed asserted HEL-972's fix "is fixed and merged". Nothing was
merged — no push, no PR, no evaluation, no final gate. I read HEL-991's current body via
Linear: it now reads *"That fix is written and committed on HEL-972's branch, but is **NOT
merged** — as of this ticket's filing it has not passed evaluation or the final gate and no
PR has been opened."* (`updatedAt` 2026-09-05T22:39:50Z, the orchestrator's correction).
**The defect was real; the correction is in place.** No further action needed beyond keeping
it in the record: a downstream ticket that mis-states the status of its sibling can send a
future reader to a merge that never happened.

Net on accuracy: one of the two carried findings (F2) holds; the other (F1) does not, and
the executor is owed that correction.

---

## Phase 1: Spec Review — **FAIL**

Against the rescoped goal:

| Ticket AC | Verdict |
|---|---|
| AC1 — un-quarantine + passes repeatedly | **PASS** (see judgment below) |
| AC2 — probe-confirmed, not inferred | **PASS** |
| AC3 — `roots: [{ sourceId }]` fixture correct | **PASS** |
| AC4 — spec delta matches what shipped | **FAIL** |
| AC5 — HEL-962 / HEL-964 untouched | **PASS** |

**AC1 — un-quarantined and "passes repeatedly": PASS, stated without rounding up.**
The `testIgnore` entry is gone (spot-check confirms the removed 15 lines are exactly that
entry plus its rationale comment; `retries: 0` and `fullyParallel: false` intact at
`playwright.config.ts:39-40`). My own measurement is **59/60 = 98.3%**, with an independently
measured control arm showing the pre-fix rate was 10% target-signature. I judge this as
satisfying "passes repeatedly": the guard is back in service, the improvement is real and
reproduced by me rather than accepted on report, and 1.7% is at or below the ambient rate of
specs that already live in the suite. **It is explicitly not zero**, and I am not calling it
"fixed" — a ~1.7% residual will still red a PR roughly one run in sixty. That honest residual
belongs in the spec text (CR1) and in a follow-up ticket (CR3), but it does not by itself
make this change a FAIL.

**AC2 — PASS.** The root cause is probe-confirmed to the standard `systematic-debugging`
demands: D2 isolated the single variable (dispatch disabled alone → 0/20 vs 4/20), D3
instrumented the mechanism with a MutationObserver and *refuted* the ticket's own hypothesis
rather than confirming a convenient one. My E2 control arm independently reproduces the D2
direction. This is unusually good probe work and should be said plainly.

**AC3 — PASS.** Verified against the live schema: `schemas/pipelines/create-pipeline-request.schema.json`
has `required: ["name", "roots"]`, with `roots[].sourceId` as the field. The old scalar has no
alias in the required set. The fixture change is correct and was genuinely blocking (20/20
setup 400s before it).

**AC5 — PASS.** No `hel908-*` file appears in `git diff main...HEAD`. Both quarantine
entries survive in `playwright.config.ts` — `"**/hel908-tail-attach.spec.ts"` (line 18,
HEL-962) and `"**/hel908-full-flow.spec.ts"` (line 36, HEL-964). Neither was un-quarantined,
neither was fixed. The report-only obligation on HEL-962 is discharged in
`probe-findings.md` ("not touched, not re-run under this fix specifically", with reasoning).

**AC4 — FAIL. The spec delta was written for the refuted DOM-detach framing and now
materially overclaims.** This is the real risk the rescope created, and it landed. See CR1.

Other Phase-1 checks: all 25 task items in `tasks.md` are marked `[x]` with none outstanding,
and they match what was implemented. No scope creep — the diff is the guard, its test, the
fixture repair, and the un-quarantine, all called out in `files-modified.md`. The fixture
repair is out-of-ticket-scope strictly speaking but was a hard prerequisite to measuring
anything, and it is disclosed rather than smuggled; I do not count it against scope.

## Phase 2: Code Review — **FAIL**

The gates all pass (E4). Standards read first: `CONTRIBUTING.md` and `DESIGN.md`. No
`[mechanical]` design-standard violations — the diff touches no markup, styling, tokens or
shared components. No inline FQNs, no dead code, no `any`, no leftover TODO/FIXME, no
security surface. Comment density and the "explain *why*" convention are honored well.

**The blocking issue is behavioral, and the gates cannot see it.**

`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:289` — the guard `return`s
out of the `setTimeout` callback, and the effect's dependency array is
`[id, stepsFingerprint, dispatch]` (line 294, with an `exhaustive-deps` disable). Nothing
re-schedules. **A suppressed analyze is dropped permanently, not deferred.** There are two
drop paths and both are reachable in ordinary use:

1. **`sseActiveRef.current`** — a step edited while a run is in flight never gets re-analyzed.
   The analyze panel keeps showing pre-edit results until the *next* step edit or a remount.
2. **`analyzeStatusRef.current === "loading"`** — worse, and it does not involve a run at all.
   Two step edits inside one `/analyze` round trip: the second edit's analyze is dropped
   because the *first* one is still loading. But the in-flight analyze was dispatched
   *before* the second edit, so its result describes the **old** step list by construction.
   The user is left looking at a stale-and-wrong schema with no pending request to correct it.

The inline justification is also **factually wrong on a checkable point**:

> `// run's own response (and/or its SSE terminal event) already carries fresher schema/row`
> `// data than a concurrent /analyze call would.`

`state.analyzeResult` is written in exactly one place — `analyzePipeline.fulfilled` at
`frontend/src/features/pipelines/state/pipelinesSlice.ts:533`. A run does **not** populate
`analyzeResult`. The claim that the run's response supersedes the skipped analyze does not
hold for the state the skipped dispatch actually feeds. Under this repo's own standard, a
confidently-stated comment that a reader can disprove in one grep is worse than no comment.

No test covers either drop path — the new test asserts only that the dispatch *doesn't*
happen, never that it *eventually does*. That asymmetry is exactly how a suppression fix
turns into a silent staleness bug.

Everything else in Phase 2 is clean: the `xRef.current = x` render-phase pattern matches
three pre-existing uses in the same file (`stepsRef` at :136, `allOutputsRef` at :412), so
it is consistent rather than novel; the new test holds the run promise open deliberately and
settles it to avoid leaking a pending `act()` into the next test, which is careful work.

## Phase 3: UI Review — **PASS**

Servers started via `scripts/concertino/start-servers.sh` (both already healthy, reused).

- Happy path end-to-end: pipeline detail page loads, **Dry run** completes and reaches
  `aria-label="Run status: succeeded"` with a preview rendered.
- Op picker: clicking **Branch** opens the menu with 21 `role="menuitem"` entries, each with
  an accessible name and `tabIndex=0` (keyboard reachable); `Escape` dismisses it.
- Feature reachable from the pipelines list entry point.
- Breakpoints 1440 / 1100 / 768 / 360: no horizontal overflow
  (`scrollWidth === clientWidth` at every width).
- Console: one error, `404` on `GET /api/pipelines/:id/schedule`. This is the documented
  "no schedule configured" case (the hook models it as `null` once fetched-and-absent) and is
  **pre-existing and unrelated** to this diff. Noted, not charged.
- The 60-iteration e2e run above is itself substantial unhappy-path coverage of this exact
  page.

## Overall: **FAIL**

To be unambiguous about what this verdict is and is not: **the fix itself is sound and I
verified it works.** The probe discipline was excellent, the executor's numbers survived
independent re-measurement, the RED test is genuinely red, and every gate passes. The FAIL is
for two specific, cheap-to-fix defects — a spec delta that describes a refuted mechanism, and
a suppression that never resumes. Neither requires redoing the investigation.

## Change Requests

1. **Rewrite `openspec/changes/fix-opdropdown-anchor-detach/specs/pipeline-op-picker-stability/spec.md`
   to describe what shipped.** As written it is a spec for the refuted DOM-detach mechanism and
   nothing in the diff implements or verifies it:
   - **Delete** the requirement *"The open op picker survives ancestor re-renders"* and its
     three scenarios. `OpDropdown.tsx` is untouched; the MutationObserver probe observed zero
     node-removal events. Asserting the menu node "SHALL NOT be unmounted, removed and
     re-inserted" is an unverified guarantee this change never made.
   - **Delete** the requirement *"The open picker holds a stable screen position"* and its two
     scenarios. Its own text says it "may be revised … once the probe has reported" — the probe
     has reported and refuted the premise, so revise it: delete it here and let HEL-991 own the
     picker's stability contract once that mechanism is actually observed.
   - **Keep** *"The lanes-rejoin end-to-end guard is in service"*, but fix its second scenario.
     `THEN every iteration passes` is contradicted by the shipped, measured behavior (1/60 by
     my run, 3/60 by the executor's). Restate it against the honest bar, e.g. *"the spec passes
     across repeated runs, with the debounced-analyze contention signature
     (`Run status: succeeded` timeout) reduced to a measured residual well below the pre-fix
     rate"*, and record the measured numbers. Do not ship a spec requirement the implementation
     is known to violate.
   - Consider renaming the capability from `pipeline-op-picker-stability` (it no longer
     describes the shipped guarantee) — or leave the id and fix the `## Purpose` text, which
     still describes menu-click stability rather than analyze/run contention.

2. **Make the suppressed analyze resume instead of being dropped**
   (`frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts:289-294`). Replace the bare
   `return` with a deferral: set a `pendingAnalyzeRef.current = true` when the guard fires, add
   `sseActive` and `analyzeStatus` to the effect's dependency array so the effect re-runs when
   the guard clears, and dispatch the deferred analyze then. That preserves the entire
   contention benefit (nothing is dispatched *while* a run is in flight) without leaving
   `state.analyzeResult` stale — and the `analyzeStatus === "loading"` case wrong — until the
   user happens to edit another step.
   Add a unit test in `PipelineDetailPage.test.tsx` that is the mirror of the new one: edit a
   step while a run is in flight, resolve the run, and assert `analyzePipeline` **is** dispatched
   exactly once afterwards. Re-run the N=60 e2e loop after this change — the deferral must not
   reintroduce the contention.

3. **Correct the false justification comment**
   (`usePipelineDetailPage.ts:285-287`). "the run's own response (and/or its SSE terminal event)
   already carries fresher schema/row data" is not true of `state.analyzeResult`, which is
   written only by `analyzePipeline.fulfilled` (`pipelinesSlice.ts:533`). Either state the real
   reason (analyze is deliberately deferred, per CR2, to avoid competing with the run) or drop
   the claim. Keep the D2/D3 evidence citation — that part is accurate and valuable.

4. **File a follow-up ticket for the measured residual.** `probe-findings.md` already names the
   likely next suspect (another concurrent request such as `previewOutput` refreshes) and states
   the residual honestly. Turn that paragraph into a real ticket rather than leaving it as prose
   in an archived change, so the ~1.7% is owned by someone. A deferral must name a real task.

## Non-blocking Suggestions

- `usePipelineDetailPage.ts` is now **1156 lines**. `CONTRIBUTING.md:24` asks that a file
  crossing ~400 lines get a split proposed in the PR description rather than grown further.
  This change adds only ~29 lines to a long-standing offender, so it is not a fair charge
  against this ticket — but the PR description is the right place to note it, and the
  run/analyze-orchestration block is a natural extraction candidate.
- `probe-findings.md` flags that `submitPipelineRun.fulfilled` sets `runStatus = "succeeded"`
  for dry runs too, which is why the flaky assertion can pass at all. Correctly left alone here
  and correctly *not* fixed silently. It deserves its own ticket alongside CR4 — the e2e is
  currently asserting on a label that is arguably mislabeled.
- The change directory name `fix-opdropdown-anchor-detach` now describes a refuted mechanism.
  Renaming mid-flight is not worth the churn, but the archived change will read oddly; a line at
  the top of `proposal.md` pointing at the rescope would help a future reader. `proposal.md`'s
  "What Changes" and "Capabilities" sections also still lead with the anchor-churn framing and
  would benefit from the same treatment as CR1.
