# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `f7aaf433` on top of `f36132fa`, base `origin/main` @ `9e995f69`. Working tree clean.

**Content self-authentication (task 6.4), re-taken for this cycle.** The cycle-1 string is no longer
discriminating (it exists on both commits), so I picked one that exists only on `f7aaf433`:
`eyebrow` has **0** occurrences in `frontend/src/shared/chrome/SidebarItemList.tsx` on `origin/main`;
`http://localhost:5173/src/shared/chrome/SidebarItemList.tsx` serves a copy containing **5**. I also
confirmed the server is *not* serving the temporarily-reverted CSS: the served
`DashboardList.css` contains **0** occurrences of `eyebrow-tracking`, i.e. the converted state.
Backend `:8080` healthy. Every observation below is against that server.

---

## Phase 1: Spec Review — FAIL

### The two cycle-1 blocking findings are closed in code

**C-1 (the regression) — CLOSED, re-measured by me, not taken on report.** `SidebarItemList.tsx:301`
now carries `className="eyebrow"`. I measured **all three** `SidebarBody.tsx` call sites live, in
**both themes**, driving `documentElement.dataset.theme` and re-reading computed style each time:

| route | element | class | font-size | font-weight | transform | tracking | mono |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/sources` | "Data Sources" (`:76`) | `eyebrow` | 10px | 500 | uppercase | 1.4px | yes |
| `/pipelines` | "Data Pipelines" (`:109`) | `eyebrow` | 10px | 500 | uppercase | 1.4px | yes |
| `/chat` | "Assistant" (`:200`) | `eyebrow` | 10px | 500 | uppercase | 1.4px | yes |

Light and dark readings were identical at every site. In the same sweep I re-scanned **all 13**
converted selectors on `/`, `/sources`, `/pipelines`, a pipeline detail page, `/chat` and `/settings`,
both themes: **0 non-conforming matches**. The defect is genuinely closed, not moved.

**Multi-consumer re-enumeration — I derived it independently and agree with the conclusion.** I did
not rely on the executor's grep. For the four selectors that are *not* single-class BEM (the shape
that hid C-1), I traced consumers to source:

- `.dashboard-list__header h2` — **2 consumers**: `DashboardList.tsx:203`, `SidebarItemList.tsx:301`.
  Both converted.
- `.auth-field label` — 7 `.auth-field` containers (`LoginPage` 2, `RegisterPage` 3, `MfaVerifyPage` 1,
  `ConnectorCompletionPage` 1) and exactly 7 `<label>` elements, all carrying `eyebrow`. No other
  element renders a `label` inside an `.auth-field`.
- `.mfa-enroll-modal__field label` — 1 container, 1 label, converted.
- `.source-list-table th` — bare-tag descendant. `tableClassName="source-list-table"` appears exactly
  once in the repo (`SourceListTable.tsx:108`). `SortableTable` renders `<th>` only from `columns`
  plus an optional `trailingHeaderCells`; `SourceListTable` passes **no** `trailingHeader`, so the 5
  `HEADER_COLUMNS` entries are the complete set, and all 5 carry `eyebrow` (measured: 5 conforming
  `th`, 0 non-conforming).

For the nine single-class selectors I re-grepped each class across `**/*.tsx`; every occurrence
carries `eyebrow`, including all the `--actions` modifier headers. **Conclusion confirmed:
`.dashboard-list__header h2` was the only multi-consumer case.**

### FINDING S-1 (BLOCKING) — the "AFTER" screenshots are stale and depict the regression

This was the check the brief asked me to scrutinise, and the failure is the mirror image of the one
anticipated. The *restore* worked fine (see Phase 2). What is wrong is the **AFTER** half.

File times against commit times:

```
AFTER  set  written 08:59
f36132fa    committed 09:06   (cycle 1 — the commit that CONTAINED the regression)
BEFORE set  written 09:25     (CSS reverted to 9e995f69)
f7aaf433    committed 09:28   (cycle 2 — the fix)
```

The AFTER set is the **oldest** artifact in the directory. It predates even the cycle-1 commit, and
was never re-captured after `SidebarItemList.tsx` was fixed. Inspecting the images confirms it
rather than merely inferring it — in `th-sources-light-AFTER.png` the sidebar section heading renders
as a large title-case **"Data Sources"** (the regressed 24px/700 state), while in
`th-sources-light-BEFORE.png` the same heading correctly renders as small mono uppercase
**"DATA SOURCES"**. The pair is inverted in effect: the "before" shows correct typography and the
"after" shows the defect.

That is also the entire explanation for the byte deltas, which I checked pairwise:

| pair | BEFORE | AFTER | |
| --- | --- | --- | --- |
| `badge-mfa-settings-{light,dark}` | 56845 / 56703 | 56845 / 56703 | **byte-identical** |
| `label-login-light` | 88271 | 88271 | **byte-identical** |
| `label-login-dark` | 87064 | 87063 | 1 byte |
| `th-sources-{light,dark}` | 170037 / 169230 | 172436 / 171706 | differ — the sidebar heading |

All six are 1280x900. The four byte-identical pairs are on surfaces with no sidebar section heading,
and their identity is genuine (and welcome) evidence of the P4 no-op. The two that differ are the two
that contain the sidebar — so the only visual delta across the whole evidence set is the C-1
regression, presented under the label "AFTER".

`files-modified.md` points the reader at these filenames as the evidence for *"measured before AND
after, both themes"*. A committed evidence set whose AFTER half shows a defect that has since been
fixed is worse than no screenshots: it is evidence-shaped and it is wrong. Box 6.1 is checked over it.

### FINDING S-2 (BLOCKING) — a false citation in the inventory HEL-1043 consumes

`files-modified.md` states, in **two** places (item 12 and the "Correction" section), that
`SidebarItemList.tsx`'s heading is rendered for *"Data Sources", "Data Pipelines", and "Connectors"*
at *`SidebarBody.tsx:76,109,194`*.

Traced to source: `SidebarBody.tsx` contains exactly three `heading=` props — `:76 "Data Sources"`,
`:109 "Data Pipelines"`, `:200 "Assistant"`. There is no `SidebarItemList` with heading
"Connectors" (Connectors is a plain nav link, not a section list), and `:194` is inside a
`conversations` block, not a heading. I measured the real third site live at `/chat` — it is
"Assistant", and it is correctly converted.

The heading name is wrong and the line number is wrong, and the same wrong pair is repeated in the
prose that describes the regression's blast radius. This document is explicitly designated
HEL-1043's input; a consumer following `SidebarBody.tsx:194` finds nothing, and one auditing
"Connectors" concludes the fix covered a surface it does not exist on. Given that this lane's whole
discipline is "trace claims to their source", a fabricated citation inside the corrective artifact
is not a typo I am willing to wave through.

### Everything else in Phase 1 checks out

- **Arithmetic corrected and independently re-derived.** My own strict-token scanner (re-run this
  cycle) yields 23 files / 29 blocks / 12 all-5 / 17 exactly-3. My classification: P1=2, P2=1,
  P4=13, P6=0, and 13 P5-shaped blocks of which the 2 P3 members are drawn — giving
  **2+1+2+13+11 = 29**. This matches the corrected inventory exactly, member for member: the 11
  P5 entries plus `.patch-set-review__diff-label` and `.message-turn__outcome-note` under P3 are
  precisely the 13 weight-inheriting blocks I derived. The double-count is genuinely fixed, not
  renumbered.
- **Scan precondition stated** (strict = 23/29/12/17; value-identical = 40/27), matching my two
  scanner variants. Rule 6 satisfied.
- **P3 attempts are auditable.** Both entries name the route attempted and where it stopped
  (`/patch-sets/review`'s DEV fixture only producing a string edit; `/chat` needing a
  `timedOut`/clarification outcome). I can corroborate the shape of the second: `/chat` is reachable
  and renders, and `.message-turn__outcome-note` was absent from the DOM there — a state-level, not
  route-level, unreachability, which is what the entry claims.
- **P2 open question** is stated as a question, not decided. Task 4 satisfied.
- **The inventory is consumable by HEL-1043** apart from S-2: every one of the 16 unconverted blocks
  carries file, selector and reason; the 11 P5 members carry the measured before-weight (400) and the
  value the utility would impose (500); the two P1 dead selectors and the P2 open question are
  present. Nothing would need re-deriving — except that a reader chasing the "Connectors" /
  `SidebarBody.tsx:194` citation is chasing something that does not exist.
- Checkbox status: **0.3, 3.4, 4.1, 4.2, 5.1 now have committed evidence behind them.** **6.1 does
  not** — see S-1.

---

## Phase 2: Code Review — PASS

**Gates, re-run by me in `WORKTREE_PATH` at `f7aaf433`:**

| gate | result |
| --- | --- |
| `npm run lint` | pass (0) |
| `npm run typecheck` | pass (0) |
| `npm run format:check` | pass (0) |
| `npm --prefix frontend test` | pass — **2901 passed, 2901 total**, 1 snapshot |
| `npm run check:tokens` | pass (0) |

The honest answer to "which gate exercised the change" remains **"none of them meaningfully"** — and
cycle 1 proved it, since this identical green set sat over a live 24px/700 regression.

**The revert-and-restore method — verified clean, no leakage.** This was the specific hazard the
brief raised, and it did not occur:

- `git diff f36132fa..HEAD -- 'frontend/**/*.css'` is **empty** — not one CSS byte differs between
  the cycle-1 commit and the current tree, so nothing reverted survived into `f7aaf433`.
- `f7aaf433` touches exactly three files: `SidebarItemList.tsx` (the one-line fix), `files-modified.md`,
  and my `evaluation-1.md`. No CSS in the commit at all.
- `git status --porcelain` is empty, and `--ignored=matching` over `frontend/src` shows no `.orig`,
  `.rej`, backup or stray file.
- The dev server serves the converted CSS (0 `eyebrow-tracking` in `DashboardList.css`), confirming
  the restore is live and not merely committed.

**Cycle-1 cleared findings all still hold:**

- `DESIGN.md` and `frontend/src/theme/theme.css` — `git diff origin/main...HEAD` over both is
  **empty**. `.eyebrow` and the `--eyebrow-*` tokens untouched.
- Baseline edit unchanged since cycle 1 (`tokenAuditSweep.css.test.ts` is not in this commit); my
  cycle-1 verification stands — 62 entries before and after, identical file multiset, all 62 HEAD
  pins resolving to real `px` declarations.
- **No synthetic scaffolds** — the only code change in this cycle is a `className` attribute.
- **No dev-DB residue** — `agent_memory` still has **0 rows**.
- **Screenshots untracked** — `git ls-files .concertino/runs` returns **0** files. Task 6.3 respected.
- The single-line fix is idiomatic and consistent with the twelve sibling conversions.

---

## Phase 3: UI Review — PASS

Measured live, both themes, on `/`, `/sources`, `/pipelines`, a pipeline detail page, `/chat`,
`/settings`.

- All 13 converted selectors: every matched element computes 10px / 500 / uppercase / 1.4px /
  JetBrains Mono. **0 non-conforming matches anywhere**, in either theme.
- The three sidebar section headings render correctly (table above).
- P5 spot-check re-confirmed on the real surfaces: `.outputs-rail__kind`,
  `.output-gallery-card__kind`, `.outputs-gallery-tab__count` all compute `font-weight: 400` at 10px,
  inherited from a 400 parent — so leaving the 11 P5 blocks unconverted remains correct. (Precondition
  unchanged from cycle 1: I reached 3 of the 11; the rest live on proposal/patch-set surfaces I did
  not reach. Since none was converted, unmeasured P5 blocks carry no regression risk.)
- No console errors attributable to this change on any route. No layout breakage; the change is
  typographic only.

---

## Overall: FAIL

Both cycle-1 blocking findings are genuinely fixed and I verified each myself. What remains is
confined to the committed evidence record — but that record is the PR's evidence and HEL-1043's
input, and both defects are the kind this lane has repeatedly ruled blocking.

## Change Requests

1. **Re-capture the AFTER screenshots at `f7aaf433` and overwrite the stale set.** The six
   `*-AFTER.png` files were written at 08:59, before the cycle-1 commit (09:06) and long before the
   fix (09:28); `th-sources-light-AFTER.png` visibly shows the sidebar heading in its regressed
   24px/700 title-case form. Re-take all six on the current tree, both themes, same three contexts,
   same 1280x900 viewport, and confirm each `th-sources` pair then matches its BEFORE except for
   incidental data. If you would rather not re-shoot, delete the AFTER set and uncheck task 6.1 —
   but do not leave a committed "AFTER" that depicts the defect.

2. **Correct the false citation in `files-modified.md` (two places: item 12 and the "Correction"
   section).** `SidebarItemList.tsx`'s heading renders for **"Data Sources", "Data Pipelines" and
   "Assistant"**, at **`SidebarBody.tsx:76,109,200`** — not "Connectors" at `:194`. There is no
   `SidebarItemList` with a "Connectors" heading. Verify against the three `heading=` props in
   `SidebarBody.tsx` rather than restating from memory; this document is HEL-1043's input and a
   citation that does not resolve is exactly what re-derivation costs that ticket.

## Non-blocking Suggestions

- Worth stating in the PR that the four byte-identical BEFORE/AFTER pairs
  (`badge-mfa-settings-{light,dark}`, `label-login-light`) are themselves the cleanest available
  evidence of the P4 no-op — identical PNGs across a CSS revert are a stronger claim than a visual
  comparison. Note the caveat honestly, though: byte-identity cannot by itself distinguish "the
  revert happened and changed nothing" from "the revert did not happen", so it corroborates the
  numeric measurement rather than replacing it.
- Also worth stating: the five green gates were green over the cycle-1 regression, and are green
  again now. That is the sharpest concrete support for this ticket's own "no gate exercises a CSS
  consolidation" claim.
