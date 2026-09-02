## Skeptic Report — final gate (round 1, skeptic-final-3.md)

**Axis:** Frontend UX quality, DESIGN.md compliance, accessibility across the new surfaces
(river/tail chains, OutputsRail, Outputs gallery tab, OutputEditorSheet, shapes retarget,
new-pipeline flow).

Reviewed at HEAD `649baa21`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`, tree clean
(`git status --short` empty). Servers verified current before any UI evidence:
backend `:9247/health` → 200, frontend `:6340` → 200.

---

### What I verified (with evidence)

#### Gates — re-run fresh by me, not trusted from evaluation-5

| Gate | Result |
| --- | --- |
| `npm run lint` (`eslint . --max-warnings=0`) | PASS, exit 0 |
| `npm run typecheck` (`tsc --noEmit`) | PASS, exit 0 |
| `npm test` | PASS — `Test Suites: 282 passed`, `Tests: 3009 passed`, exit 0 |

#### CR4 (mobile touch target on `.outputs-rail__chip`) — CONFIRMED HOLDING

I did not trust the report; I re-ran an independent `elementFromPoint` bisection (0.25px step)
at 375x812, scrolling each chip into view first. My first pass returned zeros for chips 3–4 —
**that was a measurement artifact** (off-viewport `elementFromPoint` returns `null`), not a
failure. Re-run after `scrollIntoView`, all four chips reproduce cleanly:

| chip | painted box | real vertical hit | real horizontal hit | up / down |
| --- | --- | --- | --- | --- |
| `CHART Total Revenue by Region` | 245.1 x 28.0 | **44.50** | 199.50 | 22.75 / 21.75 |
| `+ Output` | 87.7 x 28.0 | **44.50** | 88.50 | 22.75 / 21.75 |
| `CHART Total Revenue by Region (prev…` | 301.2 x 28.0 | **44.50** | 199.50 | 22.75 / 21.75 |
| `+ Output` | 87.7 x 28.0 | **44.50** | 88.50 | 22.75 / 21.75 |

All clear the `44 - samplingStep` = 43.75 threshold in both axes, symmetric about the control.
Touch gate `(max-width: 768px), (pointer: coarse)` confirmed matching. **CR4's fix is genuine.**

#### CR6 (ARIA tabs) — CONFIRMED HOLDING, by real key presses

Focused the Steps tab and pressed a real `ArrowRight` through the browser (not a synthetic
attribute read):

```
before: activeElement="Steps"        tabIndex=[0,-1]  aria-selected=[true,false]
after:  activeElement="Outputs (19)" tabIndex=[-1,0]  aria-selected=[false,true]
        activeIsTab=true
```

Panel swapped from `#…tabpanel-steps` (labelledby `…tab-steps`) to `#…tabpanel-outputs`
(labelledby `…tab-outputs`). `role="tablist"` carries `aria-label="Pipeline sections"`. Both
tabs carry `id` + `aria-controls`; roving tabindex genuinely moves focus. **Correctly wired.**

#### CR7 (inline styles) — CONFIRMED

`grep 'style={{'` across all new TSX (`OutputsRail`, `TailChain`, `OutputsGalleryTab`,
`OutputGalleryCard`, `PipelineDetailHeader`, `StepCard`, `PipelineDetailPage`,
`outputEditor/*`) → **NONE**.

#### HEL-629 (pie ↔ cartesian live switch) — CONFIRMED HOLDING

Clean page reload, then 8 consecutive live switches in the open sheet:
`Pie → Bar → Pie → Line → Pie → Scatter → Pie → Line`. Chart instance re-mounted every time
(`chartMounted=true` x8). Console errors for that isolated session: **only** the pre-existing
`/api/types` 404 (x2) and the handled `/schedule` 404. Zero exceptions.

(Note for the record: a full-history console dump surfaced `ReferenceError: stepsTabRef is not
defined` and hooks-order errors. I traced these to `[vite] Failed to reload
PipelineDetailPage.tsx` HMR events during the **executor's earlier editing session** — they do
not reproduce on a clean load of the committed code. Not a defect.)

#### Token/mechanical scan of the new CSS — mostly clean

No hardcoded hex/rgb, no literal `font-size`, no literal `font-weight`, no ad-hoc
`font-family` in any new CSS. Only one newly-added literal spacing value (`gap: 2px`), which
DESIGN.md sanctions (≤4px optical tweak). The two `max-width: 800px` values are container
widths (pre-existing on `main`), not media queries — §4 not implicated.

#### Layout / overflow — clean

`documentElement.scrollWidth - clientWidth = 0` on the gallery tab at 320 and 375; the
OutputEditorSheet at 320px measured `282.0x648.0`, `dialogOverflow=0`, zero elements escaping
the viewport. No horizontal overflow found on any new surface.

#### Shared-primitive reuse — partially confirmed

`OutputEditorSheet` **does** reuse the shared `Modal` (native `<dialog>`), `Select`,
`TextField` and `InlineError` — the claim holds, and every `Select` carries a proper
`aria-label` (`"Output kind"`, `"Chart type"`, `"Group by field"`, …). Good.

---

### Verdict: REFUTE

Five cycles of change requests (CR1, CR9, CR10, CR11) were spent almost entirely on
data-correctness. On the UX axis the rail was fixed and then left; the **Output editor sheet
and gallery card were never measured or judged**. Both carry defects, one of which is a direct
failure of a named acceptance criterion.

---

### Change Requests

**1. `OutputEditorSheet`'s footer buttons fail the 44px touch floor — AC failure.**
`frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx:385,397` (Cancel, Save)
and `:375` (Delete). The ticket AC reads: *"Mobile (375px/430px) layout of river + rail + **sheet**
meets >=44px touch-target floor."* CR4 fixed the rail. Nobody measured the sheet. My
`elementFromPoint` bisection, **reproduced stably at both 375px and 430px**:

| button | className | painted | real hit height | `::after` | floor |
| --- | --- | --- | --- | --- | --- |
| Delete | `"output-editor-sheet__delete"` | 60.0 x 22.0 | **22.50** | `none` | **FAIL** |
| Cancel | `""` | 63.5 x 22.0 | **22.50** | `none` | **FAIL** |
| Save | `""` | 48.0 x 22.0 | **22.50** | `none` | **FAIL** |

Exactly half the required floor, with no hit expander at all. The fix already exists inside the
primitive the sheet imports: `.ui-modal-btn` in `shared/ui/Modal.css:170-235` supplies
`height: var(--control-md)`, `--primary`/`--secondary` variants, **and** the 44px `::after`
expander under the identical `(max-width: 768px), (pointer: coarse)` gate. Apply
`ui-modal-btn ui-modal-btn--primary` to Save, `ui-modal-btn ui-modal-btn--secondary` to Cancel,
and add `ui-modal-btn` alongside `output-editor-sheet__delete`.

**2. Cancel and Save carry no button recipe at all — DESIGN.md §5 violation.**
Same lines. `className=""` is a bare unstyled `<button>`: no border, no background, no radius,
and a 22px height that is not one of the sanctioned control tokens (`--control-sm` 28 /
`--control-md` 32 / `--control-lg` 40). DESIGN.md §5: *"every button follows one of these
recipes"* and *"One primary per view/section"* — the sheet's primary action (Save) is not the
Primary recipe and is visually indistinguishable from Cancel. Every other `Modal` consumer in
the repo styles its footer (`PipelineShareDialog` and `PipelineScheduleDialog` use
`ui-modal-btn`; connectors modals use `connectors-page__btn`; `PanelDetailModal` uses
`panel-detail-modal__btn`). `OutputEditorSheet` is the only one that ships bare buttons.
CR 1 and CR 2 are fixed by the same edit.

**3. `output-editor-sheet__add-tail` is referenced but defined in no stylesheet.**
`OutputEditorSheet.tsx:392` renders the task-5.6 "Add as tail with aggregate" affordance with
`className="output-editor-sheet__add-tail"`. `grep -rn 'output-editor-sheet__add-tail'
--include=*.css` → **no match in any CSS file**. This key affordance renders as an unstyled
browser-default button. Give it a real recipe (`ui-modal-btn ui-modal-btn--secondary`).

**4. `--app-surface-sunken` is an invented token; the gallery thumbnail well renders inverted
and, in light theme, invisible.** `OutputGalleryCard.css:29`:
```css
background: var(--app-surface-sunken, var(--app-surface-raised));
```
`--app-surface-sunken` **is defined nowhere** — `theme.css` ships exactly
`--app-surface`, `--app-surface-soft`, `--app-surface-raised`, `--app-surface-strong`, and this
is its only occurrence in the entire codebase. So it always resolves to the fallback,
`--app-surface-raised` — which DESIGN.md §3 designates the **hover** rung, not a recessed well.
The recessed-well token is `--app-surface-soft`. Measured from rendered pixels in light theme:

```
card  .output-gallery-card           background = rgb(253,252,250)  (= --app-surface  #fdfcfa)
well  .output-gallery-card__thumbnail background = rgb(255,255,255)  (= --app-surface-raised #ffffff)
                                       --app-surface-soft would be   #efece6
```

The "recessed" well is painted **lighter than the card containing it** — depth is inverted, and
in light theme white-on-#fdfcfa gives essentially no visible boundary (see the light-theme
gallery screenshot: 19 cards reading as near-blank rectangles). Replace with
`var(--app-surface-soft)` and delete the invented token. This also warrants a guard —
`theme/tokenAuditSweep.css.test.ts` was modified in this diff yet does not catch a
`var()` reference to an undefined `--app-*` token.

**5. The Outputs gallery empty state hand-rolls markup instead of the shared `EmptyState`
primitive.** `OutputsGalleryTab.tsx:35-37` renders:
```html
<div class="outputs-gallery-tab__empty"><p>No Outputs yet. Add one from any step in the Steps tab, or start here.</p></div>
```
Verified live on a 0-Output pipeline (`5802e4ac-…`, tab reads "Outputs (0)"):
`usesSharedEmptyState = false`. DESIGN.md §7 — *"**Empty:** render `EmptyState` — never render
nothing"* — and §6 lists `EmptyState` under *"Use these; do not hand-roll equivalents.
**[mechanical]**"*. This is a main content area, i.e. exactly the `variant="main"` case (icon,
Fraunces title, description, `cta`). The precedent is in this very feature directory:
`PipelineRiverView.tsx:316`, `RunHistoryModal.tsx:172`, `PipelineEmptyState.tsx:15` all use it,
and `RunHistoryModal.test.tsx:126` is a Jest test asserting *"renders the shared EmptyState
primitive (not ad-hoc text)"*. Wire the existing `onAddOutput` in as the `cta`.

**6. The Output sheet's form is built from 27 borrowed `panel-detail-modal__*` classes owned by
another feature, and does not use the shared `FormField` primitive.**
Counted across `outputEditor/`: `__data-section` x11, `__data-label` x8, `__field-hint` x4,
plus `__mapping-row`, `__mapping-label`, `__edit-section-heading`, `__type-hint`. These are
defined **only** in `features/panels/ui/detailModal/PanelDetailModal.binding.css`, which
`OutputEditorSheet.tsx` never imports (it imports only `./OutputEditorSheet.css`). Two problems:
  - DESIGN.md §6 names **`FormField`** *"(label + control + help/error layout — the one form-row
    recipe; new forms use it instead of re-deriving `.xxx__field`)"*. `grep FormField
    features/pipelines/ui/outputEditor/` → **not used**. The visible symptom is in the sheet
    screenshot: Name/Kind/Chart type use a label-above layout while Group by/Value field/
    Function/Annotation use a label-left layout — two competing form-row idioms in one dialog.
  - DESIGN.md §1 requires BEM-ish naming; a `panel-detail-modal__` block inside
    `OutputEditorSheet` misattributes ownership and creates a cross-feature CSS dependency on a
    file this component does not import. P1.6 (HEL-909) explicitly follows this ticket and
    touches `features/panels/` — restyling or moving `PanelDetailModal.binding.css` would
    silently restyle the Output sheet.

  Adopt `FormField` for the sheet's rows (one consistent idiom), or at minimum re-home these
  rules under an `output-editor-sheet__*` block in the CSS file the component actually imports.

---

### Non-blocking notes

- **Gallery thumbnails are not live renders.** Ticket scope says *"gallery of every Output
  rendered live (ECharts/DataGrid/metric renderers reused from panels)"*; every card instead
  shows an icon and a row-count string (`OutputGalleryCard.tsx:9-14` documents the deferral as
  blocked on "Section 5's editor migration"). That migration **shipped in this same diff** —
  `OutputPreviewPane.tsx` already does exactly this rendering — so the stated blocker is stale.
  Flagging for the scope-completeness skeptic, who owns that axis; visually it means the gallery
  reads as 19 identical grey rectangles.
- **`.output-preview-table` hand-rolls a `<table>`** (`OutputEditorSheet.css:27`) where §6 names
  **`DataGrid`** (`variant="preview"`). `OutputPreviewPane.tsx:145-148` justifies this by citing
  `TableRenderer`'s `panelId` column-resize PATCHes — but that names the wrong component;
  `DataGrid` requires only `rows` + `variant` and has no `panelId` coupling.
- **Long Output names blow out gallery card height.** `.output-gallery-card__name` has no
  ellipsis/line-clamp (contrast `.outputs-rail__name`, which has `max-width: 12rem` +
  `text-overflow: ellipsis`). Visible in both screenshots: one card is ~2x its siblings' height,
  breaking the grid rhythm.
- **The two "add an Output" affordances are styled inconsistently.**
  `.outputs-rail__add` uses `color: var(--app-accent)` (`OutputsRail.css:61`) while
  `.outputs-gallery-tab__add` uses `--app-text-muted`. Same action, two treatments; the muted
  one is the better fit for DESIGN.md §0.3's accent-scarcity rule.
- **File-size provenance is off again.** `OutputEditorSheet.tsx:7-8` states the file "sits a bit
  over the ~400-line soft budget (~480 lines)"; `wc -l` reports **569**. The AC's "stated reason"
  requirement is met, but this repeats the CR8 class of inaccurate self-reported numbers.
- **19 parallel `GET /api/outputs/:id/panels` on gallery mount** (one per `OutputGalleryCard`
  effect). Works, but consider a batch endpoint given CLAUDE.md's performance-by-default rule.
- Positive: no horizontal overflow anywhere; `Select`/`IconButton` accessible names are complete;
  the `tap-expand-44` adoption on rail chips and gallery cards is correct and correctly measured.
