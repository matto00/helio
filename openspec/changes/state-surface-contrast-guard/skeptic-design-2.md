## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Numbers re-derived from the tree, not trusted from the plan.

**CR1 — genuinely resolved.** The rendered ancestor walk does reach a real surface for the
canonical exemplar. `frontend/src/features/commandPalette/ui/CommandPalette.css:62`
sets `.command-palette__item { background: transparent; }`; `frontend/src/shared/ui/Modal.css:5`
sets `background: var(--app-surface-strong)` on the ancestor the item renders inside. A walk to
the first painted ancestor therefore lands on exactly the pair that IS the defect — which the
static heuristic could not. The same shape holds for the transparent-background majority: their
backdrop is an ancestor and an ancestor walk is the correct instrument for it. Task 2.3 requires
this be verified explicitly for `.command-palette__item`. No objection.

**CR6 population — the count is real.** My own parse of `frontend/src/**/*.css` for state-selector
rules with a background declaration returns **45** accent-based declarations, matching design.md
D3/D4 exactly. `theme.css:172-173,223-224` confirms the `color-mix(..., transparent)` shape. Task
1.4 puts them in the population with a stated abort ("or report that the threshold needs revisiting
**before** the guard is written"). The *inclusion* half of CR6 is addressed; the *measurement* half
is not — see CR1 below.

**CR3 — resolved.** Task 3.8 now requires a call site the guard **resolves and reports green**,
and a transcript showing green→red naming element, ratio and theme. Non-vacuous.

**CR2 — adequate, if weaker than ideal.** Task 2.7 requires resolved/unresolved and
pass/fail/advisory counts before remediation, forbids the bulk-exemption escape ("Any exemption is
a reviewed diff entry with a written reason"), and states the ceiling in both directions. The
~116-exemption failure mode is foreclosed structurally rather than by promise: the rendered design
has no fail-closed-unresolved bucket to allowlist. The ceiling itself is still executor-stated
after the first run; that is acceptable because no a-priori number is derivable here. Not blocking.

**CI gating is achievable.** `.github/workflows/ci.yml:368` runs `npx playwright test` by glob
governed by `playwright.config.ts` (`testDir: "./e2e"`), so a new `e2e/` spec is gated on landing.
Task 4.1's instruction to verify the job's actual selection is right, and the answer is favourable.

**D4a split and the pre-commit drop — sound.** Advisory-for-shadow-only correctly avoids absorbing
HEL-1044 (D7) while still failing nothing-changed-at-all, which is the class this ticket owns.
Dropping the static pre-commit guard is the honest call: a 28%-coverage hook reports a coverage
number that reads as a guarantee. Stated, not compensated with a weaker check.

**Flakiness risk — mitigation is real but thin.** Settle-before-read plus page-identity assertion
are the right controls and the harness already exists. No runtime budget is stated for hovering a
whole-app population across themes and viewports; noted, not blocking.

**D6.2 — an honest qualification, not a hollowing-out.** Unlike round 1's D6.3, it does not remove
the mechanism's ability to see the class; it bounds the route list, and task 5.2a makes that scope
legible in the PR. Acceptable.

### Verdict: REFUTE

The rewrite is a strict improvement and CR1/CR3/CR6-inclusion are genuinely closed. Three defects
remain, two of them in load-bearing places: the measurement is wrong by construction for exactly the
28% accent family CR6 was raised about, and the shipped spec delta still describes the *abandoned*
static design.

### Change Requests

1. **The rendered guard does not "resolve to what actually paints" for the 45 alpha-composited
   accent states — specify compositing or the threshold is applied to a colour that is never
   painted.** `theme.css:172-173,223-224` define `--app-accent-surface` / `--app-accent-dim` as
   `color-mix(in srgb, var(--app-accent) 15%/10%, transparent)` — i.e. **alpha < 1**.
   `getComputedStyle(el).backgroundColor` returns that colour *with its alpha*, not the composited
   result; D4's claim "At runtime they resolve to what actually paints" is false for this family,
   and D4.3 specifies `getComputedStyle` as the reading instrument. Comparing an
   `rgba(accent, 0.15)` value against the backdrop as though it were opaque **overstates** the
   difference, so the failure mode is silent false passes on 45/161 (28%) of the population — the
   very family CR6 asked to be validated. Required: state in D4 (and task 2.1/2.3) that the guard
   alpha-composites the state colour over the resolved backdrop before computing the ratio, and
   that the ancestor walk accumulates *partially* transparent ancestors rather than terminating on
   the first `alpha > 0` one (D4.2's "first non-transparent painted background" is undefined for
   alpha in (0,1)). Task 1.4's confirmation must be run against the composited values, not the
   declared rgba.

2. **The `state-surface-contrast-guard` spec delta still specifies the abandoned static design and
   contradicts D4/D6.2.** `specs/state-surface-contrast-guard/spec.md` requires the population "SHALL
   be derived by **parsing the stylesheet set**", with the scenario "*WHEN a stylesheet gains a new
   interactive state background and no inventory file is updated THEN that new state is included in
   the checked population*". Under the rendered guard the population comes from the rendered DOM and
   is bounded by the visited routes (D6.2) — a new state on an unvisited route is **not** included,
   so the delta asserts a guarantee the implementation will not provide. This is the durable artifact
   that outlives the change dir. Rewrite the requirement and its scenarios to describe derivation
   from the rendered application (no hand-maintained component/file inventory) and to carry the
   route-scope qualification honestly.

3. **tasks.md 6.4 still names the round-1 gap list and contradicts D4a.** It reads "Expected from
   design.md D6: the equal-luminance hue gap (D6.1) and **the absence-shaped-state gap (D6.3), which
   the guard cannot detect by construction**." D4a now claims absence detection as the guard's most
   important capability, and D6.3 is now "states reachable only behind data or permissions". Correct
   6.4 in place to route out D6.1 (equal-luminance hue) and D6.2 (route-bounded coverage), which are
   the two the design itself says qualify the claim.

4. **Two D6 "closed" claims have no task behind them; one of them is not verified anywhere.**
   D6 lists pseudo-element-expressed states as closed via `getComputedStyle(el, '::after')` (real
   instance `DataGrid.css`'s `.ui-data-grid__resize-handle:hover::after`), but **no task in section 2
   or 3 mentions pseudo-elements at all** — 2.2 enumerates elements, 2.4 re-reads computed style.
   Add the pseudo-element read to task 2.2/2.4 and a self-test case in section 3, or move the item
   back to the open list. (The breakpoint-scoped claim *is* tasked — 2.5 covers viewports — so that
   one stands.)

### Non-blocking notes

- Task 5.3's "independent" enumeration draws on the same selector families as task 2.2, so it is
  independent in *judgment* (a human eye on whether state is visible) rather than in *population*.
  That is still worth having — it catches a correct query with a broken classifier — but the word
  "independently" overstates it; consider saying what it is actually independent of.
- Section 1 is ordered 1.1, 1.2, 1.4, 1.3. Cosmetic.
- No runtime/duration budget is stated for the walk (all interactive elements x themes x viewports x
  routes). A guard that times out in CI gets disabled as surely as a flaky one.
- Task 1.3's "expected 58" and design.md's 45/161 accent figure both reproduce against the tree at
  this gate.
