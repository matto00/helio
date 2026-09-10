## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth.** `git log --oneline 7b872db9..HEAD` (6 commits, matches the handoff),
`git diff --stat 7b872db9...HEAD` (25 files). `git status --short` at start and after every
probe: only the untracked `evaluation-4.md`. Servers confirmed as THIS worktree's before any
rendered reading: `ss -ltnp` → java 3732398:8859, node 3732729:5952; `readlink /proc/<pid>/cwd`
→ `.../HEL-520/backend` and `.../HEL-520/frontend`. All browser readings re-checked against
`location.port === "5952"`.

**AC4 restore coverage — MUTATION-TESTED, and it is VACUOUS.** I deleted the single line
`previouslyFocusedRef.current?.focus();` from `frontend/src/shared/ui/Modal.tsx:116` and ran
`npx jest --config jest.config.cjs src/shared/ui/Modal.test.tsx`. Result, reproduced on two
consecutive runs with the mutation verified present in the file (`grep -n previouslyFocusedRef`
showed line 116 collapsed to the `= null` assignment): **23 passed, 23 total.** Restore removed
entirely; every test still green, including both new cases. Root cause probed and confirmed:
`Modal.test.tsx`'s own `beforeEach` stubs
`HTMLDialogElement.prototype.showModal = jest.fn(function () { this.setAttribute("open",""); })`,
which never moves focus. So while the modal is "open" `document.activeElement` is still the
trigger, and `expect(document.activeElement).toBe(trigger)` after close is true by precondition.
File reverted from backup; tree clean.

**AC2 population — verified by opening surfaces, not by grep.** `e2e/focus-presence-guard.spec.ts:184`
enumerates exactly `["/", "/sources", "/pipelines/:id", "/settings"]` x 2 themes. No modal, popover,
menu, or the login page is ever opened. I opened the dashboard-appearance popover and the user menu
in the running app; `AccentPicker` (`AccentPicker.css:19`, one of the four base-rule unconditional
`outline: none` sites the ticket flags for closest measurement) renders only inside a popover and
returns zero matches on every swept route. `files-modified.md` states this itself: "Task 3's full
11-named-site enumeration was NOT completed by rendering"; `tasks.md` 3.1, 3.2a, 3.2c, 3.4 are
unchecked. Also unchecked and undone: 1.1/1.2/1.3, 2.4, 4.1–4.5, 5.0–5.4, 6.3, 7.3.

**Regression harness — genuinely RED, for the stated reasons (my own run).**
`HEL520_REGRESSION=1 DEV_PORT=5952 BACKEND_PORT=8859 /home/matt/Development/helio/node_modules/.bin/playwright test -c playwright.regression.config.ts e2e/hel520-focus-presence-guard.regression.spec.ts`
→ 2 passed (19.1s):
```
[Case A][baseline] verdict=pass          ratio=4.9596025224053735
[Case A][mutated]  verdict=no-indicator  no outline/box-shadow/border/background channel changed under forced focus-visible
[Case A][reverted] verdict=pass          ratio=4.9596025224053735
[Case B][baseline] verdict=pass          ratio=5.1089714871982395
[Case B][mutated]  verdict=clipped       outline: clipped on X by ancestor box [302.0,553.3]
[Case B][reverted] verdict=pass          ratio=5.1089714871982395
```
`git status --short` clean afterwards — the tracked-source mutation in Case B reverted correctly.
I found no inverted / precondition-guaranteed assertion of the `cells.some(c => c.ratio < 4.5)`
shape in `focus-presence-guard.spec.ts`, `focusPresenceProbe.ts` or the harness; the mutated arms
assert on the verdict's *content* (`toBe("no-indicator")`, `toBe("clipped")` +
`toMatch(/clipped on [XY] by ancestor box/)`), not merely "not pass". CR-B's per-view
non-emptiness floor is real and correctly non-vacuous.

**The one claimed real defect is real, and the fix is right.** Measured live on
`/pipelines/<id>`: `.pipeline-detail-header__add-source-btn` box y 58.5–78.5 (20px), clipping
ancestor `.pipeline-detail-header__group-value` box y 56–81 (25px). At the global `outline-offset: 2px`
the ring spans 54.5–82.5 — clipped at both edges. The shipped `outline-offset: -2px` pulls it
inside the 20x20 box; computed style confirms `outline: rgb(168,129,6) solid 2px; outline-offset: -2px`.

**UI / design judgement (mine).** Element screenshots of the focused button in both themes
(`.playwright-mcp/skeptic-hel520-addsource-dark.png`, `...-light.png`): a clean, unbroken 2px gold
ring, fully inside the control, reading clearly against both the dark and the light header surface,
and consistent with the sibling icon buttons' ring. DESIGN.md §8's documented `-2px` carve-out for
clip-prone flush children is the correct instrument here, not a hand-rolled value. Light/dark parity
holds; the ring token is the shared one, no hardcoded colour. No new component or one-off pattern was
introduced. No console errors on any view I visited. I have no visual objection to the shipped diff.

**Reuse.** `classifyState` was genuinely EXTENDED in place (`stateKind` param, hover path byte-for-byte
preserved), `parseColor`/`compositeStack` are imported unchanged, and `forceFocusVisible` was extracted
into `e2e/support/` and the HEL-866 spec re-pointed at it. That satisfies the HEL-444 precedent. The one
divergence — `readBackdrop` re-implemented in `focusPresenceProbe.ts` rather than extracted from
`state-surface-contrast-guard.spec.ts` — is ~30 lines, documented in place, and not a parallel
mechanism; non-blocking, noted below.

### Verdict: REFUTE

The AC2 measurement spine is real work and the RED harness is honest evidence — but of the two ACs this
change claims to deliver, one (AC4) is proven vacuous by mutation and the other (AC2) is claimed "in full"
on a population that excludes every surface the ticket itself singled out. The de-scoping of AC1/AC3 is
recorded but names no task. This is a completion claim that outruns its evidence.

### Change Requests

1. **`frontend/src/shared/ui/Modal.test.tsx` — the two new restore cases assert nothing.** Verified by
   mutation: deleting `Modal.tsx:116`'s `previouslyFocusedRef.current?.focus();` leaves all 23 tests in the
   file green (reproduced twice). The file's `beforeEach` stub of `HTMLDialogElement.prototype.showModal`
   only sets an `open` attribute, so focus never leaves the trigger and the post-close assertion is true by
   precondition — the exact MISTAKES.md / HEL-1060 shape this ticket's own binding constraint #5 forbids.
   Make the stub move focus the way `showModal()` does (e.g. focus the dialog's first focusable descendant,
   as the trap cases already assume), assert focus is NOT on the trigger while open, then assert restore —
   and record a transcript showing the suite goes RED with `Modal.tsx:116` removed and GREEN with it
   present. The second case ("does not throw" when the trigger is detached) is likewise vacuous under
   optional chaining; either give it a real failure mode or drop it rather than count it as coverage.
   Until this is done, AC4's restore half is not delivered and must not be reported as such.

2. **Stop claiming AC2 "in full"; the sweep's population excludes the surfaces the ticket named.**
   `e2e/focus-presence-guard.spec.ts:184` sweeps 4 authenticated routes and opens no dialog, popover, menu,
   or the login page. `files-modified.md` already admits the 11-site enumeration was not completed by
   rendering, and `tasks.md` 3.1/3.2a/3.2c/3.4 are unchecked. Pick one and make the artifacts consistent:
   either (a) extend the sweep to open the enumerated modal/popover surfaces (ticket binding constraint #4:
   "enumerate modal surfaces by OPENING them") so the named sites — `AccentPicker` in its popover,
   `auth.css:107` on `/login`, `PanelGrid`'s panel-title input, `DashboardList`'s rename input,
   `PipelineDetailPage`'s schedule/output inputs, `inputs.css:60-64`'s aria-invalid variant — are actually
   measured; or (b) narrow the claim everywhere it appears (evaluation-4.md's per-AC table, files-modified.md,
   the delivery report) from "AC2 delivered in full" to the measured claim — "196 focusable elements across 4
   authenticated routes in both themes present unclipped indicators at the 3:1 non-text floor" — and name the
   unmeasured population as an explicit, owned residual under CR3 below.

3. **The AC1/AC3 (and occlusion) deferrals name no real task.** `proposal.md`'s "Scope amendment",
   `files-modified.md`, and the spec delta's occlusion comment all say "follow-up ticket" / "an owned,
   unimplemented follow-up", but a grep of the entire change directory turns up no ticket identifier for any
   of them. AC3 is worded in the ticket as "verified in the app" and is being dropped wholesale; that cannot
   ride on an unnamed intention. File the follow-up tickets (dialog focus lifecycle / keyboard-flow
   operability / rendered occlusion detection), then cite their real IDs in `proposal.md`, `files-modified.md`,
   the spec delta comment, and as a one-line pointer at the head of `tasks.md` §4 and §5 so the unchecked
   boxes are not read as unfinished work in this change.

### Non-blocking notes

- `focusPresenceProbe.ts:164`'s `readBackdrop` duplicates ~30 lines of
  `state-surface-contrast-guard.spec.ts:112`. `forceFocusVisible` was extracted in this very change; the same
  treatment for `readBackdrop` would remove the last parallel copy. Divergence risk is small but real.
- `hel520-focus-presence-guard.regression.spec.ts` step 2's comment says `#email`'s "real baseline verdict is
  'fail' at a specific, known ratio, not 'pass'". Every observed run — the evaluator's six and my one —
  reports `verdict=pass ratio=4.9596`. The comment is stale and misdescribes the harness's own output.
- The two "occlusion sampling" comments in `e2e/focus-presence-guard.spec.ts` (~258, ~263) still describe
  removed code, as evaluation-3/4 already noted.

### Addendum — concurrent uncommitted work observed mid-review

Immediately after I emitted this verdict, `git status --short` in this worktree showed STAGED, UNCOMMITTED
edits that were not present when I established ground truth: `e2e/support/focusPresenceProbe.ts` (comment
only), `files-modified.md` (+32 lines), and `evaluation-4.md` staged. Those edits name **HEL-1062** (dialog
focus lifecycle) and **HEL-1063** (keyboard-only flows + this sweep's unmeasured population) and reword the
AC2 claim to "met-for-the-measured-population". I confirmed HEL-1062 exists in Linear, created
2026-09-09T22:29:41Z — during this review.

Effect on the verdict: **CR3 is materially addressed** by that in-flight work (once committed), and **CR2
appears to be addressed by branch (b)** — both need re-checking at the next HEAD, not at `f8de031b`, which is
what I gated. **CR1 is untouched and remains decisive**: the AC4 restore coverage is still vacuous under
mutation. Note that HEL-1062's own description asserts "HEL-520 added Jest/RTL restore-on-close coverage for
it (that half of AC4 is done)" — that statement is false on the evidence above and should be corrected on the
ticket, or it will propagate the wrong premise into the follow-up.
