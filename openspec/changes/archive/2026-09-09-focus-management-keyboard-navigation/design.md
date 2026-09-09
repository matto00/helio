# Design — HEL-520 focus management and keyboard navigation

## D0. What is already true (measured, not assumed)

Premise validation is in `ticket.md`. The load-bearing findings:

- `theme.css:449` already applies a global `:focus-visible { outline: var(--app-focus-ring); outline-offset: 2px }`,
  and ~30 component stylesheets re-apply the same token with their own offsets. The default state is
  *conforming*; the risk is confined to overrides and to paint-time effects.
- Of the 11 `outline: none` sites, **four suppress unconditionally in the element's BASE rule** —
  `auth.css:107`, `AccentPicker.css:19`, `PipelineDetailPage.css:885`, `AddSourceModal.css:165` — with any
  replacement in a separate later rule; the rest suppress inside their own `:focus-visible` rule. Nearly all
  supply a replacement keyed to `--app-focus-ring-color`. (This tally was stated wrongly twice in this planning
  round before being verified against the files; re-derive it rather than trusting any summary, including
  this one.) One of the four, `AddSourceModal.css:165`, uses bare `:focus` with a raw `--app-accent`
  border — and is **not a defect**. DESIGN.md §8 documents bare `:focus` as legitimate for a persistent,
  modality-independent indicator on a text input and names this selector as *the example of the shape*; it is
  orphaned CSS with zero markup references (HEL-1050 D9), already pinned in `focusRingTokenGuard.css.test.ts`
  with `owner: "HEL-1052"`. **HEL-520 does not touch it.** An earlier draft of this design called it the
  ticket's one concrete defect; that was wrong, and the correction is recorded here rather than appended below,
  per MISTAKES.md.
- Consequence, stated plainly: **HEL-520 begins with zero known concrete AC2 defects.** AC2's deliverable is the
  measurement, and finding nothing to fix is an acceptable and reportable outcome. Manufacturing a fix to
  justify the section is the failure mode to avoid here.
- `focusRingTokenGuard.css.test.ts` carries **two** source-parsing guards: one enforcing the `outline` colour
  channel across every `.css` under `frontend/src`, and a second ("border/box-shadow focus-indicator guard
  (HEL-1050)") requiring every group declaring `outline: none` to carry a conforming ring-token indicator —
  `border-color`, `border-bottom-color`, `box-shadow`, … — in a `:focus-visible` rule of the same group, or a
  pin. **An earlier draft of this design said the border/box-shadow channel was unguarded; that was false.**
  What neither guard establishes is whether a declared indicator actually PAINTS. See D1c for the precise
  residue this change owns; re-parsing CSS is not part of it.
- Of the 5 "non-Modal dialog surfaces", 3 were a grep artefact. Only `MobileNavSheet.tsx` (hand-rolled dialog,
  which on inspection already implements trap/initial-focus/restore/Escape) and `Select.tsx` (a listbox popover,
  to which the trap contract does not apply) are genuinely outside the shared `Modal`.
- `Modal.tsx` implements trap (HEL-716), restore (HEL-590) and Escape. `Modal.test.tsx` covers the trap in three
  cases and **does not cover restore at all**.
- `shareDialogContext.tsx` carries a `setTimeout(...,0)` + `restoreFocusSelector` workaround because `Modal`'s
  restore heuristic — capture `document.activeElement` at open — loses the trigger when the trigger is a menu
  item unmounted in the same commit. This is a real `Modal` limitation, currently patched at one call site.

## D1. The measurement gap, and why it is the spine of this change

`e2e/support/stateContrast.mjs`'s `classifyState` returns:

```
if (!backgroundChanged) return { verdict: otherChannelChanged ? "advisory" : "fail", ratio: null };
```

An element whose focus state changes **only** outline/border/box-shadow — i.e. every correctly-implemented
focus ring in this app — scores `advisory`, explicitly deferred ("HEL-1044's call, not ours"). So the existing
HEL-866 guard walks the focus state of the whole interactive population and then declines to judge the one
channel focus actually uses. AC2 is therefore not "add a guard"; it is **close the deferral**.

**D1a. Decision: extend the existing core, do not build a parallel one.** `classifyState` gains an explicit
focus-channel adjudication path; the backdrop ancestor-walk, alpha accumulation and compositing in
`stateContrast.mjs` are reused verbatim. The POPULATION is not reused verbatim: `INTERACTIVE_SELECTOR`
excludes form fields, so a sibling `FOCUSABLE_SELECTOR` is added alongside it — see D1d, which governs. Precedent:
HEL-444's design gate refuted a from-scratch guard on exactly this ground. A parallel guard would also
re-create the dead-duplicate hazard `stateContrastProbe.ts`'s own header comment records.

**D1b. Scope the change to the focus state only.** Hover remains advisory — adjudicating a hover-shadow design
is HEL-1044's, and widening it here would fail the existing guard on unrelated surfaces. The new adjudication
keys on which state is being probed, not on the channel alone.

**D1d. The population must be widened, and that is a deliberate fork, not an accident.**
`INTERACTIVE_SELECTOR` (`stateContrastProbe.ts`) is
`a, button, tbody tr, [role=option], [role=menuitem], [role=row], [tabindex]:not([tabindex='-1'])` — it
contains **no `input`, `textarea`, or `select`**, because HEL-866 was scoped to elements conveying a hover/
focus *surface* state. But **9 of the 11 suppression sites are inputs**, and the focusable population is not
the same population. So "reuse `INTERACTIVE_SELECTOR`" and "measure all 11 sites with it" are mutually
unsatisfiable as originally written.

Resolution: add a separate, explicitly-named `FOCUSABLE_SELECTOR` alongside it in the same module, covering
what can actually receive keyboard focus (adding `input:not([disabled]):not([type=hidden])`, `textarea:not([disabled])`,
`select:not([disabled])`, `[href]`, and `[contenteditable]`; `type=hidden` is excluded because it is not
focusable and would inflate the coverage count with elements that can never fail). The two constants are deliberately different
populations answering different questions, and each carries a comment saying so — the shared compositing and
backdrop-resolution core is still reused unchanged. Silently widening `INTERACTIVE_SELECTOR` in place is
forbidden: it would change the existing HEL-866 guard's population and could turn that guard red on surfaces
this ticket never examined.

**D1e. DESIGN.md §8 is the binding test for conformance, and must be consulted per site.**
§8 rules that a focus *ring* is always `:focus-visible`, never bare `:focus` — but carves out a legitimate
exception for "a persistent, modality-independent indicator": a text input showing it is the one accepting
keystrokes (an accent border, not an outline ring), or a selected listbox item. The test §8 states: if the
visual announces "this is the thing you're typing into / have selected", bare `:focus` is correct; if it
announces "a keyboard just moved here", it must be `:focus-visible`. **Not applying this test is exactly how
the first draft of this design misclassified `AddSourceModal.css:165` as a defect.** Every conformance call in
§3 cites §8 and the pin list in `focusRingTokenGuard.css.test.ts` before it is made.

**D1f. Both themes.** The existing guard iterates `["dark", "light"]`. Every measurement this change adds does
the same; a focus indicator that conforms in one theme and not the other is the defect class HEL-866 and
HEL-533 both found repeatedly.

**D1c. Contrast, precisely scoped. This replaces TWO earlier framings of mine, both wrong; the corrections
are folded in here rather than appended, per MISTAKES.md.**

What is already enforced, verified in `focusRingTokenGuard.css.test.ts` rather than assumed:

- **Part 1 (line ~309):** every `outline` declaration in every `.css` under `frontend/src` is
  `var(--app-focus-ring)`, `none`, or a pinned exception.
- **Part 2, the "border/box-shadow focus-indicator guard (HEL-1050)" at line ~600:** every selector group
  declaring `outline: none` must carry some indicator declaration — `outline`, `outline-color`,
  `border-color`, `box-shadow`, … — in a `:focus-visible` rule of the same group referencing the conforming
  ring token, or hold a `BORDER_INDICATOR_PINS` entry.
- The token itself is derived to clear 3:1 against every surface declared in both theme blocks
  (`deriveFocusRingColor`), and that derivation is separately guarded.

**An earlier draft of this design asserted that "nothing enforces the border/box-shadow channel today". That
was false** — part 2 above is exactly that enforcement, and it was in the tree the whole time. (An earlier
draft still said the opposite thing, "do not re-litigate contrast at all", which contradicted the spec delta.
Both are superseded by this paragraph.)

So the honest residue — what this change actually adds, and all it adds:

1. **Paint.** Every check above is a *source parse*. None of them establishes that the declared indicator
   becomes perceivable: a conforming, token-referencing `box-shadow` clipped by an ancestor or covered by a
   sibling passes part 2 and shows the user nothing. This is the core of AC2 and it is genuinely unguarded.
2. **Rendered contrast against the real composited backdrop.** The token clears 3:1 against surfaces *declared
   in `theme.css`*; it does not follow that it clears 3:1 against every backdrop actually composited at paint
   time (translucent overlays stacked over arbitrary content — precisely the resolution `stateContrast.mjs`'s
   ancestor-walk exists to perform).
3. **Focus states outside part 2's trigger.** Part 2 only fires on a group declaring `outline: none`. An
   element that conveys focus by a border swap *without* suppressing an outline is outside it.

The new `classifyState` branch is therefore **ratio-enforcing**, matching the spec delta's normative wording:
presence first, then the 3:1 floor on whichever mechanism conveyed focus, measured against the real composited
backdrop. The token's own derivation stays out of scope (HEL-1046/1050).

**Expect this to find little, and say so if it does.** With part 2 already enforcing source-level conformance,
the plausible finds are narrow: a clipped or occluded indicator, or a token-conforming indicator that fails
against a composited backdrop `theme.css` never declared. `PanelGrid.css:253` (`border-bottom-color` alone —
one edge of the box) and `PipelineDetailPage.css:893` remain the likeliest, since a one-edge indicator is the
thinnest thing part 2 will accept. A null result here is a legitimate, reportable outcome.

## D2. Presence is not a computed-style read

A `getComputedStyle(el).outline !== "none"` check is an assertion whose precondition guarantees it — the global
rule makes it true for nearly every element regardless of whether the user can see anything (MISTAKES.md,
HEL-1060). Presence must be established the way the spec words it: **the element in its focused state, as
rendered**. Three failure modes a style read cannot see, all in scope:

1. **Suppressed with no replacement** — reachable by comparing rest vs focus paint, not by reading declarations.
2. **Clipped** — an ancestor with `overflow: hidden` removes an `outline-offset: 2px` ring on a flush-fitting
   child. Detectable by comparing the element's box against each ancestor's clipping box.
3. **Occluded** — a sibling painted above covers the ring. Detectable via `elementsFromPoint` sampling on the
   ring band.

Clipping and occlusion are the two the ticket's brief calls out specifically and are the two most likely to
produce a false green. They are scored as **absence for the affected region**, per the spec delta.

**D2a. Playwright's `.focus()` does not match `:focus-visible` — this WILL bite.** Chromium's focus-visible
heuristic does not treat a programmatic focus as keyboard-originated, so `locator.focus()` leaves every
`:focus-visible` rule unmatched. `state-surface-contrast-guard.spec.ts` records that this produced **100% false
failures across the entire focus-state population** before it was found. Use the CDP
`CSS.forcePseudoState` mechanism that file already implements (`forceFocusVisible`), or a real Tab sequence.
This is the single most likely way this ticket produces a confidently wrong result.

**AC2 and AC3 deliberately use different mechanisms, and this is not an inconsistency.** AC2's presence sweep
uses CDP `CSS.forcePseudoState` because it must render the true `:focus-visible` styling for a large
population without a real Tab sequence per element. AC3's flow walk uses **real** `keyboard.press("Tab")`,
because what it is testing IS the sequential navigation order — forcing a pseudo-state there would assume away
the thing under test. Neither mechanism is correct for the other's job; an executor must not unify them.

**D2b. Sampling is not exhaustiveness, and AC2's wording is universal. Decision: do not sample.**
The existing guard measures `MAX_ELEMENTS_PER_VIEW = 24` per view on an even stride, because a full
hover+focus contrast composite over two states is expensive. **The focus-presence measurement is cheaper PER ELEMENT** — one state instead of two, and the common case
resolves on a rest-vs-focus paint comparison without a full ancestor composite. Do not expect a faster run
overall, though: uncapping also multiplies the POPULATION, and `FOCUSABLE_SELECTOR` adds inputs, textareas,
selects and `[href]` on top. The existing guard's own notes record 36 in-`<main>` interactive elements on
`/settings` alone against a cap of 24, so total run cost may well rise. That is expected and acceptable;
2.6c requires the runtime be recorded rather than guessed. So the presence spec takes **no per-view cap**: it measures every visible focusable
element in each enumerated view, and prints the count it measured so the coverage is legible rather than
implied.

This is a decision, not a preference, because the alternative is the "completeness claim asserted rather than
checked" defect shape verbatim: a universal AC discharged by an unstated sample. If measured runtime makes an
uncapped sweep impractical, the fallback is **not** to quietly reinstate a cap — it is to narrow AC2's claim
explicitly to the measured population, name the residual, and give it an owning item, per
`accessible-focus-indicator`'s existing "unfixed sites are named rather than omitted" requirement. Record the
measured runtime either way. Per MISTAKES.md, an unverifiable AC is reported unmet, never softened.

Note the residual limit that survives either branch: "every focusable element in each enumerated view" is
still bounded by which views are enumerated. The view list is therefore itself part of the claim and is
printed with it.

**D2c. `overflow: hidden` cannot be found by grep.** Every `overflow: hidden` in the stylesheets carrying focus
rings (`inputs.css:93`, `DashboardList.css:585/594`, `AddSourceModal.css:39`) is text-ellipsis on a label, not
a ring-clipping ancestor. Grepping for it produces only false leads; clipping is a rendered-geometry question
and is measured as one.

## D3. AC3 — keyboard flows

Driven by real `keyboard.press("Tab"/"Enter"/"Escape")` in Playwright, reading `document.activeElement` after
each press. Direct precedent: `e2e/hel1003-actions-menu-keyboard-reach.spec.ts` and
`e2e/hel510-keyboard-shortcuts.spec.ts`, whose `registerAndLogin` + `createDashboard` helpers and post-login
mount-race wait are reused rather than re-derived. jsdom is excluded by the spec text itself: it performs no
layout and no sequential focus navigation, so a `toHaveFocus()` there is vacuous.

**D3a. Enumerate modal surfaces by opening them.** The flow list is fixed by the AC (panel-create,
appearance-edit, dashboard-switch, detail-modal). Each is walked in the running app; any surface encountered on
the way is included whether or not it greps as a `<Modal>`. A `grep '<Modal'` enumeration is what produced this
ticket's three false "non-Modal dialog" entries — it is not an acceptable substitute.

## D4. AC1 — dialogs

`Modal` already satisfies trap/restore/Escape for its 17 consumers, so AC1's work is: (a) verify
`MobileNavSheet`'s hand-rolled implementation actually behaves rather than merely containing the code, by
rendered measurement; (b) judge `Select` against listbox semantics, not dialog semantics; (c) decide whether
`shareDialogContext`'s restore workaround should be generalised into `Modal` — a trigger that unmounts on open
is not unique to the share dialog, and one patched call site is not a fix.

**D4a. Generalising the restore workaround is proposed, not assumed.** It touches a primitive with 17
consumers. If rendered measurement finds no second affected call site, leave the workaround where it is and
name that decision rather than silently widening blast radius.

## D5. AC4 — Jest/RTL

Scoped exactly to what AC4 asks: trap + restore on the shared `Modal`, plus one consuming surface. The trap is
already covered; **add the missing restore coverage** to `Modal.test.tsx`. `ShareDialogFocusRestore.test.tsx`
already serves as the consuming surface. RTL is used for this and nothing else — it is the right tool for a
unit contract about which element a ref-captured `.focus()` call targets, and the wrong tool for AC2 and AC3.

## D6. Proving every guard red

Every new guard is proven red against the pre-fix tree using the repo's existing
`*.regression.spec.ts` harness pattern (`e2e/hel813-mobile-touch-target-floor.regression.spec.ts`): patch real
source into the known-bad shape, re-measure **with the same shared helper**, assert red, revert, assert green.
That file's three-layer exclusion (`playwright.config.ts` `testIgnore`, an env-var `test.skip`, and a separate
`playwright.regression.config.ts`) is reproduced exactly — it mutates tracked source and must stay inert by
default. The known-bad shapes to prove against are synthesised, since no live defect is known going in: an element with
its focus indicator suppressed and no replacement, a clipped ring, and an occluded ring. Each is produced by
patching real source, measured with the same shared helper, then reverted.

**D6a. A guard that cannot be shown red is not evidence and does not ship.** Recording the red transcript is
part of the task, not a nicety. The bar is the one `focusRingTokenGuard.css.test.ts` already sets for itself:
each arm must go red **for the stated reason**, asserted on the failure's content, driving real rendering
source through the whole pipeline — that file's own evaluator CR3 records fixture-only arms silently bypassing
the collection pipeline and thereby proving a different branch than the one they named.

## D7. Gate chain

New `e2e/` specs are picked up by CI's `e2e` job by glob (HEL-951) — no `.husky/` change and no new npm gate
line are anticipated. `stateContrast.mjs` changes are covered by the existing
`npm run check:state-contrast:selftest`, already in CI; that selftest is extended alongside the core rather
than left asserting the old classification. If `.husky/**` does end up touched, this file gains the
`## Gate-Chain Implications Checklist` section before delivery.

## Planner Notes

- Self-approved: extending `classifyState` rather than adding a new comparator (D1a) — it is the smaller change
  and the repo has an explicit refutation precedent against the alternative.
- Self-approved: leaving hover advisory (D1b).
- Self-approved: not adding a skip link (one exists, HEL-772) and not re-deriving ring colour (HEL-1046/1050).
- Deliberately left open for execution to decide on evidence, not now: whether `Modal`'s restore heuristic is
  generalised (D4a), and whether any cluster genuinely warrants a roving-tabindex retrofit. The ticket says
  "where warranted"; inventing a warrant to satisfy a bullet would be scope invention.
- Any site knowingly left non-conforming must be named with a reason and an owning item — this is already a
  requirement of `accessible-focus-indicator` ("Unfixed sites are named rather than omitted"), not a new rule.
