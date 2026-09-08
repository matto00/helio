## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every finding below is derived from the tree, the diff, my own scanner, and the
running app at `localhost:6164`/`9071`. I read `evaluation-{1,2,3}.md` and `files-modified.md`
as claims only. **I used no file mtimes as evidence anywhere.** HEAD verified `75524095`.

### What I verified (with evidence)

**1. The diff is exactly what it claims to be.**
`git diff main...HEAD --stat`: 31 frontend source files + `tokenAuditSweep.css.test.ts` + change-dir
docs. `theme.css`, `DESIGN.md`, and the `--eyebrow-*` tokens are absent from the diff — the
HEL-1043 boundary holds. `git diff main...HEAD -- 'frontend/src/**/*.css'` shows exactly **13**
rule blocks losing the recipe, each keeping its non-recipe declarations
(`color`/`padding`/`border-bottom`/`white-space`/`margin`/pill layout).

**2. Independent re-derivation of the population — reproduces every published number.**
I wrote my own block scanner (comment-stripped, `theme.css` excluded, `>=3 of 5` recipe
properties) and ran it against both a clean `git archive main` extract and the worktree:

| reading | main | HEAD | delta |
| --- | --- | --- | --- |
| strict (`var(--eyebrow-size)`/`var(--eyebrow-weight)`) | **29** | **16** | 13 |
| loose (value-identical, `--text-micro`/`--weight-medium` count) | **40** | **27** | 13 |

Both of `files-modified.md`'s stated readings reproduce exactly (29/23-file strict, 40/27-file
loose). The 13 converted blocks are the same 13 in the CSS diff. The **16 strict-reading blocks
remaining at HEAD are exactly** P1 (`.audit-event-table__th`, `.sources-page__section-title`)
+ P2 (`.agent-memory-list-table__kind`) + P3 (`.patch-set-review__diff-label`,
`.message-turn__outcome-note`) + the 11 listed P5 members — no block is unaccounted for, none is
double-counted, and no undocumented block was left behind. The recorded remainder is complete.

P1's "dead" claim reproduces: `grep -rl` over `*.ts`/`*.tsx` for `audit-event-table__th` and
`sources-page__section-title` returns **zero** files.

**3. Per-consumer enumeration, re-derived from scratch (the cycle-1 failure mode).**
I re-grepped every converted selector's class/tag across the tree rather than inheriting the
executor's list. The multi-consumer selectors and their full consumer sets:

- `.auth-field label` — **7** labels across 4 files: `LoginPage.tsx:83,97`,
  `RegisterPage.tsx:103,117,135`, `MfaVerifyPage.tsx:66`, `ConnectorCompletionPage.tsx:102`.
  All 7 carry `className="eyebrow"`. (`RegisterPage.tsx:131` is a `span.auth-field__error`, not a
  label — correctly not a consumer.)
- `.dashboard-list__header h2` — **2** consumers: `DashboardList.tsx:203` and
  `SidebarItemList.tsx:300`; both `<h2 className="eyebrow">`. This is the cycle-1 regression and
  it is fixed at both sites.
- `.source-list-table th` — bare-tag descendant. **I verified the `trailingHeaderCells` trap
  myself rather than inheriting it**: `SortableTable.tsx:102` renders `{trailingHeaderCells}` raw,
  and a repo-wide grep shows only `PipelineListTable.tsx:132` and `ConnectorsPage.tsx:204` pass it
  (both trailing `<th>`s carry `eyebrow`). `SourceListTable.tsx` passes **none**, and all five of
  its `HEADER_COLUMNS` entries carry `className: "eyebrow"` — so no `<th>` inside
  `.source-list-table` escapes the utility.
- `.mfa-enroll-modal__field label`, `.source-detail-panel__section-title` (2 consumers, both
  converted), `.schema-field-viewer__title`, `.dashboard-appearance-editor__label`,
  `.pipeline-detail-page__footer-output-label` (2 spans), and the four `__th` class selectors
  (every `<th>` render site carries `eyebrow`, actions columns included) — all fully enumerated.

**4. Live computed-style measurement in the running app, both themes.**
`start-servers.sh` + `assert-phase.sh servers` → `PASS servers`. I injected a fresh
`<span class="eyebrow">` on each page as the reference and compared the full 5-property signature
(`font-size|font-weight|font-family|letter-spacing|text-transform`). Reference on every page:
`10px | 500 | "JetBrains Mono" | 1.4px | uppercase`.

| surface / selector | theme | result |
| --- | --- | --- |
| `.dashboard-list__header h2` "Dashboards" (`/`) | dark | match |
| `.dashboard-list__header h2` "Data Sources" (`/sources`) | dark | match |
| `.dashboard-list__header h2` "Data Pipelines" (`/pipelines`) | light | match |
| `.source-list-table th` x5 | dark | all match |
| `.connectors-page__th` x7 (incl. Actions) | light | all match |
| `.pipeline-list-table__th` x7 (incl. Actions) | light | all match |
| `.api-tokens-list-table__th` x4 | light | all match |
| `.mfa-security-section__badge` "DISABLED" | light | match |
| `.pipeline-detail-page__footer-output-label` x2 | light | both match |
| `.source-detail-panel__section-title` "PREVIEW" | light | match |
| `.dashboard-appearance-editor__label` | light | match |
| `.auth-field label` x2 (`/login`) | light | both match |
| `.auth-field label` x3 (`/register`) | dark | all match |

The sidebar headings only mount on their own route, which is why a single-route sweep can miss
them — I visited `/`, `/sources`, and `/pipelines` separately and confirmed all three.
`.agent-memory-list-table__th`, `.schema-field-viewer__title`, `.mfa-enroll-modal__field label`
and `ConnectorCompletionPage`'s label were not reachable in this dev session (empty state /
enrollment flow / OAuth completion); their classes are source-verified and the utility is
theme-invariant (`--text-micro`, `--weight-medium`, `--eyebrow-*` are each defined **once** in
`theme.css`, never re-declared per theme), so dark/light parity is structural, not per-site.

**5. Visual judgment, not just numbers.** Screenshots taken and looked at:
`.playwright-mcp/sk-{sources-dark,settings-light,tokens-light,pipelines-light,pipedetail-light,
sourcedetail-light,appearance-light,login-light,register-dark,dash-dark}.png`. The converted
surfaces read correctly *and* sit correctly beside their un-converted neighbours: on the pipeline
detail page the new `PIPELINE`/`OUTPUT` footer labels match the untouched `TABLE` step-card
eyebrow; on the dashboard the sidebar `DASHBOARDS` heading matches the untouched panel-footer
`OUTPUT UPDATED 9/8/2026`; `DASHBOARD APPEARANCE` in the popover matches both. Table headers keep
their tracking and muted color in both themes with no weight or baseline shift. No new visual
dialect was introduced — this reads as the same design language, which is the point of the change.

**6. Baseline re-pin is a re-pin, not a defect being papered over.**
`tokenAuditSweep.css.test.ts`: **62** baseline entries at `main` and **62** at HEAD, with an
*identical per-file multiset* (`diff` of the per-file counts is empty). Every changed value is a
uniform `-5` shift confined to lines below each file's removed 5-line block. The guard is
bidirectional (`runCategoryGuard` asserts both "no hit outside the baseline" and, separately,
"every baseline entry still exists in its file"), so a pin moved onto a non-offending line would
fail. Test run green: 2 suites / 53 tests.

**7. Gates — what each one actually scans.**
- `npm run check:tokens` → OK. But it only asserts that every `var(--*)` **resolves to a defined
  token**. This diff exclusively *deletes* `var()` references, so this gate is green vacuously and
  is **not** evidence for this change. Confirmed by reading `scripts/check-tokens.mjs`'s output
  contract, not by trusting the name.
- `npm run typecheck`, `npm run lint` → clean.
- Root `npm test` is `jest && npm --prefix frontend test`; the root arm scans no CSS and the
  frontend arm cannot render layout in jsdom. As `workflow-state.md` itself states, no gate
  meaningfully exercises this change. The live measurements above are the evidence.

**8. Citation check.** `SidebarBody.tsx` `heading=` props are at `:76`, `:109`, `:200` — exactly as
`files-modified.md` now says; the previously fabricated "Connectors at `:194`" is gone.

**9. The evidence-screenshot claim — reproduced, and it is false.**
`md5sum` over the six BEFORE/AFTER pairs in `.concertino/runs/HEL-732/evidence/`: **4 of 6** are
identical, not 5. `th-sources-light-{BEFORE,AFTER}.png` are both exactly `170037` bytes but have
different md5s; `cmp -l` reports **164,995 differing bytes**. I ran this twice; it is stable, not a
flaky reading. So an equal-*size* check passed this pair silently, and that size check is written up
as a "byte-for-byte" cross-check. I accept the evaluator's measured conclusion that the underlying
pixel deltas are antialiasing noise (6px @ max channel Δ4, 26px @ Δ2 of 1.152M) — and my own live
computed-style measurements independently establish that no visual change occurred. **The code is
correct. The sentence describing the evidence is not.**

### Verdict: REFUTE

To be explicit about what this is *not*: I found no defect in the code, no missed consumer, no
computed-style divergence, no scope violation, and no unrecorded block. The 13-of-29 outcome is the
owner's rescoped intent and the remaining 16 are completely and accurately enumerated. Were the
diff the only artifact, this would be a CONFIRM.

The refutation is confined to `files-modified.md`, which this document itself designates as
**HEL-1043's input**. It carries a demonstrably false statement about the strength of its own
evidence — the same defect class as the fabricated `SidebarBody.tsx:194` citation this ticket
already had to spend a commit removing from this same file. A downstream reader cannot detect
"byte-for-byte" was really "same file size" without re-running `md5sum` themselves. The fixes below
are text-only, need no re-measurement, no re-capture, and no code change.

### Change Requests

1. **`openspec/changes/consolidate-eyebrow-recipe/files-modified.md`, P4 section — correct the
   screenshot cross-check sentence.** It currently reads:

   > cross-checked byte-for-byte against their BEFORE counterparts: 5 of 6 are byte-identical
   > (expected — P4 conversion is value-identical, so no visual difference should exist),
   > `label-login-dark` differs by 35 bytes (negligible render-noise, e.g. cursor/blink timing).

   Both the method and the count are wrong. Replace with a statement of what was actually measured,
   e.g.:

   > cross-checked by `md5sum` against their BEFORE counterparts: **4 of 6 are byte-identical**.
   > Two differ: `label-login-dark` (87064 vs 87099 bytes) and `th-sources-light`, which is
   > `170037` bytes in **both** files but differs in content — an equal-file-size check passes it
   > silently, which is why the comparison must be by digest, not by size. Both differing pairs
   > were then compared per-pixel: 6 pixels at max channel delta 4 and 26 pixels at delta 2, out of
   > 1,152,000 — antialiasing noise, not a rendering change. The no-visual-change conclusion rests
   > on the computed-style measurements, not on byte equality.

   Do not describe a size comparison as "byte-for-byte" anywhere in the file.

2. **Same file, last section — scope the "exact remaining population" claim to its reading.** The
   closing line tells HEL-1043 that "the P1/P2/P3/P5 lists above are the exact remaining
   population it needs to consume". That is true only under the **strict** `var(--eyebrow-*)`
   reading (16 blocks). Under the file's own **loose** value-identical reading there are 27 blocks
   left, including hand-copied recipes written with the underlying tokens that appear in no list
   here — e.g. `DashboardList.css` `.dashboard-list__pinned-badge`, `PanelGrid.css`
   `.panel-grid-card__footer` and `.panel-grid-card__type-badge`, `PanelContent.css`
   `.panel-content__metric-label`, `PipelineDetailHeader.css`
   `.pipeline-detail-header__schedule-disabled-badge`. Add the qualifier (one clause: "…the exact
   remaining population **under the strict reading**; under the loose reading a further 11 blocks
   written with `--text-micro`/`--weight-medium` directly also remain") so HEL-1043 does not
   under-scope itself against a list that was never meant to be its whole corpus.

3. **Commit `openspec/changes/consolidate-eyebrow-recipe/evaluation-3.md`.** `git status` shows it
   untracked at HEAD `75524095`. The cycle-3 evaluation — which is where the screenshot-method
   finding is recorded — is not in the branch and would be lost with the worktree.

### Non-blocking notes

- Item 9's underlying conclusion is sound; CR1 is about wording only. No re-capture is needed.
- `.agent-memory-list-table__th`, `.schema-field-viewer__title`, `.mfa-enroll-modal__field label`
  and `ConnectorCompletionPage.tsx:102`'s label could not be rendered in this dev session. Source
  inspection plus the theme-invariance of the `--eyebrow-*` tokens covers them; no action asked.
- Unrelated to this change: on the source detail panel the schema table's `Field/Type/Nullable`
  header row is *not* an eyebrow (13px sans) while every other table header in the app now is.
  That is a pre-existing inconsistency in a different component — worth a line in HEL-1043's
  corpus, not a change here.
- `check:tokens` being green on this diff should not be cited as evidence in the PR body; it is
  vacuous for a change that only removes `var()` references.
