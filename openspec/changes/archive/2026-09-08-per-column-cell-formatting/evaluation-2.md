# Evaluation Report — Cycle 2 (evaluation-2.md)

HEAD `40078e75`. Re-reviewed the cycle-2 diff (`git diff 5745f68f..40078e75`): 4 source files,
+65/-16 — `TableDisplayFields.css` (+14), `TableDisplayFields.tsx` (wrapper div),
`TableRenderer.tsx` (`formatIntl` prop + threading), `TableRenderer.test.tsx` (`PINNED_INTL`
passed at 7 call sites). Nothing else in the implementation moved.

Both cycle-1 change requests are fixed. Verified by my own measurements, not from the report.

## Phase 1: Spec Review — PASS

- Tasks 5.2 / 5.3 are now `[x]` and the evidence behind them is real (re-measured below).
- Task 4.1a is now actually satisfied, not just marked.
- The `formatIntl` mechanism follows design D4 / task 4.0 as written — *"an EXPLICIT locale
  argument to every `Intl` call under test (not by mutating a global)"* — rather than being
  invented to pass. Task 4.2's "do NOT fix production to match the tests" is respected: see
  Phase 2.
- No scope creep in the fix diff; nothing touched in HEL-1042 / HEL-1033 / HEL-1027 territory.
- Everything settled in cycle 1 (flat sibling, `mergeableSubObjects` untouched, corrected
  comments, D6 four-consumer split) is unchanged by this diff and re-confirmed where the diff
  could plausibly have disturbed it.

## Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH`:

| gate | result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm --prefix frontend test` | PASS — 294 suites / 3097 tests |
| `LANG=de-DE TZ=Asia/Tokyo npx jest --testPathPatterns="TableRenderer\|columnFormatting"` | **PASS — 81/81** (was 5 failed / 76 passed) |

Backend untouched; `sbt test` N/A.

### The guards were anchored, not weakened

The concern with a locale fix is a guard loosened until it passes everywhere. It was not:

- The diff adds **only** `formatIntl={PINNED_INTL}` lines. No assertion changed. The sort
  guard still asserts the exact formatted order `["$9.99", "$1,234.56"]`; the filter guards
  still assert on `"1,234"` matching and `"1234.56"` not matching. Formatted output is still
  what is asserted.
- `PINNED_INTL` is applied only to the 7 tests that assert locale-dependent rendered text.
  The object-branch contract test, the text-column non-alignment test, the unparseable-value
  test and the unformatted-column tests correctly do **not** receive it — nothing locale-
  dependent to anchor.
- **Both mutations re-run by me on the cycle-2 code**, because the `formatIntl` threading
  touches `resolveColumnFormatter`'s call path:
  - sort call site → per-column formatter: **RED**, 2 tests, including
    *"3.2 PROOF/GUARD: a currency column sorts numerically (raw)…"*.
  - `cellMatches` → bare `formatCell`: **RED** in both directions
    (*"…matches the FORMATTED text"* and *"…does NOT match a term visible only in its raw
    value"*).
  Both restored; `git status` clean after each.

So the pin made the guards portable without costing them their teeth.

### `formatIntl` is genuinely test-only

Grepped rather than assumed. Outside `TableRenderer.test.tsx`, `formatIntl` appears at exactly
four sites, all declaration/threading inside `TableRenderer.tsx` (`:73`, `:204`, `:251`,
`:254`). The **only** production call site is `PanelContent.tsx:137`, whose prop list
(`:138-149`) does not include it — so production passes `undefined` and
`resolveColumnFormatter(spec, undefined)` keeps `Intl`'s runtime-locale defaults, exactly as
before. Production formatting behaviour is unchanged (design D4 / task 4.2 honoured).

### Formatter sharing still holds

`formatters` remains one memoized map built from `resolveColumnFormatter`, consumed by both
`formattedColumns`' `render` (`TableRenderer.tsx:262-278`) and `rowMatchesFilters`
(`:296`). One resolver, two consumers — D6b intact, and the mutation results above are the
evidence rather than the reading.

### The CSS fix

`.table-display-fields__column-format { width: 140px; flex-shrink: 0 }` with a comment naming
the actual mechanism (`.ui-select`'s `width: 100%` becoming the flex item's basis and winning
against the `flex: 1; min-width: 0` sibling). That diagnosis matches what I measured in cycle 1
(label at literal 0px) — it is a root cause, not a symptom patch. `width` is not covered by
DESIGN.md's `[mechanical]` spacing rule (which binds margin/padding/gap to `--space-*`) and
the `--control-*` tokens are heights only, so the literal is not a token violation. No new
`gap`/`padding` literals were introduced.

## Phase 3: UI Review — PASS

**Content self-authentication first.** `GET localhost:5176/src/.../TableDisplayFields.css`
contains `.table-display-fields__column-format`, and
`GET localhost:5176/src/.../TableRenderer.tsx` contains 3 `formatIntl` occurrences — the port
is serving cycle-2 code, not a cached cycle-1 build.

### The column list, re-measured (my finding, my measurement)

At 1600×1000, live DOM:

| element | cycle 1 | cycle 2 |
| --- | --- | --- |
| `.table-display-fields__column-key` ("category") | **0px** (scrollWidth 57) | **57.1px**, `clipped: false` |
| `…__column-visibility` label | **0px** | **334px** |
| `[aria-label="Format category"]` wrapper | 434px | **140px** (bounded) |
| visibility checkbox | clipped | 13×13px, hit-testable |

First five keys all render at full text width with no ellipsis
(`category` 57.1, `company` 59.9, `date` 28.2, `game_id` 51.8, `last_modified` 86.0). Confirmed
in **both themes** — `hel469-c2-editor-fixed-dark.png`, `hel469-c2-editor-fixed-light.png`.

### Does the squeeze just move to a narrower width? No.

This was the specific follow-up worth checking, since `flex-shrink: 0` on a 140px child could
hand the squeeze back to the label. Measured across the sweep:

| viewport | dialog | row | label | format | keys clipped |
| --- | --- | --- | --- | --- | --- |
| 1600 | — | 666 | 334 | 140 | none |
| 768 | 720 | 666 | 334 | 140 | none |
| 360 | 322 | 666 | 334 | 140 | none |

The row's width is set by the modal body, not by viewport reflow, so the label never
re-shrinks — at 768 the row fits inside the dialog (`rowRight` 737 vs `dialogRight` 744, no
overflow) and no key is clipped at any width. 1440/1100 sit between measured points that both
pass.

### The full editor round trip, through the real UI (not the API)

Cycle 1 measured formatting by PATCHing the Output directly. This cycle I drove the surface
that was broken:

1. Opened the format `Select` for `last_modified` — options are exactly
   `None / Number / Currency ($) / Date / Text`.
2. Chose `Currency ($)`, clicked **Save**. Persisted config became
   `{"columnFilters":null,"columnFormats":{"last_modified":{"type":"currency"}},"columnSort":{…},"fieldMapping":{}}`
   — the format written, and `columnSort`/`columnFilters` **survived** the shallow merge, which
   is the D1a/task-1.4 claim demonstrated rather than reasoned.
3. Reloaded the page and re-opened the editor: the control re-seeded to `Currency ($)` while
   every other column read `None`. **AC "format spec persists across modal open/close and
   reload" verified end-to-end through the UI.**
4. Set it back to `None`, Saved: `columnFormats` became `{}` — **written, not omitted**. That
   is design D3b proven on the real path, not only in `buildOutputConfig.test.ts`.

**Keyboard/a11y:** the trigger is the shared `Select` (`role="combobox"`,
`aria-haspopup="listbox"`, accessible name `Format <column>`); it takes focus and `Enter` sets
`aria-expanded="true"`. DESIGN.md §8 satisfied.

**Console:** 0 errors on port 5176 across every flow this cycle.

Cycle-1 findings I am **not** re-deriving, per the orchestrator and because this diff cannot
disturb them: rendered header+cell alignment agreement (`th`/`td` both `right`, matching 12px
gaps; unformatted columns keep no `td` style attribute), live numeric sort over 200 real rows,
and live formatted-vs-raw filter behaviour. The only path the cycle-2 diff touches there is
`resolveColumnFormatter`'s extra argument, which is re-covered by the two mutations above and
by 3097 green tests.

## Overall: PASS

## Non-blocking Suggestions

- **Still with the owner, reported not blocked:** the control exposes format TYPE only.
  Confirmed live — `last_modified` saved as `{"type":"currency"}` with no currency code, so it
  renders at the formatter's `"USD"` default. This is the escalated AC gap
  (*"number respects decimal places … date renders the chosen pattern"*), and the fixed-USD
  default is the HEL-1042 pattern repeating. My cycle-1 observation stands and is worth folding
  into that decision: `useOutputColumnFormats.ts` rebuilds each entry as `{ type }` only, so a
  spec carrying `decimals`/`currency`/`datePattern` (which `readColumnFormats` reads and the
  formatter honours) is **discarded** by any unrelated Save — "silently destroys", not just
  "cannot set". A currency-code control would close both at once.
- At a 360px viewport the editor's content (666px row) overflows the 322px dialog. **Pre-existing,
  not caused by this ticket** — probed by suppressing the format control's layout box, which
  leaves the row at 518px, still far wider than the dialog. This ticket widens an existing
  overflow by 148px; it does not create it. Worth a ticket for the editor generally, not a
  change here.
- A right-aligned column narrower than its value ellipses the tail, dropping the low-order
  digits the alignment exists to line up (carried from cycle 1; cosmetic, widths are
  user-resizable).

## Disclosure — shared dev-DB writes

Same Output as cycle 1: `hel904-orphan-output-05d5dbab-6942-44d7-80d4-be17510515bb`
("Projections 2026", pipeline `proj-2026-flat`).

1. Set `last_modified` → Currency via the editor UI and Saved (round-trip test).
2. **Reverted** via the same UI: set back to `None` and Saved →
   `columnFormats: {}`, i.e. the state I left it in after cycle 1.
3. Carried over from cycle 1 and still present: `columnSort = {key:"player_id",
   direction:"asc"}`. Also, the editor's Save path added `fieldMapping: {}` (empty; ordinary
   behaviour of that path, not specific to this ticket).

Evidence (main checkout, survives Phase 4):
`/home/matt/Development/helio/.concertino/runs/HEL-469/evidence/`
— cycle 2: `hel469-c2-editor-fixed-dark.png`, `hel469-c2-editor-fixed-light.png`;
cycle 1: `hel469-align-dark.png`, `hel469-align-light.png`,
`hel469-editor-format-control-light.png` (the collapse, for the record),
`hel469-table-formatting-light.png`.
