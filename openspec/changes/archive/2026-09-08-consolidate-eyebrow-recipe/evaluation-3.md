## Evaluation Report — Cycle 3 (evaluation-3.md)

Evaluated at HEAD `75524095` by a cold-replacement evaluator. All findings below rest on my own
fresh measurements, not on the executor's report or on my predecessor's two evaluations.

### Method note — 6.1 self-authentication is restated on BYTE CONTENT, not mtime

I was told, before I could discover it, that relocating the evidence to
`.concertino/runs/HEL-732/evidence/` rewrote all 12 PNG mtimes to 09:42 (BEFOREs included), so
timestamp ordering can no longer establish that the BEFOREs predate the conversion. Confirmed —
every PNG carries a 09:42:3x–09:42:59 mtime, and the BEFOREs are in fact *newer* than the AFTERs.
**I did not use mtime as evidence anywhere in this report.**

The substitute is self-authenticating and time-independent: `th-sources-dark` is **169230 bytes in
both BEFORE and AFTER, with identical md5 `608ad87d…`**. The stale, regressed AFTER cited in cycle 2
was 171706 — larger, because 24px/700 sans paints more pixels than 10px/500 mono. A byte-identical
pair at the smaller size cannot have been produced by a render carrying the regression. That
argument holds regardless of file times.

Stronger still, I did not rely on the screenshots as the primary instrument at all: I ran the app
and read computed styles myself (Phase 3).

---

### Phase 1: Spec Review — PASS

Issues:

- **Scope/rescope handled correctly.** The ticket was rescoped by the owner to an optional tidy-up;
  13 of 29 converted is the intended outcome. I verified the arithmetic and each exclusion rather
  than treating the shortfall against 29 as a defect:
  - P1 DEAD = 2, P2 SIZE-DIVERGENT = 1, P3 UNREACHABLE = 2, P4 CONVERTED = 13, P5
    WEIGHT-INHERITING = 11, P6 = 0. **Sum 2+1+2+13+11 = 29.** Correct and disjoint.
  - P1 verified independently: `audit-event-table__th` and `sources-page__section-title` both return
    **zero** non-CSS references under a repo-wide grep of `frontend/src`. Genuinely dead, correctly
    listed rather than deleted.
  - P2 verified at `AgentMemoryList.css:77-83`: declares `font-size: var(--text-xs)` and **no**
    `font-weight`. Correctly not converted and correctly carried as an open question for the owner
    rather than decided — this is exactly what the AC demanded.
  - P3 verified: both classes have live TSX consumers (`MessageTurn.tsx:49,52`;
    `PatchSetReview.tsx:170,174`), so they are unreachable-state, **not** dead — the distinction
    from P1 is real and correctly drawn.
  - P5 spot-checked at four members (`outputs-rail__kind`, `output-gallery-card__kind`,
    `proposal-review__type`, `patch-set-review__op`): each declares `font-size: var(--text-micro)`
    and **no `font-weight`**. The stated discriminator (presence/absence of an explicit
    `font-weight`) holds on every one I checked. Leaving these unconverted is the conservative,
    AC-compliant choice.
- Unconverted blocks are recorded with file, selector and reason — the "never silent" binding is
  satisfied.
- The unachievable AC ("no component CSS file hand-declares the recipe") is explicitly called out as
  unachievable under `DESIGN.md:276`'s current permission to copy the recipe, and deferred to a
  **live** ticket, HEL-1043. Per the binding, a deferral is only real if a live ticket owns it —
  this one does. I did not require any DESIGN.md/`theme.css`/`.eyebrow`/token change, per scope.
- No scope creep: the only non-eyebrow file touched is the HEL-439 spacing baseline, and that edit
  is forced by the recipe removal (see Phase 2).

### Phase 2: Code Review — PASS

**Cycle-3 source-delta check (the primary thing I was asked to confirm): CLEAN.**
`git diff --name-status f7aaf433..75524095` yields exactly two paths — `evaluation-2.md` (added) and
`files-modified.md` (modified). `git diff f7aaf433..HEAD -- '*.css' '*.tsx' '*.ts'` is **empty**.
Cycle 3 moved no source. Working tree is clean.

**Corrected `SidebarBody.tsx` citation resolves against the tree AT `75524095`** — verified now, not
as-written:
- `:76 heading="Data Sources"`, `:109 heading="Data Pipelines"`, `:200 heading="Assistant"` — all
  three exact.
- `:194` is indeed **not** a `heading=` prop; it falls inside the conversations block (a comment run
  about "Chat" vs "Assistant" naming drift). The old "Connectors at :194" citation was wrong and is
  now gone. Since this document is HEL-1043's input, this mattered; it now resolves.

**Gates — all re-run by me in the worktree, none taken on the executor's word:**

| gate | result |
| --- | --- |
| `npm run lint` (`eslint . --max-warnings=0`) | PASS, clean |
| `npm run format:check` | PASS — all files match Prettier |
| `npm run typecheck` (`tsc --noEmit`) | PASS, no output |
| `npm --prefix frontend test` | PASS — 285 suites, 2901 tests |
| `npm run check:tokens` | PASS — every `var(--*)` under `frontend/src` resolves |

I ran `npm --prefix frontend test` **directly**, not root `npm test`, precisely because the root
script's `jest --passWithNoTests` arm finds zero tests at the worktree root and converts silence
into a pass. The 285/2901 figure is the frontend suite actually executing.

**Honest statement of what the gates prove here:** essentially nothing about this change. There is
no logic under test; a green Jest run over a CSS-recipe consolidation is not evidence. The gates
establish only that nothing *else* broke. The real deliverable is measurement, which is Phase 3.

**The edited test file — checked as a defect symptom, cleared.**
`tokenAuditSweep.css.test.ts` was modified, and an edited baseline is suspect by default. I did not
accept the executor's "only line numbers changed" claim; I verified it mechanically by normalizing
every integer in both revisions and diffing:

```
diff <(sed 's/[0-9]\+/N/g' <old>) <(sed 's/[0-9]\+/N/g' <new>)  →  no differences
```

So the two revisions are structurally identical and **only numbers changed** — no baseline entry
added, removed, or reworded. The re-pin is forced and legitimate: removing 5 declarations from four
CSS files shifts every later line up by 5. Critically, the guard is **failable** — it contains
`it("every ... baseline entry still exists in its file (baseline isn't stale)")`, so a pin that no
longer resolves to a real `px` declaration fails the suite. The pins therefore are validated by a
check that can go red, not merely asserted.

**Consumer enumeration — the exact seam that failed in cycle 1 — now sound.** I re-enumerated every
converted selector myself, with particular attention to the bare-tag selectors where a class grep
cannot find consumers:
- `.dashboard-list__header h2` — exactly **2** consumers repo-wide (`DashboardList.tsx:203`,
  `SidebarItemList.tsx:300`); both now carry `className="eyebrow"`.
- `.auth-field label` — 7 `<div className="auth-field">` sites across 4 files; **all 7** labels carry
  `className="eyebrow"` (LoginPage 2, RegisterPage 3, MfaVerifyPage 1, ConnectorCompletionPage 1).
  None missed.
- `.source-list-table th` — every `<th>` originates from `HEADER_COLUMNS`, all 5 entries carry
  `className: "eyebrow"`. I checked the one real trap here: `SortableTable` supports a
  `trailingHeaderCells` prop that renders extra `<th>` verbatim, which would also match the bare-tag
  selector — **SourceListTable passes no `trailingHeaderCells`**, so there is no unstyled header.
- The four class-based `__th` selectors (connectors, pipelines, api-tokens, agent-memory) — every
  occurrence, **including each `--actions` header**, carries `eyebrow`.

CSS conversions themselves are clean: the 5 recipe properties removed, non-recipe declarations
(`color`, `padding`, `border-bottom`, `margin`, `white-space`) retained, no orphaned rules.

DRY/readability/modularity: this change is a de-duplication by definition and is behavior-preserving
where expected. No type-safety, security, or error-handling surface is touched. No dead code, no
TODO/FIXME, no over-engineering, no drive-by behavior change.

### Phase 3: UI Review — PASS

Triggered (`frontend/**`). Servers started via the canonical script on 5178/8085; both healthy.
I measured computed style in the running app rather than reading the screenshots, so this leg does
not depend on the evidence record at all.

**The cycle-1 regression site is fixed — measured, not eyeballed.** All three shared sidebar
headings rendered by `SidebarItemList`:

| heading | route | font-size | font-weight | family | tracking | transform |
| --- | --- | --- | --- | --- | --- | --- |
| Data Sources | `/sources` | 10px | 500 | JetBrains Mono | 1.4px | uppercase |
| Data Pipelines | `/pipelines` | 10px | 500 | JetBrains Mono | 1.4px | uppercase |
| Assistant | `/chat` | 10px | 500 | JetBrains Mono | 1.4px | uppercase |
| Dashboards | `/` | 10px | 500 | JetBrains Mono | 1.4px | uppercase |

Against a freshly injected reference `<span class="eyebrow">`, measured in the same document:
**10px / 500 / JetBrains Mono / 1.4px / uppercase** — an exact match on all five properties. The
24px/700/sans regression is definitively gone.

- **Both themes:** re-measured `Data Pipelines` and the pipeline table headers under
  `data-theme=light` and `data-theme=dark` — identical on all five properties in both. Light/dark
  parity holds.
- Converted table headers sampled live (`.source-list-table th` ×5, `.pipeline-list-table__th` ×3):
  all 10px/500/mono/uppercase.
- **No console errors** across all tested routes (0 errors, 0 warnings).
- Happy paths render; no blank screens or unhandled exceptions encountered.

**Screenshot corroboration (secondary).** I compared the 12 PNGs by content, not by size:
`th-sources-dark`, `th-sources-light`, `badge-mfa-settings-{light,dark}`, `label-login-light` — and
computed per-pixel deltas for the two that differ. See the non-blocking note below; both deltas are
sub-perceptual and neither is consistent with a weight or size change.

### Overall: PASS

All three defects this cycle was opened to fix are confirmed fixed: no source moved, the
`SidebarBody.tsx` citation resolves, and the evidence is durable outside the worktree. The
substantive claim — 13 blocks converted with no computed-style change, and the cycle-1 regression
repaired — I verified independently in the running app.

### Change Requests

None.

### Non-blocking Suggestions

1. **`files-modified.md` overstates its screenshot check as "byte-for-byte"; it was a size
   comparison.** The report says "5 of 6 are byte-identical … `label-login-dark` differs by 35
   bytes." By md5, **4 of 6** are byte-identical. `th-sources-light` also differs — BEFORE and AFTER
   are both exactly 170037 bytes but have **different md5 sums** (`6e77c20c…` vs `aa658b94…`), which
   an equal-size check silently passes. Two files can share a size and differ in content; the method
   described would not have caught that, and here it did not.
   **The conclusion is nonetheless correct, and my own measurement strengthens it.** Per-pixel diffs:
   - `th-sources-dark`: **0** differing pixels (truly identical).
   - `th-sources-light`: 6 differing pixels of 1,152,000, max channel delta **4**.
   - `label-login-dark`: 26 differing pixels of 1,152,000, max channel delta **2**.
   Deltas of 2–4/255 over a few dozen pixels are antialiasing/cursor noise. A font-weight or
   font-size change would move thousands of pixels at high contrast — this is categorically not that.
   So `label-login-dark`'s 35 bytes need no further explanation; it is render noise, as claimed.
   Worth correcting the wording because this document is HEL-1043's input and "byte-for-byte" will
   be read as a stronger check than the one performed. Not blocking: the claim it supports is true
   and independently confirmed.
2. **The evidence directory's mtimes are now misleading to a future reader.** The BEFOREs are
   timestamped *after* the AFTERs, purely as an artifact of the relocation. A one-line
   `README`/provenance note in `.concertino/runs/HEL-732/evidence/` stating that mtimes reflect the
   move and that authentication rests on byte content would stop the next reader from drawing a
   wrong inference — or from re-litigating the stale-screenshot question a fourth time.
3. For HEL-1043: the P5 exclusion rests on all 11 sites inheriting 400. I spot-checked the source
   discriminator on 4 of 11 rather than re-measuring all 11 live, since they are *unconverted* and
   therefore unchanged by this PR. HEL-1043 will need the full 11-site live measurement before it
   can convert any of them.
