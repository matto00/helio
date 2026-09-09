## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Tree: `7b872db9` (worktree HEAD). Every finding below is derived from the files, not from the artifacts' narrative.

### What I verified (with evidence)

**Premise-validation claims — checked, and largely CORRECT.** This is a genuinely well-grounded premise pass; I could not refute its major claims.

- **11 outline-suppression sites**: `grep -rn "outline:\s*\(none\|0\)" frontend/src --include=*.css` returns exactly the 11 files:lines listed. Confirmed.
- **`classifyState` defers the focus channel**: `e2e/support/stateContrast.mjs:185-190` reads `return { verdict: otherChannelChanged ? "advisory" : "fail", ratio: null }` with the comment "HEL-1044's call, not ours". design.md D1's quote is verbatim-accurate. Confirmed — this is a real, load-bearing gap and a correct spine for the change.
- **`theme.css:449`** is `:focus-visible { outline: var(--app-focus-ring); outline-offset: 2px }`. Confirmed — so D2's "a computed-style read is vacuous by construction" is correct and correctly acted on (task 2.6).
- **`AccentPicker.css:19` conforming via line 66**: confirmed, the triple-ring `box-shadow` is at `.accent-picker__swatch:focus-visible` exactly as described.
- **`QuickLauncherOverlay.tsx` renders `<Modal>`** (line 5 import, line 71). **`App.tsx` has no dialog role/element.** **`MobileNavSheet.tsx`** is a hand-rolled `role="dialog" aria-modal="true"` div (`:338`) with `previouslyFocusedRef` restore (`:210`) and a per-keydown Tab trap (`:222-241`). Round-2's correction of round-1's grep artefact is itself correct.
- **Skip link exists**: `App.tsx:206` `.app-skip-link`. Confirmed; correctly excluded as a non-goal.
- **`Modal.test.tsx` covers trap, not restore**; `frontend/src/app/ShareDialogFocusRestore.test.tsx` exists. Confirmed.
- **Regression-harness precedent**: `e2e/hel813-...regression.spec.ts:29` `test.skip(!process.env.HEL813_REGRESSION, ...)`, `playwright.config.ts:32` `testIgnore`, and `playwright.regression.config.ts:34` filtering `baseConfig.testIgnore`. All three inertness layers exist as D6 describes. Confirmed.
- **CI e2e runs by glob**: `.github/workflows/ci.yml:378` `npx playwright test` with no file args. D7's "no gate-chain change anticipated" is correct.

So: this is **not** a plan to rebuild something already built. The measurement gap is real. But six concrete defects make it unimplementable as written — one of which (CR1) would have shipped a regression against a documented ruling.

### Verdict: REFUTE

### Change Requests

**1. `AddSourceModal.css:165` is not a defect — it is orphaned CSS that DESIGN.md §8 rules CORRECT and that an existing pin forbids editing. Task 3.2 would ship a regression.**
The plan's single pinned known-bad shape does not survive contact with the tree:
- **Orphaned.** `grep -rn "cell-input\|cell-select\|add-source-modal__cell" frontend/ --include=*.ts --include=*.tsx --include=*.css` returns **only** the stylesheet itself and the guard test. **Zero `.tsx` applies either class.** Nothing in the running app ever renders an element matching `.add-source-modal__cell-input:focus`.
- **Ruled correct.** `DESIGN.md:815-829` names bare `:focus` a legitimate exception for "a persistent, modality-independent indicator... a text input showing it's the one accepting keystrokes (an accent border, not an outline ring)", and names these two selectors verbatim as **"the example of the shape (bare `:focus` on a text input, correctly)"**.
- **Owned and pinned.** `frontend/src/theme/focusRingTokenGuard.css.test.ts:402-415` carries two `BORDER_INDICATOR_PINS` entries for exactly these selectors, `reason: "orphaned CSS, zero markup references (D9)"`, `owner: "HEL-1052"`, with a header comment stating "D9 forbids editing it".

So ticket.md:76-79, design.md D0's "the outlier"/"the exact shape HEL-1050 was filed against", and **task 3.2's instruction to fix it** are all wrong. Task 3.2 as written would edit CSS a documented ruling calls correct, break a pinned guard, and land inside another ticket's scope. Task 3.1 ("measure all 11 sites with the guard from §2") is also impossible for this site — it never renders. Task 7.3's first red proof is likewise unattainable against it.

Required: remove site 11 from the defect narrative entirely (ticket.md, design.md D0, tasks §3, tasks 7.3), citing `DESIGN.md:815-829` and the HEL-1052 pin as the reason, and record HEL-520 as **not touching it**.

**1a. Consequence the plan must state, not paper over.** With site 11 removed, HEL-520 enters with **zero known concrete AC2 defects**. That is an honest and acceptable position — AC2's deliverable is the measurement, and a measurement that finds nothing is a valid result. But it changes the burden on D6: the red proof can no longer lean on a real pre-existing bad site, so it rests entirely on **synthesised** clipped-ring and occluded-ring cases. design.md must say so explicitly and require that the synthesised mutations patch **real, rendering** source (the `hel813` harness pattern) rather than fixture markup — a synthesised case in a fixture the production path never touches is the same vacuity in a new place. Do not manufacture a "fix" to justify the ticket.

**2. The population selector the design mandates reusing EXCLUDES `input`, `textarea` and native `select` — i.e. most of the sites AC2 targets.**
`e2e/support/stateContrastProbe.ts:31-32`:
```
export const INTERACTIVE_SELECTOR =
  "a, button, tbody tr, [role=option], [role=menuitem], [role=row], [tabindex]:not([tabindex='-1'])";
```
Native form fields carry no `tabindex` attribute, so they match nothing here. Design D1a and task 2.5 mandate reusing `INTERACTIVE_SELECTOR` "as is"; task 3.1 then mandates measuring all 11 sites with that guard. But the sites are overwhelmingly inputs: `inputs.css:39` (`.ui-input`/`.ui-textarea`), `auth.css:107` (`.auth-field input`), `DashboardList.css:75/156/373/723` (four `*-input`s), `PanelGrid.css:253` (`.ui-input.panel-grid-card__title-input`), `PipelineDetailPage.css:885/893` (`.ui-input...`). Only `.ui-select__trigger` (a button) and the swatch button are inside the population today. **The two mandates are mutually unsatisfiable.**

Required: design.md must decide and record how the focus-presence population is defined — extend `INTERACTIVE_SELECTOR` (shared, so the change affects the HEL-866 guard's population and must be assessed for that guard's own results), or define a focus-specific population constant beside it with the reason. Then reconcile task 2.5 and task 3.1.

**3. AC2's universal claim is measured on a 24-element-per-view SAMPLE, and the design never addresses it.**
`e2e/state-surface-contrast-guard.spec.ts:67` `MAX_ELEMENTS_PER_VIEW = 24`, and `collectCandidates` (~:391) takes an even-stride sample when `visible.length > cap`. AC2 is "**No** interactive element is reachable without a visible focus indicator" — a universal. A stride-sampled guard cannot discharge it, and the plan currently says "print the measured element count per view, as the HEL-866 guard does" (task 2.5), which inherits the cap silently.

Required: name the decision in design.md — raise/remove the cap for the focus-presence spec (presence is a cheaper measurement than the full contrast composite; justify the runtime), or explicitly narrow AC2's claim to the measured population with the residual named and owned per `accessible-focus-indicator`'s existing "unfixed sites are named" requirement. A universal AC discharged by an unstated sample is the "completeness claim asserted rather than checked" defect shape verbatim.

**4. Programmatic `.focus()` does not produce `:focus-visible` — the design omits the one mechanism that makes AC2 measurable.**
`e2e/state-surface-contrast-guard.spec.ts:205-232` documents this and works around it with `CSS.forcePseudoState` (`forcedPseudoClasses: ["focus", "focus-visible"]`) over a CDP session, calling it "the only reliable way to render the TRUE `:focus-visible` styling without a real keyboard Tab sequence per element". D2 says only "the element in its focused state, as rendered" and tasks §2 never mention CDP. Every replacement indicator among the 11 sites is keyed to `:focus-visible`; an executor reaching for `locator.focus()` measures a state in which none of them apply and gets a 100%-false-failure run.

Required: design.md D2 states the `CSS.forcePseudoState` mechanism as the binding one for the presence guard, and tasks §2 reference it. Note the resulting tension with AC3 (§5), which correctly uses *real* `keyboard.press("Tab")` — the two ACs deliberately use different mechanisms and that should be said, not left for an executor to rediscover.

**5. ticket.md's premise validation accumulates corrections instead of replacing them.**
ticket.md:33-34 still asserts the round-1 "5 non-shared-Modal surfaces" list (`QuickLauncherOverlay`, `App.tsx`, `Select`, `shareDialogContext`, `MobileNavSheet`) and the "11 sites, each needs an individual determination" framing, with the corrections appended 12 lines later under a separate heading. A reader stopping at line 34 — including an executor skimming for the surface list — gets the refuted answer. MISTAKES.md's rule is that corrections replace decision text rather than accumulating beneath it. Fold round 2 into round 1 and keep the superseded list only as a short "what was wrong and why grep caused it" note.

**6. Neither design.md nor tasks.md cites DESIGN.md §8 — the binding adjudication standard for exactly this question.**
`DESIGN.md:815-825` supplies the operative test for whether a bare-`:focus` indicator is conforming ("if the visual state is announcing 'this is the thing you're typing into/have selected' rather than 'a keyboard just moved here'"), and §8 also governs what counts as a legitimate indicator shape at all. The plan adjudicates eleven sites without once referencing it — which is how site 11 got misclassified as a defect. The same misclassification risk applies in reverse to the other ten: two of them (see notes) reduce to a border-colour swap alone, and whether that clears §8 is a §8 question, not solely a rendered-contrast question.

Required: task 1.1 adds `DESIGN.md` §8 to the mandatory pre-read; §3 states that each site's disposition is judged against §8's test **and** rendered measurement, and that any site already pinned/owned elsewhere (`focusRingTokenGuard.css.test.ts`'s `BORDER_INDICATOR_PINS`) is out of scope by construction.

### Non-blocking notes

- ticket.md:72-75 says the ten non-outlier sites "all suppress the outline *inside* a `:focus-visible` rule". Three do not: `auth.css:107`, `AccentPicker.css:19` and `PipelineDetailPage.css:885` suppress unconditionally in the element's **base** rule, with the replacement supplied in a separate later `:focus-visible` rule. All three are still functionally conforming in shape, and task 3.1's "measure, don't read" makes the plan robust to the mischaracterisation — but the sentence is inaccurate and an unconditional base-rule suppression is exactly what `accessible-focus-indicator`'s existing "unconditional suppression is not a focus state" requirement names.
- Two sites (`PanelGrid.css:253`, `PipelineDetailPage.css:893`) set `box-shadow: none` alongside `outline: none` and leave a **border-colour swap alone** as the entire indicator (one is `border-bottom-color` only). These are the likeliest real AC2 failures once measured; worth flagging as expected finds so a green result on them draws scrutiny rather than relief.
- Tasks §2/§3 never mention **theme**. The ring colour is contrast-derived per theme, and the existing HEL-866 guard iterates both. The focus-presence spec should measure light and dark.
- `focusRingTokenGuard.css.test.ts` is a source-parsing guard already pinning several of these selectors. Worth reading in task 1.1 alongside the e2e helpers — it may already own part of §3's adjudication, and it is where CR1's dead-CSS pin lives.
