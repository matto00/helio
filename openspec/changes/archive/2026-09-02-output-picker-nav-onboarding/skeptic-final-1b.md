## Skeptic Report — final gate, Axis B: Frontend UX / DESIGN.md / Accessibility (round 1, skeptic-final-1b.md)

Dimension-split fan-out. This report covers ONLY the frontend UX / DESIGN.md-compliance /
accessibility axis. Backend data integrity and migration/deletion hygiene are two sibling
skeptics' ground and are deliberately not assessed here.

Filename note: `next-report-number.sh` returned `number=1` / `skeptic-final-1.md`, but the
orchestrator assigned this sub-run the `-1b` suffix precisely because the parallel siblings
would each be handed the same `1`. Written as `skeptic-final-1b.md` per that instruction.

---

### Environment / freshness

- `git log -1 --format=%cI HEAD` → `2026-09-02T00:11:04-07:00` (commit `2913739b`).
- `start-servers.sh` reported both already healthy and reused them. Process start times
  (`ps -eo pid,lstart`): backend `sbt run` JVM pid 2327076 started **Wed Sep 2 00:15:23**
  (after the commit — good); Vite pid 2237598 started **Tue Sep 1 23:51:02** (before the
  commit). Vite dev serves modules transformed from disk per request, and every CSS rule and
  DOM behavior I asserted below was read out of the **served** stylesheet /
  live DOM (`document.styleSheets` walk, `getComputedStyle`), not from source — so the
  findings are of the current tree regardless. Flagged for transparency, not as a caveat on
  the findings.
- **Shared-browser contention (real, observed):** the parallel sibling skeptics drive the
  same Playwright session. Mid-review the page was navigated to `/metrics` and dashboards were
  switched out from under me, and the picker was opened/closed by another agent. Every
  finding below was therefore captured and **re-reproduced** before being recorded; the two
  keyboard findings were each run twice with matching results.

### What I verified (with evidence)

| # | Check | Evidence | Result |
|---|---|---|---|
| 1 | Picker opens, groups by pipeline, marks already-placed, accessible names on every card | Playwright a11y snapshot of `.output-picker` — 50+ pipeline groups, e.g. `button "My chart (skeptic-repro-5), already on this board"`, `button "Add Text panel"` | PASS |
| 2 | Search filter, content-panel row, escape-hatch links present | source + live snapshot (`Content` heading + 4 content buttons) | PASS |
| 3 | Arrow-key nav moves real focus | live: after `ArrowDown`, `document.activeElement` is still `.output-picker__search`; `aria-activedescendant` = `null`; list `role` = `null`; focused card has no `id` | **FAIL** (F1) |
| 4 | Focused item scrolls into view | live, run twice: 25 × ArrowDown → `scrollTop` stays `0`, focused card `top: 2211px` vs container `bottom: 796px`, `visible: false`. Re-run with 10 presses: `scrollTop: 0`, `cardTop: 2602`, `visible: false` | **FAIL** (F1) |
| 5 | Output-panel sheet has no field-mapping/aggregation control and no Data tab | live: opened a real output panel → Edit. Sheet text = `APPEARANCE / Title / Background / Text / Preview / Transparency / OUTPUT / My chart / Swap output / Used on 1 dashboard`. `hasFieldMapping: false`, `[role=tab]` count 0. Output link → `/pipelines/bda615a8…?outputId=9808a214…` | PASS |
| 6 | Content-kind panels' tab structure unchanged vs `main` | `git show main:…/PanelDetailModal.tsx \| grep -i tab` → only `isTablePanel` hits; no tab UI on `main` either. No regression | PASS (see N1) |
| 7 | Onboarding Done button DESIGN.md compliance | `OnboardingChecklist.css:165-212` — Primary recipe (`--app-accent` / `--app-accent-ink`, hover `--app-accent-strong`), `--control-sm`, `--app-radius-sm`, `--text-xs`, `--weight-medium`, plus a touch-gated `::after` 44px expander with `position: relative` | PASS |
| 8 | Done-button guard is genuinely computed-style-based and proven red-first | `OnboardingChecklist.test.tsx:352-407` — reads the REAL `.css` off disk with `fs.readFileSync`, injects it as a `<style>` tag, asserts `getComputedStyle(...).getPropertyValue("background")`. Companion `(red-before-green)` test blanks the governing rule via regex AND asserts `expect(brokenCss).not.toEqual(realCss)` so the red case can't pass for the wrong reason | PASS — this is a genuine guard, not a docstring claim |
| 9 | 5-destination nav on desktop sidebar and 375px bottom nav | live a11y snapshot: `navigation "Primary"` = Dashboards / Data Sources / Data Pipelines / Connectors / Assistant. At 375px, bottom-nav anchors = same five. No Data Types or Metrics anywhere | PASS (see F6 on order) |
| 10 | Mobile nav sheet Assistant create-action (HEL-789) actually works | live at 375px on `/chat`: `.mobile-nav-sheet__create-action` renders "New chat"; `elementFromPoint` at centre ±21px both resolve inside the button (44px hit region); **clicked it** → sheet dismissed, conversation list re-rendered. Not merely test-asserted | PASS |
| 11 | Light/dark parity of the picker | screenshots in both themes; light renders correctly with the same structure/token resolution | PASS |
| 12 | Picker search input control metrics | live `getComputedStyle(.output-picker__search).height` = **36px** | **FAIL** (F3) |
| 13 | Picker focus-ring behaviour | live: input `outline: rgb(249,115,22) solid 2px`, `outline-offset: 2px`, input `top` === scroll-container `top`, container `overflow-y: auto` → ring clipped; corroborated visually in the light screenshot (only a bottom sliver of the ring paints) | **FAIL** (F4) |

---

### Verdict: REFUTE

Five of the seven briefed axis items pass cleanly — the Panel-sheet negative requirement, the
onboarding Done button **and** its regression guard, the 5-destination nav, and the HEL-789
mobile Assistant create action are all genuinely done and genuinely verified. The Output
picker itself is where 11 executor cycles left real defects: its keyboard model is
non-functional for anyone actually using a keyboard, and it is the one new surface in this
change that visibly diverges from DESIGN.md on multiple binding `[mechanical]` rules.

---

### Change Requests

**1. `OutputPicker.tsx:129-143` — arrow-key navigation does not move focus and does not scroll; the picker is not keyboard-operable.**
`specs/output-picker/spec.md` ADDED "Picker is keyboard-operable": *"arrow keys move focus
through the grouped list"*. They do not. `handleKeyDown` only mutates the `focusedIndex`
React state, which paints a CSS class. Live-reproduced twice:

- DOM focus never leaves the search input (`document.activeElement.className ===
  "output-picker__search"` after `ArrowDown`).
- There is no `aria-activedescendant`, no `role="listbox"`/`role="option"`, and the cards
  carry no `id` — so this is not the sanctioned virtual-focus pattern either. A screen-reader
  user pressing ArrowDown is told **nothing at all**; the selection is a purely visual class.
- The container never scrolls the "focused" card into view. After 25 ArrowDowns the
  highlighted card sits at `top: 2211px` while `.output-picker__inner` ends at `796px`, with
  `scrollTop` still `0`. A keyboard user's highlight silently disappears off-screen and
  `Enter` then places a panel they cannot see.

Fix one of the two legitimate patterns, completely: either move real DOM focus
(`cardRefs[i].current?.focus({preventScroll:false})` plus `scrollIntoView({block:"nearest"})`,
with `tabIndex` roving), or implement `aria-activedescendant` with `role="listbox"`/`option`,
stable card `id`s, and manual scroll-into-view. Add a test that asserts `document.activeElement`
(or `aria-activedescendant`) after an arrow press — the current tests can pass while the
widget is inert to assistive tech.

**2. `OutputPicker.tsx` — `ArrowLeft`/`ArrowRight` are unhandled in a multi-column grid, and `ArrowDown` moves one cell sideways.**
Live at 1440px: `getComputedStyle('.output-picker__cards').gridTemplateColumns` =
`"220.656px 220.672px 220.672px"` — a 3-column grid. `ArrowDown` advances `focusedIndex` by
**one**, i.e. one cell to the *right*, not down a row; `ArrowLeft`/`ArrowRight` do nothing.
Either handle Left/Right (±1) and Up/Down (±columnCount), or render the list as a genuine
single-column list so the axis semantics match what the arrows do.

**3. `OutputPicker.css:9-16` — the search field is a hand-rolled `<input>` at a non-token height, bypassing the `TextField` primitive.**
Three distinct binding-rule breaks in one control:
- DESIGN.md §6: `TextField` is the canonical primitive and explicitly accepts
  `type: "search"` (`TextField.tsx:6`). `grep -rn 'type="search"' frontend/src` returns
  **exactly one hit — `OutputPicker.tsx:176`**; every other input in the app uses `TextField`.
  "Use these; do not hand-roll equivalents. **[mechanical]**"
- DESIGN.md §3 control metrics: measured live at **36px**. The sanctioned set is
  `--control-sm` 28 / `--control-md` 32 / `--control-lg` 40. "**[mechanical]** No other
  control heights."
- DESIGN.md §3 touch floor: text inputs take the *grow-the-box* mechanism (`min-height: 44px`
  under `@media (max-width: 768px), (pointer: coarse)`). `OutputPicker.css` has no touch-gated
  rule at all, so the picker's primary control is a 36px target on a phone.

Replacing the raw `<input>` with `<TextField type="search" aria-label="Search outputs" />`
resolves all three at once.

**4. `OutputPicker.css:9-16` + `.output-picker__inner:5` — the auto-focused search input's focus ring is visibly clipped to a bottom-edge sliver.**
The input is `searchRef.current?.focus()`-ed on open (`OutputPicker.tsx:53-55`), so this is the
first thing the user sees. Measured live: input `top` = 166px is *identical* to
`.output-picker__inner`'s content top, the container is `overflow-y: auto` (which also clips
the x-axis), and the global ring is `outline: 2px` at `outline-offset: 2px` — so the ring's
top and both sides fall outside the scroll box and are clipped. Visible in the light-theme
screenshot: only the bottom edge of the accent ring paints, reading as a stray underline.
DESIGN.md §8 covers exactly this: *"use `-2px` inset only where the ring would clip"*, and
further specifies that **inputs replace the ring entirely with an accent border +
`--app-accent-dim` halo** — neither is implemented (`.output-picker__search` has no `:focus`
or `:focus-visible` rule at all; confirmed by walking the served `document.styleSheets`).

**5. `OutputPicker.css:70-75` — the hover state paints an accent structural border and a focus-ring-shaped outline.**
The served rule, read from `document.styleSheets`, is verbatim:

```
.output-picker__card:hover, .output-picker__card--focused {
  border-color: var(--app-accent); outline: 2px solid var(--app-accent); outline-offset: -1px;
}
```

- DESIGN.md §0.3: the accent *"is **never** used for structural borders, hover washes on
  neutral controls…"*. `border-color: var(--app-accent)` on `:hover` is precisely that.
- Collapsing hover and keyboard-focus into one identical treatment means mousing over any card
  makes it look keyboard-focused — and since there is no `:focus-visible` override, a real
  Tab-focused card gets the global `outline-offset: 2px` ring while the emulated arrow-key
  "focus" gets `-1px`: two different focus indicators inside one widget.
- `outline-offset: -1px` is unsanctioned; §8 allows `2px`, or `-2px` only where the ring
  would clip.

Split the rule: hover → `--app-border-strong` + `--app-surface-raised` (§5 Secondary recipe);
selection/virtual-focus → the §8 ring at a sanctioned offset; and add a real `:focus-visible`.

**6. `PanelDetailModal.tsx:105-118` (+ `binding.css`) — the new Panel-sheet Output section is entirely unstyled; "Swap output" is not styled as a button.**
`grep -rn "swap-output\|output-link\|placements-note" frontend/src/features/panels/ui/detailModal/*.css`
returns **no matches** — `.panel-detail-modal__swap-output-btn`,
`.panel-detail-modal__output-link`, `.panel-detail-modal__output-link-loading` and
`.panel-detail-modal__placements-note` are all dead class names with no rule anywhere.
Visible consequence (light-theme screenshot of a real output panel's sheet in edit mode):
"Swap output" renders as bare, **centre-aligned**, borderless, background-less text stretched
to the full width of the `display: grid` parent — no height, no radius, no hover, no focus
treatment — while every sibling in the section is left-aligned. It reads as a caption, not an
action. DESIGN.md §5: every button must match one of Primary / Secondary / Ghost / Danger at
`--control-sm/md`, `--app-radius-sm`, `--weight-medium`, `--text-xs/sm`; *"A new button style
is a defect, not a variant."* No style at all is strictly worse. The `<Link>` likewise falls
back to UA default link rendering, and the `<p>` placements note keeps its UA margins on top
of the grid `gap`. Give the section real rules (Secondary recipe for the button).

**7. `OutputPicker.tsx:187-200` — loading and empty states bypass the §7 primitives.**
Loading renders `<p className="output-picker__status">Loading outputs…</p>`; empty renders a
hand-rolled `<div className="output-picker__empty">`. DESIGN.md §7 is explicit: loading uses
*"the established spinner pattern … or a skeleton"* (`Spinner`/`Skeleton` are shared
primitives, §6) and *"**Empty:** render `EmptyState` — never render nothing."* Use `Spinner`
(or `Skeleton`) and `EmptyState` (whose `cta` slot is the natural home for the "New pipeline"
/ "Ask the assistant" escape hatch this requirement mandates).

**8. `OutputPicker.css:26,48-52` — two hardcoded values where tokens exist.**
- `color: var(--app-danger, #d64545)` — `--app-danger` is defined in **both** theme blocks
  (`theme.css:173` dark, `:219` light), so the `#d64545` fallback is unreachable dead code and
  is still a literal hex in component CSS. §3 **[mechanical]**: *"No hardcoded hex/rgb/rgba in
  component CSS or TSX where a token applies."* Drop the fallback.
- `.output-picker__group-heading` is a section label (uppercase, muted, tracked) — i.e. an
  eyebrow — but diverges from the §3 eyebrow recipe three ways: measured live it renders in
  **Schibsted Grotesk** (recipe: mono), at **12px** `--text-xs` (recipe: `--text-micro`), with
  a hardcoded **`letter-spacing: 0.04em` / 0.48px** where `--eyebrow-tracking` (0.14em) is the
  token. §3: *"Use the `.eyebrow` utility or copy its recipe."* Apply `.eyebrow`.

**9. `OutputPicker.css:54-58` — grouping-by-pipeline against a 3-column grid leaves ~70% of the modal empty across a very long scroll. [judgment]**
Each pipeline group gets its own `repeat(auto-fill, minmax(180px, 1fr))` grid. In the live
data most pipelines have exactly one Output, so each group paints one ~220px card and leaves
two empty columns — repeated across 50+ groups. The light-theme desktop screenshot shows this
plainly: a narrow ragged column of single cards down the left third of a `size="lg"` modal.
This is the picker's primary surface and an experienced eye reads it as broken layout rather
than as grouping. Pick a remedy (single-column rows for single-entry groups, a denser
group-header + inline-cards row treatment, or letting cards flow across group boundaries with
sticky headers) — the current shape should not ship as the default view.

**10. `specs/nav-section-registry/spec.md` — the delta's own scenario contradicts the shipped order.**
The ADDED scenario says the nav-visible entries are *"exactly Dashboards, Pipelines, Sources,
Connectors, Assistant, **in that order**"*. The shipped registry (`sections.ts:44-87`) and its
lock test (`navDestinations.test.ts:12-19`) are **Dashboards, Data Sources, Data Pipelines,
Connectors, Assistant** — Sources before Pipelines. The shipped order is the better one (it
mirrors the source → pipeline → dashboard model this change's own onboarding rewrite teaches),
so the fix is to correct the spec text, not the code. Left as-is, the change archives a spec
that its own test suite contradicts.

---

### Non-blocking notes

- **N1 — `specs/panel-detail-modal/spec.md` describes a tab structure that does not exist on `main` either.** The ADDED requirement says content-kind panels *"retain their existing Appearance/Data-tab structure … unchanged"*, but `git show main:…/PanelDetailModal.tsx` has no tab UI at all (the only `tab` matches are `isTablePanel`). No regression — content panels genuinely are unchanged — but the requirement text asserts a pre-existing structure that isn't there, which will read as false to a future reader. Worth a wording correction; possibly the migration-axis sibling's call.
- **N2 — "Used on N dashboard(s)" pluralization and distinct-dashboard counting are correct.** Verified live: `Used on 1 dashboard`, and `OutputPanelSection` de-dupes via `new Set(placements.map(p => p.dashboardId))`.
- **N3 — Duplicate pipeline names produce visually identical adjacent groups** ("HEL-328 smoke pipeline (renamed)" appears as five separate groups). This is dev-data noise, not a defect, but it compounds finding #9's scroll length.
- **N4 — Onboarding was verified statically, not live.** Findings 7/8 in the table rest on the CSS rules plus the (genuinely rigorous) real-CSS-injection computed-style test. I did not reset first-run state to render the checklist live, because the DB and browser are shared with two concurrently-running sibling skeptics and resetting onboarding state would have corrupted their sessions. The static evidence is strong and I'd not gate on a live re-check, but noting the scope honestly.
