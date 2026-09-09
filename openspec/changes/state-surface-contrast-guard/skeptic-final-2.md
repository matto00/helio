## Skeptic Report — final gate (round 2, skeptic-final-2.md)

HEAD `037ea0da`. Every number below measured by me: the guard run three times
(baseline + two mutations of my own choosing), and the app rendered at
`http://localhost:6298` with `location.href` + `data-theme` re-read before every
reading. Served bundle self-authenticated (`curl .../DashboardList.css` returns
this branch's `HEL-866 skeptic-final-1B.md CR1` comment blocks and the
`.app-sidebar`-scoped dark overrides). `assert-phase.sh servers` → `PASS servers`.

### 1. Is the partition assertion real and load-bearing? — YES

Read at `e2e/state-surface-contrast-guard.spec.ts:252-330`, then **defeated on
purpose**. I removed `sidebarRailDocIds` from the `assertPartitioned` input array
(only that; the view is still probed) and re-ran. It failed loudly at the FIRST
route, naming exactly the elements round 1 found broken:

```
Error: HEL-866 guard: partition assertion failed for "/" — 18 interactive elements
exist in the rendered document, but only 15 were covered by a declared view.
Uncovered (...):
  button[ui-icon-btn] aria="Add dashboard" "+"
  button[dashboard-list__button] aria="HEL-866 Guard Dashboard" ...
  button[popover__trigger] aria="HEL-866 Guard Dashboard actions" ""
```

Attempts to defeat it analytically also fail: `covered` is built only from
`docId` attributes read off currently-visible elements stamped by *this*
document state, so `covered ⊆ stamped` and the `covered.size >= totalStamped`
count test is equivalent to set equality. Sampling does not weaken it (`docIds`
is populated pre-sample, deliberately). Shadow-DOM/0-box elements can only
*shrink* `covered`, i.e. err toward failing. **The root cause named in the brief
is genuinely fixed for every visited document state.** Mutation reverted;
`git status` clean.

Residual bound (correctly named in `design.md` D6.2, non-blocking): the assertion
runs per *enumerated route*, so route enumeration and the overlay set are still
hand-listed, and the assertion does not run on overlay states. It also only sees
the document in its **default interaction state** — see finding 2, which is
exactly a state the assertion cannot reach.

### 2. Baseline guard run (mine, fresh)

`458 probed, resolved=458, unresolved=0, pass=186, fail=22 (all 22 exempted),
advisory=250` — reproduces the recorded numbers exactly; **1 passed (3.8m)**.

### 3. AC5 mutation-failability — re-proven on MY OWN call site

My first pick (`AddSourceModal.css:216 .add-source-modal__btn--secondary:hover`
→ `--app-surface-raised`) did NOT turn the guard red — I checked before
concluding, and found that class is **dead CSS** (no `AddSourceModal.tsx`
reference). Not a guard defect; my bad pick.

Second pick, a live site neither prior reviewer used:
`DashboardList.css` `:root[data-theme="dark"] .app-sidebar .dashboard-list__button:hover`
→ `--app-surface-raised`. GREEN → RED:

```
[dark] /:sidebar-rail :: button ... [dashboard-list__button] (#7) (hover) — ratio=1.0893
[dark] /sources:sidebar-rail :: a ... (hover) — ratio=1.0893
[dark] /pipelines:sidebar-rail, /pipelines/<id>:sidebar-rail — same
1 failed
```

The guard rejects **1.089**, comfortably above the ticket's 1.040 — a real
threshold test, not an inequality (`classifyState`: `ratio >= 1.1`; selftest
`30 passed, 0 failed`, including the `#232019`/`#262320` = 1.040 must-fail case).
**AC5 met**, and the previously-invisible sidebar rail is now inside the guarded
population. Mutation reverted.

### 4. Round-1 findings — two of three fixed, one NOT

| round-1 finding | status (measured live) |
| --- | --- |
| 1B CR1 `.dashboard-list__button:hover` 1.030 dark | **FIXED** — hover `rgb(38,35,32)` on sidebar `rgb(26,24,22)` = **1.133**; visible band in `dark-sidebar-row-hover-1133.png` |
| 1 CR2 `--expanded` light 1.119 → 1.054 | **FIXED** — card `rgb(255,255,255)` on ancestor-walked `rgb(244,242,237)` = **1.119**, back at its pre-diff value; justification comment rewritten against `--app-bg` |
| 1 CR1 step-card action buttons, light, ratio 1.000 | **NOT FIXED — still exactly 1.000, on the rule this cycle rewrote** |

### 5. The blocking finding — CR1 is still shipping, relocated

`/pipelines/236b13e7-…`, **light**, step card **expanded**, `.pipeline-detail-page__step-card-duplicate-btn` **hovered**:

```
btnBg  rgb(255,255,255)   cardBg rgb(255,255,255)   identical: true   ratio 1.000
```

At rest the button is `rgba(0,0,0,0)`; on hover it becomes the card's own colour.
Reproduced on a second sibling (`…__toggle-enabled-btn`, `identical: true`) after
an independent page reload and theme flip. Screenshot
`.concertino/runs/HEL-866/evidence/skeptic2/light-expanded-stepcard-duplicate-hover-1000.png`
— the hovered icon shows no band at all.

Cause, read from the diff: `--expanded` now sets `background: var(--app-surface-raised)`
**and** `--step-card-hover-bg: var(--app-surface-strong)`
(`PipelineDetailPage.css:298-302`). In light, `--app-surface-raised` and
`--app-surface-strong` are **both `#ffffff`** — the ticket's founding premise.
So the fix moved the collision from soft-on-soft to white-on-white. Dark is fine
(hover `rgb(22,21,20)` on `rgb(38,35,32)` = **1.167**).

The guard cannot see it: it probes each route's default document state, and step
cards render collapsed, so the `--expanded` variant of `--step-card-hover-bg` is
never exercised. This is a fourth instance of the same population shape — this
time an *interaction state* rather than a route or a region.

### 6. Remaining brief items

- **DESIGN.md:561** — corrected; now says `--app-surface-raised` with the family-3
  reasoning. Met.
- **Honest reporting** — `files-modified.md` and the guard's own log now state
  `pass=186 (41% asserted) / fail=22 exempted / advisory=250 (55%, gates nothing)`
  and bound coverage to the 7 routes + 3 overlays; `design.md` D6.2 names
  `/sources/:id` and the `*/review` routes as deliberately excluded. AC2 is now
  honestly qualified. Met.
- **theme.css** — `git diff main...HEAD -- frontend/src/theme/theme.css` is
  **0 lines**; AC4 recommendation recorded and declined. Met.

### AC status

- **AC1 / AC3** — met everywhere I measured EXCEPT the expanded step card in
  light (1.000). Not met as a whole.
- **AC2** — honestly bounded now; met as qualified.
- **AC4** — met. **AC5** — met (mutation-proven by me).

## Verdict: REFUTE

One blocking defect, and it is the ticket's own canonical defect (an exact 1.000
collision, zero hover feedback in the default theme) on the very rule this cycle
rewrote to fix it. This ships a visible bug, so it clears the "would not ship a
defect" bar for CONFIRM.

## Change Requests

1. **`frontend/src/features/pipelines/ui/PipelineDetailPage.css:298-302` — the
   expanded step card's `--step-card-hover-bg` is `--app-surface-strong`, which in
   LIGHT is byte-identical (`#ffffff`) to the same rule's own
   `background: var(--app-surface-raised)`. Measured hovered in the running app:
   `rgb(255,255,255)` on `rgb(255,255,255)`, ratio **1.000**, on
   `…__step-card-duplicate-btn` and `…__step-card-toggle-enabled-btn` (all four
   co-declared siblings at :398-403 share it).** Pick a rung that is measurably
   different from `#ffffff` for the light expanded card — `--app-surface-soft`
   (`#efece6`) gives 1.179 there — while leaving the dark path (currently 1.167)
   alone; i.e. the light/dark assignment for the `--expanded` modifier needs to be
   split the same way the base card's already is. State the measured light AND
   dark ratios in the comment, taken hovered from the running app.

2. **Reach the state the guard structurally cannot: add an expanded step card to
   the `/pipelines/:id` probe.** The partition assertion covers every element in a
   route's *default* document state, which is why CR1 above survived a green
   458-element run. Click the step-card expand toggle before probing that route
   (or probe it as a named overlay-style view), so the `--expanded` variants of
   `--step-card-hover-bg` are actually measured. Then record in `design.md` D6.2
   the residual bound that remains: the guard probes default interaction states
   only, so component sub-states not explicitly opened are unchecked.

## Non-blocking notes

- The commit message's "pass=186 (41%)" and the log's "45% pass/fail-ASSERTED"
  are the same data under two definitions (186/458 vs (186+22)/458). Harmless,
  but pick one denominator in the PR body.
- Overlay views (`command-palette`, `modal:add-source`, `actions-menu`) are probed
  but not partition-asserted — an element added to an open overlay outside the
  overlay's own root would still be missed. Worth a line in D6.2.
- `--app-state-hover` / `--app-state-selected` now has a fourth independent piece
  of evidence behind it: light's `raised == strong == #ffffff` is what turned this
  cycle's fix back into the original bug. File it with this measurement attached.
