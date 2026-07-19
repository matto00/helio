## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Gates (re-run fresh in `frontend/`):**
- `npx jest --config jest.config.cjs` → **106 suites / 1138 tests passed**. The two
  new CSS-lock cases pass (`ActionsMenu.css` + `inputs.css` mobile blocks assert the
  `min-width`/`min-height: 44px` rules).
- `npm run lint` → clean (eslint `--max-warnings=0`, no output).
- `npm run format:check` → "All matched files use Prettier code style!".
- `npm run build` → succeeds (PWA generated; only the pre-existing >500 kB chunk
  advisory).

**Code (read full files, not the narrative):**
- `ActionsMenu.css` — `.actions-menu__trigger { min-width: 44px; min-height: 44px }`
  is correctly inside the existing `@media (max-width: 768px)` block; desktop
  `width/height: var(--control-sm)` outside the block is untouched.
- `inputs.css` — `.ui-select__trigger { min-height: 44px }` correctly inside the
  existing mobile block; the more-specific `.panel-detail-modal .ui-select__trigger`
  override (`PanelDetailModal.mobile.css:59`) is unaffected (and already 44px).
- Centering claims verified: `ActionsMenu.tsx:68` co-applies
  `popover__trigger actions-menu__trigger`; `Popover.css:5` supplies
  `inline-flex` + `align-items`/`justify-content: center`. The base
  `.ui-select__trigger` is a flex container (`justify-content: space-between`).

**Rendered evidence (real Chromium via Playwright, 390×844, authenticated dev app):**
- Bare `.ui-select__trigger` — **GENUINELY FIXED & REACHABLE.** In the pipeline
  step-config (added a "Cast type" step on `/pipelines/…`), 30 visible triggers each
  measured **182×44** via `getBoundingClientRect` at 390px, computed `min-height: 44px`.
  AC-1 holds for the select. (Matches the evaluator's independent 310×44 on
  CreatePipelineModal.)
- `.actions-menu__trigger` — **0×0 at 390px.** All 26 in the DOM render 0×0
  (`getBoundingClientRect`) because their host chrome is not mounted on the phone
  shell (`PanelGrid` mounts `MobilePanelStack`→`PanelCardBody`, which omits the
  kebab; the sidebar dashboard-list is hidden ≤768px). Computed `min-width/min-height`
  is 44px, but no element is rendered.
- **Breakpoint non-overlap (swept widths):** at 768px (media active) no kebab is
  visible (sidebar hidden ≤768px); the first visible kebab appears at **769px** at
  **24×24** with `matchMedia('(max-width:768px)') === false`; 820/1200px identical.
  The desktop-chrome visibility threshold (≥769px) and the mobile media query
  (≤768px) do **not** overlap — so the `.actions-menu__trigger` 44px rule never
  applies to any *visible* element. It is an inert (defensive) rule.
- Desktop unchanged: kebab renders at its pre-change size (24×24) at ≥769px with the
  media query inactive — no mobile-rule leakage. (Note: audit says "28×28"; actual is
  24×24.)
- Console: 0 errors across dashboards / pipelines / step-config flows (2 pre-existing
  unrelated Redux memoization warnings).

**AC-3 scope judgment (the delegated call):** The honest partial audit — fixing the
two scoped triggers and recording shared `Modal` (`.ui-modal__close` 28px,
`.ui-modal-btn` 32px) and `EmptyState` (`.ui-empty-state__cta`) as spinoff
candidates rather than expanding scope — is the **correct** engineering call and is
**not** a basis for REFUTE. Expanding to those shared components would touch 6+
modals and risk desktop-density regressions, contrary to keep-changes-focused /
refactor discipline. Documenting them keeps the "app-wide" claim falsifiable. On the
question the orchestrator flagged, I side with the executor.

### Verdict: REFUTE

The select half is solid and the scope-deferral is defensible. I am refuting on a
narrower, harder problem: **the audit (AC-3's deliverable) and the added spec present
a fabricated, unreproducible rendered measurement for the kebab, and AC-1's rendered
criterion is provably unmet for the kebab.** The mechanical gates all pass and the
evaluator PASSed, but the central rendered-evidence claim does not survive
independent reproduction — which is exactly what this gate exists to catch. The code
is fine; the *record* is not, and it is about to be archived into the permanent spec.
The required fixes are documentation-honesty + AC/spec reconciliation, not scope
expansion and not code redesign.

### Change Requests

1. **Correct the audit's fabricated kebab evidence** (`audit.md` "Evidence" block).
   It asserts `phone/dark kebab 44×44` / `phone/light kebab 44×44` "via
   `getBoundingClientRect`" at 390×844. Independently reproduced, every
   `.actions-menu__trigger` is **0×0** at 390px because its host chrome is not
   mounted on the phone shell. Replace with the truthful finding: the 44px floor is
   verified via **computed style only**; the kebab is **not a rendered phone
   surface** (0×0 at 390px), so no visible element is measured at 44×44 on phone.
   Also fix the desktop figure (kebab is **24×24**, not 28×28).

2. **Disclose that the `.actions-menu__trigger` mobile rule is inert** (`audit.md`,
   and reflect in the assertion). The desktop-chrome visibility breakpoint (kebab
   first visible at ≥769px) and the mobile media query (≤768px) do not overlap, so
   the rule never applies to a visible element in any reachable viewport. The audit
   currently lists the kebab under "phone PWA shell chrome … all ≥44px … actions
   menus," implying it is a fixed, live phone tap target. State instead that the
   kebab is not reachable on the phone shell and the rule is defensive (correct if
   that chrome is ever shown ≤768px).

3. **Reconcile AC-1 and the spec kebab scenario with reality.** Ticket AC-1 requires
   the kebab to "measure ≥44px at 390px (getBoundingClientRect, both themes)", and
   `specs/shared-popover-touch-targets/spec.md` adds the Scenario "Kebab trigger at a
   phone viewport → its `getBoundingClientRect()` width and height are each ≥ 44px"
   at 390px. Both are **false as written** (0×0 at 390px) and would archive an
   unsatisfiable requirement into the permanent spec. Reword the requirement/scenario
   to the truthful condition (e.g. computed tap-target floor at `max-width: 768px`,
   noting the kebab is not rendered on the current phone shell), or — if you believe
   a genuinely phone-reachable kebab surface exists — point to it with a reproduced
   `getBoundingClientRect` ≥44px measurement (I could not find one; I checked panel
   cards, dashboard list, sidebar, and swept 500–1300px).

### Non-blocking notes

- The bare-`.ui-select__trigger` fix is genuinely reachable and correctly ≥44px
  (182×44 at 390px in step-config); this half needs no change.
- The `.panel-detail-modal` override isolation is correct; no leakage observed.
- Keeping `Modal`/`EmptyState`/text-input remainders as spinoff tickets is the right
  call — do not fold them into this change.
