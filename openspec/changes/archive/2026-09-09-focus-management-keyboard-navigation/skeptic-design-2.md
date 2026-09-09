## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Derived from the files in the worktree, not from the revision narrative. I also received a
mid-review message from the planning agent about a tally correction; I re-derived that tally
myself rather than accepting it.

### What I verified (with evidence)

**Round-1 CR1 — mostly addressed, one residue (see CR1 below).** `ticket.md:73` and
`design.md:11` now state `AddSourceModal.css:165` is NOT a defect, cite DESIGN.md §8 and the
HEL-1052 pin, and state plainly that HEL-520 enters with zero known concrete AC2 defects.
Task 3.2 now forbids touching it. Verified against `DESIGN.md:817-829`, which names
`.add-source-modal__cell-input:focus` / `__cell-select:focus` verbatim as "the example of the
shape (bare `:focus` on a text input, correctly)". Correct. **But task 7.3 still requires the
first red proof to be "the pre-fix `AddSourceModal.css` bare-`:focus` raw-accent border".**

**CR1a — addressed.** design.md D6 now says "The known-bad shapes to prove against are
synthesised, since no live defect is known going in", and requires each be "produced by patching
real source, measured with the same shared helper, then reverted". That is exactly what was
asked. It is contradicted only by 7.3.

**CR2 — addressed and correct.** `e2e/support/stateContrastProbe.ts:31-32` confirmed to be
`a, button, tbody tr, [role=option], [role=menuitem], [role=row], [tabindex]:not([tabindex='-1'])`
— no `input`/`textarea`/`select`. D1d's resolution (a separate `FOCUSABLE_SELECTOR` beside it,
shared compositing core reused, `INTERACTIVE_SELECTOR` not widened in place) is the right call and
its stated reason is verifiably true: `state-surface-contrast-guard.spec.ts` imports that constant
and would change population, and its per-view sampling means the *sampled subset* would shift too,
so a widen-in-place could redden surfaces this ticket never examined. Task 2.4a matches, and 2.5
now says `FOCUSABLE_SELECTOR`, reconciling the previously-unsatisfiable pair.

**CR3 — addressed.** `MAX_ELEMENTS_PER_VIEW = 24` confirmed at
`e2e/state-surface-contrast-guard.spec.ts:67`. D2b takes the "narrow the claim explicitly" option
and 2.6b operationalises it (sampled count AND true total printed; AC2 reported *partially met*
rather than softened if the universal cannot be made true). Residual naming is carried by 3.5.
Acceptable.

**CR4 — addressed.** D2a and task 2.6a both name `CSS.forcePseudoState`; verified the mechanism and
its 100%-false-failure history at `state-surface-contrast-guard.spec.ts:194-232`. D3 correctly keeps
AC3 on real `keyboard.press`, and the two-mechanism split is now stated rather than left to be
rediscovered. (One implementability gap remains — CR2 below.)

**CR5 — addressed.** `ticket.md`'s premise section is now a single corrected statement; the refuted
"5 non-shared-Modal surfaces" list survives only as a method warning about `grep '<Modal'`, which is
the right shape.

**CR6 — addressed.** DESIGN.md §8 is now cited in ticket.md constraint 6, design.md D1e, and tasks
1.2 / 3.1, with §8's actual test quoted accurately, and pinned/owned sites declared out of scope by
construction.

**Non-blocking notes from round 1 — all three addressed, and the tally is now correct.** I
re-derived it: `grep -rn "outline:\s*\(none\|0\)" frontend/src --include=*.css` gives 11 sites, and
opening each shows **four** base-rule suppressions — `auth.css:107`, `AccentPicker.css:19`,
`PipelineDetailPage.css:885` (line 885 is inside the base block; 893 is a *separate*
`:focus-visible` suppression), and `AddSourceModal.css:165`. ticket.md:44-50 and task 3.2a now say
exactly this. Confirmed correct. D1f/2.5a cover both themes (matching
`state-surface-contrast-guard.spec.ts:627`). 3.2b flags `PanelGrid.css:253` /
`PipelineDetailPage.css:893` as expected finds.

**Not rebuilding existing machinery.** D1a/D1c/D5 stay inside the reuse decision; nothing here
duplicates `focusRingTokenGuard.css.test.ts` or the HEL-866 core. Jest/RTL is scoped to AC4 only
(D5, tasks 6.3, constraint 1). Both confirmed.

### Verdict: REFUTE

Three defects; two are small edits, one is a direct self-contradiction that would send an executor
into the exact regression round 1 blocked.

### Change Requests

**1. Task 7.3 still orders the executor to reproduce the `AddSourceModal.css` "pre-fix" shape as a
red proof — contradicting task 3.2, design.md D0 and D6 in the same document set.**
`tasks.md:121`: "Prove red against: the pre-fix `AddSourceModal.css` bare-`:focus` raw-accent
border; a clipped ring; an occluded ring." There is no "pre-fix" state — the file is unchanged and
`3.2` forbids changing it; the shape is DESIGN.md-conforming, so a guard proven *red* against it is
a guard that would fail a correct site. Worse, the 7.1/7.2 harness "patches real source", i.e. this
step would edit the very file that carries an `owner: "HEL-1052"` pin. This is the round-1 CR1
residue: the defect narrative was removed from ticket.md/design.md/§3 but not from §7.
Required: rewrite 7.3 to name three *synthesised* known-bad shapes consistent with D6 — an
indicator suppressed with no replacement, a clipped ring, an occluded ring — each patched into real,
*rendering* source (not a fixture, and not `AddSourceModal.css`), and state explicitly that no site
is patched that carries a `BORDER_INDICATOR_PINS` entry.

**2. Task 2.6a instructs the executor to "reuse `state-surface-contrast-guard.spec.ts`'s existing
`forceFocusVisible` helper", but that helper is not importable.**
Verified: `grep -n "^export" e2e/state-surface-contrast-guard.spec.ts` returns **nothing**;
`forceFocusVisible` is a module-local `async function` at `:210` inside a spec file, and it hard-codes
the marker attribute `data-hel866-force-focus`. An executor following 2.6a literally will either
copy it (creating the dead-duplicate hazard `stateContrastProbe.ts`'s own header comment warns
against, and the same hazard D1a invokes as its reuse rationale) or silently deviate.
Required: design.md/tasks state the mechanical step — extract `forceFocusVisible` into
`e2e/support/` (alongside the other shared probes), have `state-surface-contrast-guard.spec.ts`
import it from there so the existing guard still exercises it, and generalise or namespace the
`data-hel866-*` marker. Note that this touches a spec that currently runs in CI, so its result must
be re-measured after the extraction.

**3. design.md D1c and the `accessible-focus-indicator` spec delta give the executor opposite
instructions about contrast.**
D1c: "**Do not re-litigate contrast.** ... This change adds **presence**". The spec delta
(`specs/accessible-focus-indicator/spec.md`, requirement "A focus state conveyed only by outline,
border, or shadow is adjudicated rather than deferred") says that indicator "SHALL be measured
against the non-text contrast floor" and "the result is a pass or a failure". A spec delta is
normative; D1c says the ratio belongs to HEL-1046/1050/HEL-533. As written an executor cannot tell
whether the new `classifyState` branch returns a *ratio-enforcing* verdict (spec) or a
presence-only verdict (D1c) — and the difference decides whether §3's eleven sites can newly fail
on contrast grounds already owned elsewhere.
Required: pick one and make both documents say it. If the intent is "presence, and where an
indicator IS present the existing floor applies", say that explicitly in D1c and confirm the
spec-delta wording matches; if the intent is presence-only, the spec delta's "measured against the
non-text contrast floor" sentence must be rewritten.

### Non-blocking notes

- D1d's proposed `FOCUSABLE_SELECTOR` includes `input:not([disabled])`, which matches
  `input[type=hidden]` (and `type=hidden` is not focusable). Worth an explicit exclusion so the
  population count is not inflated by unfocusable elements — the kind of silent population error
  that makes a coverage number look better than it is.
- ticket.md:46 and task 3.2a still call `AddSourceModal.css:165` "the pair". It is a single
  `outline: none` declaration; the *pair* is the two grouped selectors in the separate `:focus`
  rule below it. Harmless given both lines say "re-derive from the file", but the tally has now been
  wrong twice in this planning round, so precision here is cheap insurance.
- `stateContrast.mjs` (the shared core, JS) and `stateContrastProbe.ts` (TS) are different modules;
  tasks 2.1 and 2.4a correctly target each, but 2.5's "reusing the existing
  backdrop-resolution/compositing helpers unchanged" spans both. Naming which helper comes from
  which module would remove one guess.
- 7.2's "reproduce that file's three independent inertness layers exactly" is right, but the
  regression harness will now patch a *different* set of files than hel813 did. The
  `playwright.config.ts` `testIgnore` entry and the revert-on-failure path should be confirmed
  against the new file list, not assumed to carry over.
