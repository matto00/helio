# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `964268d4` — "HEL-442 Add elevation/radius token guard, hold already-good CSS state".
All gates, mutations and browser observations below were run by me in this worktree, not read from any transcript.

## Provenance (binding, stated once; applies to every visual observation in Phase 3)

- Listeners: `ss -lptn` → `node` pid 1709167 on `[::1]:5874`, `java` pid 1708966 on `*:8781`.
- `/proc/1709167/cwd` → `…/HEL-442/frontend`; `/proc/1708966/cwd` → `…/HEL-442/backend`. Both THIS worktree.
- Content self-authentication: `curl http://localhost:5874/src/features/panels/ui/MarkdownPanel.css` contains
  `HEL-442 D2`; `git grep -c "HEL-442 D2" main -- frontend/src` returns nothing. The served app is this branch.

---

## Phase 1: Spec Review — PASS

Issues: none.

- AC1 (no literal shadow/radius where a token applies; **guard test added**) — satisfied. The guard is the deliverable,
  as settled at the design gate; the "essentially zero other CSS change" outcome is the projected and correct one.
- AC2 (no accent-derived structural border; no `backdrop-filter` on chrome) — the 46 accent-border sites are the
  documented `--app-accent-mid` selection-border idiom and are untouched; `BottomNav` verified against the HEL-774
  carve-out (measured `backdrop-filter: blur(12px)`, inside the prescribed 10–16px); `Modal.css` untouched (HEL-1035).
- AC3 (ramp spot-checked in both themes) — performed by computed style, both themes, per-rung results in Phase 3.
- AC4 (lint/tests, zero new warnings) — re-run by me, green.
- Tasks: all 26 items ticked and each corresponds to work I can see in the diff or reproduce. Tasks 4.2/4.3 were
  honestly flagged by the executor as static-only (no browser tool); I have now performed them properly — see Phase 3.
- Scope: no change outside `DESIGN.md`, three comment-only CSS edits, one new guard, one re-pinned pre-existing guard.
- Planning artifacts match the implemented behavior.

## Phase 2: Code Review — PASS

Gates (my own fresh runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):

| gate | result |
| -- | -- |
| `npm run lint` (`eslint . --max-warnings=0`) | clean, no output |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npx jest` from `frontend/` (NOT root `npm test`) | 282 suites / **2866 tests passed** |
| backend | N/A — no `backend/**` file changed |

### Priority 1 — `tokenAuditSweep.css.test.ts` (85-line change): LEGITIMATE RE-DERIVATION, not a weakening

This was the highest-risk item; it clears on four independent checks:

1. **Entry count unchanged and complete.** 71 baseline entries on both sides; 42 for `PipelineDetailPage.css` on both
   sides. Re-running the guard's own regex (`(margin|padding|gap)(-[a-z]+)?:\s*[0-9.]+(px|rem|em|%)` minus
   `var(--space`) over the post-change file yields **exactly 42 hits, and the new baseline set is set-identical to
   them** — no hit unpinned, no pin unmatched.
2. **Every entry still corresponds to a real declaration at its new line**, and the *same* declaration: I extracted the
   ordered (line, declaration-text) sequence from `main`'s copy of the CSS and from HEAD's, and the **42 declaration
   texts are identical in the same order**. Nothing was dropped, substituted or loosened.
3. **The shift arithmetic matches the stated comment exactly**: `+0` for the 4 entries below line 559, `+4` for the 19
   in [559, 905), `+7` for the 19 at/after 905 — i.e. the 4-line and 3-line doc comments the executor inserted, and
   nothing else. Also verified `main`'s baseline == `main`'s hit set, so the pre-change state was itself exact.
4. **The guard still fails on a NEW off-scale spacing literal.** I planted `.sweep-probe { padding: 13px; }` in
   `features/panels/ui/ImagePanel.css` → RED (`features/panels/ui/ImagePanel.css has no unexpected raw spacing …`,
   1 failed / 45 passed). Reverted → 46/46 green. The guard also carries a staleness arm (`every … baseline entry still
   exists in its file`), so a wrong line number cannot pass silently in either direction.

Verdict: this is a mechanical re-pin forced by the executor's own comment insertions, verified rather than
hand-computed, and the guard catches on HEAD everything it caught on `main`.

### Priority 3 — the new guard: all four mutation arms re-run by me, all RED

Baseline: `npx jest src/theme/elevationTokenGuard` → 5/5 green. Each arm applied, observed, reverted, re-confirmed green.

| arm | mutation | result |
| -- | -- | -- |
| 1 | literal `box-shadow: 0 4px 12px rgba(0,0,0,0.3)` in `shared/ui/Modal.css` (a file with NO exception) | **RED** — `Found 1 unguarded declaration(s): shared/ui/Modal.css:251` |
| 2 | `border-radius: 7px` (off-scale) | **RED** — reported as an unguarded declaration |
| 3a | stale SHADOW pin (`0 0 0 3px var(--app-error-surface)` → a value matching nothing) | **RED** — "no stale shadow exceptions" test fails |
| 3b | stale RADIUS pin (`border-radius: 3px` → `33px`) | **RED** — "no stale radius exceptions" test fails |
| 4 | literal `box-shadow: 0 6px 18px var(--app-border-strong)` inserted INTO exception-bearing `shared/ui/DataGrid.css` | **RED** — `Found 1 unguarded declaration(s): shared/ui/DataGrid.css:159` |

Both families are therefore demonstrably expirable, and arm 4 confirms the exceptions are per-declaration, not a
per-file or pattern-shaped allowance.

Additional probes the brief asked for:

- **No "contains any `var()`" loosening.** `isAllowedShadow` tests `/var\(--app-shadow-(card|soft)\)/` by name.
  Proved behaviourally: `box-shadow: 0 2px 8px var(--app-accent-dim)` (tokenised COLOUR, literal GEOMETRY — exactly the
  shape that made the original audit wrong) → **RED**. The loosening is absent.
- **`50%` is an allowed value, not a pin.** `.circle-probe { border-radius: 50%; }` added to a file → still **GREEN**,
  and `50%` appears nowhere in `BORDER_RADIUS_EXCEPTIONS`. The 12 live `50%` declarations are byte-identical to `main`
  (same 9 files, same per-file counts).
- **Every pin is exact file + declaration text + count** (`Pin { file, declaration, count, note }`), matched via
  normalised whole-declaration equality, and each carries the ticket that would remove it (HEL-1022 / HEL-1037 / D2).
- Non-vacuity: the guard asserts it walks 110 CSS files and separately proves a file with zero shadow/radius
  declarations yields zero hits.

### Priority 4 — boundaries, independently confirmed

- `git diff main...HEAD --stat` touches only: `DESIGN.md`, `DividerPanel.css`, `MarkdownPanel.css`,
  `PipelineDetailPage.css` (all three **comment-only**, verified by reading the hunks), the new guard, the re-pinned
  sweep guard, and the change-dir artifacts. **`Modal.css` and `BottomNav.css` are untouched.**
- No accent-derived border changed (no `--app-accent*` line appears in the diff at all).
- The 12 `50%` radii are unchanged vs `main`.
- HEL-1037's three defects are **still present and unfixed**: `PipelineDetailPage.css:524` and `:543`
  `border-radius: var(--radius-sm)`, `:538` `font-size: var(--text-small)`. The two radius ones are pinned in the
  guard with the note "wrong/undefined custom property, HEL-1037's defect in this file — not fixed here". Correct
  boundary: the hole stays visible and attributed rather than being silently mechanically "fixed".

### Code quality (CONTRIBUTING.md / DESIGN.md)

- No inline fully-qualified names; no `any`; no dead code, TODO/FIXME, or unused imports in the new file.
- The guard is self-contained, readable, comment-justified at every non-obvious decision, and duplicates nothing —
  it deliberately mirrors the `motionTokenGuard`/`tokenAuditSweep` precedent rather than inventing a new shape.
- Comments explain *why* (the D2 leave rationale per site), not *what* — matching the HEL-849 comment standard.
- Behavior-preserving as expected: zero runtime CSS value changed anywhere in the diff.

## Phase 3: UI Review — PASS

Both themes, computed style, all provenance as stated above. Zero console errors across every flow exercised
(`browser_console_messages` level=error → 0 of 3 messages). No layout breakage at 1440 / 1100 / 768 / 390
(`scrollWidth == innerWidth` at 390; screenshots below).

### 4.3 — the elevation ramp by computed style, per rung

Token resolution — dark: `--app-bg` rgb(18,17,16), `soft` rgb(22,21,20), `surface` rgb(26,24,22), `raised`
rgb(35,32,25), `strong` rgb(38,35,32). Light: `--app-bg` rgb(244,242,237), `soft` rgb(239,236,230), `surface`
rgb(253,252,250), `raised` **rgb(255,255,255)**, `strong` **rgb(255,255,255)**.

| rung | inspected | dark | light | result |
| -- | -- | -- | -- | -- |
| canvas | `body` / grid background | rgb(18,17,16) = `--app-bg` | rgb(244,242,237) = `--app-bg` | **confirmed** (grid itself is transparent over `--app-bg`) |
| recessed well | `.ui-input` at rest | rgb(22,21,20) = `soft`, radius 6px = `--app-radius-sm` | rgb(239,236,230) = `soft` | **confirmed** |
| recessed well | DataGrid header `th` | rgb(22,21,20) = `soft` | rgb(239,236,230) = `soft` | **confirmed** |
| card / chrome | `.panel-grid-card` | rgb(26,24,22) = `surface` + `--app-shadow-card` + radius 14px | see note | **confirmed** |
| card / chrome | sidebar | rgb(26,24,22) = `surface` | rgb(253,252,250) = `surface` | **confirmed** |
| card / chrome | top bar | rgb(26,24,22) = `surface` | rgb(253,252,250) = `surface` | **confirmed** |
| hover | same card `:hover` | bg stays rgb(26,24,22); shadow deepens to `--app-shadow-soft`, border → `--app-border-strong` | same | **MISMATCH — see finding F1** |
| overlay | Modal (`.ui-modal`, opened live via the command palette) | — | rgb(255,255,255) = `strong` + `--app-shadow-soft` + radius 14px | **confirmed** |
| overlay | Popover (`.popover__panel`, opened live via a dashboard actions menu) | rgb(38,35,32) = `strong` + `--app-shadow-soft` + radius 14px | — | **confirmed** |
| overlay | Toast | source-confirmed: `shared/ui/toast.css` `.toast` → `background: var(--app-surface-strong); box-shadow: var(--app-shadow-soft)` | same | **confirmed by source; live instance UNREACHABLE** (no toast could be provoked without mutating data — reported, not skipped) |

Light-theme note on the card rung: the panel cards on the dashboard I inspected carry a user appearance override
(`--panel-surface-override: rgba(26,24,22,1)`), so their light-theme background is user data, not a ramp defect —
the default is `var(--panel-surface-override, var(--app-surface))` at `grid/PanelGrid.css:41`.

### 4.2 — the absence hunt (fixed inventory, per-item result)

Overlays:

| item | result |
| -- | -- |
| Modal panel | **confirmed** live — `strong` + `shadow-soft` |
| Popover | **confirmed** live — `strong` + `shadow-soft` |
| Toast | **confirmed by source**, live instance unreachable (see above) |
| MobileNavSheet | **confirmed by source** — `MobileNavSheet.css:75/79` `strong` + `shadow-soft` (live: sheet not opened) |
| RefinementChatDrawer | **confirmed by source** — `RefinementChatDrawer.css:39/41` `strong` + `shadow-soft` |
| ShapePickerModal | **confirmed** — no own shell; renders inside the shared `<Modal>` (`.ui-modal`), which is confirmed live |
| RunHistoryModal | **confirmed** — same; its own CSS is explicit that "modal shell is provided by `<Modal>` / `ui-modal`" |

Card surfaces:

| item | result |
| -- | -- |
| panel grid card | **confirmed** — `--app-surface` + `--app-shadow-card` at rest, live |
| DashboardList row | **observed flat by design** — `DashboardList.css:5-6` is explicitly `background: transparent; box-shadow: none`; it is a sidebar list row inside the sidebar's own `--app-surface`, not a free-standing card. Not a defect; recorded so a later reviewer does not "fix" it. |
| PipelineListTable row | **observed flat by design** — a table row inside a page surface; carries only the scroll-fade insets. |
| SourceListTable row | **observed flat by design** — same shape. |
| ConnectorsPage card | **UNREACHABLE / inventory item is stale** — HEL-1022 replaced the stacked-card layout with one table at every width (see `ConnectorsPage.css:28,126,299`); there is no `connectors-page__card` surface any more. Reported, not skipped. |

Recessed wells: `.ui-input` **confirmed** live (`soft`); DataGrid header **confirmed** live (`soft`);
`.ui-textarea` **UNREACHABLE** on the surfaces I could reach (shares `inputs.css`'s `soft` rule at line 14, so
source-confirmed); code/`pre` **UNREACHABLE** live — `MarkdownPanel.css` styles it as a `color-mix` wash over
`currentColor`, deliberately not a ramp rung, which is consistent with the D2 comment added there.

Canvas + empty state: canvas **confirmed** (`--app-bg`); `EmptyState.css:22-23` is `--app-surface` + `--app-shadow-card`
(shared component, **confirmed by source**).

### Findings from the running app (report, do not absorb)

- **F1 — CONFIRMED, the executor's static finding is real on the running app.** `.panel-grid-card:hover`
  (`frontend/src/features/panels/ui/grid/PanelGrid.css:52-55`) conveys hover elevation by deepening the shadow
  (`--app-shadow-card` → `--app-shadow-soft`) and darkening the border, and does **not** move the background to
  `--app-surface-raised`. Measured live: rest bg rgb(26,24,22) → hover bg rgb(26,24,22) (unchanged), shadow
  `0 1px 2px / 0 8px 24px -12px` → `0 4px 16px / 0 24px 64px -16px`. So D6's "hover" rung is not expressed on the
  background channel. **This is a spinoff, NOT a fix in this ticket** — the mechanism is coherent and intentional, and
  changing it is a visual-design decision outside AC1–AC4.
- **F2 — light-theme ramp collision, HEL-866's territory, report only.** In light theme `--app-surface-raised` and
  `--app-surface-strong` both resolve to `rgb(255,255,255)`, so the hover rung and the overlay rung are
  indistinguishable by background there. Directly adjacent to HEL-866 (light-theme modal/hover token collision);
  named as a guardrail, not absorbed.
- **F3 — scroll-fade duplication** (13 declarations, four distinct values, across `DataGrid` / `PipelineListTable` /
  `SourceListTable` / `ConnectorsPage`) remains a spinoff candidate, correctly pinned rather than absorbed.

### Evidence

`/home/matt/Development/helio/.claude/worktrees/feature/elevation-border-radius-normalization/HEL-442/.concertino/runs/HEL-442/evidence/`
— four screenshots, `md5sum`-verified DISTINCT (four different hashes):
`eval-light-1440.png` `358d0011…`, `eval-light-768.png` `138d13ee…`, `eval-dark-1100.png` `8ba592d1…`,
`eval-dark-390.png` `77abe8aa…`. Nothing was `git add -f`'d past `.gitignore`; the worktree is clean
(`git status --porcelain` empty after every mutation was reverted).

## Overall: PASS

The deliverable is a guard I could not break in any of the four required directions plus a fifth (loosening) probe, a
correctly-scoped set of comment-only CSS annotations, and documentation. The one changed pre-existing test is a
verified mechanical re-pin, not a test changed in shape to pass. Both running-app inventories are now done properly in
both themes, and the one genuine ramp finding they surface (F1) is confirmed and referred out rather than absorbed.

## Non-blocking Suggestions

- `elevationTokenGuard.css.test.ts:296` — `BORDER_RADIUS_RE` only matches the `border-radius` shorthand.
  `border-top-left-radius` and friends are invisible to the guard. There are currently **zero** corner-specific radius
  declarations in `frontend/src` (I checked), so this is a latent gap, not a live hole — worth a one-line regex
  widening (`border(-(top|bottom)-(left|right))?-radius`) whenever this file is next touched.
- `elevationTokenGuard.css.test.ts:350-352` — the hard-coded `expect(files.length).toBe(110)` will fail on any
  unrelated CSS file add/delete. It is a deliberate non-vacuity check and cheap to update, but a `toBeGreaterThan`
  plus a separate "scanned at least N files" assertion would be less noisy for sibling lanes.
- `DESIGN.md` — two continuation lines inside the shadow bullet start at column 0 (`color-mix(...)` and
  `elevationTokenGuard.css.test.ts`), which breaks the list-item indentation when rendered. Prettier accepts it;
  it is purely cosmetic.
