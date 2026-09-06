# Evaluation Report — Cycle 3 (evaluation-3.md)

Commit under review: `a720a4ec` ("Fix unbounded /analyze redispatch loop from cycle 2's own fix").

**Overall: PASS.** The cycle-2 loop is dead, not relocated — I verified that against the specific
adjacent entry points that would have caught a fix of the same shape at a different door, and they
are clean. Nothing here rises to blocking. Three residuals are recorded below as findings, clearly
labelled non-blocking; none of them is a reason to hold this change.

Every number below is my own, re-derived. Where I could not verify something directly, I say so
rather than inferring it.

---

## 1. Is the loop actually dead, or relocated? — **Dead. Verified at three entry points.**

The fix is exactly the remedy I proposed and pre-verified in cycle 2 — `pendingAnalyzeRef` is set
only when `lastAnalyzedFingerprintRef.current !== stepsFingerprint`
(`usePipelineDetailPage.ts:307-320`).

**Probe A — my cycle-2 probe, re-run verbatim against `a720a4ec`** (every `/analyze` mocked at
600ms; one edit; then five seconds of complete idleness):

| Hook version | dispatches after 1 edit + 5s idle |
|---|---|
| `b992e937` (cycle 1) | 1 |
| `698961e1` (cycle 2, buggy) | **6 and climbing** |
| **`a720a4ec` (cycle 3)** | **1** |

**Probe B — a genuinely new edit arriving mid-flight** (the case a fingerprint-based bail-out is
most likely to over-suppress). Slow 600ms analyze; edit 1 dispatches; edit 2 fires while edit 1's
analyze is still in flight; then five seconds idle:

```
EVALPROBE2 dispatches for 2 edits (1 mid-flight): 2
```

Exactly two — one per edit. **The deferral resumes exactly once: not zero (cycle 1's drop bug),
not unbounded (cycle 2's loop).** This is the case I most expected a too-aggressive fix to break,
and it does not.

**Probe C — the `sseActive` arm, which my cycle-2 probe did not cover.** Run held in flight, slow
analyze, a step edit made during the run, then five seconds idle:

```
EVALPROBE3 dispatches while run in flight (expect 0): 0
EVALPROBE3 total dispatches after run settles:       0
```

Zero during the run — correctly deferred, with **no loop on this arm**. The unbounded behavior
cannot be reached through `sseActive`, and the reason is structural rather than incidental:
`sseActive` is set true on submit and cleared only by the SSE `onTerminal` handler
(`usePipelineDetailPage.ts:187`) or the submit-failure `catch`. It never toggles as a side effect
of the effect's own dispatch, so it cannot self-trigger the way `analyzeStatus` could. The
cycle-2 defect's shape genuinely does not exist here.

(The trailing `0` after the run settles is a jsdom harness limitation, not a hook defect —
`sseActive` clears only via a real SSE terminal event, for which this harness has no transport.
The executor documented this same constraint in cycle 2. It does raise one narrow production
residual, recorded as Finding 1 below.)

All probe edits were removed; `git diff HEAD` confirmed empty afterwards.

## 2. Is the regression test genuinely RED pre-fix? — **Yes, re-derived by mutation.**

I reverted only the hook to cycle-2's `698961e1` and ran the executor's new test unchanged:

```
● a single edit's analyze settles once and does not redispatch indefinitely while idle
    Expected: 2
    Received: 7
Tests: 1 failed
```

**RED at 7, exactly as reported**, then green on `a720a4ec`. This is a mutation test in the strict
sense — the test file was untouched and only the fix was reverted — so it confirms the test fails
if and only if the loop returns. It is a real guard, not a green-only assertion, and it is written
against the slow-mock condition that made this defect invisible to every other test in the file.

## 3. The voluntary disclosure about the reorder mock — **the right call, and I can prove the test is not blunted.**

This is the finding I most wanted to get right, because a rationalised workaround and a correct
test-setup fix do look alike from the outside. Two independent lines of evidence, both decisive:

**(a) The diagnosis is correct.** `handleReorderSteps` (`usePipelineDetailPage.ts:901-942`) does
`setSteps(newOrder)` optimistically, awaits `reorderPipelineSteps(...)`, and on failure runs
`catch { setSteps(previousOrder); }`. With `reorderPipelineStepsMock` unmocked, the call throws,
the optimistic order is reverted, and that revert is a **second, genuine `stepsFingerprint`
change** — an extra edit the hook is *supposed* to analyze. The executor's account of its own
authoring bug is accurate, and mocking it matches every sibling test in the file (both cycle-1's
and cycle-2's tests set it in the same way).

**(b) The mock demonstrably does not blunt the test.** This is the part that settles it. **My own
cycle-2 probe already included `reorderPipelineStepsMock.mockResolvedValue([])`** and still
measured 6-and-climbing against the buggy code — and the RED re-derivation in section 2 above,
run against the executor's *final* test with that mock in place, reported 7. **A mock that
concealed the loop could not produce a RED of 7.** The test still fails when the loop is present.

So: a real authoring bug, correctly diagnosed, fixed at the correct layer, with the resulting test
independently confirmed to retain its detecting power. Correcting the fixture rather than the hook
was right, because the extra dispatch it produced was a legitimate one.

## 4. Does the spec now constrain both directions? — **Yes. I checked both failure modes against the text.**

Two scenarios were added to the contention requirement:

- **"A suppressed analyze resumes exactly once when the guard clears"** — requires a dispatch for
  the suppressed edit's fingerprint. **Cycle 1's silent-drop behavior violates this**: it never
  dispatched at all after the guard cleared. The gap I raised in CR4 is closed.
- **"Dispatching stops once nothing has changed — no unbounded re-dispatch"** — explicitly names
  the precondition, that "a request whose OWN resolution takes longer than the 300ms debounce
  window ... SHALL NOT cause repeated, ever-continuing re-dispatches of an already-analyzed
  fingerprint." **Cycle 2's loop violates this directly and by name.**

Both directions are now constrained, and the termination scenario is specified precisely enough
that it names the >300ms precondition rather than gesturing at "no excessive requests" — which is
what would let this regress again. The spec matches what the diff implements.

## 5. The numbers — **57/60, and the spread is explained. Nothing moved.**

```
npx playwright test e2e/hel912-lanes-rejoin.spec.ts --repeat-each=60 --workers=1
→ 3 failed, 57 passed (6.7m)
```

My raw tally matches the executor's 57/60. But the composition differs from theirs, and it is the
composition that answers your question:

| My run | tally | **target signature** (`Run status: succeeded`) | unrelated layout-pixel flake (`expect(desktopTops[0]).toBe(desktopTops[1])`) |
|---|---|---|---|
| cycle 1 (`b992e937`) | 59/60 | **1** | 0 |
| cycle 2 (`698961e1`) | 59/60 | 0 (its 1 failure was the click-timeout) | 0 |
| cycle 3 (`a720a4ec`) | 57/60 | **1** | **2** |

**The target signature has been rock-stable at 0-1 per 60 (≈1.7%) across all three of my
independent runs.** The 59 → 59 → 57 spread is entirely accounted for by the *unrelated,
pre-existing* layout-pixel assertion at `hel912-lanes-rejoin.spec.ts:165`, which happened to fire
twice this time and zero times before. Nothing about this fix moved the number it is responsible
for.

(The executor reported the inverse split — 2 target, 1 layout. Either way both components are
small and stable; the difference between their split and mine is itself noise at this N.)

## 6. The HEL-991 note — **hedged correctly in `probe-findings.md`, but its framing overstates the evidence. Non-blocking; correction recommended.**

The claim in `probe-findings.md` is properly hedged in its conclusion — "suggestive, not
conclusive (N=1 vs N=0 is not itself decisive)" — and it does not read as "resolved". That part
is right, and it is what you asked me to check.

But one sentence in it is not accurate: *"one of its only **two** known live occurrences coincided
with a request-loop defect."* There are at least **six** known occurrences, and four of them
cannot possibly be explained by the loop:

- **#555, #562, #563, #564** — four CI failures, all on commits that predate this branch entirely
  and therefore contain no loop.
- One local `hel968` occurrence during cycle 1, measured against `b992e937` — **also loop-free**
  (the loop was introduced in cycle 2 and existed only there).
- My one `hel912` occurrence in cycle 2 — the only one that coincides with the loop.

HEL-991's own record now states that CI reproduces this at roughly 50% while local reproduces at
~1.7%, on commits that never contained the loop. That comprehensively rules out the loop as a
general explanation. At most it may explain the single `hel912` occurrence, which is a much
narrower claim than the writeup's "may be far cheaper to reproduce/fix than currently scoped."

**A limitation of my own check, stated plainly:** I could not read the comment actually posted to
HEL-991 — the Linear tooling available to me returns issue bodies but not comments — so I verified
the framing in `probe-findings.md`, which is the source the comment was written from, and not the
comment text itself. Someone should read the posted comment and, if it carries the "only two known
occurrences" framing, correct it. **Also worth knowing: HEL-991 was closed as Done at
2026-09-06T00:04Z via PR #566, which quarantines `hel968-multi-root-editor-flow`** — so this note
landed on a ticket that has since been closed by a different route, and may not be read at all.

This is a note on a sibling ticket, not on the deliverable. It does not affect the verdict.

---

## Gates (my own fresh run)

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm test` (frontend) | PASS — 256 suites, **2649 tests** (+1: the new regression test) |
| `npm test` (helio-mcp) | PASS — 24 suites, 238 tests |
| `npm --prefix frontend run build` | PASS |

No `backend/**` changes; `sbt test` not applicable.

**HEL-962 / HEL-964 untouched — confirmed.** Zero `hel908` files in `git diff main...HEAD --name-only`,
and both quarantine entries intact in `playwright.config.ts`: `"**/hel908-tail-attach.spec.ts"`
(line 47) and `"**/hel908-full-flow.spec.ts"` (line 65). The full changed-file list across the
whole branch is three code/test files, `playwright.config.ts`, and planning artifacts — no scope
creep at any point across three cycles.

## Phase 1: Spec Review — **PASS**

All five ticket ACs hold. AC1: un-quarantined, and passing repeatedly at a target-signature rate
of ~1.7% measured three independent times. AC2: probe-confirmed throughout — this ticket's
investigation refuted its own premise rather than confirming a convenient one. AC3: `roots` fixture
correct. AC4: the spec delta now matches what shipped and constrains both directions. AC5: HEL-962
and HEL-964 untouched. Tasks all marked done and matching. `probe-findings.md` is an accurate
account of the work, with the one framing overstatement noted in section 6.

## Phase 2: Code Review — **PASS**

Gates green. The fix is minimal, correct, and sits behind a comment that explains the invariant
(and names the failure mode it prevents) rather than restating the code. The regression test is
genuinely red pre-fix and exercises the slow-analyze condition that every other test in the file
misses. No mechanical `CONTRIBUTING.md` or `DESIGN.md` violations. No dead code, no untyped escape
hatches, no security surface.

## Phase 3: UI Review — **N/A**

No UI-affecting surface changed relative to cycle 1's passing Phase 3 — this diff is a hook
guard, a test, and planning artifacts, with no rendering, markup or styling change.

## Overall: **PASS**

Three cycles in, this change is in good shape. The fix is small, the mechanism behind it is
probe-confirmed rather than inferred, both of its own regressions were found and fixed with real
red-first guards, and the spec now constrains the behavior in both directions. The executor's
cycle-3 writeup was accurate on every point I could check independently, including the one it
volunteered against its own interest.

## Findings (non-blocking — recorded, not blocking)

1. **A deferred analyze depends on `sseActive` clearing, and only the SSE terminal event clears
   it.** If a run's SSE stream drops without delivering a terminal event, `sseActive` remains true
   and a deferred analyze never resumes — cycle 1's drop behavior, in a narrow failure mode. I am
   explicitly **not** blocking on this: a stuck `sseActive` already leaves the page's run UI in a
   broken state independent of this change, so the incremental harm is small, and the jsdom harness
   cannot test it. Worth a line in HEL-992 or its own small ticket, not a fourth cycle.
2. **The `hel912-lanes-rejoin.spec.ts:165` layout-pixel assertion is an unowned flake.** It fired
   2/60 in my run (off by 1-4px on a side-by-side layout check) and has appeared across cycles. It
   is pre-existing and unrelated to this ticket, but **HEL-992 is scoped only to the
   `Run status: succeeded` signature**, so nothing currently owns it. It will keep reding PRs at a
   few percent. Recommend adding it to HEL-992's scope or filing it separately.
3. **The HEL-991 note's "only two known live occurrences" framing** understates the prior
   occurrences that pre-date the loop, and should be corrected (section 6). Low cost, and worth
   doing because HEL-991's investigation could otherwise be pointed at a lead that its own CI data
   already rules out.

## Recommendation to the product owner

Ship it. The three cycles were spent well: cycle 1 caught a spec that described a refuted
mechanism and a suppression that silently dropped work, cycle 2 caught a fix that had traded that
drop for an unbounded request loop, and cycle 3 closed both with guards that fail when the defects
return. The remaining residuals are pre-existing, owned or ownable, and none of them is worth a
fourth cycle or an escalation.
