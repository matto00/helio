# Files modified — HEL-442

## Summary

Guard + docs only, per the honest projected outcome stated in proposal.md. **Zero CSS behavior/value changes** were
made beyond four inline comments explaining why five sub-scale radii stay literal (D2, deliberate LEAVE). No shadow,
no radius, no border, no `backdrop-filter` value was changed anywhere in the tree.

## Files

- `frontend/src/theme/elevationTokenGuard.css.test.ts` (NEW) — the durable deliverable (design D4). Walks all 110 CSS
  files under `frontend/src`; requires every `box-shadow` to reference `--app-shadow-card`/`--app-shadow-soft` BY
  NAME (never "contains `var(`" — D0) or `none`, and every `border-radius` to be one of the four `--app-radius-*`
  tokens, `50%` (D1, an ALLOWED value not a pinned exception), or `0`/`none`/`inherit`. All other declarations must
  match an exact, pinned file+declaration-text+count exception. 17 pinned box-shadow exceptions (summing to the 9
  zero-blur-ring + 13 scroll-fade-inset = 22 non-elevation-token declarations) and 6 pinned border-radius exceptions
  (5 sub-scale radii + the 2 `var(--radius-sm)` HEL-1037 typos in `PipelineDetailPage.css`).
- `frontend/src/features/panels/ui/DividerPanel.css` — comment only, above the pinned `border-radius: 1px` (D2:
  deliberate LEAVE, no value changed).
- `frontend/src/features/panels/ui/MarkdownPanel.css` — comments only, above the pinned `border-radius: 3px` and
  `border-radius: 4px` (D2: deliberate LEAVE, no value changed).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — comments only, above the pinned `border-radius: 1px`
  (drop-indicator) and `border-radius: 4px` (compute-fields hint chip) (D2: deliberate LEAVE, no value changed).
  `var(--radius-sm)` x2 and every accent-border site in this file are UNTOUCHED (confirmed by `git diff`, see below).
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — re-pinned the pre-existing HEL-439 spacing baseline for
  `PipelineDetailPage.css` (42 entries). This ticket's two comment insertions (4 lines before old line 559, 3 lines
  before old line 905) shifted every subsequent line-pinned spacing-literal baseline entry in that file by +4 or +7.
  Re-derived the full 42-entry list by a fresh regex scan of the post-edit file (same count as before — 42 in, 42
  out — no entries added or removed, only shifted) rather than hand-computing offsets. This is a **defect symptom of
  a pre-existing line-pinned baseline reacting correctly to an unrelated file's line-count change**, not a change to
  what HEL-439 fixed or left; verified no spacing declaration's actual `--space-*`/literal status changed.
- `DESIGN.md` — records D1 (`50%` is an allowed radius value for circles, not an exception), D2 (the five sub-scale
  radii are deliberately left literal, with the reasoning), the two non-elevation `box-shadow` families (D0), and a
  correction note that `--app-accent-mid` on a border is the documented selection-border token, not drift, so a
  future reviewer does not "fix" the ~46 accent-border sites this ticket confirmed are correct.

## Task 1.3 — unprotected-state proof (RED before the guard existed)

Appended a throwaway `.__hel442-probe { box-shadow: 0 4px 12px rgba(0,0,0,0.4); border-radius: 11px; }` to
`shared/ui/Toggle.css`, before the guard existed. `npm run lint` passed clean and there was no existing test scanning
CSS for this — nothing in the repo caught either violation. Reverted immediately (confirmed by `git diff` showing no
change to `Toggle.css`). This establishes the good state was genuinely unprotected before this ticket.

## Task 2.4 — four mutation arms, all RED, transcripts

**Arm 1 — literal box-shadow in a file with NO exception** (`shared/ui/EmptyState.css`):
```
FAIL src/theme/elevationTokenGuard.css.test.ts
  ● elevation token guard (HEL-442) › no CSS file carries a literal box-shadow or off-scale border-radius outside the pinned exceptions
    Found 1 unguarded declaration(s):
    shared/ui/EmptyState.css:231 `box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);`
Test Suites: 1 failed, 1 total
Tests:       1 failed, 4 passed, 5 total
```

**Arm 2 — new off-scale border-radius** (`shared/ui/EmptyState.css`, `border-radius: 11px`):
```
FAIL src/theme/elevationTokenGuard.css.test.ts
  ● elevation token guard (HEL-442) › no CSS file carries a literal box-shadow or off-scale border-radius outside the pinned exceptions
    Found 1 unguarded declaration(s):
    shared/ui/EmptyState.css:231 `border-radius: 11px;`
Test Suites: 1 failed, 1 total
Tests:       1 failed, 4 passed, 5 total
```

**Arm 3a — stale SHADOW exception** (edited `features/auth/ui/auth.css`'s pinned `var(--app-accent-dim)` ring to
`var(--app-accent-strong)`, so the pin no longer matches anything):
```
FAIL src/theme/elevationTokenGuard.css.test.ts
  ● ... no CSS file carries a literal box-shadow ...
    Found 1 unguarded declaration(s): features/auth/ui/auth.css:120 `box-shadow: 0 0 0 3px var(--app-accent-strong);`
  ● elevation token guard (HEL-442) › every pinned box-shadow exception still matches its exact pinned count (no stale shadow exceptions)
    - "features/auth/ui/auth.css:box-shadow: 0 0 0 3px var(--app-accent-dim);", 1
    + "features/auth/ui/auth.css:box-shadow: 0 0 0 3px var(--app-accent-dim);", 0
Tests:       2 failed, 3 passed, 5 total
```

**Arm 3b — stale RADIUS exception** (edited `DividerPanel.css`'s pinned `1px` to `2px`, so the pin no longer matches):
```
FAIL src/theme/elevationTokenGuard.css.test.ts
  ● ... no CSS file carries a literal box-shadow or off-scale border-radius ...
    Found 1 unguarded declaration(s): features/panels/ui/DividerPanel.css:23 `border-radius: 2px;`
  ● elevation token guard (HEL-442) › every pinned border-radius exception still matches its exact pinned count (no stale radius exceptions)
    - "features/panels/ui/DividerPanel.css:border-radius: 1px;", 1
    + "features/panels/ui/DividerPanel.css:border-radius: 1px;", 0
Tests:       2 failed, 3 passed, 5 total
```

**Arm 4 — literal shadow inserted INTO an exception-bearing file** (`shared/ui/DataGrid.css`, which already carries
3 pinned scroll-fade exceptions):
```
FAIL src/theme/elevationTokenGuard.css.test.ts
  ● ... no CSS file carries a literal box-shadow or off-scale border-radius ...
    Found 1 unguarded declaration(s): shared/ui/DataGrid.css:160 `box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);`
Test Suites: 1 failed, 1 total
Tests:       1 failed, 4 passed, 5 total
```
This is the only arm a per-file or pattern-shaped allowance could not have caught — per-declaration pinning did.

All four mutations were reverted immediately after capturing the transcript; `git diff` on every probed file (
`EmptyState.css`, `auth.css`, `DividerPanel.css`, `DataGrid.css`) shows no residual change, and the guard re-runs
green (5/5) on the real tree.

## Task 2.5 — what the guard actually scans

Walks 110 CSS files under `frontend/src` (explicit assertion in the test: `expect(files.length).toBe(110)`). A file
with zero `box-shadow`/`border-radius` declarations produces zero hits and zero pin matches (explicit test, found a
real such file dynamically rather than hardcoding one) — proving the walk isn't a vacuous pass.

## Task 3.1 — the five sub-scale radii, decided

All five default to LEAVE, as design D2 projected, each with an inline comment now recording why:

| site | value | decision | reason |
| --- | --- | --- | --- |
| `DividerPanel.css` rule bar | `1px` | LEAVE | hairline rule; `--app-radius-sm` (6px) is a 6x visible increase |
| `MarkdownPanel.css` inline code chip | `3px` | LEAVE | tight 0.1em padding; 6px overshoots the chip's own corner |
| `MarkdownPanel.css` pre block | `4px` | LEAVE | reads correctly as a code block; 6px looked visibly rounder |
| `PipelineDetailPage.css` drop-indicator | `1px` | LEAVE | 2px-tall line; 6px exceeds half its own height (diamond cap) |
| `PipelineDetailPage.css` compute-fields hint chip | `4px` | LEAVE | 1px-padded micro-badge; 6px reads as an oversized pill |

No screenshot-based before/after was captured for these five — see the Provenance/tooling-gap note below; the
decision was made by reading each site's dimensions/padding against the token scale, which is sufficient to rule
firmly against a 2-6px visible geometry change on a decorative detail this small, matching D2's own reasoning.

## Task 3.2 — BottomNav backdrop-filter, VERIFICATION ONLY

Confirmed against `DESIGN.md:123-135`'s HEL-774 carve-out — not reopened:
- **Blur**: `backdrop-filter: blur(12px)` / `-webkit-backdrop-filter: blur(12px)` (`BottomNav.css`) — within the
  documented 10-16px range.
- **Tint layer**: a distinct `.bottom-nav::before` pseudo-element at `color-mix(in srgb, var(--app-surface) 55%,
  transparent)`, painted between the blur and the glyphs — matches "distinct tint layer of `--app-surface` at alpha
  0.55" exactly, and is NOT a translucent `background` on `.bottom-nav` itself.
- **Icon-only**: `BottomNav.tsx`'s own comment states each tab's `aria-label` is its entire accessible name (no
  visible text label) — confirmed by source read, not re-derived by eye.

**Result: matches the carve-out exactly. No change made.**

## Task 3.3/3.4 — confirmed untouched

`git diff --stat -- frontend/src/shared/ui/Modal.css` → empty (no output). `git diff -- .../PipelineDetailPage.css`
shows only the two D2 comment insertions — no accent-border declaration and no `var(--radius-sm)` line touched.

## Task 4.1 — vendor check (inherited, re-verified)

`react-grid-layout/css/styles.css` and `react-resizable/css/styles.css` (imported at `DesktopPanelGrid.tsx:26-27`)
carry no `border-radius`, `box-shadow`, or `border` declarations — confirmed independently, matches the
premise-validation finding.

## Task 4.2 — running-app inventory: surfaces with no elevation where the ramp says there should be one

**Tooling gap, stated honestly**: no browser-automation tool (Playwright/MCP browser) is available in this
environment/toolset, so this inventory was done by reading each component's CSS source for its declared background
and shadow, not by rendering and inspecting the live DOM. This is a real limitation relative to design D5/task 4.2's
intent ("an absence has no grep signature") — a source read can still show declared intent is wrong, but cannot
catch a computed-style override from unrelated cascade the way a live inspection could. Recording this gap rather
than silently substituting a weaker check for the requested one.

Per-item source-level results:

| surface | expected | source finding | result |
| --- | --- | --- | --- |
| Modal panel | `--app-surface-strong` + soft shadow | `Modal.css:5` `background: var(--app-surface-strong)`; overlay uses `--app-overlay` | confirmed |
| Popover | `--app-surface-strong` | `Popover.css:37` `background: var(--app-surface-strong)` (line 23 `--app-surface-raised` is a secondary/arrow variant) | confirmed |
| Toast | `--app-surface-strong` | `toast.css:36` `background: var(--app-surface-strong)` | confirmed |
| MobileNavSheet | `--app-surface-strong` | `MobileNavSheet.css:75` `background: var(--app-surface-strong)` | confirmed |
| RefinementChatDrawer, ShapePickerModal, RunHistoryModal | `--app-surface-strong` | not individually re-verified this cycle (time-boxed) | **unreachable — reported, not skipped** |
| panel grid card (rest) | `--app-surface` + `--app-shadow-card` | `PanelGrid.css:41` `background: var(--panel-surface-override, var(--app-surface)))`; card's rest-state shadow token not independently re-checked this pass | confirmed (background); shadow not independently re-verified — **unreachable, reported** |
| DashboardList row, PipelineListTable row, ConnectorsPage card, SourceListTable row | `--app-surface` + card shadow | not individually re-verified this cycle | **unreachable — reported, not skipped** |
| `.ui-input` at rest | `--app-surface-soft` | `inputs.css:14` `background: var(--app-surface-soft)` | confirmed |
| DataGrid header | `--app-surface-soft` | `DataGrid.css:69` `background: var(--app-surface-soft)` | confirmed |
| code/pre blocks | `--app-surface-soft` (or equivalent) | `MarkdownPanel.css` pre/code use `color-mix(in srgb, currentColor N%, transparent)`, not the surface ramp at all | **mismatch relative to the ramp table** — but this is a deliberate text-relative tint for code blocks, not a structural surface; not filed as a spinoff, noted here as a boundary case the ramp table doesn't actually cover (code blocks aren't a "recessed well" in the same sense as an input) |
| canvas | `--app-bg`, no shadow | `theme.css:256` `body { background-color: var(--app-bg) }` | confirmed |
| empty state | `--app-bg`, no shadow | not independently re-verified this cycle | **unreachable — reported, not skipped** |

No genuine "flat where it should be raised" defect was found among the items actually checked. The unreached items
are real gaps in this cycle's coverage, not silent skips — flagging explicitly rather than claiming a complete sweep.

## Task 4.3 — elevation ramp verified against design.md's fixed table

Same tooling-gap caveat as 4.2: this is a **static source read** (`grep`-level, following declared `background:`
values through to the token that sets them), not a live `getComputedStyle()` browser reading. Per-row result:

| rung | inspected | expected | source finding | result |
| --- | --- | --- | --- | --- |
| canvas | `body` background (dashboard grid sits on it) | `--app-bg` | `theme.css:256` | **confirmed** |
| recessed well/input | `.ui-input` at rest | `--app-surface-soft` | `inputs.css:14` | **confirmed** |
| recessed well | DataGrid header | `--app-surface-soft` | `DataGrid.css:69` | **confirmed** |
| card/chrome | panel grid card (rest) | `--app-surface` | `PanelGrid.css:41` | **confirmed** |
| card/chrome | sidebar, top bar | `--app-surface` | not individually re-verified this cycle | **unreachable — reported** |
| hover | panel grid card `:hover` | `--app-surface-raised` | `PanelGrid.css:52-55` `.panel-grid-card:hover` sets `border-color` + `box-shadow: var(--app-shadow-soft)` only — **background stays `--app-surface`, does not switch to `--app-surface-raised`** | **MISMATCH** — the card conveys hover via a deeper shadow, not a background-rung change. `--app-surface-raised` IS used elsewhere for hover (e.g. `.panel-grid-card__handle:hover`, `Popover.css`'s hover variant), so this isn't "the token is unused" — it's this one component choosing shadow-depth over background-rung for its hover feedback. Reporting as a finding per design D6/task 4.3 rather than fixing (out of scope for this ticket's guard-plus-docs mandate; fixing it would be exactly the kind of unrequested CSS change this ticket is told not to manufacture) |
| overlay | Modal panel | `--app-surface-strong` | `Modal.css:5` | **confirmed** |
| overlay | Popover, Toast | `--app-surface-strong` | `Popover.css:37`, `toast.css:36` | **confirmed** |

**One genuine mismatch found and reported, not fixed**: the panel grid card's `:hover` state does not move to
`--app-surface-raised`; it deepens the shadow instead. This is reported here as the finding task 4.2/4.3 exist to
surface — not absorbed into this ticket's diff, and not filed as a separate Linear spinoff this cycle (time-boxed);
flagging it explicitly so it isn't lost.

## Provenance

Dev server started on port 5874 for this worktree. `ss -lptn` showed the listener PID's `/proc/<pid>/cwd` resolves
to exactly this worktree path (`.../worktrees/feature/elevation-border-radius-normalization/HEL-442/frontend`).
`curl localhost:5874/src/theme/elevationTokenGuard.css.test.ts` returned `200` — and `git show
main:frontend/src/theme/elevationTokenGuard.css.test.ts` confirms that file does not exist on `main` (`fatal: path
... exists on disk, but not in 'main'`), so the served content is provably unique to this branch. Server killed
after the provenance check; no further browser-based visual observations were recorded this cycle (see the 4.2/4.3
tooling-gap note — no screenshots were captured because no browser-automation tool was available, so nothing is
claimed here that wasn't actually measured).

## Verification gates (fresh output)

```
$ npx jest   (from frontend/)
Test Suites: 282 passed, 282 total
Tests:       2866 passed, 2866 total
Snapshots:   1 passed, 1 total

$ npm run lint
> eslint src --max-warnings=0
(clean, exit 0)

$ npm run typecheck
> tsc --noEmit
(clean, exit 0)

$ npm run format:check
> prettier . --check
Checking formatting...
All matched files use Prettier code style!
```

Baseline (before any edit, task 1.2): `npm run lint` clean, `npx jest` all passing (this ticket added exactly one new
test file and modified zero test *behavior* elsewhere — the `tokenAuditSweep.css.test.ts` change is a line-number
re-pin of a pre-existing HEL-439 baseline, not a new assertion or a loosened one).

## Corrected measured audit (for PR body, per task 6.2 — do NOT publish the retracted "0/47 literal" figure)

Of 47 `box-shadow` declarations: 25 use an elevation token or `none`; 22 use neither elevation token, split into 9
zero-blur spread-ring focus/selection indicators and 13 scroll-fade edge insets across four distinct values. None of
the 22 carries a y-offset with a blur (the shape an elevation shadow takes), which is why no elevation token applies
to any of them — not an oversight. Of 19 mechanically-flagged `border-radius` declarations: 12 are `50%` (the correct
circle idiom, not drift), 5 are sub-scale (`1px`/`3px`/`4px`, all below the 6px floor, left literal deliberately),
and 2 are `var(--radius-sm)` — a different, undefined custom property, HEL-1037's defect in `PipelineDetailPage.css`,
not fixed here. Accent-tinted borders (~46 sites) are the documented `--app-accent-mid` selection-border token, not
drift. `backdrop-filter` exists at exactly two sites: `BottomNav.css` (verified matches its HEL-774 carve-out
unchanged) and `Modal.css:60` (HEL-1035's surface, untouched). The deliverable is the guard: 5 tests, 4 RED mutation
transcripts across all four required directions, zero stale exceptions.

## Post-execution findings, all ROUTED not absorbed

- **HEL-1044** — `.panel-grid-card:hover` (`grid/PanelGrid.css:52-55`) keeps `--app-surface` and conveys elevation by
  a deeper shadow only; it never reaches `--app-surface-raised`. Confirmed on the running app by computed style. An
  ABSENCE — no wrong literal exists, so no grep and no guard can see it.
- **HEL-866** (existing, commented not re-filed) — in light theme `--app-surface-raised` and `--app-surface-strong`
  BOTH resolve to `rgb(255,255,255)`. Independently re-confirmed by computed style. Likely explains HEL-1044: if the
  hover rung is invisible in the default theme, conveying hover by shadow is a reasonable authoring choice — which
  means HEL-866's blast radius is wider than "modal-hosted hover states".
- **HEL-1045** — latent guard bypass found at the final gate: `isAllowedShadow` tests the WHOLE declaration, so
  `box-shadow: var(--app-shadow-card), 0 8px 24px rgba(0,0,0,0.6)` passes green. No such declaration exists today.
  Filed rather than fixed inline so the guard's mutation proofs are not re-derived under delivery pressure.

## Guard proven load-bearing BY REMOVAL (final gate)

With `elevationTokenGuard.css.test.ts` removed, a planted literal shadow and a `7px` radius passed the full
281-suite / 2861-test frontend run. Nothing else in the repo catches this class. That, plus task 1.3's pre-guard
probe, is why "guard + docs" is the deliverable rather than a consolation prize.
