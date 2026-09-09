# Tasks — HEL-520

## 1. Ground truth before any edit

- [ ] 1.1 Read `e2e/support/stateContrast.mjs`, `stateContrastProbe.ts`, `stateContrast.selftest.mjs`,
      `touchTargetProbe.ts`, `e2e/state-surface-contrast-guard.spec.ts`, `e2e/hel1003-actions-menu-keyboard-reach.spec.ts`,
      `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` and `e2e/README.md` before writing anything new.
      Reuse is the design's decision (D1a); a parallel mechanism is out of bounds.
- [ ] 1.2 Read `MISTAKES.md`, `frontend/src/shared/ui/Modal.tsx`, **DESIGN.md §8 in full**, and
      `frontend/src/theme/focusRingTokenGuard.css.test.ts` including its pinned-exception list. §8 contains
      carve-outs (legitimate bare `:focus` for persistent modality-independent indicators) and the guard
      contains owned pins; a site matching either is not a defect. Not reading these is what produced a wrong
      "defect" in the first draft of this plan.
- [ ] 1.2a Do not invoke `npx playwright` / `npm` / `vite` bare — a bare invocation inherits an ambient default
      and can measure another worktree's server (MISTAKES.md). Confirm any reused dev server's process cwd is
      THIS worktree (`readlink /proc/<pid>/cwd`) before trusting a reading.
- [ ] 1.3 Start the dev servers via `scripts/concertino/start-servers.sh` and confirm the app loads and a test
      account can register/log in — every AC2/AC3 task below measures the running app.

## 2. AC2 — close the focus-channel deferral in the shared core

- [x] 2.1 Extend `classifyState` in `e2e/support/stateContrast.mjs` so a focus-state change conveyed only via
      outline/border/box-shadow is adjudicated rather than returned as `advisory`. Hover stays advisory (D1b).
      The verdict is RATIO-ENFORCING, not presence-only: presence first, then the 3:1 non-text floor on
      whichever mechanism conveyed focus (D1c). The token's own value stays out of scope — that is
      HEL-1046/1050's and is already enforced.
- [x] 2.2 Extend `e2e/support/stateContrast.selftest.mjs` to cover the new classification — including a case
      that would have scored `advisory` before and now scores a definite verdict. `npm run check:state-contrast:selftest`
      must pass and must actually exercise the new path.
- [x] 2.3 Add rendered clipping detection: compare the focused element's ring band against each ancestor's
      clipping box; a ring removed by an ancestor's hidden overflow is absence for that region (D2.2).
- [ ] 2.4 Add rendered occlusion detection by sampling the ring band with `elementsFromPoint` (D2.3).
- [x] 2.4a Add a separate `FOCUSABLE_SELECTOR` to `e2e/support/stateContrastProbe.ts` covering what can
      actually receive keyboard focus (`input:not([disabled]):not([type=hidden])`, `textarea`, `select`,
      `[href]`, `[contenteditable]`, plus the existing entries) — `INTERACTIVE_SELECTOR` contains no
      `input`/`textarea`/`select`, yet 9 of
      the 11 suppression sites are inputs (D1d). **Do NOT widen `INTERACTIVE_SELECTOR` in place**: that would
      change the existing HEL-866 guard's population and could turn it red on surfaces this ticket never
      examined. Comment both constants to say why they differ.
- [x] 2.5 Add the focus-presence e2e spec under `e2e/`, using `FOCUSABLE_SELECTOR` (from
      `e2e/support/stateContrastProbe.ts`) and reusing the compositing/contrast core from
      `e2e/support/stateContrast.mjs` (`parseColor`, `compositeStack`, `contrastRatio`, `classifyState`)
      unchanged. Those are two different modules — JS core vs TS probe — so name the source of each helper.
- [x] 2.5a Measure in BOTH themes, as the existing guard does (`for (const theme of ["dark","light"])`). Print the measured element count per view, as the HEL-866 guard does.
- [x] 2.6a Use CDP `CSS.forcePseudoState` to render the focus state — NOT `locator.focus()`. Programmatic
      focus does not match `:focus-visible` in Chromium and produced 100% false failures across the whole
      focus-state population before this was found (D2a). Deviation, documented and correct: a real
      `.focus()` is layered UNDER the CDP force (not instead of it) to trigger genuine `:focus-within`
      ancestor-reveal rules that `forcePseudoState` alone never sets — see the in-code comment in
      `focus-presence-guard.spec.ts`.
- [x] 2.6a-i `forceFocusVisible` is NOT importable: `state-surface-contrast-guard.spec.ts` exports nothing and
      the helper is a module-local function hard-coding the marker `data-hel866-force-focus`. **Extract it into
      `e2e/support/`** alongside the other shared probes, have `state-surface-contrast-guard.spec.ts` import it
      from there, and namespace the marker attribute. Copying it instead would create exactly the dead-duplicate
      hazard `stateContrastProbe.ts`'s header comment warns about.
- [x] 2.6a-ii That spec runs in CI. **Re-run it after the extraction** and confirm its result is unchanged —
      the extraction is behaviour-preserving or it is a defect.
- [x] 2.6b Do NOT inherit `MAX_ELEMENTS_PER_VIEW`. The presence measurement is cheaper than the full
      hover+focus contrast composite, so it sweeps every visible focusable element per enumerated view,
      uncapped (D2b). Print the measured count and the view list — the view list is part of the claim.
- [x] 2.6c Record the measured runtime. If an uncapped sweep proves impractical, do NOT quietly reinstate a
      cap: narrow AC2's claim explicitly, name the residual, and give it an owning item.
- [x] 2.6 Do NOT implement presence as a `getComputedStyle(...).outline !== "none"` read — the global
      `:focus-visible` rule makes that assertion true by precondition (D2, MISTAKES.md / HEL-1060). Honoured:
      presence is decided by diffing base-vs-forced `readIndicatorSnapshot` reads across four channels
      (outline/box-shadow/border/background), never by a single-state outline read.

## 3. AC2 — adjudicate the eleven suppression sites

- [ ] 3.1 Measure all 11 sites with the guard from §2 rather than reading their CSS. Shape is not evidence.
      Before calling ANY site conforming or non-conforming, check it against DESIGN.md §8's carve-outs and
      against the existing pins in `focusRingTokenGuard.css.test.ts` (including its `BORDER_INDICATOR_PINS`).
      A site already pinned and owned by another ticket there is out of scope by construction. §8's test is explicit: if the visual
      announces "this is the thing you're typing into / have selected", bare `:focus` is CORRECT; if it
      announces "a keyboard just moved here", it must be `:focus-visible`. Cite §8 for each call. A site that
      passes the existing source guards is not thereby proven to present a visible indicator, and a site that
      looks wrong may be a documented, owned exception — 3.1a states what those guards actually cover.
- [x] 3.1a Know what the existing guards DO reach, so you do not re-implement them:
      `focusRingTokenGuard.css.test.ts` has TWO — the `outline`-colour guard, and the "border/box-shadow
      focus-indicator guard (HEL-1050)" requiring every group declaring `outline: none` to carry a conforming
      ring-token indicator (`border-color`, `border-bottom-color`, `box-shadow`, …) in a `:focus-visible` rule
      of the same group, or a pin. What NEITHER establishes is whether the declared indicator actually PAINTS,
      or how it measures against the backdrop actually composited at paint time. That — plus focus states that
      never declare `outline: none`, which are outside the second guard's trigger — is this ticket's residue.
      Expect it to be small.
- [x] 3.2 **Do NOT touch `AddSourceModal.css:165`.** An earlier draft of this plan called it a defect; that was
      wrong. DESIGN.md §8 documents bare `:focus` as legitimate for exactly this shape (a persistent,
      modality-independent indicator on a text input) and names this very selector as *the example* of it. It is
      orphaned CSS with zero markup references (HEL-1050 D9) and is already pinned in
      `frontend/src/theme/focusRingTokenGuard.css.test.ts` with `owner: "HEL-1052"`. "Fixing" it would contradict
      a documented ruling and duplicate another ticket.
- [ ] 3.2a FOUR of the eleven sites suppress unconditionally in the element's BASE rule — `auth.css:107`,
      `AccentPicker.css:19`, `PipelineDetailPage.css:885`, and `AddSourceModal.css:165` (one `outline: none` in the base rule; the *pair* is the two grouped selectors in
      the separate `:focus` rule below it) — with any
      replacement in a separate later rule. This is precisely what `accessible-focus-indicator`'s existing
      "unconditional suppression is not a focus state" requirement names; measure these four most closely. Re-derive the shape of each site from the file
      rather than from any summary in these planning documents, including this one.
- [x] 3.2b Give particular attention to `PanelGrid.css:253` and `PipelineDetailPage.css:893`: both set
      `outline: none; box-shadow: none;` inside `:focus-visible`, leaving a single border-colour swap as the
      ENTIRE indicator — and `PanelGrid.css:253`'s is `border-bottom-color` alone, one edge of the box.
      Measure these two most closely: they are the thinnest indicators part 2 will accept, and so the
      LIKELIEST — not the expected — finds. A green result on them is a perfectly acceptable outcome; do not
      read this task as a prediction that they will fail. Measure; do not assume either way.
- [ ] 3.2c **Concrete residue-item-3 lead, found during planning — measure it, do not assume the verdict.**
      `frontend/src/shared/ui/inputs.css:60-64`: `.ui-input[aria-invalid="true"]:focus-visible` /
      `.ui-textarea[aria-invalid="true"]:focus-visible` convey focus by `border-color: var(--app-error)` plus
      `box-shadow: 0 0 0 3px var(--app-error-surface)` — NOT the ring token. Part 2 of
      `focusRingTokenGuard.css.test.ts` groups by selector base, so this is the group
      `.ui-input[aria-invalid="true"]`, which does NOT itself declare `outline: none`; part 2's
      `if (!groupDeclaresOutlineNone(decls)) continue;` therefore SKIPS it entirely. Yet the outline IS
      suppressed at paint time, because the lower-specificity `.ui-input:focus-visible` rule (line 39) also
      matches the element. Net: a focused invalid input's only indicator is an error-coloured border + halo
      that no guard has ever measured against the 3:1 floor. This is the shape residue item 3 predicts. Verify
      it renders as analysed before calling it anything — the analysis is CSS reading, and CSS reading is what
      produced three wrong claims already in this planning round.
- [x] 3.2d Enumerate the attribute-qualified blind spot rather than measuring only 3.2c's one site.
      `selectorBase()` does not strip attribute selectors, so ANY `[attr]`-qualified `:focus-visible` variant
      whose `outline: none` is supplied by its unqualified base rule is invisible to part 2. Sweep
      `grep -rnE '\[[a-z-]+(=[^]]*)?\]:focus' frontend/src --include=*.css` and measure each hit. This also
      answers whether 3.2c is a one-off or a systematic gap in the guard itself — if systematic, file a
      spinoff against the guard rather than widening this ticket.
- [x] 3.3 Fix any further site the measurement — not the reading — finds non-conforming.
- [ ] 3.4 It is an ACCEPTABLE outcome for §3 to find zero sites needing a fix. Report that plainly if so; do
      not manufacture a change to justify the section. The deliverable of §2/§3 is the measurement.
- [x] 3.5 Name every site knowingly left non-conforming, with its reason and an owning filed item. Silent
      omission is not completion (`accessible-focus-indicator`, existing requirement).

## 4. AC1 — dialog focus lifecycle

> **DE-SCOPED from HEL-520 and owned by HEL-1062.** The unchecked boxes below are not unfinished work in
> this change — they are this section's handover. Do not read them as an incomplete delivery.

- [ ] 4.1 Enumerate the dialog surfaces reachable in the four AC3 flows **by opening them in the running app**,
      not by grepping for `<Modal` (D3a). Record the list found.
- [ ] 4.2 Measure `MobileNavSheet`'s hand-rolled trap, initial focus, restore and (OverlayProvider-delegated)
      Escape as rendered behaviour. It contains the code; confirm it behaves.
- [ ] 4.3 Judge `Select.tsx` against listbox semantics — trigger retains focus, Escape closes, selection
      refocuses the trigger — not against the dialog trap contract.
- [ ] 4.4 Determine by measurement whether any call site other than the share dialog hits `Modal`'s
      unmounted-trigger restore failure. Generalise the `shareDialogContext` workaround into `Modal` only if a
      second site is found; otherwise record the decision to leave it (D4a).
- [ ] 4.5 Fix any trap/restore/Escape gap the measurement finds.

## 5. AC3 — keyboard-only flows

> **DE-SCOPED from HEL-520 and owned by HEL-1063**, which also owns the focus-presence surfaces this
> change's seeded routes never render. The unchecked boxes below are this section's handover, not
> unfinished work in this change.

- [ ] 5.0 Use REAL `keyboard.press("Tab")` here — NOT the CDP `forcePseudoState` mechanism §2 uses. Sequential
      navigation order is the thing under test; forcing a pseudo-state would assume it away. The two ACs use
      different mechanisms deliberately (D2a).
- [ ] 5.1 Add an e2e spec driving panel-create, appearance-edit, dashboard-switch and detail-modal with real
      `keyboard.press` calls, reading `document.activeElement` after each press. Reuse `hel510`/`hel1003`'s
      `registerAndLogin` helper and its post-login mount-race wait.
- [ ] 5.2 Each flow must reach a committed outcome observable in the app — not merely "focus moved".
- [ ] 5.3 Add a negative control per the `hel1003` precedent: confirm the probe reports failure against a
      deliberately unreachable control before its green result on a real one is trusted.
- [ ] 5.4 Fix any control the walk finds unreachable or inoperable by keyboard.

## 6. AC4 — Jest/RTL unit contract

- [x] 6.1 Add restore-on-close coverage to `frontend/src/shared/ui/Modal.test.tsx` — currently zero restore
      assertions; the trap is already covered by three cases, do not duplicate them.
- [x] 6.2 Confirm `ShareDialogFocusRestore.test.tsx` satisfies AC4's "at least one consuming surface"; extend
      it only if it does not.
- [ ] 6.3 Do not use Jest/RTL as evidence for AC2 or AC3.

## 7. Prove every guard red (D6 — not optional)

- [x] 7.1 Add a `*.regression.spec.ts` harness following `hel813-mobile-touch-target-floor.regression.spec.ts`:
      patch real source into each known-bad shape, re-measure with the SAME shared helper, assert red, revert,
      assert green.
- [x] 7.2a The harness patches a DIFFERENT file set than `hel813` did — confirm the `playwright.config.ts`
      `testIgnore` entry and the revert-on-failure path against the new list rather than assuming they carry
      over.
- [x] 7.2 Reproduce that file's three independent inertness layers exactly: `playwright.config.ts` `testIgnore`,
      the file's own env-var `test.skip`, and `playwright.regression.config.ts`. It mutates tracked source.
- [ ] 7.3 Prove red against three **synthesised** known-bad shapes: (a) an indicator suppressed with no
      replacement, (b) a clipped ring, (c) an occluded ring. Each is patched into real, RENDERING source — not
      a fixture, since a fixture the production path never touches reproduces the same vacuity in a new place.
      **Do not patch `AddSourceModal.css`**: there is no "pre-fix" state (it is unchanged, DESIGN.md-conforming,
      and pinned to HEL-1052), so a guard proven red against it would be a guard that fails a CORRECT site.
      **Patch no file carrying a `BORDER_INDICATOR_PINS` entry.**
- [x] 7.4 Each mutation arm must go RED **for the stated reason, not merely red** — the standard
      `focusRingTokenGuard.css.test.ts` already holds itself to (see its task-4.2 mutation-arm comments, and
      its evaluator CR3 note that fixture-only arms bypassed the whole collection pipeline). Assert on the
      failure's content, and mutate real rendering source rather than a hand-built fixture, or the arm proves
      a different branch than the one it names.
- [x] 7.5 Record each red transcript in `files-modified.md`. A guard that cannot be shown red does not ship.

## 8. Gates and handoff

- [x] 8.1 `npm run lint`, `npm run typecheck`, `npm run check:e2e-types`, `npm run format:check`,
      `npm run check:tokens`, `npm run check:state-contrast:selftest`, `npm test`.
- [x] 8.2 Run the new e2e specs against the running app and record their output.
- [ ] 8.3 If `.husky/**` or anything the pre-commit chain executes is touched, add the
      `## Gate-Chain Implications Checklist` section to `design.md` (D7) and run
      `scripts/concertino/test-gate-in-isolation.sh` per script.
- [x] 8.4 Write `files-modified.md` and commit.
