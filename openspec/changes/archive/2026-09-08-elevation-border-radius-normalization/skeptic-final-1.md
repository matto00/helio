## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is derived from a command I ran in this worktree, not from
`evaluation-1.md` or `files-modified.md` (read as claims only).

Commit under review: `964268d4`, base `3a0c0fe8`. Diff = 16 files / +1506 −39; the only product CSS
touched is 3 files, comment-only.

### What I verified (with evidence)

**0. Provenance (before any visual observation).**
`ss -lptn` → DEV 5874 listener pid 1709167, `/proc/1709167/cwd` =
`…/HEL-442/frontend`; BACKEND 8781 pid 1708966, cwd `…/HEL-442/backend`. Content
self-authentication: `curl http://localhost:5874/src/features/panels/ui/DividerPanel.css | grep -c "HEL-442 D2"`
→ `1` (a string this commit introduces; absent on `main` by construction of the diff). Every visual/computed-style
observation below is on that verified server.

**1. `tokenAuditSweep.css.test.ts` — the highest-risk item. Verified; it catches exactly what it did on `main`.**
I extracted the 42 `PipelineDetailPage.css` pins from *both* `3a0c0fe8` and `HEAD` and independently re-scanned
each revision of the CSS with the guard's own predicate (`(margin|padding|gap)(-[a-z]+)?:\s*[0-9.]+(px|rem|em|%)`
minus `line.includes("var(--space")`):

- `3a0c0fe8`: 42 pins, 42 fresh-scan hits, **set-identical** (`setEqual true`).
- `HEAD`: 42 pins, 42 fresh-scan hits, **set-identical** (`setEqual true`).
- Ordered **declaration text** at each pinned line, main vs HEAD: `diff` → **IDENTICAL** (byte-for-byte, all 42).
- Shift distribution main→HEAD: `{0: 4, +4: 19, +7: 19}` — exactly the two inserted comment blocks (4 lines before
  old 559, 3 more before old 905). No entry added, removed, or re-pointed at a different declaration.
- Still RED: planting `.zz-probe { padding: 13px; }` in `PipelineDetailPage.css` → `1 failed, 45 passed`, failing
  on the spacing category for that exact file. Reverted; tree clean.

This is a mechanical line re-pin, not a test changed in shape to pass. The guard's own
"baseline isn't stale" arm (`tokenAuditSweep.css.test.ts:114-119`) still exists and still forces every pin to
resolve to a live hit.

**2. `elevationTokenGuard.css.test.ts` — I re-ran every arm myself rather than reading transcripts.**
Baseline `npx jest src/theme/elevationTokenGuard` → 5 passed. Each mutation applied to real source, run, reverted;
`git status --porcelain` clean after each.

| arm | mutation | result |
| -- | -- | -- |
| 1 | literal `box-shadow: 0 2px 8px rgba(0,0,0,0.4)` in `Toggle.css` (no exception) | **RED** — "Found 1 unguarded declaration(s)" |
| 1b (loosening probe) | `box-shadow: 0 2px 8px var(--app-accent-dim)` — tokenised colour, LITERAL geometry | **RED** — the exact loosening that made the original audit wrong is closed |
| 2 | `border-radius: 7px` | **RED** |
| 3a | stale RADIUS pin (`DividerPanel` 1px → `var(--app-radius-sm)`) | **RED** on "no stale radius exceptions" |
| 3b | stale SHADOW pin (a `DataGrid` scroll-fade inset → `var(--app-shadow-card)`) | **RED** on "no stale shadow exceptions" |
| 4 | literal shadow inserted **INTO** exception-bearing `DataGrid.css` | **RED** — a per-file allowance would have passed here; it does not |
| control | `border-radius: 50%; box-shadow: var(--app-shadow-card)` | **GREEN** — and `50%` appears in **no** exception list (it is an allowed value, D1) |

Exception shape read directly from source: every entry in `BOX_SHADOW_EXCEPTIONS` (17 pins summing to 9 rings +
13 insets = 22) and `BORDER_RADIUS_EXCEPTIONS` (6 pins) is `{file, exact declaration text, exact count}` — no
pattern, no per-file allowance. Arms 3a/3b prove both families can expire. `isAllowedShadow` matches
`var(--app-shadow-(card|soft))` **by name**, never "contains `var(`".

**3. The load-bearing fact (task 1.3), re-established independently.** I removed
`elevationTokenGuard.css.test.ts` from the tree, planted `box-shadow: 0 2px 8px rgba(0,0,0,0.4)` **and**
`border-radius: 7px` in `Toggle.css`, and ran the **full** frontend suite: `281 suites / 2861 tests, all passed`.
Nothing in the repo caught either. With the guard restored, both are RED. The small diff is therefore not
under-delivery — the guard is the only thing in the repo that holds this state.

**4. Boundaries — each confirmed by my own grep, not inherited.**
- `Modal.css`, `BottomNav.css`: **not in the diff at all** (`git diff --name-only 3a0c0fe8...HEAD` → 5 files, none
  of them). `BottomNav.css:38-39` is `blur(12px)`, inside the HEL-774 carve-out's 10–16px band; `Modal.css:60`
  untouched (HEL-1035).
- Accent-derived borders: **46**, unchanged (no accent border appears in the diff).
- `border-radius: 50%`: **12**, unchanged.
- HEL-1037's three defects still **present** and attributed, not silently fixed:
  `PipelineDetailPage.css:524`, `:543` (`var(--radius-sm)`) and `:538` (`var(--text-small)`); the two radius ones
  are pinned in the guard with a note naming HEL-1037.
- CSS file count `find frontend/src -name '*.css' | wc -l` → **110**, matching the guard's non-vacuity assertion.
- The 3 product CSS hunks are **100% comment additions** — I read every hunk; not one declaration value changed.

**5. AC1's "where a token applies" / the five sub-scale LEAVEs.** I accept the reading. The scale floor is 6px;
each of the five sites is 1–4px on an element whose own geometry makes 6px wrong (a 2px-tall drop indicator, a
`0.1em`-padded inline-code chip, a hairline rule bar, a `1px 6px` micro-badge). Snapping is a 2–5px visible change,
i.e. a redesign, not a normalization — and each literal now carries an inline comment and an individually-expirable
guard pin, so it cannot silently multiply. That is an honest discharge, not a dodge.

**6. Running app — ramp by computed style, both themes.** Mapped the five ramp tokens to their computed `rgb()`
and scanned every live element. Dark: canvas `--app-bg`; `.app-sidebar` / `.app-command-bar` `--app-surface`;
`.ui-input` `--app-surface-soft` (`rgb(22,21,20)`); `.panel-grid-card` `--app-surface` + a resting card shadow;
`.ui-modal` (command palette, quick launcher, help overlay) `--app-surface-strong` + the softer overlay shadow;
`.ui-keycap` `--app-surface-raised`. All five rungs reachable and correct.
Light: re-rendered via `localStorage.helio-theme` + reload (see caveat below) — chrome, card, canvas and dotted
field all coherent, card legible against canvas, no parity break. Screenshots distinct by `md5sum`
(`a585cf66…` dark / `ffcfbe27…` first light / third capture separate). `/pipelines` → **0 console errors**.

**Measurement I re-ran rather than reported.** My first light-theme capture showed the panel card still dark while
the chrome went light. That was **my** crude override (flipping `data-theme` alone leaves the inline
`color-scheme: dark`), not a product defect — reproducing it properly via the app's own theme storage rendered
correctly. Recording it because it would have been a false REFUTE.

**7. Routed findings did not leak in.** HEL-1044 (panel card `:hover` never reaching `--app-surface-raised`) —
confirmed by observation: `--app-surface-raised` is live on `.ui-keycap` but no card hover state exists; nothing in
the diff adds one. F2 — confirmed live: in light theme `--app-surface-raised` and `--app-surface-strong` are both
`#ffffff`; `theme.css` is **not in the diff**, so it was commented onto HEL-866 rather than absorbed. Both correctly
referred out.

**8. Gates, re-run by me from `frontend/` (not root `npm test`).**
`npx tsc --noEmit` → rc 0. `npx eslint src --max-warnings=0` → rc 0.
`npx jest` → **282 suites / 2866 tests, all passed** (+1 suite / +5 tests vs. the guard-removed run above, which is
exactly this ticket's new file). `npx prettier --check` on `DESIGN.md` + the new guard → clean.

### Verdict: CONFIRM

The deliverable is real, load-bearing and failable: I broke the new guard in all four required directions plus the
loosening probe, confirmed its exceptions expire in **both** families, and proved by removal that nothing else in
2861 tests catches what it catches. The one modified pre-existing guard is a verified mechanical re-pin — same 42
declarations, byte-identical text, shifts matching the inserted comments, still RED on a planted literal. Every
named boundary (HEL-1035, HEL-1037, HEL-866, HEL-1044, HEL-774, the 46 accent borders, the 12 `50%` radii) holds.
Ships.

### Non-blocking notes

1. **Composite-shadow bypass (worth a spinoff, not a blocker).** `isAllowedShadow` tests the whole declaration, so
   `box-shadow: var(--app-shadow-card), 0 8px 24px rgba(0,0,0,0.6);` passes **green** (I verified this against
   `Toggle.css`). No such declaration exists in the tree today — all 47 are accounted for as 25 token/`none` + 22
   pinned — so this is a latent hole, not a live one, and the guard's stated rule ("must reference an elevation
   token by name") is honestly satisfied by a composite. But adding a literal glow layer beside a token is a
   plausible real edit, which makes this the one bypass with a realistic trigger. Suggested hardening: after
   stripping every `var(--app-shadow-*)` layer, require the remainder to be empty. **Recommend filing this as a
   spinoff** — it is currently owned by no ticket, and an unowned deferral is not a real deferral.
2. `BORDER_RADIUS_RE` only matches the `border-radius` shorthand; `border-top-left-radius` and friends are
   invisible. I confirmed the evaluator's claim independently: **zero** corner-specific radius declarations exist in
   `frontend/src`. Latent, same follow-up as (1).
3. `expect(files.length).toBe(110)` will fail on any unrelated CSS file add/delete, including from a sibling lane
   (HEL-444 is next in this same area). It fails loudly with an obvious fix, so it is friction rather than a defect
   — but a `toBeGreaterThanOrEqual` floor would be less noisy.
4. `DESIGN.md` — two continuation lines in the shadow bullet begin at column 0 (`color-mix(...)`,
   `elevationTokenGuard.css.test.ts`), breaking list indentation when rendered. Prettier accepts it; cosmetic.
5. `evaluation-1.md` is **untracked** in the worktree (`?? openspec/changes/…/evaluation-1.md`). Delivery-artifact
   hygiene for the orchestrator, outside the reviewed commit.
