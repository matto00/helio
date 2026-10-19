## Evaluation Report — Cycle 7 (evaluation-5.md)

Cold re-check of pushed HEAD `fcfbd43d7cd2651dd49990fca92d81efbb0e9918` (PR #1068). The spawn guard returned `READY`.
The review base was resolved live with `resolve-review-base.sh` as `069afd36d` (origin/main). The full branch diff
`069afd36d...HEAD` was reviewed, plus `git show fcfbd43d7` for this cycle's change. The worktree is clean.

### Phase 1: Spec Review — PASS

- **Both evaluation-4 change requests are resolved.**
  - **CR1 (component branch on the type style).** `HomePage.css:61` now reads `white-space: var(--heading-sentence-wrap)`.
    theme.css:35 declares `--heading-sentence-wrap: nowrap` on `:root`, and theme.css:203 overrides it to `normal`
    inside the existing `:root[data-type-style="mono"]` block.
    - Grep `data-type-style` over `frontend/src/**/*.css` finds only theme.css (:197, :201). No component rule keys
      on the style any more, so DESIGN.md:385-387 and theme.css:189 are met as written.
    - The `@media (max-width: 768px)` override (`white-space: normal`) is unchanged. It is keyed on width.
  - **CR2 (dead e2e path).** `STYLE_CASES` no longer has an `asserted` field. The `(measured only)` suffix and the
    `if (!asserted) return;` are gone (spec :466-509). All four style cases assert all three spreads.
- **ACs and constraints are unchanged from evaluation-4 and are still met.** AC1 is 0px. AC2 is the relaxed guard
  from owner ruling C3. AC3 is fails-first. C1 (the 1280 pins) and C3 hold, and C2 is retired.
- **Planning artifacts.** design.md's cycle-8 note now describes the token form. The spec copies were already
  style-neutral ("the placeholder wraps likewise").
- **Scope.** This cycle touched only the files the change requests named, plus theme.css and its test, which CR1
  option (a) prescribed.

### Phase 2: Code Review — PASS

**Gates, re-run by me on fcfbd43d7** (`nice -n 19`, under the e2e lock, at most 2 workers). Logs are in
`/home/matt/Development/helio/.concertino/scratch/HEL-1665/eval5/`.

- `npm run lint`, `format:check`, `typecheck` and `check:e2e-types` all exit 0.
- `npm test`: root 524/524 and frontend 9173/9173. That is one more than evaluation-4's 9172, from the new token test.
- `npm --prefix frontend run build` exits 0.
- **e2e on the canonical servers 7097/10004** (`--trace retain-on-failure`): **89/89 passed** (`e2e.log`). The run
  covered hel1665, hel1642, hel1572, hel1583-home-375, hel1578-home-page and hel1578-home-changed-dot.
  - **Shift series:** 32 `HEL1665-SHIFT` cases, every one `runsTopSpread`/`contentTopSpread`/`shelfTopSpread` = 0.
  - **Type styles, held load:**

    | Style | Viewport | Spreads (runs/content/shelf) | Sentence lines |
    | --- | --- | --- | --- |
    | Mono | 1280 | 0/0/0 | 2 |
    | Mono | 375x667 | 0/0/0 | 3 |
    | Serif | 1280 | 0/0/0 | 1 |
    | Serif | 375x667 | 0/0/0 | 2 |

  - **C1 pins:** "Home settled at 1280x900 (light|dark): boxes equal the pinned base numbers" both passed.
  - **AC2 guard:** "Home at 375x667 (light|dark): the timeline heading and the top of the first row are above the
    bottom nav (guard)" both passed.
  - **hel1572:** all cases passed.
  - **Fonts:** the cold-load `fontSwapSpread` was recorded at 3–4px. It is not asserted, as the owner ruled.

**Does theme.css's token follow the file's conventions? Yes.**

- It sits on `:root` next to the `--font-heading` it relates to.
- It has the file's block-comment style with a ticket reference.
- The type-style override sits in the existing type-style block.
- Its name does not use a family prefix like `--font-*`/`--density-*`. But theme.css already has
  component-scoped tokens (`--app-swatch-ring`, `--bottom-nav-*`, `--app-command-bar-height`). The comment names its
  one consumer and why Mono differs. This is acceptable.

**Does loosening appearanceTokens.css.test.ts weaken the guard? No.**

- The Mono test still compares the block's **complete** declaration list with `toEqual`
  (`["--font-sans: var(--font-mono)", "--heading-sentence-wrap: normal"]`). Any other declaration added to the Mono
  block still fails it. The guard against style blocks growing unreviewed overrides is kept; one named, tested
  declaration was admitted.
- The Serif test is untouched and is still an exact match.
- The new test pins the `nowrap` default and checks that Serif does not override the token.
- `HomePage.css.test.ts` adds `expect(css).not.toMatch(/data-type-style/)`. That turns CR1 into a regression guard
  against any type-style selector in Home CSS. It is a stronger rule than before.

**Live parity check** (MCP browser, DOM-only attribute switch, no server write). A ghost copy was injected beside the
real sentence:

| Width | Sans | Serif | Mono |
| --- | --- | --- | --- |
| 1280 | nowrap, 30/30 | nowrap, 30/30 | normal, 60/60 |
| 375 | `normal` via the media rule, 50/50 | `normal` via the media rule, 50/50 | normal, 75/75 |

Each cell is the computed `white-space`, then ghost/real sentence height in px. The 1280 values are the token. There
was no horizontal scroll and no console errors.

**Issues:** none.

### Phase 3: UI Review — PASS

- **Servers.** Started with `start-servers.sh` (`PASS servers`) and stopped with `stop-servers.sh`
  (`STOPPED ports=7097,10004`).
- **Coverage.** Held load at 375–1280, light and dark, Mono and Serif, is covered by the e2e group above. The settled
  layout matches the C1 pins. The live probe above confirms ghost/real parity across all three styles at 1280 and 375.
- **Unchanged from evaluation-4.** This cycle touches only the placeholder's wrap source, so the Phase-3 findings
  there still hold: touch targets, `aria-hidden` slot and ghost, loading status names, and no breakage at 768/1100/1440.
- **Test data.** The e2e teardown deleted its 89 throwaway users. I created no data.

### Overall: PASS

### Non-blocking Suggestions

- **Stale describe title.** The describe at `appearanceTokens.css.test.ts:61` is still titled "type-style tokens
  (font tokens only)". The Mono block now also carries a non-font token, so the title could say so.
- **DESIGN.md does not mention the new override.** The "Type styles (HEL-1572)" bullet (DESIGN.md:385-392) lists Mono
  as `--font-sans: var(--font-mono)` only. A short note on `--heading-sentence-wrap: normal` would keep the standard's
  token inventory exact. The rule itself is met.
- **Nested `aria-hidden`.** Carried from evaluation-4: `DashboardShelf.tsx:45`'s nested `aria-hidden` is redundant.
- **CI.** Confirm PR CI is all green on fcfbd43d7 before merge.
