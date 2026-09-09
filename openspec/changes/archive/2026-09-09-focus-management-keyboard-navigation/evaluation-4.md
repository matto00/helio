## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed `f8de031b` on top of `207c33f7` (base `7b872db9`). Diff since my cycle-3 review is four
files: the CR1 timing fix, one comment block in `focusPresenceProbe.ts`, my own committed
evaluation-3.md, and the `files-modified.md` writeup. No `frontend/src` runtime or style code
changed — I confirmed that from the diff, not from the handoff.

§4/§5 (AC1 dialog lifecycle, AC3 keyboard flows) remain de-scoped by the cycle-3 orchestrator
decision and are not evaluated as gaps.

**Cycle-3's single blocking change request is closed, correctly and with the evidence it asked
for. I found no new blocking defect.**

### Phase 1: Spec Review — PASS

- CR1's deliverable was behavioural, not just textual, and the writeup matches what the code and
  the runs actually do. `files-modified.md`'s "Cycle 6" section states the root cause, the
  one-line fix, and the 5-run table without overclaiming — it explicitly credits the diagnosis to
  the evaluator rather than presenting it as independently re-derived, which is the honest framing.
- The absolute-contrast-vs-delta limitation is recorded as *documentation, not a fix*, exactly as
  my non-blocking suggestion 1 framed it, including the measured-zero-exposure figures and the
  fact that it is inherited from the old precedence rule rather than introduced by the any-channel
  change. No new claim of a fix is made.
- No AC is claimed that is not met. The scope amendment continues to be carried in `proposal.md`
  and `files-modified.md`.

### Phase 2: Code Review — PASS

Gates, all re-run by me in this worktree at `f8de031b` (not taken from the executor's or the
orchestrator's report):

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, zero-warnings policy) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm run check:e2e-types` | PASS |
| `npm test` | PASS — 3143 frontend (299 suites) + 248 helio-mcp (25 suites) |
| `e2e/focus-presence-guard.spec.ts` | PASS — 196 elements, 8 views, 99337ms, 0 failures |
| `e2e/hel520-focus-presence-guard.regression.spec.ts` | PASS — **3/3 of my own fresh runs** |
| `git status --short` after every e2e run | clean, every time |

Servers: verified belonging to THIS worktree before trusting any reading — `ss` → pids 3732398
(backend/8859) and 3732729 (frontend/5952), `readlink /proc/<pid>/cwd` both resolving under
`.../HEL-520/`. Health 200 on both. No bare `npm`/`vite`/`npx playwright` invocation: absolute
binary path (`/home/matt/Development/helio/node_modules/.bin/playwright`), explicit
`DEV_PORT=5952 BACKEND_PORT=8859`, `-c` naming this worktree's config, and `HEL520_REGRESSION=1`
for the opt-in harness.

#### CR1 — closed

`hel520-focus-presence-guard.regression.spec.ts:101` is now `waitForTimeout(400)`, and the comment
gives the derivation (theme.css's 160ms `--app-transition`, `inputs.css` transitioning
`border-color` on it, 200ms being only 1.25x headroom) plus the observed failure signature, rather
than an unexplained constant. It now matches the 400ms post-focus wait four lines below and the
steady-state guard. That is exactly the requested change, in the requested place.

My own three fresh runs, three independent processes:

```
[Case A][baseline] verdict=pass          ratio=4.9596025224053735   (x3)
[Case A][mutated]  verdict=no-indicator  "no outline/box-shadow/border/background channel
                                          changed under forced focus-visible"   (x3)
[Case A][reverted] verdict=pass          ratio=4.9596025224053735   (x3)
[Case B][baseline] verdict=pass          ratio=5.1089714871982395   (x3)
[Case B][mutated]  verdict=clipped       "outline: clipped on X by ancestor box [302.0,553.3]" (x3)
[Case B][reverted] verdict=pass          ratio=5.1089714871982395   (x3)
```

I also independently read all five of the orchestrator's raw run outputs (`/tmp/c6-run1..5.output`)
and confirm its reading is accurate: 5/5 "2 passed", 5/5 Case A mutated `no-indicator`, identical
ratios throughout. Combined with mine that is **8/8 consecutive green runs**, and the failure
signature I required be eliminated — `verdict=fail ratio=1.440754096742417` at 2-in-5 — occurred
zero times in eight.

Crucially, this is `no-indicator` *for the stated reason*, not merely "not failing": the verdict
comes from the early return that fires before any candidate is collected, which is what task 7.4
and design.md D6a actually require.

#### Did closing CR1 break or weaken anything? Checked, no.

This was the real question for this cycle, since a longer settle is exactly the kind of fix that
can pass by making the probe blind rather than by making it accurate. Three checks:

1. **The 400ms wait has not made everything read as "unchanged".** If it had, the baseline and
   reverted arms would also report `no-indicator`. They do not — both report a genuine
   `pass` at `ratio=4.9596`, the same real border-channel ratio measured by hand in cycle 2 and
   observed in cycle 3. The wait discriminates; it does not suppress.
2. **Case B is unaffected** — still `clipped` with the per-channel `outline:` prefix on every run,
   so the defect this ticket originally fixed is still provably caught.
3. **The full live sweep is unaffected** — 196 elements across 8 views, 0 failures, ~99s, matching
   cycle 3 exactly. `measureLive` is regression-harness-only and does not touch the sweep's path,
   which the sweep's identical result confirms empirically rather than by inspection.

The added latency is 200ms x 3 `measureLive` calls per case against a 60s per-test budget; observed
runtimes are 17–19s, unchanged from cycle 3. No timeout risk.

#### The `focusPresenceProbe.ts` comment — accurate

The added block correctly states the limitation (absolute channel contrast vs. magnitude of change
from rest), correctly attributes it as inherited from the old precedence rule's background
fallback rather than introduced here, and carries the measured distribution (outline 47,
box-shadow 11, border 3, background 2, none 0; zero elements rescued only by a border/background
candidate). Every figure matches what I measured in cycle 3. It is labelled a named, accepted gap
rather than dressed up as handled. Comment-only; no behaviour change, and `npm test` + both e2e
specs confirm that.

The one item from my cycle-3 suggestion list not picked up is the second half of suggestion 1 —
that a clipped outline can now be rescued by an unclipped border/box-shadow candidate. It remains
worth a sentence in the same comment. Non-blocking, restated below.

### Phase 3: UI Review — PASS

Triggers matched (`e2e/**` supporting `frontend/**`; no `frontend/src` change this cycle). Rendered
evidence: the 196-element/8-view sweep and three regression-harness runs, all against servers
cwd-verified to this worktree. Cycle 1's `PipelineDetailHeader.css` offset fix remains verified by
Case B on every run. No console errors surfaced; `git status --short` clean after every single
run, so the Case B source mutation reverted cleanly each time. No new UI surface exists to review
this cycle. Subjective visual judgement remains the skeptic's.

### Overall: PASS

### Change Requests

None.

### Per-AC verdict (independent), for the delivery report

| AC | Verdict | Already satisfied on base `7b872db9`? | What this change actually delivers |
| --- | --- | --- | --- |
| **AC1** — dialogs trap focus, restore to trigger, respond to Escape/Enter | **Satisfied in behaviour on base; rendered verification de-scoped** | Yes — shared `Modal` implements trap (HEL-716), previously-focused restore (HEL-590) and Escape via the native `cancel` event, for its 17 consumers | Nothing. The rendered-measurement half (tasks §4: enumerate by opening, `MobileNavSheet`, `Select`, the unmounted-trigger restore question) was dropped mid-execution to a follow-up ticket, with its capability delta correctly not shipped here |
| **AC2** — no interactive element reachable without a visible focus indicator | **Delivered by this change** | No. Base had only SOURCE PARSES (`focusRingTokenGuard.css.test.ts`'s outline guard and its HEL-1050 border/box-shadow guard); nothing established that a declared indicator actually paints, is unclipped, or clears 3:1 against the real composited backdrop | The whole AC2 spine: `focusPresenceProbe.ts` + `forceFocusVisible.ts` + `focus-presence-guard.spec.ts` (196 elements, 8 views, both themes, at the real 3:1 non-text floor), the `stateContrast.mjs` extension and its selftest, the coverage-partition floor, one real rendered defect found and fixed (`PipelineDetailHeader.css`'s clipped add-source ring), and the demonstrated-RED harness proving both the no-indicator and clipped branches |
| **AC3** — four named flows completable by keyboard, verified in the app | **Not delivered; de-scoped** | No — and it was unverified on base too (no test drove the flows by keyboard) | Nothing. Dropped with AC1 to a follow-up ticket; its delta is likewise not shipped here |
| **AC4** — Jest/RTL coverage for focus trap + restore on shared `Modal` and one consuming surface | **Delivered by this change (the half that was missing)** | Partly — the trap half was already covered by three cases in `Modal.test.tsx`, and `ShareDialogFocusRestore.test.tsx` already served as the consuming surface. The restore half had **zero** assertions | The restore half: two new cases in `Modal.test.tsx` — restore to the pre-open focused element, and no-throw when that element has been removed from the document |

>  **SUPERSEDED ON THE AC2 AND AC4 ROWS — see the "Superseding note" at the end of this file before
>  relying on the table above.** AC2's claim is narrowed to the measured population (the sweep opens no
>  dialog, popover, menu, or `/login`); AC4's restore cases were later proven vacuous and fixed in
>  `3f636ae6`.

Net: of the four ACs, this change delivers **AC2 in full** and **the missing half of AC4**; AC1 was
already met in behaviour on base and AC3 was never started, both formally split to follow-ups.

### Non-blocking Suggestions

(Carried forward; none is newly blocking, and none should be treated as such.)

- Add one sentence to the same `focusPresenceProbe.ts` comment noting that a clipped outline can
  now be rescued by an unclipped border/box-shadow candidate that clears the floor. Intended
  behaviour, but a real difference from the precedence rule that a reader should not have to infer.
- The two stale "occlusion sampling" comments in `e2e/focus-presence-guard.spec.ts` (~lines 258,
  263) still describe code that no longer exists. Keep the 400ms transition-wait rationale, drop
  the occlusion framing.
- `assertRouteFullyCovered`'s `coveredIds.add` placement and the stamp-filter visibility predicate
  mismatch remain unaddressed. Neither has fired in any run. **Recommendation: these three items
  and the one above are follow-up-ticket material, not rework for this change** — they are
  comment/robustness polish in test-support code with no observed effect across four cycles.
- `tasks.md` §4/§5 items are left unchecked with no inline note explaining the de-scope; the
  amendment lives only in `proposal.md` and `files-modified.md`. A one-line pointer at the head of
  each section would stop a future reader reading them as unfinished work. Documentation only.
- Environment notes for the orchestrator, not defects: this worktree still has no root
  `node_modules` and resolves through the parent repo's, and the dev servers have died between
  every cycle (they were up and correctly-scoped this time).

---

## Superseding note (orchestrator, 2026-09-09, added after skeptic-final-1.md)

**The per-AC table above and the "delivers AC2 in full" line at the end of it are SUPERSEDED on the AC2 row.**
This note is appended rather than editing the table, because rewriting a past reviewer's report in place
would destroy the record of what was actually concluded when. But a reader who stops at the table gets the
wrong answer, so read this first.

`skeptic-final-1.md` established that this change's AC2 sweep enumerates exactly four **authenticated
routes** (`/`, `/sources`, `/pipelines/:id`, `/settings`) x 2 themes and opens **no dialog, popover, menu, or
the login page**. Several of the very sites the ticket singled out for closest measurement are therefore
never rendered and never measured: `AccentPicker` (which only renders inside a popover), `auth.css:107` (only
on `/login`), `PanelGrid`'s panel-title input, `DashboardList`'s rename input, `PipelineDetailPage`'s
schedule/output inputs, and the `inputs.css:60-64` aria-invalid variant.

**The accurate AC2 claim, which is what the delivery report uses:**

> AC2 — met for the measured population: 196 focusable elements across 4 authenticated routes x 2 themes,
> uncapped, by rendered measurement at the 3:1 non-text floor, with one real defect found and fixed and zero
> unnamed failures. The surfaces the seeded routes never render are named in `files-modified.md` and are
> owned by **HEL-1063**.

"AC2 in full" is withdrawn. The AC is worded universally; the delivery is not universal, and `design.md` D2b
pre-committed to exactly this honesty ("the view list is therefore itself part of the claim").

**The AC4 row is also narrower than it reads.** It records the restore half as delivered; `skeptic-final-1.md`
then proved by mutation that both new cases were VACUOUS — deleting `Modal.tsx`'s
`previouslyFocusedRef.current?.focus();` left the whole file green, because the `showModal` stub never moved
focus. That was fixed in commit `3f636ae6`, and the fix is mutation-proven (RED for the stated reason, then
GREEN at 119/119, re-verified independently at the final gate). **AC4 is met — but as of `3f636ae6`, not as
of the commit this report evaluated.**

Nothing else in this report is superseded; its PASS on the code as it stood remains accurate.
