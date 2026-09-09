# Skeptic Report — final gate (round 1, skeptic-final-1.md)

HEAD `91e66a18`. Reviewed `git diff main...HEAD` in full, and gave
`git diff 40078e75..91e66a18` (never reviewed by anyone) a first review, not a spot check.

## What I verified (with evidence)

### Gates, re-run by me in the worktree

| gate | command | result |
| --- | --- | --- |
| unit tests | `npm --prefix frontend test` | PASS — 295 suites / 3105 tests |
| lint | `npm run lint` (`eslint src --max-warnings=0`) | PASS |
| typecheck | `npm run typecheck` (`tsc --noEmit`) | PASS |
| format | `npm run format:check` | PASS |
| locale-hostile | `LANG=de-DE TZ=Asia/Tokyo npx jest --testPathPatterns="TableRenderer\|columnFormatting\|useOutputColumnFormats\|buildOutputConfig\|outputConfigTypes\|TableDisplayFields"` | PASS — 7 suites / 142 tests |

The locale-hostile run is a real measurement, not a no-op: under that env
`node -e 'new Intl.NumberFormat().resolvedOptions().locale'` prints `de-DE` and the timezone
prints `Asia/Tokyo`. So the `formatIntl` pin is doing work.

### The central trap — sort reads RAW values, guard mutation-failable AT THE CALL SITE

Re-derived, not inherited. The call site is now `TableRenderer.tsx:309`
(`() => columns.map((col) => ({ key: col.key, getValue: (row) => getSortValue(row[col.key]) })),`)
— design.md/ticket.md still cite `:243`, line drift only.

I applied the mutation MYSELF (re-pointing that `getValue` at
`formatColumnValue((columnFormats ?? {})[col.key], row[col.key], formatIntl)`) and captured the
failing test NAMES rather than a count:

```
● TableRenderer — column formatting … › 3.2 PROOF/GUARD: a currency column sorts numerically (raw), not by its formatted text
● TableRenderer — column formatting … › formatting a column does not change the row order of an already-sorted column
● TableRenderer — sort (HEL-448) › 2.5a PROOF: a decimal-valued string column sorts numerically…
● TableRenderer — sort (HEL-448) › 2.5b: blanks … sort last in both directions, never as zero
```

The named HEL-469 guard is red, at the branch that can actually leak. Restored; `git status` clean.

### The filter path — same treatment

Reverted `cellMatches` to bare `formatCell(value)` (ignoring the `format` parameter). RED in both
directions, by name:

```
● 3.5 PROOF/GUARD: a currency-formatted column's filter matches the FORMATTED text, not the raw value
● 3.5 PROOF/GUARD: the same column does NOT match a term visible only in its raw (unformatted) value
```

Restored; clean.

### `91e66a18` — the unreviewed fix. It is correct, and I checked what it ADMITS

The fix moves state from type-only `selections` to full `specs: TableColumnFormats`, derives
`selections` from it, and returns `columnFormats: specs`. Checked the consequences the fix admits,
not only the ones it excludes:

- **A carried-forward field that is now meaningless for the new type is safe on the round trip.**
  `setFormat("amount","number")` on `{type:"currency",currency:"EUR"}` yields
  `{type:"number",currency:"EUR"}`. That persists, and `readColumnFormats`
  (`outputConfigTypes.ts`) keeps `currency` regardless of `type` (it validates each optional field
  independently), so it survives reload; `formatColumnValue`'s `number` branch never reads
  `spec.currency`. No data loss, no rendering change. Verified by reading both functions, not from
  the comment.
- **No default is invented** for an absent sub-option — `{ type }` only for a fresh column; an
  absent `currency` still means the formatter's `"USD"` default rather than a written claim.
- **Returning the state object itself** (`columnFormats: specs`) is not mutated by any consumer:
  `buildOutputConfig` passes it through into a fresh object literal.
- **The `useState`-initializer seeding is NOT stale across opens**, contrary to the worry the
  `OutputEditorSheet.tsx:145` comment invites ("the sheet instance is reused across opens rather
  than remounted"). At the only production call site, `PipelineDetailPage.tsx:315`, the sheet is
  rendered under `{outputSheet && (…)}`, so closing unmounts it and every open re-seeds. The
  comment is stale for this call site; the behaviour is correct.

### Alignment coupling (settled ruling) — correctly implemented

`DataGrid.tsx` applies `col.align` to the `th` (`textAlign` merged into the width style) AND the
`td`, and `TableRenderer.tsx`'s `formattedColumns` sets `align: "right"` only for
`number`/`currency`. Test `3.3` asserts both `th.style.textAlign` and `td.style.textAlign`.
No focus indicator is introduced anywhere in this diff (no `:focus`/`outline`/`box-shadow` rule
added; the only new CSS is `width`/`flex-shrink`), so the `--app-focus-ring-color` ruling has
nothing to bind to here.

### Acceptance criteria traced

| AC | status |
| --- | --- |
| `currency` renders `$1,234.56`-style; `text` unchanged | MET (`columnFormatting.ts`, tests, locale-pinned) |
| `number` respects decimal places; `date` renders the chosen pattern | **UNMET as a user-reachable capability** — the spec and formatter support `decimals`/`datePattern`, but the control exposes TYPE only, so a user cannot choose either. Stated plainly per the reporting rule; **owner-ruled reported-not-blocked**, so it is NOT a change request below. |
| Unparseable/null render raw or `—`, never throw | MET (`formatColumnValue` try/catch + fallbacks; tests) |
| Persists across modal open/close and reload | MET — code path re-derived above; evaluation-2 demonstrated the reload round trip live |
| Sort uses RAW values, guarded by a mutation-failable test | MET — **I reproduced the mutation myself**, correct branch, RED |
| Jest coverage per formatter + fallback, locale/timezone PINNED | MET — 142 tests green under `de-DE`/`Asia/Tokyo` |
| Right-align numeric/currency | MET |

## Verdict: REFUTE

Three findings below. None is a design objection — the implementation is sound and the guards are
real. All three are pointer/label defects of exactly the class this change has already committed
twice, and one of them is a guard-verification claim I could not reproduce as written.

Separately, and NOT counted as a change request: **the UI/visual-cohesion judgment did not happen
this round.** The shared Playwright browser profile (`mcp-chrome-30e282e`, pid 2545276) is held by
another live session; six navigation attempts over ~10 minutes returned "Browser is already in
use", and I will not kill another lane's browser. So I have NO independent screenshots and made no
visual claim in either theme. Whoever runs round 2 must do that; do not treat this report as having
cleared it. (I did content-self-authenticate the servers before concluding anything:
`GET localhost:5901/src/.../useOutputColumnFormats.ts` contains `setSpecs` — i.e. the port serves
`91e66a18`, not a stale build — and `localhost:8808/health` returns 200. The stray 5176 server is
gone; `ss -lntp` shows only 5901 and 8808.)

### Change Requests

1. **Five shipped files cite a report that did not exist.** `TableRenderer.tsx:64` ("skeptic-final-1
   finding 2"), `TableRenderer.test.tsx:762` ("skeptic-final-1 finding 2"),
   `TableDisplayFields.css:84` ("skeptic-final-1 finding 1"), `useOutputColumnFormats.ts` and
   `useOutputColumnFormats.test.ts` ("skeptic-final-1 cycle-3 finding"), plus `files-modified.md:23`
   and `:71` ("skeptic-final-1 blocking finding 1/2"). No skeptic-final report existed for HEL-469
   before this one. Those were **evaluation-1's two change requests** and **evaluation-2's
   non-blocking finding**. This is not cosmetic: `skeptic-final-1.md CR1` is a load-bearing
   navigation convention in this codebase (14+ live references across `PanelList.tsx`,
   `PanelGrid.tsx`, `useRecentPaletteActions.ts`, …), and `skeptic-final-1.md` now exists for
   HEL-469 and contains none of those findings — a reader following the pointer lands on the wrong
   document. Re-point each to `evaluation-1.md` change request 1/2 and `evaluation-2.md`
   non-blocking finding respectively.

2. **`useOutputColumnFormats.test.ts`'s guard comment describes a mutation that does not make that
   guard red.** The comment says the guard was "verified red by hand against that rebuild
   (`columnFormats[key] = { type }` instead of carrying the existing spec forward)". I ran exactly
   that — replaced `const nextSpec = existing ? { ...existing, type } : { type }` with
   `{ type }` — and the labelled test **"MUTATION-FAILABLE GUARD: editing ONE column's format does
   not discard ANOTHER column's already-persisted sub-options"** stayed **GREEN**; only the
   *same-column* test went red. That mutation cannot reach it: the cross-column property is carried
   by the `specs` state, not by `setFormat`'s carry-forward.
   The mutation that does make it red is the **derivation**: rebuilding the returned map as
   `for (const [k, sp] of Object.entries(specs)) rebuilt[k] = { type: sp.type }` — I ran that and
   got both tests red, by name. So the guard IS genuinely mutation-failable against the real pre-fix
   defect (good), but the recorded verification procedure is wrong, and this is the **third**
   occurrence in this change of a plausible mutation exercising the wrong branch — the exact failure
   the two LESSON sections in `workflow-state.md` were written to stop. Correct the comment (and the
   matching sentence in `files-modified.md`) to name the derivation-site mutation, and keep the
   same-column test explicitly labelled as the guard for `setFormat`'s carry-forward.

3. **A stale ruling still stands as a heading in `workflow-state.md`.** Under "RULED AC
   ADJUSTMENTS": *"'composes with filter' OUT OF SCOPE — HEL-451 is parked, `columnFilters` is not
   on `main`. Do not build against an absent interface."* That is false today and contradicted by
   `ticket.md` ("IN SCOPE, superseding the earlier deferral" — HEL-451 merged as `a6bde0d3`), by
   design D6a, and by the shipped `tableFilterPredicate.ts`. A reader who stops at that heading gets
   the wrong answer and could "correct" the filter composition back out. Replace the bullet text;
   do not append a correction under it.

### Non-blocking notes

- Line drift: `design.md` D1b, `ticket.md` and the `getSortValue` comment all cite
  `TableRenderer.tsx:243` for the sort call site; it is `:309` on HEAD.
- The `th` now always receives a `style` object literal (`{...width, ...align}`), where it
  previously received `undefined` when there was no width. Behaviourally inert (React writes no
  style properties for an empty object) and no test regressed, but it is a small widening.
- `OutputEditorSheet.tsx:145`'s comment ("the sheet instance is reused across opens rather than
  remounted") is stale at the only production call site, which unmounts on close. Not this ticket's
  to fix, but it invites a false conclusion about every `useState`-seeded field in that file.
- Untracked `5901/backend/.env` in the worktree root — a server-start artifact (an empty path
  variable), not part of this diff and not committed. Environmental, worth a glance at
  `start-servers.sh` in the Concertino repo rather than a fix here.
- The known consequence that this ticket's behaviour changes when HEL-1033 lands (object columns
  will show real JSON) is recorded in the artifacts; make sure it reaches the PR body as required.
