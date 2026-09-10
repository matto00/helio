## Evaluation Report — Cycle 1 (evaluation-1.md)

Scope note: §4 (AC1 rendered measurement) and §5 (AC3 keyboard flows) were de-scoped
mid-execution by the orchestrator and are NOT evaluated as gaps. Everything below concerns
what was scoped and delivered, or artifacts that misrepresent the split.

### Phase 1: Spec Review — FAIL

Issues:

1. **Two spec deltas describe de-scoped, unimplemented capabilities.**
   `specs/dialog-focus-lifecycle/spec.md` and `specs/keyboard-flow-operability/spec.md` are both
   `## ADDED Requirements` for the dropped §4/§5. On archive these merge into canonical
   `openspec/specs/` as normative contract. `keyboard-flow-operability` has zero implementation
   in this change. `dialog-focus-lifecycle` is worse than merely unverified: its second
   requirement ("Focus restore survives a trigger that does not outlive the open" — "Capturing
   the focused element at open time SHALL NOT be relied on alone") asserts as normative exactly
   the behaviour design.md D4a explicitly declined to generalise. `Modal.tsx` still relies on
   capture-at-open alone; the workaround remains at one call site (`shareDialogContext.tsx`).
   Shipping this delta would canonise a requirement the codebase knowingly does not meet.
   (Independently raised by the orchestrator; confirmed against the files.)

2. **The `accessible-focus-indicator` delta overclaims occlusion.** Its requirement "Occlusion
   and clipping count as absence" carries the scenario "An indicator painted behind a sibling is
   not credited". Occlusion detection was built and REMOVED as methodologically unsound
   (`focusPresenceProbe.ts` module comment). Nothing in the shipped guard measures occlusion;
   the `"occluded"` member of the `Verdict` union is unreachable. Clipping shipped and is proven;
   occlusion is a normative requirement with no implementation and no verification.

3. **The delta's third requirement is not implemented at the strength it states** — see Phase 2
   issue 1 (the 3:1 floor). "SHALL be measured against the non-text contrast floor" is normative;
   the shipped enforcement is a 1.10 measurable-difference threshold.

4. **`files-modified.md` contradicts its own transcript.** The Cycle 2 entry claims the
   `state-surface-contrast-guard.spec.ts` extraction was "Confirmed behaviour-preserving via a
   stashed-source A/B ... reconfirmed in Cycle 3 below", but the Cycle 3 transcript section it
   points at says the re-run "was cut short by a tighter watch window before the final assertion
   line printed — not re-confirmed to full completion in cycle 3". Task 2.6a-ii is marked `[x]`
   on that basis. (My own fresh run resolves the underlying question favourably — see Phase 2
   issue 5 — but the artifact must say what actually happened.)

Passing: the ticket's own AC4 is genuinely met; scope creep is absent; the de-scope of §4/§5 is
stated plainly in `files-modified.md` and reflected in `tasks.md`'s unchecked items; the three
named incomplete items (occlusion, Case A, Case C) are reported rather than hidden — that
reporting discipline is the strongest thing about this delivery.

### Phase 2: Code Review — FAIL

Gates, re-run fresh by me in `WORKTREE_PATH` (not trusting the executor's report):

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm test` | PASS — 299 suites / 3143 tests, plus helio-mcp 25/248 |
| `npm --prefix frontend run build` | not re-run separately; typecheck+lint clean, no `frontend/src` TS changed (one CSS file + one test file) |
| `e2e/state-surface-contrast-guard.spec.ts` (CI-gated) | **PASS**, full completion, 3.9m, 470 probed |
| `e2e/focus-presence-guard.spec.ts` (new) | **PASS**, 196 elements / 8 views / 97651ms |

No `backend/**` files changed; sbt not run.

Issues:

1. **[BLOCKING] The focus contrast check enforces 1.10, not the 3:1 non-text floor the design,
   the tasks and the spec delta all specify.**
   `e2e/support/focusPresenceProbe.ts:325` passes `threshold: CONTRAST_THRESHOLD` into
   `classifyState`. `e2e/support/stateContrast.mjs:19` defines `CONTRAST_THRESHOLD = 1.1`, and
   its own header comment (lines 15-18) states outright: *"This is a 'measurably different'
   threshold, NOT a WCAG text-legibility threshold (no adjacent-surface pair in this theme, good
   or bad, comes close to WCAG's 3:1/4.5:1)"*. It was derived for HEL-866's hover-SURFACE
   question, not for a focus indicator.
   Meanwhile design.md D1c says the new branch is *"presence first, then the 3:1 non-text floor
   on whichever mechanism conveyed focus"*; tasks 2.1 repeats *"the 3:1 non-text floor"*; the
   spec delta says *"SHALL be measured against the non-text contrast floor"* (WCAG 2.1 SC 1.4.11
   = 3:1). The shipped guard credits a focus ring at ratio 1.5 against its backdrop — plainly
   failing non-text contrast — as `pass`.
   This is the highest-value finding in the review: the AC2 contrast claim is materially weaker
   than every artifact describing it, and at 1.10 the contrast arm is close to vacuous for any
   ring with a real colour delta. It also reframes issue 3 below: the "5 near-misses at 1.0828 vs
   1.10" are near-misses against the wrong floor, and the true 3:1 residual population is
   unmeasured and unknown.

2. **[BLOCKING] A live detection path ships unproven, contrary to design.md D6a.**
   `measureOneElement` (`focusPresenceProbe.ts:206-215`) returns the `no-indicator` verdict when
   no outline/box-shadow/border/background channel changes under forced focus — the
   suppressed-with-no-replacement detector. That branch is live in the CI-discoverable guard and
   `no-indicator` is treated as a failure by the sweep, but §7 Case A was attempted and NOT
   delivered, so it has never been shown red. D6a is unambiguous: *"A guard that cannot be shown
   red is not evidence and does not ship."* The executor named the gap honestly, which is right,
   but naming a gap is not the same as satisfying the rule the design set. Case B (clipped) does
   not prove this branch — the clipped case enters `measureOneElement` with `outlineChanged ===
   true`, i.e. it exercises the negation of this condition, never its positive arm.

3. **[BLOCKING] The sweep has no coverage floor, so its own coverage claim is not self-checking.**
   The only population assertion is `expect(totalMeasured).toBeGreaterThan(0)`
   (`focus-presence-guard.spec.ts:268`). Seven of the eight enumerated views could measure zero
   elements — a seeding change, a login regression, an error boundary on `/pipelines/:id` — and
   the guard still passes while printing "0 focusable element(s) measured" lines nobody reads.
   design.md D2b makes the view list *part of the claim*; the sibling HEL-866 guard already
   solves exactly this with a partition assertion it describes as making *"the coverage claim
   SELF-CHECKING instead of trusting"* the enumeration
   (`state-surface-contrast-guard.spec.ts:232, 266, 293`), and that assertion has already caught
   one real population gap in its own cycle 4. The new guard, which is the strictly more
   universal claim ("every focusable element"), ships with strictly weaker coverage checking than
   its sibling.
   Not vacuous today — my run measured 19/21/24/34 per view and the contrast arm produced real
   findings — but nothing in the spec keeps it that way.

4. **[BLOCKING] Shipped code claims occlusion coverage it does not have.**
   - `focus-presence-guard.spec.ts:66` — test title: "every focusable element presents an
     unclipped, **unoccluded**, conforming focus indicator".
   - `focus-presence-guard.spec.ts:261` — failure message: "did not present a conforming,
     unclipped, **unoccluded** focus indicator".
   - `focusPresenceProbe.ts:187` — `| "occluded"` in the `Verdict` union: dead, unreachable, no
     producer (CONTRAST.md/CONTRIBUTING "no dead code").
   The module comment explaining why occlusion was dropped is excellent and should stay; the
   three claim sites must stop asserting the check exists.

5. **[RESOLVED by my own measurement, no change requested] The `forceFocusVisible` extraction is
   behaviour-preserving.** I diffed it: the moved function is textually identical apart from the
   marker attribute rename `data-hel866-force-focus` → `data-hel520-force-focus`, and
   `grep -rn` across `e2e/` and `frontend/src` finds zero other references to either marker, so
   the rename cannot affect selection, styling or the `describeElement` identity string. I then
   ran `e2e/state-surface-contrast-guard.spec.ts` fresh against this branch to full completion:
   **1 passed (3.9m)**, 470 probed, 470 resolved, 22 reviewed exemptions, no partition failure.
   The `/settings` audit-event-table coverage-partition failure the executor saw in cycle 2 does
   not reproduce; it was transient/environmental, and their "pre-existing on diff review"
   judgement happens to be correct. This is the one place a regression could have hidden and it
   is clear — but the evidence for that is this run, not the cycle-2 claim, and issue 4 of Phase 1
   asks the artifact to say so.

Positive findings worth recording:

- The `PipelineDetailHeader.css` fix is a genuine, measured defect with a correct remedy:
  a 20x20 button inside a 25px `overflow: hidden` ellipsis wrapper, global ring reaching 4px
  past its box, resolved with DESIGN.md §8's own documented `outline-offset: -2px`
  flush-fitting-child carve-out. The `bandExpand = max(0, width + offset)` geometry (as opposed
  to `width + max(offset, 0)`) is correct and the in-code comment records the live correction.
- `stateContrast.mjs`'s `stateKind` parameter defaults to `"hover"` and leaves HEL-866's path
  byte-for-byte in behaviour — confirmed by the sibling guard's clean full run.
- `FOCUSABLE_SELECTOR` was added alongside `INTERACTIVE_SELECTOR`, not in place of it, with both
  constants commented as to why they differ (binding constraint 7 honoured exactly).
- The real-`.focus()`-then-CDP-force layering, and the comment explaining the `:focus-within`
  ancestor-reveal pattern that forced it, is a correct and non-obvious harness finding.
- `Modal.test.tsx`'s two restore cases are meaningful, not tautological: the first fails if the
  restore effect is removed; the second pins the vanished-trigger no-throw path.
- The `KNOWN_RESIDUAL_RATIO` allowance keys on the exact measured float rather than on view/desc
  text, so an unrelated future defect is not silently swallowed. That is the fail-closed choice.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`, `e2e/**` measuring the running app). Servers started via
`scripts/concertino/start-servers.sh` (frontend 5952, backend 8859); process cwd verified via
`readlink /proc/<pid>/cwd` to be this worktree before any measurement was trusted. No bare
`npx playwright`/`npm` invocation was used — the binary was invoked by absolute path with
`DEV_PORT`/`BACKEND_PORT` set explicitly and `-c ./playwright.config.ts`.

The rendered evidence is the two e2e runs above. Both pass; the new guard reproduces the
executor's reported numbers exactly (196 elements, 8 views, 5 named light-theme residuals,
~98s vs their ~98s), which is a good independent-reproduction result. No console errors
surfaced in either run. The one CSS change is a focus-offset adjustment inside an existing
button and introduces no layout, state or breakpoint surface of its own.

Subjective visual judgement of the ring's appearance is deferred to the skeptic.

### Overall: FAIL

### Change Requests

1. **Reconcile the contrast floor with every artifact that specifies it.** Either:
   (a) enforce the 3:1 non-text floor the design, tasks and spec delta all state — pass an
   explicit `threshold: 3` (or a named `FOCUS_NONTEXT_CONTRAST_THRESHOLD = 3`) at
   `focusPresenceProbe.ts:325` rather than inheriting `CONTRAST_THRESHOLD`, re-run the sweep, and
   name + own every site that then fails per `accessible-focus-indicator`'s "unfixed sites are
   named rather than omitted"; or
   (b) if 3:1 is deliberately out of reach for this ticket, say so as a decision: correct
   design.md D1c, tasks 2.1 and the spec delta's "non-text contrast floor" wording to state the
   enforced floor is the 1.10 measurable-difference threshold inherited from HEL-866, explain why
   in the same place, and file the 3:1 gap as an owned follow-up.
   Do not leave the code at 1.10 while three artifacts say 3:1. Whichever branch is taken,
   `focusPresenceProbe.ts` must carry a comment stating which threshold it enforces and why,
   because `CONTRAST_THRESHOLD`'s own header explicitly disclaims being a WCAG floor.

2. **Delete `specs/dialog-focus-lifecycle/spec.md` and `specs/keyboard-flow-operability/spec.md`
   from this change** and carry their content to the §4/§5 follow-up tickets. Answering the
   orchestrator's second question: yes, the change remains valid — `accessible-focus-indicator`
   remains as the one delta, and it is the only one whose requirements this change's code
   actually implements. Re-run `openspec validate --type change` after the deletion to confirm.

3. **Narrow the `accessible-focus-indicator` delta's occlusion claim.** Retitle the requirement
   to clipping only, delete the "An indicator painted behind a sibling is not credited" scenario,
   and name occlusion as an unowned/follow-up gap with the reason already written in
   `focusPresenceProbe.ts`'s module comment (hit-test geometry does not include paint-only
   effects). In the same pass, remove the word "unoccluded" from
   `e2e/focus-presence-guard.spec.ts:66` (test title) and `:261` (failure message), and remove
   the unreachable `| "occluded"` member from the `Verdict` union at
   `e2e/support/focusPresenceProbe.ts:187`.

4. **Resolve the unproven `no-indicator` path (D6a).** Preferred: deliver §7 Case A. The two
   anchors that failed were both CSS-file mutations racing Vite HMR; a third approach that avoids
   that race entirely is available — mutate nothing and instead drive the shared
   `measureOneElement` against an element whose indicator is genuinely suppressed, e.g. inject a
   `<style>` element into the page with a higher-specificity
   `#email:focus-visible { outline: none !important; box-shadow: none !important; border-color:
   <its resting colour> !important; }` via `page.addStyleTag`, which lands in the same document
   with no file-watch round trip and no tracked-source mutation to revert. That still drives real
   rendering source through the whole pipeline, which is what task 7.4 requires; it is a fixture
   only if the measurement path differs, and it does not.
   If Case A still cannot be produced, the fallback is not to ship the branch silently: make the
   `no-indicator` verdict non-gating (report it, do not fail on it) and record in design.md and
   `files-modified.md` that the suppressed-no-replacement arm is unproven and therefore
   advisory-only, owned by the follow-up. A live gating assertion that has never been shown red
   is precisely what D6a forbids.

5. **Add a coverage floor to `e2e/focus-presence-guard.spec.ts`.** At minimum assert a per-view
   minimum (`expect(measuredThisView).toBeGreaterThan(0)` inside the route loop, ideally with a
   route-specific floor so a stripped-down error page cannot satisfy it). Better, and cheaper
   than it looks: reuse the sibling guard's partition approach so the claim "every focusable
   element in each enumerated view" is checked rather than trusted. `totalMeasured > 0` is a
   headline total that seven empty views can satisfy.

6. **Correct `files-modified.md`'s Cycle 2 entry.** Remove "reconfirmed in Cycle 3 below" (the
   Cycle 3 transcript it points at states the opposite) and state plainly what was and was not
   confirmed in each cycle. You may record my independent evidence: a full-completion run of
   `e2e/state-surface-contrast-guard.spec.ts` on this branch passed — 470 probed / 470 resolved /
   22 reviewed exemptions / 3.9m, no partition failure — so the extraction is behaviour-preserving
   on measured evidence, and the cycle-2 `/settings` failure did not reproduce. Task 2.6a-ii's
   `[x]` is then justified by that run rather than by the contradicted claim.

### Non-blocking Suggestions

- `tasks.md` leaves 2.6a and 2.6 unchecked although both were satisfied — 2.6a's CDP
  `forcePseudoState` mechanism is used (with a real `.focus()` layered under it, a documented and
  correct deviation), and 2.6 is a prohibition the implementation honours. Checking them with a
  one-line note on the deviation would make the unchecked set mean "genuinely not done", which is
  the property that makes the rest of this handoff trustworthy.
- `KNOWN_RESIDUAL_RATIO = 1.0828608452896535` is fail-closed and correctly justified, but it will
  go red on any `--app-accent-dim` or surface-token tweak, at a call site whose failure text will
  not obviously point at the token change. A one-line comment naming that expected trigger ("if
  this goes red after a theme-token change, re-measure and update the constant, do not widen the
  epsilon") would save the next reader a diagnosis.
- `readBackdrop` is duplicated from `state-surface-contrast-guard.spec.ts` rather than extracted;
  the in-code comment defends this deliberately and reasonably for this cycle's blast radius, but
  it is now a second copy of ~25 lines of alpha-accumulation logic that must stay in sync. Worth a
  follow-up to extract it into `e2e/support/` the way `forceFocusVisible` just was.
- This worktree has no root `node_modules`; module resolution falls through to the parent repo's
  because the worktree is nested inside it. That worked, but it is ambient state a CI checkout
  would not have. Not a defect in this change — noted for the orchestrator's environment setup.
