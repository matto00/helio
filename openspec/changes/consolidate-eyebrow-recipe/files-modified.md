# Files modified — HEL-732

## Precondition on every count below

Two different predicates yield two different, both-correct counts over the same tree at `9e995f69`:

- **Strict `var(--eyebrow-*)` reading** (a block declares `font-size`/`font-weight` using the literal
  tokens `var(--eyebrow-size)` / `var(--eyebrow-weight)`, not their resolved equivalents): **23 files
  / 29 blocks** with >= 3 of 5 recipe properties; 12 with all 5; 17 with exactly 3. This is the
  reading design's own numbers were quoted under, and the reading the P1..P6 classification below
  uses.
- **Value-identical reading** (a block counts if its declared value resolves to the same value the
  token would, e.g. `font-size: var(--text-micro)` counting as equal to `--eyebrow-size`): **40
  blocks / 27 files** with >= 3 matches under that looser equivalence.

Quoting either number without naming which reading it's under is how a later re-scan produces a
spurious mismatch against this one. Every count from here down is under the **strict** reading,
which is the one the P1..P6 predicates are defined against.

## Predicate counts (corrected)

P1 DEAD=2, P2 SIZE-DIVERGENT=1, **P3 UNREACHABLE=2, P4 VALUE-IDENTICAL=13, P5
WEIGHT-INHERITING=11** — sum 2+1+2+13+11 = 29. P6 OTHER=0 (empty; the partition is total on this
tree).

(An earlier version of this report double-counted P3's two members inside P5 as well, summing to
31. P3 is evaluated **before** P4/P5 in the predicate order — a block that is both
weight-inheriting-shaped AND unreachable is P3, not P5. Both P3 members below were drawn from what
would otherwise have been P5, which is why P5 is 11, not 13.)

## P1 DEAD (2) — zero non-CSS references, unconvertible, not deleted

- `frontend/src/features/audit/ui/AuditEventTable.css` `.audit-event-table__th`
- `frontend/src/features/sources/ui/SourcesPage.css` `.sources-page__section-title`

## P2 SIZE-DIVERGENT (1) — flagged as an open question, not decided

- `frontend/src/features/settings/ui/AgentMemoryList.css` `.agent-memory-list-table__kind` — uses
  `var(--text-xs)` (12px), genuinely different from `--eyebrow-size` (10px). Not converted. Open
  question for the owner: is this a deliberate variant of the eyebrow recipe at a larger size, or
  drift that predates the recipe? Not obvious from the code; not decided here.

## P3 UNREACHABLE (2) — attempted, state not reachable, no scaffold built

- `frontend/src/features/patchSets/ui/PatchSetReview.css` `.patch-set-review__diff-label` —
  attempted via `/patch-sets/review`'s DEV demo fixture. The fixture only produces a single
  title/string edit (a plain before/after inline pair), never the diff-rendering shape this class
  needs (before/after blocks for a non-string change). Left unconverted.
- `frontend/src/features/assistant/ui/MessageTurn.css` `.message-turn__outcome-note` — attempted via
  `/chat`. This class only renders for a `timedOut`/needs-clarification assistant turn outcome,
  which is not deterministically reachable in a dev session (would require actually causing an
  assistant timeout or contrived ambiguity, not something the DEV fixtures synthesize). Left
  unconverted.

## P4 VALUE-IDENTICAL (13) — converted, measured before AND after, both themes

Method: computed `font-size`/`font-weight` read from the running app, same element/same state
resolved by the block's own selector, both themes, **before conversion and after**. All 13 held
constant at `10px` / `500` before and after, including the 7 descendant/compound selectors at
`(0,1,1)` specificity vs `.eyebrow`'s `(0,1,0)` (the cascade-position risk design flagged in D1a).

Before/after screenshots for the three structural contexts (table header, badge, form label) are at
`/home/matt/Development/helio/.concertino/runs/HEL-732/evidence/{th-sources,badge-mfa-settings,label-login}-{light,dark}-{BEFORE,AFTER}.png`
— written to the **main checkout's** evidence directory (not the worktree's), since
`cleanup.sh --phase4` destroys the worktree and that path is gitignored (`.gitignore:87`) so it
survives teardown. All 6 AFTER screenshots were re-captured against `f7aaf433` (the sidebar-heading
fix), confirmed live via Playwright before capture that the rendered heading actually showed the
fixed computed style (`10px`/`500`/`1.4px`/`uppercase`), and initially compared against their BEFORE
counterparts by **file size only** — which is not sufficient (two same-size PNGs can differ in
content) and was corrected on skeptic review: an `md5sum` comparison shows **4 of 6** are
byte-identical (`badge-mfa-settings-{dark,light}`, `th-sources-dark`, `label-login-light`). Of the
remaining two, `th-sources-light` is the case the size check actually missed: it matches its BEFORE
counterpart in file size (170037 bytes both) but differs in 164,995 of those bytes. `label-login-dark`
differs in file size too (87064 vs 87099), so the size check caught that one correctly. The
conclusion (no computed-style change) still holds: it rests on the live computed-style measurement
in the P4 section above, not on the screenshots, and the evaluator's independent per-pixel delta
analysis (`evaluation-3.md:180-186`, accepted by the skeptic at `skeptic-final-1.md:123-124`)
attributes both differing pairs to antialiasing render noise, not a real visual change.

- `frontend/src/features/settings/ui/MfaEnrollModal.css` — removed the 5 recipe properties
  from `.mfa-enroll-modal__field label`; kept `color`.
- `frontend/src/features/settings/ui/MfaEnrollModal.tsx` — added `className="eyebrow"` to the
  confirm-code `<label>`. Single consumer (verified via repo-wide grep).
- `frontend/src/features/settings/ui/AgentMemoryList.css` — removed the 5 recipe properties
  from `.agent-memory-list-table__th`; kept `text-align`/`padding`/`color`/`border-bottom`.
- `frontend/src/features/settings/ui/AgentMemoryList.tsx` — added `eyebrow` to all four `<th>`
  elements (including the actions column, same CSS rule). Single consumer.
- `frontend/src/features/settings/ui/MfaSecuritySection.css` — removed the 5 recipe
  properties from `.mfa-security-section__badge`; kept the pill/layout declarations.
- `frontend/src/features/settings/ui/MfaSecuritySection.tsx` — added `eyebrow` to the status
  badge's `className` template. Single consumer.
- `frontend/src/features/settings/ui/ApiTokensSection.css` — removed the 5 recipe properties
  from `.api-tokens-list-table__th`; kept `text-align`/`padding`/`color`/`border-bottom`.
- `frontend/src/features/settings/ui/ApiTokensSection.tsx` — added `eyebrow` to all four `<th>`
  elements. Single consumer.
- `frontend/src/features/connectors/ui/ConnectorsPage.css` — removed the 5 recipe properties
  from `.connectors-page__th`; kept `text-align`/`padding`/`color`/`border-bottom`.
- `frontend/src/features/connectors/ui/ConnectorsPage.tsx` — added `eyebrow` to every column's
  `className` (including the actions header). Single consumer.
- `frontend/src/features/pipelines/ui/PipelinesPage.css` — removed the 5 recipe properties
  from `.pipeline-list-table__th`; kept `text-align`/`padding`/`color`/`border-bottom`.
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx` — added `eyebrow` to every column's
  `className` (including the actions header). Single consumer.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — removed the 5 recipe
  properties from `.pipeline-detail-page__footer-output-label`; kept `color`.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx` — added `eyebrow` to both
  `PIPELINE`/`OUTPUT` footer label spans. Single consumer.
- `frontend/src/features/auth/ui/auth.css` — removed the 5 recipe properties from
  `.auth-field label`; kept `color`.
- `frontend/src/features/auth/ui/LoginPage.tsx` — added `eyebrow` to the Email/Password labels
  (2 of the 7 label instances across the 4 files below; every consumer verified via repo-wide
  grep).
- `frontend/src/features/auth/ui/RegisterPage.tsx` — added `eyebrow` to the Email/Password/Display
  name labels (3 of the 7).
- `frontend/src/features/auth/ui/MfaVerifyPage.tsx` — added `eyebrow` to the code-entry label
  (1 of the 7).
- `frontend/src/features/connectors/ui/ConnectorCompletionPage.tsx` — added `eyebrow` to the
  credential label (1 of the 7).
- `frontend/src/features/sources/ui/SourceListTable.css` — removed the 5 recipe properties
  from the bare-tag `.source-list-table th`; kept
  `text-align`/`padding`/`color`/`border-bottom`/`white-space`.
- `frontend/src/features/sources/ui/SourceListTable.tsx` — added `className: "eyebrow"` to every
  `HEADER_COLUMNS` entry (the shared `SortableTable` renders every header from this array; no
  other `<th>` exists in this table). Single consumer.
- `frontend/src/features/sources/ui/SourceDetailPanel.css` — removed the 5 recipe
  properties from `.source-detail-panel__section-title`; kept `margin`/`color`.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — added `eyebrow` to the "Preview"
  section title (1 of exactly 2 consumers, both converted, verified via repo-wide grep).
- `frontend/src/features/sources/ui/EmptySchemaAffordance.tsx` — added `eyebrow` to the "Schema not
  available" title (the other of the 2 consumers).
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css` — removed the 5
  recipe properties from `.dashboard-appearance-editor__label`; kept
  `display`/`margin-bottom`/`color`.
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` — added `eyebrow` to the
  "Dashboard appearance" label span. Single consumer.
- `frontend/src/features/dashboards/ui/DashboardList.css` — removed the 5 recipe properties
  from the bare-tag `.dashboard-list__header h2`; kept `margin`/`color`. **Two consumers, both now
  converted** (this selector was missed on the first pass — see "Correction" below):
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — added `className="eyebrow"` directly
  to `<h2>Dashboards</h2>` (1 of the 2 consumers).
- `frontend/src/shared/chrome/SidebarItemList.tsx` — added `className="eyebrow"` to
  `<h2>{heading}</h2>` (the other of the 2 consumers), the shared sidebar-section heading rendered
  for "Data Sources", "Data Pipelines", and "Assistant" (the three `heading=` call sites, verified
  directly in `SidebarBody.tsx:76,109,200` — corrected from an earlier, wrong citation of
  "Connectors" at `:194`, which does not exist; `:194` is inside a conversations block, not a
  `heading=` prop; one shared component, one fix, all three sites re-measured).
- `frontend/src/shared/ui/SchemaFieldViewer.css` — removed the 5 recipe properties from
  `.schema-field-viewer__title`; kept `color`.
- `frontend/src/shared/ui/SchemaFieldViewer.tsx` — added `eyebrow` to the title span. Single
  consumer.

## Correction (evaluator cycle 1) — a live visual regression from a missed second consumer

`.dashboard-list__header h2` (item 12 above) has **two** consumers, not one:
`DashboardList.tsx:203` (converted on the first pass) and `SidebarItemList.tsx:300` (missed). The
CSS rule lost the recipe on the first commit while `SidebarItemList.tsx` still relied on the bare
selector for its styling, so the three sidebar section headings ("Data Sources", "Data Pipelines",
"Assistant") regressed to `24px / 700 / sans / no-transform` instead of `10px / 500 / mono /
uppercase`.

Every consumer of every one of the 13 converted selectors has now been re-enumerated by repo-wide
grep (documented per item above); this was the only selector with more than one consumer, and it is
now fixed and re-measured: both `DashboardList.tsx`'s "Dashboards" heading and
`SidebarItemList.tsx`'s "Data Sources" heading compute `10px` / `500` / mono / uppercase, in both
themes, after the fix.

## P5 WEIGHT-INHERITING (11) — NOT converted; measured before, would change on conversion

Method: computed `font-weight` read from the running app, before conversion only (conversion was
never applied — see below), both themes, same element/state resolved by the block's own selector.
All 11 currently inherit **`font-weight: 400`**; `.eyebrow` would impose `var(--eyebrow-weight)` =
`500`. That is a real, measured visual change with no justification recorded anywhere in the
artifacts, so per the binding method ("different ⇒ justify in the PR or leave the block alone") none
of these 11 were converted. `font-size` in all 11 is `10px`, matching the utility, so the only
divergence is `font-weight`.

- `frontend/src/features/pipelines/ui/OutputsRail.css` `.outputs-rail__kind`
- `frontend/src/features/pipelines/ui/OutputGalleryCard.css` `.output-gallery-card__kind`
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.css` `.outputs-gallery-tab__count`
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReview.css`
  `.pipeline-proposal-review__meta-row dt`
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReview.css`
  `.pipeline-proposal-review__type`
- `frontend/src/features/proposals/ui/CombinedProposalReview.css`
  `.combined-proposal-review__type`
- `frontend/src/features/proposals/ui/CombinedProposalReview.css`
  `.combined-proposal-review__meta-row dt`
- `frontend/src/features/patchSets/ui/PatchSetReview.css` `.patch-set-review__op`
- `frontend/src/features/patchSets/ui/PatchSetReview.css` `.patch-set-review__change-key`
- `frontend/src/features/dashboards/ui/ProposalReview.css` `.proposal-review__type`
- `frontend/src/features/dashboards/ui/ProposalReview.css`
  `.proposal-review__meta-row dt`

(`.patch-set-review__diff-label` and `.message-turn__outcome-note`, both otherwise
weight-inheriting-shaped, are classified P3 UNREACHABLE above instead — evaluated first, per the
predicate order, so they are not double-counted here.)

## Other changes

- `frontend/src/theme/tokenAuditSweep.css.test.ts` — re-pinned the HEL-439 spacing-baseline line
  numbers for the four files whose recipe-removal shifted later lines up by 5
  (`DashboardAppearanceEditor.css`, `PipelineDetailPage.css`, `PipelinesPage.css`,
  `SourceDetailPanel.css`); no baseline entries added or removed, only their pinned line numbers
  corrected to match the new file layout. Verified: 62 baseline entries before and after the edit,
  identical multiset, every pin resolves to a real `px` declaration in its file.

  **Rebased onto `origin/main` (`318af787`) after HEL-442 (`6800583e`) independently re-pinned this
  same file's baseline against a different base** (a comment inserted before
  `PipelineDetailPage.css`'s `.pipeline-detail-page__drop-indicator` and
  `.pipeline-detail-page__compute-fields-hint-item` rules, shifting 42 of that file's entries).
  Neither side's pins were valid against the merged tree, so the baseline was **re-derived from
  scratch by a fresh regex scan** (the test's own `SPACING_PATTERN`/`spacingIsDisallowed` against
  `SWEPT_FILES`) rather than composed by hand from the two tickets' offsets — composing two
  independent shifts arithmetically is exactly how an off-by-one ships. The fresh scan yields **62
  entries** (42 of them in `PipelineDetailPage.css`, matching HEL-442's own reported count for that
  file exactly). Reconciled the multiset by comparing FILE+LINE-CONTENT (not line numbers) across
  three states — the pre-rebase HEL-732 branch tip, the pre-rebase `origin/main` tip, and the fresh
  post-merge scan — and all three normalize to the identical 62-entry content multiset: nothing
  added, nothing removed, only re-pinned. Proved the guard is still failable: mutated one pin by +1,
  confirmed both the "no unexpected literal" and "baseline isn't stale" assertions go red, then
  restored and confirmed green again.

No other file was modified. `theme.css`, `.eyebrow`, the `--eyebrow-*` tokens, and `DESIGN.md` are
untouched.

## AC unachievable under the current standard

`DESIGN.md:276` explicitly permits copying the eyebrow recipe ("Use the `.eyebrow` utility **or
copy its recipe**"), so every one of the 29 blocks on the tree is currently *compliant*, and the
ticket's AC ("no component CSS file hand-declares the eyebrow recipe") is unachievable without
amending that standard. Full elimination is tracked as **HEL-1043** (owner-authorized as of cycle 2).
This document is that ticket's input — the P1/P2/P3/P5 lists above are the exact remaining
population **under the strict `var(--eyebrow-*)` reading only**. Under the looser value-identical
reading (40 blocks / 27 files, see the precondition above), additional blocks outside this
document's P1..P6 classification — e.g. `.dashboard-list__pinned-badge`, `.panel-grid-card__footer`
— also declare a subset of the recipe's *values* without using its literal tokens, and are not
enumerated here. HEL-1043 should re-scan under whichever reading it adopts rather than treat this
list as exhaustive across both readings.
