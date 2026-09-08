## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. Round 1's report was read as a set of claims; every conclusion below comes from a
command I ran, a computed style I measured, or a screenshot I looked at in this session.

### Content self-authentication

`curl localhost:5935/src/features/commandPalette/ui/CommandPalette.tsx` contains the class name
`command-palette__notice-icon` (1 hit), and the served CSS module contains the full
`.command-palette__notices` / `.command-palette__notice` / `.command-palette__notice-icon` block.
Both are runtime strings (class names, not types) that exist only on `f45d78c8`. Port 5935 serves
the post-fix branch. I also re-checked `location.href` before every observation: a peer Playwright
session repeatedly stole the shared tab to `localhost:5876`, and I discarded and re-took every
reading that came back on the wrong port (two occurrences).

### CR2 — the overflow row is genuinely non-interactive (VERIFIED FIXED)

Live, query `test` on `/`:
- The notice is `tag: DIV`, `role: null`, `tabindex: null`, `closest('[role="listbox"]') === null`,
  contains 0 `<button>`s, `cursor: auto`.
- 16 `role="option"` elements; none is the notice.
- I dispatched 20 `ArrowDown`s and captured `aria-activedescendant` after each: it cycles the same
  16 real option buttons and wraps; `anyNoticeActive === false`. The notice has no id at all.
- I clicked the notice in the running app: palette still open, `input.value === "test"`, still 16
  options, URL unchanged. This is the exact action that in round 1 closed the palette and dropped
  the query.
- Sole consumer / no second path: `grep` finds `useResourceSearchActions()` called from exactly one
  site (`CommandPalette.tsx:121`), `overflowNotices` referenced only there and in the hook, and
  **zero** `run: () => {}` occurrences anywhere under `features/commandPalette/`. No other code path
  can register a notice as an action.
- Structural edge I checked rather than assumed: the notice block is gated on
  `group.section === SEARCH_SECTION`. A notice can only exist when its kind had >5 matches, and
  those 5 capped matches are pushed as `matchesQuery: true` actions which `rankActions` always
  keeps — so the search group is always present when a notice exists. Should that ever break, the
  notice silently does not render (fails safe; it can never become a dangling affordance again).

**Guard failability, mutation-proved in a real browser (not jsdom).** I restored the notice to its
pre-fix `CommandAction`/no-op-`run` shape (pattern-asserted, "MUTATION LANDED", grep-confirmed at
line 175) and re-ran the new e2e: **FAILED** — `toHaveCount(5)` saw 6 options. Reverted, green.

### CR1 — icon-gutter alignment (VERIFIED FIXED, measured)

Computed style in the running app, at the same DPI, both themes:
- Light: notice text `x = 253.0`, sibling option title `x = 253.0` — **0px delta** (round 1 measured
  223 vs 253, a 30px hang).
- Dark: notice `x = 253.0`, option `x = 253.0` — 0px.
- Spacer and icon are dimensionally identical (`18px × 18px` both), padding `8px 12px` both, gap
  `12px` both. All from `--text-lg` / `--space-*`; `check:tokens` resolves every reference.

**Failability:** I set `.command-palette__notice-icon { display: none }` and re-ran the new e2e:
**FAILED** at the `Math.abs(noticeBox.x - optionTitleBox.x) <= 1` assertion. Reverted; `git status`
clean.

### Nothing newly broken — by the fixes or by the rebase onto HEL-442

- `npm run lint` (frontend, `--max-warnings=0`) clean; `npm run typecheck` clean.
- `npm test` from `frontend/` (not the worktree root, where jest finds zero tests):
  **291 suites / 2937 tests passed**.
- `npm run check:tokens` — OK.
- HEL-442 elevation/radius guard + HEL-441 motion guard + token audit sweep: **56 passed**. I
  verified the elevation guard actually scans this file by injecting `border-radius: 7px` and
  `box-shadow: 0 1px 2px rgba(0,0,0,0.2)` into the NEW `.command-palette__notice-icon` rule —
  the guard went **red** on it. Reverted. So the post-rebase guard covers the new CSS and the new
  CSS satisfies it.
- `npm run format:check` — clean. `scripts/check-openspec-hygiene.mjs` — clean; `tasks.md` has 31
  checked tasks and zero unchecked.
- Full HEL-503 e2e: **6/6 passed** (incl. the 5 pre-existing acceptance tests, so the fix did not
  disturb the indexing/navigation/coverage paths).
- Downstream (evidence rule 5): HEL-519 recents e2e **8/8 passed** post-rebase.
- Console: **0 errors** across the whole live session (load → palette → search → arrow → click →
  theme toggle).

### UI cohesion, judged against the running app in both themes

Screenshots: `skeptic2-light.png`, `skeptic2-light-notice.png`, `skeptic2-dark-notice.png`,
`skeptic2-dark-4notices.png`. The notice reads as a muted footnote (`--text-xs`,
`--app-text-muted`, `rgb(155,148,138)` in both themes) sitting at the end of the Search results
group, text column continuous with every row above it, with no hover/active affordance — it now
correctly looks like what it is. I also drove the multi-kind case (query `e`, all four kinds
overflowing): four notices stack cleanly between the last search row and the `NAVIGATION` eyebrow,
consistent spacing, legible in dark. No new visual dialect; no new cohesion call to escalate.

### Two-axes question

*What does no source text carry:* whether the notice is reachable by a real pointer or real arrow
keys — the source only shows it is not a `<button>`; jsdom cannot prove the rest. I answered it by
clicking it and by walking `aria-activedescendant` through a full wrap in a real browser.
*What path did the gates not exercise:* round 1's answer (the overflow row) is now covered by a
real-browser e2e I proved failable on both arms. The remaining unexercised path I found is the
**assistive-technology announcement** of the notice — see non-blocking note 1. It degrades nothing
that worked before (the pre-fix row was announced but broken), so it is not a blocker.

### Verdict: CONFIRM

Both blocking findings are genuinely fixed in the running app, both guards are failable and were
proved red, and nothing regressed from the fixes or the HEL-442 rebase.

### Non-blocking notes

- The notice is a plain `<div>` with no `aria-live` / `role="status"`. A screen-reader user
  arrowing the listbox will never hear "+70 more sources match". It sits inside
  `#command-palette-results` (the combobox's `aria-controls` region), so it is not invisible to AT,
  but it is not announced on change either. Folding the count into the existing
  `.command-palette__coverage` line (already a polite status area) would be the tidier home; worth
  a palette-polish follow-up, not this ticket.
- With several kinds overflowing, all notices stack at the END of the single Search results group,
  spatially detached from the rows each describes. Readable because each names its kind, and a
  direct consequence of the design-gate D5 single-section decision — recording it only so the owner
  can rule later if per-kind placement is wanted.
- No guard covers `width`/`height` values in CSS (only elevation/radius and var-resolution), so the
  new spacer's token sizing is protected by the e2e alignment assertion rather than by a static
  check. That is adequate here — noting it because the e2e is the only thing holding that line.
- Round 1's "clipped first group label" note still stands as pre-existing (HEL-496) and untouched.
