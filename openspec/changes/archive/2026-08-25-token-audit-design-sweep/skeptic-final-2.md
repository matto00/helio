## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-derivation. Round 1 REFUTEd on documentary grounds only; commit `07e3cf3e`
is the fix. Per the orchestrator's brief I re-verified the four fix claims plus a
regression sanity sweep, and independently re-derived the headline enumeration
numbers rather than accepting the artifact's own statement of them.

### What I verified (with evidence)

**Branch/tree state.** `git log --oneline main..HEAD` → three commits
(`8bc62d5b`, `21ae7174`, `07e3cf3e`). `git status --porcelain` → clean, nothing
untracked. `git diff main...HEAD --name-only` → 16 `frontend/src` files
(15 CSS + the guard test) and the change dir; **zero** files outside those two
areas. No unrelated changes crept in.

**CR1 — durable enumeration artifact exists and is committed.**
`openspec/changes/token-audit-design-sweep/enumeration.md`, 92 lines, added in
`07e3cf3e`. It states all five by-category dispositions. I re-derived the numbers
myself with a standalone AST-free scanner over `frontend/src/**/*.css`
(design.md's widened patterns, comment-stripped, `theme.css` excluded) rather
than trusting the artifact:

| Claim | My independent measurement | Verdict |
|---|---|---|
| spacing: 84 fixes | 84 occurrences of `var(--space-N)` on added diff lines, 0 on removed lines → 84 net substitutions | ✅ exact |
| across 15 files | `git diff --name-only -- 'frontend/src/**/*.css'` → 15 | ✅ exact |
| 119 off-scale across 20 files | **119, 20 files** | ✅ exact |
| 10 relative `em`/`%` | **10** | ✅ exact |
| font-size: 3 flagged, 0 fixed | `MarkdownPanel.css:79` `0.85em`, `MobileNavSheet.css:161` `0.8em`, `EmptyState.css:171` `0.8em` — all three confirmed at those exact lines | ✅ exact |
| font-weight: 0 | `grep -rnE "font-weight:\s*[0-9]"` over non-test `frontend/src` → **no output** | ✅ exact |
| font-family: 10 hits all `inherit` | consistent with the guard test's empty baseline, 76/76 green | ✅ |
| color: 0 violations outside documented exclusions | exclusions named are `PreferencesEditor.tsx`, `MfaEnrollModal.tsx/.css`, `DividerEditor.tsx` — matches round 1 | ✅ |

Scan reproduced twice, byte-identical output both times.

**CR2 — dangling "executor report" references fixed.** Both now point at the real
artifact: `files-modified.md:16` → "see `enumeration.md` in this change dir",
and `tokenAuditSweep.css.test.ts:48` and `:136` → "See `enumeration.md` in this
change dir". `grep -rn -i executor` over the change dir + test file returns only
legitimate historical mentions (prior evaluation/skeptic reports narrating their
own process, and design-gate planning prose) — no surviving pointer to a
non-existent deliverable.

**CR3 — residual statement will reach the PR body.** `files-modified.md` carries
a dedicated `## For the PR description (task 4.4 / skeptic-final-1.md CR3)`
section stating the 119-literals/20-files residual, its `6px`/`10px` dominance,
and explicitly that it is "materially larger than HEL-680's stated remit ('the
one already-known compact-chip case')", routing the scope decision to the human
reviewer. That is the file the orchestrator reads when drafting the PR
description, so the statement lands. ✅

**CR4 — `evaluation-2.md` committed.** Present in `07e3cf3e`'s stat (28 lines);
`skeptic-final-1.md` was committed alongside it. Working tree clean. ✅

**CR5 — no regression.** Fresh runs in the worktree: `npm run lint` exit 0
(`--max-warnings=0`), `npx tsc --noEmit` exit 0, `npx jest
--testPathPatterns=tokenAuditSweep` → **76 passed, 76 total**. No CSS or TSX
changed since round 1's Playwright visual confirmation (`21ae7174` touched only
the test file + docs; `07e3cf3e` only the test file's comment block + docs), so
round 1's visual/light-dark-parity findings still hold and no re-shoot is needed.

### Verdict: REFUTE

Everything that governs behavior is correct and verified — the 84 substitutions,
the guard test, the gates, the sibling reconciliation, and the load-bearing
HEL-680 residual note. The defect is confined to the enumeration artifact itself,
and it is the one property the ticket's restated AC #1 names explicitly:

> "the off-scale residual is enumerated **completely** as this ticket's
> deliverable, **not silently dropped**" (`ticket.md:38`)

`enumeration.md`'s itemized off-scale breakdown **silently drops one value** and
consequently does not sum to its own stated total: the twelve listed line items
(`41+33+12+10+9+3+2+2+2+2+1+1`) sum to **118**, while the artifact states **119**.
The missing entry is real and I located it. This is small, but it is precisely
the named failure mode of the AC, in the single artifact created to satisfy round
1's REFUTE — and it is a two-line fix with no code impact.

### Change Requests

1. **`enumeration.md` — add the dropped `30px × 1` line item.** The off-scale
   breakdown omits `30px`, occurring once at
   `frontend/src/features/dashboards/ui/DashboardList.css:74`:

   ```css
   padding: 0 30px 0 var(--space-2);
   ```

   It is correctly off-scale for spacing (30px matches `--text-3xl`, a type
   token, not any `--space-*` value), so its disposition is unchanged — it is
   only missing from the list. Add it so the twelve items become thirteen and
   the breakdown sums to the stated **119**. No other line item is wrong: I
   reproduced `6px×41, 10px×33, 14px×12, 7px×10, 5px×9, 0.375rem×3, 18px×2,
   0.4rem×2, 0.35rem×2, 0.3rem×2, 0.4375rem×1, 60px×1` exactly.

2. **`enumeration.md` — reconcile the "78 literals ≤4px" figure.** My scan finds
   **75** (51 strictly under 4px + 24 exactly 4px), which matches this change's
   own `design.md:88` ("~75 values ≤4px"). 78 appears in neither. I flag this as
   lower-confidence than CR1 because the count is bucketing-sensitive (whether
   `0` values and `.tsx` inline styles are counted), so either correct it to 75
   or state the counting methodology inline — but it should not silently
   disagree with the design doc it derives from.

### Non-blocking notes

- `enumeration.md`'s spacing bullet reads "**0** exact-match-fixable literals
  remain repo-wide — every literal whose value exactly equals a `--space-*`
  token's px/rem value has been substituted." Read literally this is false: 24
  literals equal to `4px`/`0.25rem` (= `--space-1`) remain, e.g.
  `PipelineDetailPage.css:22`. They are correctly left alone — `design.md:45`
  scopes the sweep to values "> 4px-equivalent", and DESIGN.md §3's ≤4px
  optical-tweak allowance takes precedence — so this is a wording looseness, not
  a substantive error. Adding "above the 4px optical-tweak floor" to that
  sentence would close it. Not blocking, since the adjacent bullets make the
  scope unambiguous.
- `tasks.md:14` and `design.md:122` still refer to "the executor's final report"
  as the enumeration's destination. Harmless historical planning prose (both
  predate `enumeration.md`), and CR2 fixed the two references that were actual
  live pointers, but a future reader may briefly hunt for that file.
- The worktree's `scripts/concertino/` is a stale partial copy missing
  `next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh`; I used the
  canonical `/home/matt/Development/helio/scripts/concertino/` copies. Worth a
  look at worktree setup, unrelated to this ticket.
