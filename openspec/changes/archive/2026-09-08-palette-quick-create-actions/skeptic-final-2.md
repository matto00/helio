# Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. Everything below is from ground truth I produced myself: the cycle-3 diff, gates run
from `frontend/`, four mutations I executed and reverted (tree clean afterwards, `git status`
empty), and live measurement in the running app on dev 5948 / backend 8855. I did not re-litigate
round 1's verified reach work — I found no evidence of regression in it.

## What I verified (with evidence)

### Gates — run by me, from `frontend/` (evidence rule 1)
- `cd frontend && npx jest` → **280 suites / 2856 tests passed** (one more than round 1: the new
  render-order guard). Not root `npm test`.
- `cd frontend && npm run typecheck` → clean; `npm run lint` (`--max-warnings=0`) → clean.
- `DEV_PORT=5948 BACKEND_PORT=8855 npx playwright test e2e/hel516-palette-quick-create.spec.ts`
  → **10/10 passed (46.0s)** against live servers, including the rewritten determinism case.

### CR1 part 1 — the HelpOverlay churn fix is real and took effect
`HelpOverlay.tsx:127` now memoizes the context value on `[]`; `setIsOpen` is a stable `useState`
setter so the empty dep list is correct, not a lie. Observable effect in the running app: the
palette's live section order is now **Navigation, General, Create** — i.e. plain registration
order, no longer the churn artifact round 1 diagnosed.

### CR1 part 2 — mechanism soundness (I did NOT rule on which order is right)
- The order is genuinely **one place**: `SECTION_DISPLAY_ORDER` in `builtInActions.ts`, the sole
  consumer being `groupBySection` in `CommandPalette.tsx`. Changing the IA is a one-line array edit.
- **Unlisted sections:** the comparator sends any section not in the array (including
  `UNSECTIONED`) after every listed one, tie-broken by first-encountered order. That is a
  consistent, transitive comparator — no crash, no drop, no silent reshuffle of listed sections.
  This is the surface HEL-519/HEL-503 inherit and it degrades correctly for a section they add
  without touching this file.

### CR1 part 3 — the new guards, mutation-tested by me (not trusted from the report)
1. **Reorder the declaration** (`Create` first in `SECTION_DISPLAY_ORDER`) →
   `CommandPalette.test.tsx` **RED** (`"Create"` in the wrong position).
2. **Remove the display sort** (`return sortedOrder.map` → `return order.map`) → same test **RED**.
   This is the important one: the guard feeds sections in the *wrong* encounter order, so it fails
   both when the declaration changes and when the sort that honors it is removed. It is not a
   restatement of encounter order and not vacuous.
3. Both reverted; `git status` clean.

### CR2 — measured live, both surfaces, in the running app (not from CSS)
`git diff main...HEAD -- frontend/src/shared/` is **empty** — `KeyCap.tsx`/`KeyCap.css` genuinely
untouched, so `.ui-keycap + .ui-keycap` remains the sole owner of intra-combo spacing.

| Surface (same `Ctrl`+`J` combo) | 1st cap margin | 2nd cap margin | measured gap between caps |
|---|---|---|---|
| `.help-overlay__row-combo` | 0px | 4px | **4px** |
| `.command-palette__item-combo` (this diff) | 0px | 4px | **4px** |

Wrapper `.command-palette__item-combo` carries the title-to-combo `--space-2` (8px,
`display: inline-flex`). Cap typography is byte-identical across surfaces
(`12px / 4px 8px / 6px` radius). Round 1's 8px/8px mismatch is gone; rhythm now matches exactly.

### UI cohesion — running app, both themes
Screenshots (`.concertino/runs/HEL-516/evidence/skeptic2-palette-theme-a.png` light,
`skeptic2-palette-dark-focus.png` dark with keyboard selection on a row). Eyebrow labels
(`NAVIGATION`/`GENERAL`/`CREATE`) render identically; the four Create rows reuse the shared item
row and plus icon with no one-off styling; caps sit inline after the title (the owner's settled
placement) and are legible in both themes; the keyboard-selection highlight is visible in dark
without an HEL-866-style collision. **0 console errors.** No new cohesion call to escalate.
No screenshots written to `openspec/**`; no `git add -f`.

### Cross-lane hazards checked (raised mid-review by a sibling lane)
- **Port confirmed:** `location.href` on the exact page instance every measurement and screenshot
  above came from (no navigation in between) is **`http://localhost:5948/`**, port `5948` — my own
  lane's dev server, not a one-digit neighbour. The CR2 rhythm measurement and both screenshots are
  against this build.
- **Undefined-custom-property fail-open:** the only `var(--*)` added by cycle 3's CSS is
  `var(--space-2)`; `getComputedStyle(documentElement).getPropertyValue('--space-2')` in the running
  app returns `0.5rem`, matching the measured 8px. It resolves by name — not a silent fallback.
- **Checked boxes:** `tasks.md` has zero unchecked items; the cycle-3 box that matters here (6.2,
  "every guard failable by mutation and labelled as such") is backed by a named test I mutated two
  ways — `CommandPalette.test.tsx:203`. The one box this report explicitly does NOT let stand on its
  own is the churn fix, which has no named test at all; see the judgment section above.

## The judgment you asked for: is the churn fix guarded? **No. It does not block.**

I proved the gap rather than reasoning about it: I reverted the `HelpOverlay` memo to the
pre-fix object literal and ran the **entire** frontend suite — **280 suites / 2856 tests, all
green.** Nothing anywhere fails. The executor's self-report is accurate and, if anything,
understated: the fix is unguarded by unit tests *and* by e2e, because the display-layer sort has
(correctly) decoupled the visible symptom from registration order.

Why I do not block on it:
- What's left unguarded is a **per-render perf defect with no user-visible symptom** — the
  ordering consequence, which was the only observable harm, is now structurally prevented by the
  declared sort regardless of churn. Trading an invisible-symptom guard for a structural fix of
  the visible one is the right trade, not a regression in coverage of *this ticket's* behavior.
- It is **not this ticket's bug**: it is a drive-by fix to already-merged HEL-510 code, correctly
  disclosed as such in `files-modified.md:131-141` for the PR body.
- The fix is defended in practice by an eleven-line comment at `HelpOverlay.tsx:120-126` naming
  exactly why the memo exists and what removing it breaks — the realistic deterrent to a future
  removal, since no linter would flag it either way.

It is a real, if small, coverage gap and I am naming it as such rather than pretending the sort
makes it a non-issue. The right shape of guard already exists in this diff as a proven pattern:
`CreateCommandActions.test.tsx:72`'s register/dispose-churn count (which I re-confirmed failable
in round 1) applied to `BuiltInCommandActions`. That is a follow-up, not a ship blocker.

## Verdict: CONFIRM

Both round-1 change requests are genuinely addressed — CR1 with a sound one-place data mechanism
plus a guard I confirmed fails two different ways, CR2 with exact measured parity in the running
app. The escalated question of *which* section order is correct remains the owner's and is
untouched by me; whichever they pick is now a one-line edit to `SECTION_DISPLAY_ORDER`.

## Non-blocking notes

1. **Unguarded churn fix (above).** Worth a spinoff: a `BuiltInCommandActions` register/dispose
   count guard mirroring `CreateCommandActions.test.tsx:72`. Flagging it, not deferring it to a
   named-but-nonexistent task (evidence rule 4).
2. Round 1's two notes still stand: `CreateCommandActions.tsx`'s primitive dep array is correct
   only by inspection of today's seams (`eslint-disable exhaustive-deps`), and the dashboard
   action's title reads `cta.label` verbatim so it momentarily shows "Creating…".
3. `SECTION_DISPLAY_ORDER` is now part of the surface HEL-519/HEL-503 inherit alongside
   `CommandAction` and the registration pattern — worth one line in their tickets.
