## Skeptic Report — final gate, Axis B: Frontend UX / DESIGN.md / Accessibility (round 2, skeptic-final-2b.md)

Dimension-split fan-out, round 2 of a 2-round budget. Covers ONLY the frontend UX /
DESIGN.md / accessibility axis, re-verifying the four blocking findings from
`skeptic-final-1b.md` against the executor's fix commit `52222878`.

Filename note: `next-report-number.sh` returned `number=1` / `skeptic-final-1.md` (it does
not see the `-1a/-1b/-1c` suffixed siblings). Written as `skeptic-final-2b.md` per the
orchestrator's sub-run suffix assignment, exactly as in round 1.

### Environment / freshness

- HEAD = `52222878` (`2026-09-02T00:45:42-07:00`), the fix commit.
- `start-servers.sh $PWD 6341 9248 HEL-909` → both already healthy, reused. Backend
  `/health` = `200`. Vite pid 2237598 started `Tue Sep 1 23:51:02`, i.e. **before** the
  commit — so I proved the served bundle is current rather than assuming it:
  `curl -s http://localhost:6341/src/features/panels/ui/OutputPicker.tsx | grep -c OPTION_ID_PREFIX`
  → `4`. Vite transforms per-request from disk; the served module is the fix commit's.
  Every assertion below is read from the **live DOM / `getComputedStyle`**, not from source.
- Shared Playwright session with sibling agents again; the two failing measurements were each
  **reproduced twice** with matching results before being recorded.

### What I verified (with evidence)

| # | Round-1 CR | Check | Evidence | Result |
|---|---|---|---|---|
| 1 | CR1 | listbox/option/activedescendant markup exists | live: `.output-picker__groups` has `role="listbox"` `id="output-picker-listbox"`; 95 `[role=option]`; search input publishes `aria-activedescendant="output-picker-option-0"` and carries `aria-controls` | PASS |
| 2 | CR1 | activedescendant advances on ArrowDown, target has matching id + `role=option` + `aria-selected=true` | live: after `ArrowDown` → `output-picker-option-1`, `role=option`, `aria-selected="true"`, DOM focus stays on the search input (correct virtual-focus pattern) | PASS |
| 3 | CR1 | focused option scrolls into view | live: 25 × ArrowDown → `scrollTop` 0 → **2360**, focused card rect `top 638 / bottom 720` inside container `152 / 721`, `visible: true` (round 1 had `scrollTop 0`, `visible: false`) | PASS |
| 4 | CR1 | **Enter places the currently-focused item** | live: filtered to 3 distinct options, ArrowDown ×2 → activedescendant `option-2` = "Markdown Eval2"; Enter → picker closed and a **markdown** panel appeared ("No content yet. Open panel settings to add markdown.") | PASS |
| 5 | CR1/CR2 | ArrowLeft/ArrowRight handled | source `OutputPicker.tsx` handleKeyDown: Down/Right advance, Up/Left retreat through the flattened reading order; documented rationale. Live Arrow presses advance monotonically when the pointer is outside the list | PASS |
| 6 | CR1 | **Arrow-key navigation is stable while the pointer rests inside the modal** | live, run **twice**: pointer parked over a card, then 12 × ArrowDown → activedescendant sequence `31,32,33,34,32,33,34,35,33,34,35,36` and (re-run) `34,35,36,37,35,36,37,38,36,37,38,39` | **FAIL (F1)** |
| 7 | CR4 | hover is visually distinct from focus | live (light): hovering `#output-picker-option-30` yields `class="… output-picker__card--focused"`, `aria-selected="true"`, `outline: rgb(249,115,22) solid 2px`, `outline-offset: 2px` — byte-identical to the keyboard-focus treatment. Dark screenshot `hel909-r2-picker-dark-hover.png` shows the merely-hovered card wearing the full accent ring | **FAIL (F2)** |
| 8 | CR4 | hover no longer paints an accent *border* | live: hovered card `border-color: rgba(33,29,25,0.2)` === `--app-border-strong`; `background: #ffffff` === `--app-surface-raised`. The §0.3 structural-border violation itself is genuinely gone | PASS |
| 9 | CR3 | search input is the shared `TextField` | live: `class="ui-input output-picker__search"`, `<input type="search">` — same `ui-input` structure as `TextField`'s other call sites (`TextField.tsx` composes `["ui-input", …, className]`) | PASS |
| 10 | CR3 | token-scale height | live `getComputedStyle(.output-picker__search).height` = **32px** = `--control-md` (was 36px) | PASS |
| 11 | CR3 | focus treatment no longer clipped | live on focus: `outline: none`, `border-color: rgb(249,115,22)`, `box-shadow: 0 0 0 3px rgba(accent,.08)` — the §8 *input* recipe (accent border + halo), not a ring. `.output-picker__inner` now has `padding: 4px`; measured clearance left `4px` / right `4px` vs a 3px halo → fits | PASS |
| 12 | CR2 | Panel-sheet Output section is really styled | live on a real output panel's sheet in edit mode: `__swap-output-btn` = height **28px** (`--control-sm`), `1px solid rgba(33,29,25,0.11)` (`--app-border-subtle`), radius **6px** (`--app-radius-sm`), `12px`/`500`, `justify-self: start`, width 97px (no longer full-width centred text); hover → `border rgba(33,29,25,0.2)` + `bg #ffffff` + `color --app-text`. `__output-link` = accent, 14px/500, `justify-self:start`. `__placements-note` = 12px muted, `margin: 0`. Screenshot `hel909-r2-sheet-light.png` | PASS |
| 13 | CR2 | light/dark parity of the new sheet CSS | dark: btn `color #9b948a`, `border rgba(242,239,233,0.09)`, transparent bg; note `#9b948a`; link accent. Screenshot `hel909-r2-sheet-dark.png` — all tokens resolve, nothing hardcoded through | PASS |
| 14 | CR7/CR8 | shared primitives + eyebrow | source+live: `Spinner` in the loading status, `EmptyState` with `cta`/`secondaryCta` for the escape hatch, `--app-danger` fallback hex dropped, group headings now carry `.eyebrow` (dark screenshot shows mono/uppercase/tracked) | PASS |
| 15 | — | Round-1 CONFIRMs not regressed | Panel sheet: `[role=tab]` count **0**, no field/aggregation control (`modalText` = `APPEARANCE … OUTPUT / My chart / Swap output / Used on 2 dashboards`), output link → `/pipelines/f0783001…?outputId=b81ae5a5…`. Nav: live a11y snapshot `navigation "Primary"` = Dashboards / Data Sources / Data Pipelines / Connectors / Assistant. `git diff 2913739b..52222878` touches **zero** files under `frontend/src/features/onboarding`, `frontend/src/shared/ui` chrome or `frontend/src/app`; the onboarding computed-style guard is intact (4 × `getPropertyValue` in `OnboardingChecklist.test.tsx`), `MobileNavSheet.tsx`'s create action untouched | PASS |

---

### Verdict: REFUTE

Six of the round-1 change requests are genuinely, verifiably fixed — the Panel-sheet Output
section (CR6/2), the `TextField` search input and its focus treatment (CR3/3 and CR4/4), the
accent-as-structural-border violation (CR5 in part), and the primitive/eyebrow/token nits
(CR7, CR8). The listbox markup and scroll-into-view of CR1 are real, and `Enter` places the
correct item.

But one line in the fix — `onFocus` was replaced with
`onMouseEnter={() => setFocusedIndex(index)}` on both card types — undoes the two headline
fixes at once. It makes the pointer a second, competing driver of the *same* virtual-focus
state, so (a) keyboard navigation is non-monotonic and partly unusable whenever the cursor
happens to be over the list, and (b) hover and keyboard focus remain the identical accent
ring, which is precisely what CR4/CR5 asked to be separated. Both are reproduced, live.

### Change Requests

**1. `OutputPicker.tsx` (the `onMouseEnter={() => setFocusedIndex(index)}` handler on the output card and on the content card) — arrow-key navigation is hijacked by the pointer and moves backwards.**
`scrollIntoView` moves cards under a stationary cursor; Chromium re-hit-tests on scroll and
fires `mouseenter`, which resets `focusedIndex` to whatever card slid under the pointer.
Live, with the cursor parked inside the modal (the state the user is in the instant after
clicking "Add panel"), 12 ArrowDown presses produce — **reproduced twice, identical shape**:

```
31,32,33,34, 32,33,34,35, 33,34,35,36
34,35,36,37, 35,36,37,38, 36,37,38,39
```

Twelve presses advance the selection five positions, with a visible three-step jump
*backwards* every fourth press. The `output-picker` spec's ADDED "Picker is keyboard-operable"
requirement ("arrow keys move focus through the grouped list") is still not satisfied for the
common case. Fix: do not let hover write the keyboard-focus index. Either drop
`onMouseEnter` entirely (hover already has its own `:hover` CSS and does not need to move
virtual focus), or gate it behind a real pointer *move* (track `lastPointerXY` and ignore
`mouseenter` events whose coordinates are unchanged since the last keyboard-driven scroll).
Add a regression test that arrows N times and asserts `aria-activedescendant` ends at index N
after a synthetic `mouseenter` has fired on an unrelated card in between — the current
`OutputPicker.test.tsx` additions never fire a pointer event, so they pass while this is broken.

**2. `OutputPicker.css:58-72` + the same `onMouseEnter` — hover and keyboard focus still render as one identical accent ring, so CR4 is only half fixed.**
The CSS split is correct in isolation (`:hover` → `--app-border-strong` / `--app-surface-raised`;
`--card--focused` → `outline: 2px solid var(--app-accent); outline-offset: 2px`), but because
`onMouseEnter` adds `output-picker__card--focused` to the hovered card, the accent branch is
what actually paints on hover. Measured live (light theme) on a merely-hovered, never-arrowed
card: `outline: rgb(249,115,22) solid 2px`, `outline-offset: 2px`, `aria-selected="true"`.
Corroborated visually in dark: `hel909-r2-picker-dark-hover.png` shows the hovered card with
the full orange ring. DESIGN.md §0.3 — the accent is not a hover wash on neutral controls —
and the round-1 objection that hover must be visually distinguishable from focus both still
stand. Removing the hover→state coupling in CR#1 fixes this at the same time; if hover is
deliberately meant to preselect, it must use the neutral treatment only and leave the accent
ring exclusively to keyboard focus. Please also add a computed-style guard (the pattern
`OnboardingChecklist.test.tsx` already uses) asserting the hovered card's `outline-color` is
not the accent.

### Non-blocking notes

- **N1 — `aria-activedescendant` can point outside the listbox it declares.** The search input
  sets `aria-controls="output-picker-listbox"`, but the Content row is a *second*
  `role="listbox"` (`aria-label="Content panels"`, no `id`) whose options share the same
  `OPTION_ID_PREFIX` index space. Arrowing past the last output moves the active descendant
  into a listbox the input does not control — invalid per the ARIA listbox pattern. Either
  merge the two into one listbox with two `role="group"`s, or extend `aria-controls`.
- **N2 — cards are `tabIndex={-1}` with `onFocus` removed**, so the only way to reach them is
  the search input's arrow keys. That is a legitimate listbox choice, but it means CR#1's
  defect is the *sole* keyboard path into the widget — hence blocking rather than cosmetic.
- **N3 — the search input is not sticky**; measured `top: -3402px` after scrolling, i.e. it
  scrolls out of the `overflow-y: auto` container. Pre-existing, judgment-only.
- **N4 — round-1 finding #9 (grouping-by-pipeline leaving ~70% of a 3-column grid empty across
  a 50-group scroll) was not addressed** and was not in the four blocking items I was asked to
  re-check. Still my judgment that this reads as broken layout at desktop width, but I am not
  re-raising it as blocking in a final round.
- **N5 — screenshots** written to `/home/matt/Development/helio/hel909-r2-sheet-light.png`,
  `hel909-r2-sheet-dark.png`, `hel909-r2-picker-dark-hover.png` (Playwright's output dir is the
  main checkout, not this worktree).
