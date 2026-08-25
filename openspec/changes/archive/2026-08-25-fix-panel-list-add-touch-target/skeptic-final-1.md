## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of commit 27adfd07 on `bug/panel-list-add-touch-target/HEL-781`.
Every figure below was produced by me in this session; the evaluator's
evaluation-1.md was read only as a set of claims to test.

### What I verified (with evidence)

**1. Diff scope (ground truth).** `git diff main...HEAD` touches exactly one
source file — `frontend/src/features/panels/ui/PanelList.css` (+19 lines) —
plus the OpenSpec change-dir artifacts. No test files, no TSX, no schema.

**2. Cascade order — confirmed by reading the file, not the claim.**
`PanelList.css`: base `.panel-list__add` rule at lines 48–62; base
`.panel-list__zoom-button, .panel-list__zoom-reset` at 116–133; extra
`.panel-list__zoom-button { width: 22px }` at 135–138. The new floor lives in
the pre-existing `@media (max-width: 768px)` block at **162–190**, i.e. after
every base rule it must override, at equal specificity. This is the inverse of
HEL-535's inert-block defect. Proven behaviourally, not just structurally, by
the 768 vs 769 measurements below.

**3. Live rendered measurement (Playwright, `getBoundingClientRect`).**
Dev servers: `start-servers.sh` reused healthy instances, then
`assert-phase.sh servers` → `PASS servers`. Measured on a real dashboard
(`Demo proposed dashboard`, 1 panel, zoom widget present):

| viewport | `.panel-list__add` | `.panel-list__zoom-button` | `.panel-list__zoom-reset` | `.panel-list__count` |
|---|---|---|---|---|
| 430px | 103.25 × **44** | 0 × 0 (`display:none` parent) | 0 × 0 | 68.41 × **22** |
| 500px | 103.25 × **44** | **44 × 44** | 47.91 × **44** | 68.41 × **22** |
| 768px | 103.25 × **44** | **44 × 44** | 47.91 × **44** | 68.41 × **22** |
| 769px | 103.25 × **28** | **22 × 22** | 47.91 × **22** | — |

- The 769px row is the decisive control: it reproduces the ticket's stated
  "before" figures (28px / 22px) on this very commit. The floor engages at
  ≤768px and not at 769px, so the media block is demonstrably live — an inert
  block would have left 28/22 at 768px too.
- `.panel-list__count` stays 22px at every mobile width: the probe
  discriminates rather than trivially passing (ticket AC 3).
- The 430px zoom 0×0 reading is correct, not a failure: the widget is
  `display: none` below/at 430px (`@media (max-width: 430px)`), matching
  design.md Decision 2's stated 431–768px reachable band.

**4. Gates re-run by me on the current commit** (`frontend/`):
`npm run lint` clean (`--max-warnings=0`); `npm run typecheck` clean;
`npm test` → **254 suites / 2751 tests passed**; `npm run build` succeeded;
`npm run format:check` → "All matched files use Prettier code style!".

**5. UI / design judgment (my domain).** Screenshots at 500px in **dark** and
**light** (`hel781-500.png`, `hel781-light-500.png`).
- Both themes render at parity; the change is token-free geometry so there is
  no light/dark divergence surface, and none observed.
- The enlarged "Add panel" button reads as a normal primary CTA and does not
  disturb the `flex-direction: column` mobile header — count badge and button
  still sit as a coherent right-aligned group; no wrap, clipping or overlap.
- The zoom capsule grows to 189.91 × 52 at 500px (`right: 480`, `bottom: 820`
  in a 500×900 viewport): fully on-screen, clear of the floating BottomNav
  capsule, still legible as one pill. The `−`/`+` glyphs now sit in visibly
  roomier targets — slightly airier than the desktop capsule, but consistent
  with the repo's other 44px mobile controls and an accepted, documented
  trade-off (design.md Risks). Not an off-pattern divergence I would reject.
- Zero console errors across navigation and all four resizes.
- No hardcoded values where a token exists: `44px` is the literal DESIGN.md §8
  floor, written literally everywhere else in this repo (`EmptyState.css:219-228`),
  so this matches the standard rather than inventing a one-off.

**6. Acceptance criteria traced.** AC1 → `PanelList.css:176-178` (placement
proven in §2/§3). AC2 → sibling audit; I re-read every selector in the file
myself and agree the only other interactive controls are the two zoom buttons
(`.panel-list__count` is a badge with no handler; `.panel-list__zoom-level` is
a text span), and both axes are floored, which is required since the base rule
sets `width: 22px`. AC3 → §3 table, measured not declared. AC4 → no `::after`
expander used; the min-height floor is the ticket's stated preference, so
HEL-777's bisection requirement does not apply. AC5 → §7.

**7. Scope call (design.md Decision 3) — I judge it sound, and for a stronger
reason than the one given.** The ticket permits declining *with* a recorded
recommendation, and the decline is recorded in design.md Decision 3, tasks.md
5.1 and the evaluation's notes — so it is not silently dropped. I additionally
checked the precedent the ticket names: this repo has 12 `*.css.test.ts`
static guards, and `EmptyState.css.test.ts` (the closest analogue, itself the
HEL-319 touch-target guard) does **text/brace matching only — it asserts no
source-order relationship between the media block and the base rule**. That is
exactly the test shape that let HEL-535 ship an inert floor. Copying it here
would have produced evidence-shaped non-evidence; a guard worth having must be
order-aware or rendered, which is genuinely its own design surface. Declining
locally and recommending a real follow-up is the correct call, not a cut corner.

### Verdict: CONFIRM

### Non-blocking notes
1. The mechanical-guard follow-up currently exists only as prose in design.md
   Decision 3 / tasks.md 5.1 (`PENDING_ESCALATION: null` in workflow-state.md).
   At Delivery it should actually be filed as a ticket, and it should be
   specified as **order-aware or rendered-measurement based** — a copy of the
   existing text-matching `*.css.test.ts` shape would not catch the HEL-535
   failure mode it exists to prevent (see §7). This is the eighth ticket in
   this class; the per-incident pattern is not converging.
2. The in-file comment says the widget is hidden "below 430px"; the rule is
   `max-width: 430px`, so it is hidden at 430px inclusive. The adjacent
   "431–768px band" wording is correct; only the one word is loose. Cosmetic.
