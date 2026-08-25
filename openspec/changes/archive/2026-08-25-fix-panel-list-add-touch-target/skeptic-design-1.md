## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/panel-list-mobile-touch-targets/spec.md` in the change dir.
- Read the actual `frontend/src/features/panels/ui/PanelList.css` (193 lines) in full,
  not the plan's description of it. Confirmed:
  - `.panel-list__add` base rule at **lines 48-62**, `height: var(--control-sm)`, no floor. Ticket premise is true.
  - Existing `@media (max-width: 768px)` block at **lines 162-171** (`.panel-list`, `.panel-list__header { flex-direction: column }`).
  - `@media (max-width: 430px) { .panel-list__zoom-widget { display: none } }` at **175-179**.
  - Second `@media (max-width: 768px)` at **189-193** (HEL-774 zoom-widget `bottom`).
  - `.panel-list__zoom-button, .panel-list__zoom-reset` at **116-133**: `height: 22px`;
    `.panel-list__zoom-button` additionally `width: 22px` (**135-138**).
  - `.panel-list__zoom-widget` capsule (**87-104**): `padding: 3px`, **`gap: 2px`**.
  - `.panel-list__count` (**34-43**) has no click handler in markup — a sound discriminator.
- Read `frontend/src/shared/ui/EmptyState.css:210-235` — the cited convention is real and is
  `min-height: 44px` inside `@media (max-width: 768px)`.
- Read `DESIGN.md` §"Control metrics" (lines ~194-224) — the binding text.
- Read `PanelList.tsx:333-357` — zoom widget markup confirms two `.panel-list__zoom-button`s
  and one `.panel-list__zoom-reset`, all real `<button>`s.

**HEL-535 placement hazard — the plan GUARDS against it correctly.** Decision 1 targets the
existing `@media` block at line 162, which is unambiguously *after* the base rule at line 48;
tasks.md 2.1 restates "placed AFTER the base rule". Combined with the mandated
`getBoundingClientRect()` measurement (an inert media query would show 28px and fail), the
HEL-535 failure mode is closed. This part of the design is sound. (Minor ambiguity: Decision 1
says "the block at the bottom of the file" — there are two such blocks (162 and 189); the
parenthetical "which already carries `.panel-list`/`.panel-list__header` layout rules"
disambiguates to 162. Non-blocking.)

**Decision 3 (no mechanical guard) — sound.** The ticket asked for an explicit evaluate-and-
escalate, and the design does exactly that with a real justification (repo-wide "what is an
interactive control" is its own design surface). Declining it here and recommending a follow-up
ticket is the correct call, and it is not silently dropped. No objection.

**Decision 2 (scoping the zoom widget in) — sound in principle, under-specified in execution.**
Reading "sibling header controls in the same file" as "sibling controls in the same file" is a
defensible widening: the two zoom buttons are genuinely touch-reachable in the 431-768px band and
they are the same class of defect. Keeping `.panel-list__count` out (non-interactive) is right.
But the *treatment* the plan prescribes for them is incomplete and its stated fallback is
pre-known to be broken — see Change Requests 1 and 2.

### Verdict: REFUTE

Four defects. #1 and #2 are substantive (the plan as written cannot satisfy DESIGN.md §5 for the
zoom buttons, and its documented fallback is a known-defective pattern at this gap); #3 and #4
are internal contradictions that will misdirect execution.

### Change Requests

1. **Zoom buttons: the plan floors only height, but `.panel-list__zoom-button` is 22px WIDE.**
   `PanelList.css:135-138` sets `width: 22px`. DESIGN.md §"Control metrics" requires a
   "`44px` min-height/**min-width** tap-target floor" for phone-reachable interactive controls.
   design.md Decision 2, tasks.md 3.2/4.1 and the spec's "Zoom-widget controls" scenario all speak
   only of *height*. Applying the plan as written yields a 22x44 target that still violates the
   standard the ticket is enforcing — a fix that measurably "passes" while leaving the defect half
   present. Update design.md Decision 2, tasks.md 3.2/4.1, and the spec scenario to require and
   assert **both** dimensions for `.panel-list__zoom-button` (and width for `.panel-list__zoom-reset`
   if its text-driven width falls below 44px — measure it, do not assume).

2. **The Risks section's `::after` fallback is pre-known to be defective at this capsule's
   `gap: 2px`, and the plan does not record that constraint.** design.md's mitigation says if the
   44px floor visually crowds the capsule, "prefer an `::after` hit-expander (per HEL-777)…
   decided empirically during execution". But DESIGN.md §5 states a 44px expander extends
   `(44 - controlSize) / 2` per side — for these 22px controls that is **11px per side, requiring a
   gap of at least 22px**; `.panel-list__zoom-widget` (line 98) has `gap: 2px`. Choosing that
   fallback mid-execution would reproduce HEL-772's exact overlap defect (adjacent hit regions
   steal each other's taps), and DESIGN.md is explicit that neither computed-style nor box-overlap
   checks can detect it. Either (a) drop the `::after` fallback from the plan for these two
   controls and commit to the box-growing floor, or (b) keep it but record in design.md the
   gap-vs-expander arithmetic above **and** add the ticket's own AC-4 requirement — HEL-777's
   `elementFromPoint` bisection verification with the `>= 44 - samplingStep` epsilon — as an
   explicit task. As written, tasks.md contains **no** task covering that AC at all, so the
   fallback path would ship unverified.

3. **tasks.md 4.1 will measure the zoom buttons at a width where they do not exist.** It says
   re-measure "any sibling controls fixed in step 3 … at 430px and 768px viewports … confirm
   >= 44px at both". At 430px, `PanelList.css:175-179` sets the widget `display: none`, so
   `getBoundingClientRect().height` is **0** — a guaranteed false failure, inviting the executor to
   either "fix" it wrongly or quietly drop the assertion. The spec file gets this right
   ("between 431px and 768px"); tasks.md contradicts it. Correct 4.1 to measure `.panel-list__add`
   at 430px/768px and the zoom controls at 431px/768px (and, optionally, assert the widget is
   genuinely absent at 430px rather than merely short).

4. **design.md's Planner Notes contradict proposal.md and the spec file that already exists.**
   Planner Notes claim "no capability/spec changes — … `specs/` is left empty and the archive step
   will use `--skip-specs`". But proposal.md declares a New Capability
   (`panel-list-mobile-touch-targets`) and
   `specs/panel-list-mobile-touch-targets/spec.md` exists with three ADDED requirement scenarios.
   One of the two is wrong. Resolve it: either delete the stale Planner Note (my recommendation —
   the spec scenarios are the measurement contract and are worth keeping) or drop the capability
   and the spec dir. Leaving both will mislead the archive step.

### Non-blocking notes

- The discriminating control (`.panel-list__count`) proves the probe reads real geometry, but it
  does not prove the *media-query boundary* works. Consider additionally measuring
  `.panel-list__add` at a desktop width (>768px) and confirming it stays ~28px — that guards the
  opposite error (a floor that leaks to desktop, which DESIGN.md explicitly forbids: "it does not
  apply at desktop widths").
- `min-height: 44px` will override the base `height: var(--control-sm)` on `.panel-list__add`;
  that is correct CSS and matches the EmptyState precedent, but the executor should confirm the
  button's `align-items: center` keeps the label/icon optically centred in the taller box rather
  than assuming it.
- `scripts/concertino/next-report-number.sh` and `persist-evidence.sh` are **absent** from this
  worktree's `scripts/concertino/` (only `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`,
  `start-servers.sh`, `lib/`, `README.md` are present); I ran the main checkout's copies instead.
  Not a blocker for this gate, but the final-gate agent should expect the same gap.
