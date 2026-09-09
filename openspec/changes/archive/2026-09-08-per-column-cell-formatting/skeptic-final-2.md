# Skeptic Report — final gate (round 2, skeptic-final-2.md)

HEAD `154e6ed3`. Fresh cold agent. Round 1's report read as claims to verify, not facts.
Round 1's one undone job — the UI/visual-cohesion judgment — is **done this round**, in both themes,
against the running app.

## What I verified (with evidence)

### Servers — content self-authenticated by me (binding rule 10)

`ss -lntp`: only `5901` (node, this worktree) and `8808` (java). `GET localhost:5901/` → `200`;
`GET localhost:5901/src/features/pipelines/ui/outputEditor/useOutputColumnFormats.ts` contains
`setSpecs` (2 occurrences) — i.e. the port serves THIS branch, not a stale build.
`GET localhost:8808/health` → `200`. The stray `5176` server and the stray `5901/backend/.env`
directory are both gone (`ls 5901` → No such file or directory).

### The `git commit -n` bypass hid nothing

| gate | result |
| --- | --- |
| `npm run check:no-credential-leak` | **PASS** — `OK (6451 files scanned … 0 violations)` |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run format:check` | PASS |
| `npm --prefix frontend test` | **PASS — 295 suites / 3105 tests** (re-run by me at `154e6ed3`, not inherited from round 1's `91e66a18`) |

The credential-leak hook was the only gate that tripped, on the stray artifact directory, which no
longer exists. Re-run clean. Bypass confirmed benign.

### Round 1 CR1 — citations re-pointed, and I verified the executor's MAPPING, not just the edit

I was told round 1's own mapping instruction was wrong and the executor corrected it. **The executor
is right.** Traced to the source text of each report rather than to anyone's numbering:

- `evaluation-1.md` Change Request **1** is *"Pin locale (and timezone where dates are asserted) in
  `TableRenderer.test.tsx`'s HEL-469 block — task 4.1a"*. → correctly cited by
  `TableRenderer.tsx:64` (the `formatIntl` TEST-ONLY prop doc) and `TableRenderer.test.tsx:762`.
- `evaluation-1.md` Change Request **2** is *"Stop the new format `Select` from collapsing the column
  name and visibility checkbox — task 5.2"*. → correctly cited by `TableDisplayFields.css:84`.
- `evaluation-2.md`'s **non-blocking suggestion** is the *"`useOutputColumnFormats.ts` rebuilds each
  entry as `{ type }` only … **discarded** by any unrelated Save"* finding. → correctly cited by
  `useOutputColumnFormats.ts` and `.test.ts`.

`grep -rn "skeptic-final-1" frontend/` returns **zero hits in any file this diff touches**. The ~90
remaining hits are other tickets' files (HEL-528/718/824/955/861/516/539 …) — the pre-existing
navigation convention, untouched. Also zero left in this change's `openspec/` artifacts except the
`workflow-state.md` line that *describes* the mislabel. Resolved.

### Round 1 CR2 — I re-ran BOTH mutations myself. The corrected comment is now exactly true.

Not accepted on report. Applied by hand at `154e6ed3`, worktree restored and verified clean after each.

**Mutation at the DERIVATION site** (`return { … columnFormats: specs }` → a loop rebuilding each
entry as `{ type: sp.type }`) — **2 red, both by name**:

```
● useOutputColumnFormats › MUTATION-FAILABLE GUARD: editing ONE column's format does not discard ANOTHER column's already-persisted sub-options (decimals/currency/datePattern)
● useOutputColumnFormats › MUTATION-FAILABLE GUARD (setFormat carry-forward): editing a column's own type preserves that SAME column's other sub-options
```

**Mutation at `setFormat`'s CARRY-FORWARD line** (`existing ? { ...existing, type } : { type }` →
`{ type }`) — **exactly 1 red**, and it is the same-column one:

```
● useOutputColumnFormats › MUTATION-FAILABLE GUARD (setFormat carry-forward): editing a column's own type preserves that SAME column's other sub-options
```

The cross-column guard stays **GREEN** under the carry-forward mutation — precisely what the rewritten
comment now says ("this guard is NOT sensitive to `setFormat`'s own carry-forward line … the
cross-column property is carried by the `specs` state itself"). Both guards are genuinely failable,
at different branches, and neither is redundant. CR2 resolved.

### Round 1 CR3 — replaced, not annotated

`workflow-state.md:60-65` now reads *"'composes with filter' **IS IN SCOPE** and is BUILT"*, with the
prior text gone and an explicit note that it was **REPLACED, not annotated**. No "composes with
filter OUT OF SCOPE" string survives anywhere. I swept the rest of the file for rulings of the same
shape (an assertion true when written, false now, standing as guidance): the "applies in exports"
drop and the `columnFormats`-flat-sibling ruling both still hold. One residual, non-blocking, noted
below.

### The central trap, re-derived at HEAD (not inherited)

```
TableRenderer.tsx:309  () => columns.map((col) => ({ key: col.key, getValue: (row) => getSortValue(row[col.key]) })),
DataGrid.tsx:811       {col.render ? col.render(row, value) : formatCell(value)}
```

Two separate paths over one raw value. I applied the call-site mutation **myself** (re-pointing
`getValue` at the resolved per-column formatter) and got the named HEL-469 guard RED:

```
● TableRenderer — column formatting renders + sort/filter guards (HEL-469) › 3.2 PROOF/GUARD: a currency column sorts numerically (raw), not by its formatted text
● TableRenderer — column formatting renders + sort/filter guards (HEL-469) › formatting a column does not change the row order of an already-sorted column
```

Failable at the branch that can actually leak. Restored; `git status` clean, HEAD unchanged.

### Object-guard honesty label — present in both artifacts AND the test

`design.md:81`, `tasks.md:67`, `workflow-state.md:177`, and `TableRenderer.test.tsx:865`
(*"3.2a CONTRACT (not independently mutation-failable)"*). It is labelled as a contract, not cited as
protection. Correct.

---

## UI / visual cohesion — judged against the RUNNING APP, both themes

The browser was available this round. Viewport 1440×900, logged in, dashboard `SKF2-82col`, panel
*"Projections 2026 table"* bound to Output `hel904-orphan-output-05d5dbab-…` (the same Output the
evaluator used). Screenshots in `.concertino/runs/HEL-469/evidence/`:
`hel469-sf2-editor-dark.png`, `hel469-sf2-dropdown-open-dark.png`, `hel469-sf2-editor-set-dark.png`,
`hel469-sf2-editor-light.png`, `hel469-sf2-table-currency-dark.png`,
`hel469-sf2-table-currency-light.png`.

I set three formats through the real UI to exercise all three formatters:
`stats.pts_ppr` → Currency, `stats.rush_yd` → Number, `last_modified` → Date. Saved, reloaded,
re-opened — all three re-seeded correctly, and `columnSort` survived the Save (the shallow-merge
property, confirmed live rather than reasoned).

**Verdict on cohesion: it belongs. This is not a new visual dialect.**

- **The rendered table.** `$177.00` sits in the same body type, same weight, same text colour, same
  row rhythm as its unformatted neighbours `stats.pts_half_ppr` (`177`) and `stats.pts_std` (`177`).
  Formatting introduces **no new colour, badge, chip, pill, border or background** — the only visual
  deltas are the glyphs themselves and the alignment. For a data table that is exactly the right
  restraint; a formatted column reads as the same table, better typeset. Identical in light
  (`hel469-sf2-table-currency-light.png`) — the formatted cell picks up the light body colour with no
  bespoke rule, so parity is structural rather than duplicated.
- **The alignment, judged by what RENDERS, not by which property is named.** I measured rather than
  eyeballed (my first read of the screenshot was wrong; the header looked left-aligned until I
  measured the column box):

  | column | format | `th` align | header btn left (cell left) | `td` align | value |
  | --- | --- | --- | --- | --- | --- |
  | `stats.pts_half_ppr` | — | `left` | 319.0 (307) | `start` | `177` |
  | `stats.pts_ppr` | currency | `right` | **509.7 (467)** | `right` | `$177.00` |
  | `stats.pts_std` | — | `left` | 639.0 (627) | `start` | `177` |
  | `stats.rush_yd` | number | `right` | **3227.7 (3187)** | `right` | `60` |
  | `last_modified` | date | `left` | −7041 (−7053) | `start` | `Sep 8, 2026` |

  The header button is genuinely **pushed to the right edge** on formatted numeric columns (40.7px
  in from the cell's left, vs 12px on unformatted ones) — so the settled owner ruling ("`align`
  applies to `th` and `td` together") is implemented *and actually renders*, not merely asserted in a
  test. Date correctly does **not** right-align, matching the design (numeric/currency only).
- **The editor control.** The format `Select` is the shared `ui-select` — same 32px height, same
  border radius, same chevron, same popup treatment and selected-item highlight as the `Cell density`
  and `Kind` selects in the same dialog. Option list reads `None / Number / Currency ($) / Date /
  Text`; the explicit `($)` is honest about the fixed-USD default rather than hiding it. Bounded at
  exactly **140px** with the column key measuring **57.1px non-zero and unellipsed** — evaluation-1
  CR2's collapse is genuinely fixed, in both themes. The control carries an accessible name
  (`aria-label="Format category"`).
- **Focus indicators.** No `:focus`/`outline`/`box-shadow` rule is introduced anywhere in this diff;
  the only new CSS is `width`/`flex-shrink`. The HEL-1046/HEL-1050 ruling has nothing to bind to here.
- **Console:** 0 errors, 0 warnings across the whole session (the single error later in the log is my
  own deliberate `403` CSRF probe, below).

## Acceptance criteria traced

| AC | status |
| --- | --- |
| `currency` renders `$1,234.56`-style; `text` unchanged | **MET** — observed live: `$177.00` |
| `number` respects decimals; `date` renders the chosen pattern | **UNMET as a user-reachable capability** — the spec and formatter support `decimals`/`currency`/`datePattern`, but the control exposes TYPE only. Stated plainly per the reporting rule. **Owner-ruled reported-not-blocked** — NOT a change request. |
| Unparseable/null render raw or `—`, never throw | MET (`formatColumnValue` try/catch + fallbacks; tests; no console errors live) |
| Persists across modal open/close and reload | **MET — demonstrated live by me**, set → Save → reload → re-open → all three re-seeded |
| Sort uses RAW values, guarded by a mutation-failable test | **MET — mutation reproduced by me**, correct branch, RED by name |
| Jest coverage per formatter + fallback, locale/timezone PINNED | MET — 295/3105 green at HEAD; round 1's `de-DE`/`Asia/Tokyo` run (142 tests) is pasted output, not an assertion |
| Right-align numeric/currency | **MET — measured as rendered**, `th` and `td` together |
| Composes with filter (HEL-451) | MET — the filter guard's mutation was independently reproduced by both the evaluator and round 1, in both directions; I did not re-run a third time |

## Verdict: CONFIRM

The implementation is sound, the two guards this change commissions are genuinely failable at the
branches that can actually leak, all three of round 1's pointer/label defects are properly fixed
(including one where the fix required overruling the instruction given), and the visual judgment
round 1 could not make is now made: **the formatted columns, the right-alignment and the Output
editor's format control all look like they belong in this product, in both light and dark.** Ships.

## What else could break in this region and would STILL pass (guard enumeration)

Recorded because a guard is only as good as the invariant someone thought to name. None of these
blocks delivery; they are the honest perimeter of what is protected:

1. **Seeding staleness.** `useState(() => ({ ...(initial ?? {}) }))` never re-seeds when `initial`
   changes. Correct today only because `PipelineDetailPage.tsx:315` renders the sheet under
   `{outputSheet && (…)}` so closing unmounts it. Make the sheet persistent and every persisted format
   silently goes stale on reopen — **no test would catch it**; `renderHook` fixes `initial`.
   `OutputEditorSheet.tsx:145`'s comment actively invites that change by claiming the opposite.
2. **Shallow seed copy.** The spread copies the map but **shares the per-column spec objects** with
   the caller. Safe today because `setFormat` only spreads; an in-place sub-option edit would mutate
   the caller's object and nothing would catch it.
3. **`th` alignment is name-fragile.** `text-align: right` on the `th` moves the header only because
   `.sortable-th__btn` is `inline-flex`. Change it to `display: flex; width: 100%` and the header
   stops moving while the test's `th.style.textAlign` assertion stays green — a green check over a
   property that no longer renders. (Verified correct as rendered today; the exposure is the future.)
4. **`getSortValue`'s internal fallthrough** re-pointed at a per-column formatter is not expressible
   inside that function and so is not covered. Already stated honestly in the artifacts; noted for
   completeness, not as an objection.

## Non-blocking notes

- **The format control adds a 3px horizontal overflow to the modal body, and it is this ticket's.**
  Probe-confirmed, not inferred: `.ui-modal__body` `scrollWidth` 721 vs `clientWidth` 718 at 1440px;
  setting `display:none` on all 124 `.table-display-fields__column-format` elements brings it to
  exactly 718, and restoring reproduces 721. **Nothing is clipped** (list right edge 1072.95 vs
  content-box right 1079), so this is a latent scrollbar, not a visible defect — but unlike
  evaluation-2's 360px finding, this 3px is *caused* by the control rather than pre-existing.
- **The format column has no visible header.** `Cell density`, its sibling control in the same
  CONFIGURATION card, carries a visible label; the per-column format `Select` renders as a bare column
  of "None" dropdowns whose purpose is conveyed only by `aria-label` (sighted users get nothing). The
  move buttons get away with this because they are iconographic; "None" is not self-evident. A single
  column header over the list would close it. Not a visual-dialect problem — a labelling one.
- **One residual stale assertion of CR3's shape, in `workflow-state.md`'s RESUME NOTE:** *"PORT DRIFT
  — REAL, VERIFIED: … the live vite server for THIS worktree is on 5176"*. False now (5176 is gone;
  it is 5901). It is self-limiting — the same bullet says "Use the ACTUAL listening port" — and it is
  orchestration state rather than a design ruling, so I did not raise it as a CR. Worth replacing
  rather than leaving, on the same principle CR3 established.
- Round 1's notes still stand: the `th` now always receives a style object literal (behaviourally
  inert); `OutputEditorSheet.tsx:145`'s comment is stale at its only call site (see enumeration 1 —
  it is more than cosmetic); and the HEL-1033 consequence (object columns will show real JSON once it
  lands) must reach the PR body.

## Disclosure — shared dev-DB writes

Output `hel904-orphan-output-05d5dbab-6942-44d7-80d4-be17510515bb` ("Projections 2026", pipeline
`proj-2026-flat`) — the same Output cycles 1 and 2 used.

1. Set `last_modified` → Date, `stats.pts_ppr` → Currency, `stats.rush_yd` → Number via the editor UI
   and Saved.
2. **Reverted** through the same UI: all three back to `None`, Saved. Verified via the API:
   `columnFormats: {}` — the exact state evaluation-2 left it in. This also exercised the
   clear-by-whole-key-replace path (design D3b) live, and confirmed `columnSort`
   (`{key:"player_id", direction:"asc"}`, carried from cycle 1) survived both writes untouched.
3. One deliberate failed probe: a direct `PATCH /api/outputs/:id` from the page context returned
   `403` (CSRF) and wrote nothing. That is the single console error in the session log.

No other dashboards, panels, pipelines or Outputs were modified. Screenshots written only to
`.concertino/runs/HEL-469/evidence/`; nothing `git add -f`'d; `git status` clean at `154e6ed3`.
