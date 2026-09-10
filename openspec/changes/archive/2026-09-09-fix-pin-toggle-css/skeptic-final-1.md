## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `ca835a27`. Every number below is from my own run — my own Playwright
probe (`/tmp/hel1065-skeptic-probe.mjs`, written from scratch, separate account/seed),
my own gate runs, my own screenshots. The evaluator's report was read only as a set of
claims to check; where we agree, I reproduced the measurement independently.

### What I verified (with evidence)

**Ground truth**
- `git diff main...HEAD` read in full (16 files; 6 source/test, rest planning artifacts).
  Source change is exactly: `sortable-th__label` class on the two label `<span>`s
  (`DataGrid.tsx:945`, `SortableTh.tsx:35`), two new scoped CSS rules, `min-height: 48px`
  → `height: 54px` in the existing media query, one Jest regex, one regenerated snapshot.
- No backend, no logic, no persistence code anywhere in the diff.

**AC1 — label ellipsis is a real rendered effect (not a correct-looking declaration)**
Measured live at 1440px, 3 columns pinned via the real pin-toggle control, both themes
(identical values across two independent runs):

| quantity | as shipped | with the fix neutralized at runtime |
|---|---|---|
| label box width | **75px** | 312px |
| label.right → icon.left | **+25px clear**, `overlaps: false` | **−212px**, `overlaps: true` |
| computed `text-overflow` / `overflow` | `ellipsis` / `hidden` | `clip` / `visible` |
| `th.scrollWidth` vs `clientWidth` | 164 > 160 (genuinely truncating) | 414 > 160 |

Neutralization overrode only the four HEL-1065 declarations (`width`/`min-width` on the
button, `max-width`/`overflow`/`text-overflow`/`min-width` on the label). The effect
inverts completely — this fix is load-bearing, unlike the HEL-465 padding-right it
replaces. Visually confirmed in screenshots (`/tmp/hel1065-desktop-{light,dark}.png`):
the header reads `aSuperca…` with a real ellipsis glyph and the pin icon fully clear,
identical in both themes.

**AC2 — row height / focus ring, and the 44px floor**
Measured at a real 400px viewport, both themes:

| quantity | as shipped | fix neutralized (`height: auto`) |
|---|---|---|
| `<th>` height | **54.00px** | 34.50px |
| pin-toggle button box | **44 × 44** | 44 × 44 |
| button top / bottom margin inside `<th>` | **+4.75 / +5.25** | **−5.00 / −4.50 (clipped)** |

Focus-ring extent past the control is `outline-width (2) + outline-offset (2) = 4px`
(global `:focus-visible`), so 4.75/5.25 contains it independently on both edges with
0.75px/1.25px to spare — real margin, not a razor's edge, and it would have gone red at
the ticket's literal 48px (~1.75–2.25px). **The 44px floor was never touched**: the
button measures 44 × 44 in the fixed tree, in the neutralized tree, and in the pre-fix
geometry — only the row grew. Visually confirmed: `/tmp/hel1065-coarse-dark.png` shows a
**complete, unbroken rounded focus ring** fully inside the header row, versus the two
disconnected clipped bars HEL-465 shipped.

**Assertions are not tolerant of any known defect (instruction 2)**
Read `e2e/hel1065-pin-toggle-css-fixes.spec.ts` line by line. Every containment check is
a bare `toBeGreaterThanOrEqual(thBox.y)` / `toBeLessThanOrEqual(thBox.y + height)` — no
epsilon, no tolerance, no `toBeCloseTo`, nothing that would absorb the ~2.25px clip that
triggered the escalation. The overlap check is a bare `overlaps === false`, and it is
guarded against vacuity by an explicit `scrollWidth > clientWidth` precondition (164 vs
160 in my run — the fixture really does truncate). The 44px floor is asserted directly.
Every quantity the spec asserts on flips to a failing value under my neutralization, so
these assertions genuinely go red against the pre-fix behaviour. The spec is **not** in
`playwright.config.ts`'s `testIgnore` quarantine (grep: 0 hits) — it runs in CI.

**Retained Jest tests still guard real invariants (instruction 3)**
Nothing was deleted. `DataGrid.test.tsx`'s only functional change is the row-height regex
(`min-height:\s*48px` → `height:\s*54px`). Still present and unchanged: the
`padding-right: calc(var(--space-3) + var(--space-9))` value assertion (the label fix now
*depends* on that reservation), the `--pin-reserve` applied/not-applied scoping pair, and
the same-media-query co-location guard asserting `.ui-data-grid__pin-toggle-btn { min-height: 44px }`
and the row rule live in the **same** `@media` block. The narrowing is correct: the Jest
tests are now explicitly labelled as declaration-text guards, with the rendered-effect
proof moved to the e2e spec.

**AC3 / persistence correctly out of scope (instruction 5)**
No pin-persistence code, test, or verification anywhere in the diff; `proposal.md` and
`design.md` Non-Goals both record it. Zero effort spent.

**Gate suite, run by me in the worktree**
- `npm run lint` → clean (`--max-warnings=0`)
- `npm run typecheck` → clean
- `npm run format:check` → clean
- `npm test` → 299 suites / 3193 tests + 1 snapshot, all pass (plus helio-mcp 25/248)
- `npm --prefix frontend run build` → succeeds
- `DEV_PORT=6497 npx playwright test e2e/hel1065-...` → **5 passed**
- No `backend/**` changes → no sbt gate required
- `git status` clean except the evaluator's untracked `evaluation-1.md`

**Server freshness (MISTAKES.md trap)** — `start-servers.sh` reported "reusing"; I checked
the served asset rather than trusting it: `curl http://localhost:6497/src/shared/ui/DataGrid.css`
contains `height: 54px` and `sortable-th__label`. Not a stale-server measurement.
`assert-phase.sh servers` → `PASS servers`.

**Regression sweep on the rest of the diff**
- `SortableTable.test.tsx.snap` regeneration is exactly the class addition, nothing else.
- The new CSS is scoped to `th.ui-data-grid__th--pin-reserve`, so `SortableTh`'s other
  consumers keep their current sizing.
- The `height: 54px` rule also matches the new HEL-451 per-column **filter row** `<th>`s
  (they live inside `<thead>`). I measured this specifically: the filter row renders at
  **61px** naturally (44px input + padding) — above the 54px floor, so the rule has no
  effect on it, the input sits fully inside, and the row renders correctly in both themes
  (`/tmp/hel1065-filterrow.png`). No regression.
- Zero `console.error` and zero page errors across the whole exercised flow (register →
  seed → render → pin via the real control → theme switch → resize to 400px), both themes.
- Spec delta (`specs/table-panel-column-pinning/spec.md`) is accurate, value-agnostic
  (no hardcoded 48/54), and maps one-to-one onto the e2e scenarios.

**Design judgment (my call, not the evaluator's)** — the ellipsized header reads cleanly
at both densities I saw; the 54px coarse-pointer header row is proportionate against the
61px filter row and the body rows, not lumpy; light/dark parity is exact in every
measurement and screenshot. The only literal added (`54px`) sits beside the pre-existing
`44px` tap-target literals in the same block, consistent with `tapTarget.css` precedent —
tap-target floors are not on a `--space-*` scale here. Nothing off-pattern.

### Verdict: CONFIRM

The two HEL-465 fixes are, this time, demonstrably non-inert: both flip under runtime
neutralization, in both themes, in two independent runs of my own probe. The new
assertions have no tolerance that could re-admit the defect, the retained Jest guards
still cover the structural invariants the CSS depends on, and the 44px floor was never
compromised.

### Non-blocking notes

1. `frontend/src/shared/ui/DataGrid.css` (the HEL-465 comment block above the
   `padding-right` rules, ~lines 395-400) now contains claims this change falsified:
   "the label still hard-clips rather than ellipsizing", and "`.sortable-th__btn` has no
   ellipsis affordance of its own today … that pre-existing gap is unrelated to this
   ticket and not fixed here". The HEL-1065 comment 20 lines below does correct the
   record explicitly, so a reader gets the truth — but the stale paragraph is worth a
   one-line "superseded by HEL-1065 below" next time this file is touched.
2. The same file's coarse-pointer comment says the rule is "scoped to the header row only
   (`thead th`); body/filter-row cells … don't need this". The filter-row cells *are*
   `<th>`s inside `<thead>` and do match the selector. Measured consequence-free (61px >
   54px, see above), so this is a comment-accuracy nit, not a defect.
3. `tasks.md` 1.3 and `proposal.md`:16 still say `height: 48px`, superseded by the
   owner-ruled 54px. The durable artifacts (spec delta, CSS comment, Jest comment,
   `design.md` D3 correction, `files-modified.md`) all carry 54px correctly, so the
   decision record is sound; these two are the only places a future reader could
   "restore" 48px from.
