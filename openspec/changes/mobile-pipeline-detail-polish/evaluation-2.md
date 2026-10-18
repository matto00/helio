## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `90d13bc9afe0ce9e69c1e50fde001e27cd201595`. It merges `origin/main` `49021293b` (HEL-1669) into `389273bc6`.
Live base from `resolve-review-base.sh`: `49021293b96c55fc9d80a6ed79b5b55d925fb6b7`. The HEL-1668 surface is therefore `49021293b...HEAD`, and the cycle-2 delta is `389273bc6..HEAD`.
Evidence: `/home/matt/Development/helio/.concertino/scratch/HEL-1668/eval-1/cycle2-e2e.log`. Cycle-1 screenshots are still in the same directory.

### Phase 1: Spec Review — PASS

- **CR1, merge with HEL-1669: resolved.**
  - In `PipelineMobile.css`, only HEL-1669's `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary):hover:not(:disabled)` moved into `@media (hover: hover)`. It stays in place: after the gated `.mobile-pill:hover:not(:disabled)` block and the UNGATED light rest-fill rule (`background: var(--app-surface-soft)`), and before the `.mobile-pill--primary` rules.
  - Values are unchanged (`--app-surface-strong`), and C2 source order is kept. On hover-capable devices the cascade matches HEL-1669's own: light Dry run hover against rest measured 1.179 here, against 1.18 in HEL-1669's design.
  - `HEAD` merges cleanly. The rest of HEL-1669 came in unchanged: theme, appearance, chart code and DESIGN.md.
- **CR2, artifacts: resolved.**
  - `tasks.md` 5.2 and 6.3 and `design.md` D5/D6(c) now describe the hel1582 context move, the HEL-1669 gating, the `min-width: 15ch` / ≤685px header threshold (hidden rather than clipped at 601-685px) and the phone label margin.
  - The `pipeline-detail-mobile-layout` delta adds scenarios for both.
  - `files-modified.md` has a "UI decisions taken overnight (for the PR body)" list.
  - Minor: line 15 of `files-modified.md` still says "ONLY the phone hover… test" and "CONFLICT RISK… whichever lane merges second". That is now historical, and the new section supersedes it. Non-blocking.
- **C1 and C2 are honoured.** There are no code changes to Toast, and C2 was checked above.
- **Other lanes' files are untouched by this lane:** `frontend/src/app/App.tsx`, `e2e/hel1579-*` and `e2e/support/apiRequestCounter.ts` are not in `49021293b...HEAD`.

### Phase 2: Code Review — PASS

I ran the gates myself on `90d13bc9a`:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test`: root 524/524 and frontend 9104/9104 passed, 728 suites, exit 0. That count includes HEL-1669's new appearance tests.
- `npm --prefix frontend run build`: exit 0.

The hover-gating guard `pipelineHoverGating.css.test.ts` passes with HEL-1669's rule present, so the conflict resolution satisfies it.

Process note: the 1-minute load was 11.4 when I launched the niced gate batch; I should have waited first. The e2e run waited until load was ≤10.

**The hel1582 spec, compared against `49021293b` with `git diff -w`.** Both hover tests changed only by:
- swapping the `page` fixture for a `browser.newContext({ baseURL, viewport: 375x812, isMobile: false, hasTouch: false, deviceScaleFactor: 2 })` page;
- a `try { … } finally { await context.close(); }`;
- reformatting one line.

Every HEL-1669 assertion is byte-identical apart from whitespace. That covers:
- the generic 4.5 / 3 / verdict filter, with no exception;
- `runPillHover` present in both themes;
- the mutation proof;
- `dryVsRest >= 1.1`;
- Run pill rest = `--app-accent` and hover = `--app-accent-strong`.

**Does HEL-1669's "Dry run hover is distinct" test still check what it was written to check? Yes.** It asserts that a hovered Dry run pill differs from its rest fill by at least 1.10, and that the Run pill rests on `--app-accent` and hovers on `--app-accent-strong`, in both themes. With hover fills gated, a pointer can only produce those hover fills on hover-capable devices. That is where it now measures. The rest fills it compares against are ungated, so they are identical in both contexts.

The test can still go red. If the gated light rule were lost or mis-ordered, `dryHover` would equal `dryRest` (ratio 1.0, which fails `>= 1.1`). If the primary pill's gated hover broke, `runHover` would not equal `--app-accent-strong`.

What it no longer does is prove that hover fills appear under `hover: none`. That is the intended behaviour change (D5). The touch side is covered by `hel1668-phone-sheet` item 5: `matchMedia("(hover: hover)")` is false, and the fill after a real tap equals the rest fill, at 375, 390 and 768, both themes.

### Phase 3: UI Review — PASS

Servers: `start-servers.sh`, then `assert-phase.sh servers` gave PASS on 7100 and 10007 (reused).

The targeted e2e run on the merged head (2 workers, `nice -n 19`, `--trace retain-on-failure`) gave **35/35 passed** (`cycle2-e2e.log`):
- every `hel1668-*` test: items 1-7 at 375, 390 and 768, the desktop placements at 1280 and 1000, the compact touch tablet, and copy at five widths, light and dark;
- `hel1608` compact rows;
- hel1582 "phone hover, focus and pressed states" and "HEL-1669: the Dry run hover is distinct";
- hel1582 "N fields" phone at 375/390/768 and desktop 1440.

Light Dry run measured rest `rgb(239,236,230)` and hover `rgb(255,255,255)`, a ratio of 1.179. The Run pill measured rest `rgb(249,115,22)` and hover `rgb(250,149,78)` (HEL-1669's ink-aware `--app-accent-strong`).

The only UI-affecting change in cycle 2 is one CSS rule wrapped in a media query, so I did not repeat cycle 1's full visual sweep (screenshots at 375/390/768/1000/1280, both themes, in `eval-1/`).

### Overall: PASS

### Non-blocking Suggestions
- `files-modified.md:15`: update or remove the "ONLY the phone hover… test / CONFLICT RISK" bullet. Both hel1582 hover tests moved, and the conflict is resolved.
- Carried over from cycle 1, still applicable:
  - Merge the two consecutive `@media (hover: hover)` blocks for `.mobile-pill--primary:hover:not(:disabled)` (`PipelineMobile.css`) and `.spine-header__btn--primary:hover:not(:disabled)` (`PipelineSpineHeader.css`) into one rule each.
  - Consider making `useTopModalDialog`'s body-subtree `childList` observer cheaper.
