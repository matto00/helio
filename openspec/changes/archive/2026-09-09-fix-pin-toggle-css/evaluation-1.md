## Evaluation Report — Cycle 1 (evaluation-1.md)

All findings below are from my own fresh runs (gates, e2e spec, and an independent
Playwright probe written from scratch in /tmp), not from the executor's self-report.

### Phase 1: Spec Review — PASS

- AC1 (label ellipsis): implemented via `sortable-th__label` class (`SortableTh.tsx:35`,
  `DataGrid.tsx:945`) + scoped CSS (`DataGrid.css:427-471`). Verified live, see Phase 3.
- AC2 (coarse-pointer row height): `min-height: 48px` → `height: 54px` inside the SAME
  existing `@media (max-width: 430px), (pointer: coarse)` block (`DataGrid.css:709-711`).
  No new breakpoint. `.ui-data-grid__pin-toggle-btn { min-height/min-width: 44px }` is
  untouched (verified in the diff and live-measured at 44x44).
- AC3 (persistence) correctly untouched — no code, test, or verification effort spent on
  it; proposal.md:41 and design.md Non-Goals both record it as out of scope. Confirmed by
  the diff: no pin/unpin logic, no persistence, no backend/schema files.
- AC4/ticket "close the green-for-broken loop": new `e2e/hel1065-pin-toggle-css-fixes.spec.ts`
  (303 lines) makes rendered-geometry assertions; Jest text-only tests kept per D4 (below).
- Scope is tight: 6 source/test files + planning artifacts, no scope creep.
- Owner escalation ruling honoured exactly: the ROW value was raised (48 → 52 → 54) and the
  e2e assertion carries NO tolerance/epsilon — every containment check is a bare
  `toBeGreaterThanOrEqual(thBox.y)` / `toBeLessThanOrEqual(thBox.y + height)`. No weakening.
  design.md D3 carries the full correction record inline.

### Phase 2: Code Review — PASS

Gates re-run by me in the worktree (all green):
- `npm run lint` → 0
- `npm run format:check` → 0
- `npm run typecheck` → 0
- `npm test` → 299 suites / 3193 tests passed (frontend) + 25/248 (helio-mcp), 1 snapshot passed
- `npm --prefix frontend run build` → 0
- No `backend/**` files changed → no sbt run required.

Task 4.1 compliance verified line-by-line in the diff: `DataGrid.test.tsx`'s only functional
change is the row-height regex (`min-height:\s*48px` → `height:\s*54px`) plus an explanatory
comment. The `padding-right: calc(...)` value assertion (~1493) and the same-media-query
co-location assertion against `.ui-data-grid__pin-toggle-btn { min-height: 44px }` are both
present and unchanged.

Other checks: no dead code, no TODO/FIXME, no `any`/type escapes, DRY (reuses
`e2e/support/{touchTargetProbe,forceFocusVisible,focusPresenceProbe}.ts` rather than
reimplementing), no over-engineering, no security surface. The `width: 100%` addition on
`.sortable-th__btn` is a documented, probe-confirmed deviation from design.md D1's literal
text, with the mechanism explained inline — my probe independently reproduces the claim
(with `width: auto` forced back on, the label measures its full untruncated width and the
overlap returns; see Phase 3).

Design-standard [mechanical] rules: no raw colours, no new spacing literals in the label
rules; the only literal is the row-height `54px`, which sits alongside the pre-existing
`44px` touch-target literals in the same block (tap-target floors are not on a `--space-*`
scale here — consistent with `tapTarget.css`/`TableRenderer.css` precedent).

Red-before-green credibility: the spec's structure supports it (each assertion targets a
rendered quantity that is provably different pre-fix), and I verified sensitivity myself by
re-running my probe with the fix neutralized at runtime (see Phase 3 numbers) — every
measured quantity the spec asserts on flips to a failing value.

### Phase 3: UI Review — PASS

Servers: `start-servers.sh` READY on 6497/9404; confirmed the dev server is actually serving
the new code (`curl .../src/shared/ui/DataGrid.css` contains `height: 54px`), so this is not
a stale-reused-server measurement.

Executor's spec, re-run by me: `DEV_PORT=6497 npx playwright test e2e/hel1065-...` → 5 passed.
The spec is NOT in `playwright.config.ts`'s `testIgnore` quarantine list, so it runs in CI.

Independent probe (my own script, separate seeding, separate measurements), both themes:

| quantity | FIXED (light/dark identical) | fix neutralized at runtime |
|---|---|---|
| label.right vs icon.left | 384 vs 409 → **25px clear, overlap −25px** | overlap **+24px** |
| label computed `text-overflow` / `overflow` | `ellipsis` / `hidden`, scrollWidth 322 > clientWidth 75 | `clip` / `visible`, 312 = 312 |
| `<th>` height @400px viewport | **54px** | 34.5px |
| pin button box | **44 x 44** | 44 x 44 |
| button top / bottom margin inside `<th>` | **+4.75 / +5.25** | **−5.0 / −4.5 (clipped)** |
| button left / right margin inside `<th>` | +92 / +24 | +92 / +24 |

Focus-ring extent = outline-width (2) + outline-offset (2) = 4px per edge; measured margins
of 4.75px (top) and 5.25px (bottom) contain it on BOTH edges independently, with 0.75px and
1.25px to spare — i.e. genuine margin, not a razor's edge, and horizontally trivially inside.
This independently confirms the executor's 54px landing and would have gone red at 48px
(margin would be ~1.75-2.25px < 4px).

Ellipsis (not hard clip) confirmed visually, not just by computed style: element screenshots
of the truncating `<th>` in both themes render `aSuperca…` with a visible ellipsis glyph and
the pin icon fully clear of the text.

44px floor: control measured 44x44 in every state; nothing in the diff touches the control's
sizing — only the row's height changed.

Console: zero `console.error` and zero page errors captured across the whole exercised flow
(register → seed → dashboard render → pin via the real toggle → theme switch → resize to
400px → resize back), both themes.

Breakpoints: exercised 1440, 1280 and 400 (plus the spec's own desktop control asserting the
header row stays < 48px outside the media query) — no layout breakage observed.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `tasks.md` 1.3 (and `proposal.md`:16) still say `height: 48px`, superseded by the owner-ruled
  54px. `design.md` D3-correction, `files-modified.md`, the CSS comment and the Jest comment
  all record 54px correctly, so the decision record is sound — but the stale task/proposal
  text is the one place a future reader could "restore" 48px from. Worth a one-line pointer
  to the D3 correction in both.
- `design.md` D7 / tasks 1.2 specify a per-density selector (`.ui-data-grid--<density> ...`);
  the shipped rules use the density-agnostic
  `.ui-data-grid__table thead th.ui-data-grid__th--pin-reserve ...`. This is equivalent in
  scope (still gated on `--pin-reserve`) and DRYer, so it is an improvement, not a defect —
  but the inline comment's phrase "scoped identically to the padding-right rules above" is
  slightly imprecise, since those rules ARE per-density.
