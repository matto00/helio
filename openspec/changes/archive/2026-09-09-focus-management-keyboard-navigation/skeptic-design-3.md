## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold derivation against the worktree at `7b872db9`. I received two mid-review messages from the
planning agent (a D1c rewrite with a self-reported false ground, then a notice that the rewrite had
briefly corrupted `design.md`). I treated both as claims: I read the files from disk before and
after, verified every factual ground myself against the tree, and re-derived every count I rely on.
Nothing below is taken from the planner's narrative or from the two prior skeptic reports.

**Note on the corruption window:** it was real, not merely reported. Between my first and second
reads, `design.md` contained a byte-identical duplicate of the `D1d/D1e/D1f` block and **two
contradictory `D1c` paragraphs**, the trailing one still carrying the retracted "reaches the
`outline` colour channel only" claim. I had drafted three change requests against that state. On
re-read the file is repaired: `grep -n "^\*\*D1" design.md` gives exactly one each of
D1a/D1b/D1d/D1e/D1f/D1c, 255 lines, and a scan for the retracted phrasings
(`colour channel only`, `colour only, never`, `outside it entirely`, `Nothing enforces those`,
`newly in reach`) across `design.md`, `tasks.md` and `ticket.md` returns **zero hits**. The
correction was propagated to all three artifacts, not just the one that was wrong first.

### What I verified (with evidence)

**Round-2 CR1 (task 7.3) — FIXED.** `tasks.md` 7.3 now names three *synthesised* shapes
(suppressed-with-no-replacement, clipped, occluded), requires each be patched into real RENDERING
source rather than a fixture, forbids patching `AddSourceModal.css` with the correct reason ("there
is no pre-fix state… a guard proven red against it would be a guard that fails a CORRECT site"), and
adds **"Patch no file carrying a `BORDER_INDICATOR_PINS` entry."** I read the pin list myself:
`focusRingTokenGuard.css.test.ts:402-418`, exactly two entries, both
`features/sources/ui/AddSourceModal.css` (`.add-source-modal__cell-input`,
`.add-source-modal__cell-select`, `owner: "HEL-1052"`). No instruction anywhere in `tasks.md` would
now edit a pinned site — 3.2 forbids it, 7.3 forbids it, 3.2a only reads it.

**Round-2 CR2 (`forceFocusVisible`) — FIXED, with the right mechanical step.** Verified
independently: `grep -c "^export" e2e/state-surface-contrast-guard.spec.ts` = **0**;
`forceFocusVisible` is a module-local `async function` at `:210` hard-coding the marker
`data-hel866-force-focus` at `:214`. New task 2.6a-i orders extraction into `e2e/support/`, an
import back into the existing spec so it still exercises the shared copy, and namespacing of the
marker; 2.6a-ii requires re-running that CI spec afterward and treats any change in its result as a
defect. That is exactly the shape asked for, and it avoids the dead-duplicate hazard
`stateContrastProbe.ts`'s own header warns about.

**Round-2 CR3 (D1c contradiction) — FIXED, and both of the rewritten D1c's grounds check out — one
of them being the opposite of what the previous draft asserted.**
- Part 1 citation accurate: `focusRingTokenGuard.css.test.ts:309`, "every outline declaration is
  var(--app-focus-ring), none, or a pinned exception".
- Part 2 citation accurate: `describe("border/box-shadow focus-indicator guard (HEL-1050)")` at
  `:600`, with `INDICATOR_PROPERTIES` at `:520` covering `outline`, `outline-color`, all four
  `border-*-color` properties and `box-shadow`, and `checkBorderIndicatorGuard` at `:541` requiring
  each group declaring `outline: none` to carry a conforming ring-token indicator in a
  `:focus-visible` rule of that group, or a pin. **So "focusRingTokenGuard.css.test.ts reaches the
  outline colour channel only" was false**, exactly as the current D1c now states. This was the most
  load-bearing thing I was asked to check, and the artifacts now describe the tree correctly.
- Spec ground verified in the EXISTING spec, not only in the delta:
  `openspec/specs/accessible-focus-indicator/spec.md:54` "The contrast obligation binds on whichever
  mechanism conveys focus", with the "SHALL NOT place the resulting indicator beyond the reach of
  whatever check enforces the floor" sentence at `:57-58`, "Unconditional suppression is not a focus
  state" at `:68`, and "Unfixed sites are named rather than omitted" at `:85`. The delta's
  ratio-enforcing wording and D1c now agree: presence first, then the 3:1 floor on whichever
  mechanism conveyed focus.

**The residue survives contact with the tree — AC2 is NOT already discharged.** I attacked all three
items the planner asked me to attack:
1. *Paint.* Both guards are `fs.readFileSync`-driven regex source parses. Neither establishes
   perceivability. A conforming token-referencing `box-shadow` that is clipped or occluded passes
   both and shows the user nothing. Genuinely unguarded.
2. *Composited backdrop.* The token is derived against surfaces declared in `theme.css`;
   `stateContrast.mjs` exports `compositeStack`/`compositeOver`/`contrastRatio` precisely because a
   real paint-time backdrop is not a declared surface. No source parse can reach this.
3. *Outside part 2's trigger.* `checkBorderIndicatorGuard` opens with
   `if (!groupDeclaresOutlineNone(decls)) continue;` — a border-swap focus state that never declares
   `outline: none` is genuinely outside it.
The residue is real, materially narrower than the earlier framing, and D1c now says so plainly,
including that a null result is a legitimate reportable outcome.

**D2b ("do not sample") — sound.** `MAX_ELEMENTS_PER_VIEW = 24` confirmed at
`state-surface-contrast-guard.spec.ts:67`; the runtime-budget comment at `:36-45` confirms the
existing cost is 10 views x 2 themes x cap x **2** forced states under `test.setTimeout(360_000)`,
so dropping to one state is a genuine per-element halving. Crucially D2b does not *assert* the
uncapped sweep is affordable: 2.6c requires the measured runtime be recorded and, if impractical,
that AC2's claim be narrowed explicitly with a named residual and owning item rather than a cap
quietly reinstated. That is the correct handling of the "completeness asserted rather than checked"
shape, and D2b also names the surviving residual (the view list bounds the claim, so it is printed
with it).

**Base-rule tally — re-derived by me, and correct.** `grep -rn "outline:\s*\(none\|0\)" frontend/src
--include=*.css` gives 11 sites. Opening each rule: base-rule suppressions are `auth.css:107`
(`.auth-field input`), `AccentPicker.css:19` (`.accent-picker__swatch`), `AddSourceModal.css:165`
(`.add-source-modal__cell-input, .add-source-modal__cell-select`) and `PipelineDetailPage.css:885`
(`.ui-input.pipeline-detail-page__footer-output-input`) = **four**, as the artifacts say. The other
seven (`inputs.css:39`, `DashboardList.css:75/156/373/723`, `PanelGrid.css:253`,
`PipelineDetailPage.css:893`) are all inside `:focus-visible` rules. `PanelGrid.css:253` reads
`outline: none; box-shadow: none; border-bottom-color: var(--app-focus-ring-color)` — one edge, as
3.2b describes.

**Other spot-checks, all confirmed:** `theme.css:449` global `:focus-visible { outline:
var(--app-focus-ring); outline-offset: 2px }` (so D2's "vacuous by construction" warning is
well-founded); `Modal.test.tsx` is 264 lines with **zero** occurrences of "restore"/"previously", so
D5/6.1's premise holds; task 2.5's named helpers (`parseColor`, `compositeStack`, `contrastRatio`,
`classifyState`) are all genuinely `export`ed from `stateContrast.mjs`, and `INTERACTIVE_SELECTOR`
is the sole export of `stateContrastProbe.ts` (so siting `FOCUSABLE_SELECTOR` beside it is right);
round-2's `input[type=hidden]` note is addressed in both D1d and 2.4a with the stated reason;
`hel813`'s three inertness layers all exist (`playwright.config.ts:32` `testIgnore`,
`test.skip(!process.env.HEL813_REGRESSION)` at `:29`, `playwright.regression.config.ts` present),
and 7.2a correctly refuses to assume the file list carries over.

**Iron-Law-adjacent checks the brief asked for.** Jest/RTL is confined to AC4 (constraint 1, D5,
6.3) and explicitly barred from AC2/AC3; AC3 stays on real `keyboard.press` (D3, 5.0/5.1) with a
negative control (5.3); nothing rebuilds existing machinery (D1a extends `classifyState`, D2a reuses
the CDP mechanism, D5 extends existing test files); every new guard must be shown red for the stated
reason against real rendering source (D6/D6a, 7.4), which is the correct answer to the
"assertion whose precondition guarantees it" shape, and D2/2.6 names the specific instance of that
shape this ticket would otherwise walk into (`getComputedStyle(...).outline !== "none"`).

### Verdict: CONFIRM

The three round-2 blockers are genuinely fixed, not merely mentioned. The new material — the
rewritten D1c, D2b, the `forceFocusVisible` extraction and the rewritten 7.3 — is itself correct
against the tree on every ground I could test, including the two I was specifically asked to attack.
The plan's own honesty is now its strongest feature: it states that AC2 may find little, that a null
result ships, and it names the three residues that make the work non-vacuous anyway.

On artifact reliability, which the planner invited me to refute on: three planner errors occurred in
this round (the base-rule tally, the "border channel is unguarded" claim, and the splice corruption).
I weighed refusing on that basis and decided against it. All three were corrected in the artifacts
before this gate closed, each correction *replaced* the wrong text rather than accumulating beneath
it, and I independently re-derived every claim the executor will act on. A process that produced
errors and then caught and replaced them is not the same as artifacts that are currently wrong — and
the artifacts are currently right. The residual risk is editorial, and the notes below cover it.

### Non-blocking notes

1. **`tasks.md` 3.2b still says "Treat these as EXPECTED FINDS: a green result on them should draw
   scrutiny, not relief… the most likely genuine AC2 finding", while D1c now says "expect this to
   find little" and calls `PanelGrid.css:253` / `PipelineDetailPage.css:893` merely the *likeliest*
   candidates.** This is the last surviving trace of the pre-correction framing. It is not blocking —
   3.2b ends "Measure it; do not assume either way", and 3.3/3.4 explicitly permit a zero-find
   outcome — but it is a thumb on the scale toward manufacturing a finding, the exact failure D0 was
   written to prevent. Softening "EXPECTED FINDS" to "the likeliest, not the expected, finds" would
   remove it for one line's cost.
2. **D2b's cost argument is per-element, not per-run.** It is true that one forced state is cheaper
   than two, but the uncapped sweep also multiplies the *population*: `FOCUSABLE_SELECTOR` adds
   inputs/textareas/selects/`[href]`/`[contenteditable]`, and the existing guard's own CR1 note
   records 36 in-`<main>` interactive elements on `/settings` alone against a cap of 24. Net run cost
   may well rise rather than fall. This is handled (2.6c records runtime and forbids a silent cap),
   but "materially cheaper" invites the executor to expect a faster run and be surprised by a slower
   one.
3. **D1a still says `INTERACTIVE_SELECTOR` is "reused verbatim".** D1d supersedes this with the
   `FOCUSABLE_SELECTOR` fork, and 2.4a is unambiguous, so an executor following the tasks will do the
   right thing — but the D1a sentence reads as though the existing constant is the population.
4. **Decision-id ordering.** `D1d/D1e/D1f` precede `D1c` in file order. The planner states this is
   deliberate (identifiers, not positions). I agree it is not corruption, and it is not worth
   renumbering; noting it only so a later reader does not mistake it for splice residue a second
   time.
