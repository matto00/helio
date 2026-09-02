## Skeptic Report — final gate (round 2, skeptic-final-6.md)

**Axis:** Frontend UX quality, DESIGN.md compliance, accessibility across every new
surface this ticket built. Cold re-check of round 1's three REFUTE findings
(`skeptic-final-3.md`), plus a regression sanity pass.

Reviewed at HEAD `9b3d0699`, branch `feature/pipeline-page-outputs-rebuild/HEL-908`,
tree clean (`git status --porcelain` empty). Servers verified current before any UI
evidence: `:9247/health` → `{"status":"ok"}`, `:6340` → `200`. Fix commit under review:
`5fa1fc54`.

---

### What I verified (with evidence)

#### Finding 1 — Output editor sheet footer touch targets + button recipes: **RESOLVED**

I re-ran my own `elementFromPoint` bisection (0.25px step, hit-target must resolve to
the button or a descendant), on the live sheet, at **both** 375x812 and 430x932. Not
trusted from the executor's claim.

At 375x812:

| button | className | painted | vert hit (up/down) | horiz hit | `::after` |
| --- | --- | --- | --- | --- | --- |
| Delete | `ui-modal-btn ui-modal-btn--danger output-editor-sheet__delete` | 76.7 x 32 | **44.50** (22.75/21.75) | 77.25 | `height: 44px` |
| Cancel | `ui-modal-btn ui-modal-btn--secondary` | 79.8 x 32 | **44.50** | 80.50 | `height: 44px` |
| Save | `ui-modal-btn ui-modal-btn--primary` | 66.1 x 32 | **44.50** | 66.75 | `height: 44px` |

Reproduced identically at 430x932 (44.50 / 77.25, 44.50 / 80.50, 44.50 / 66.75). All
three clear the `44 - samplingStep` = 43.75 threshold **in both dimensions**, symmetric
about the control. Round 1's measurement was 22.50 with `::after: none`; the expander is
now genuinely present and genuinely hit-testable. The painted box grew 22 → 32px
(`--control-md`), a sanctioned control token.

Visual treatments are genuinely distinct, not just class names — computed style plus a
rendered screenshot (`.playwright-mcp/hel908-footer.png`):

- **Save** — `background: rgb(249,115,22)` (`--app-accent`), dark text: real solid Primary.
- **Cancel** — transparent, `1px rgba(33,29,25,0.11)` hairline, `rgb(108,101,92)` muted text: Secondary.
- **Delete** — transparent, `1px color(srgb .78 .23 .16 / 0.6)` hairline, `rgb(199,58,42)` text: Danger.

The new `.ui-modal-btn--danger` variant was added to the shared `shared/ui/Modal.css`
(not a local one-off), matching `.ui-icon-btn--danger`'s recipe. One primary per section
holds. Round 1's CR3 (`output-editor-sheet__add-tail` unstyled) is also incidentally
fixed — that button now carries `ui-modal-btn ui-modal-btn--secondary`.

#### Finding 2 — invented `--app-surface-sunken` token: **RESOLVED**

`grep -rn 'app-surface-sunken' frontend/src` → the only remaining occurrence is inside
the explanatory CSS comment; **zero `var()` references remain**. `OutputGalleryCard.css:33`
now reads `background: var(--app-surface-soft)`.

Measured from rendered pixels on the live 19-card gallery, both themes (relative
luminance, 0.2126R + 0.7152G + 0.0722B):

| theme | card bg | well bg | card lum | well lum | recessed? |
| --- | --- | --- | --- | --- | --- |
| light | `rgb(253,252,250)` (`--app-surface`) | `rgb(239,236,230)` (`--app-surface-soft`) | 252.1 | **236.2** | yes |
| dark | `rgb(26,24,22)` | `rgb(22,21,20)` | 24.3 | **21.1** | yes |

Depth is no longer inverted: in both themes the well is now darker than the card that
contains it. Round 1's light-theme white-on-`#fdfcfa` invisible-boundary symptom is gone.
`--app-surface-sunken` is still undefined in `theme.css` — correctly so, since nothing
references it any more.

#### Finding 3 — cross-feature `panel-detail-modal__*` CSS dependency: **RESOLVED**

`grep -rn 'panel-detail-modal' frontend/src/features/pipelines/` → **zero references in
any `.tsx`**; the only two hits are prose inside `OutputEditorSheet.css`'s explanatory
header comment. The seven rules actually used (`__data-section`, `__data-label`,
`__edit-section-heading`, `__field-hint`, `__type-hint`, `__mapping-row`,
`__mapping-label`) were ported into an `output-editor-sheet__*` block in
`OutputEditorSheet.css`, the file this component actually imports
(`OutputEditorSheet.tsx:72`). HEL-909 can no longer restyle this sheet invisibly.

I checked the one apparent leftover: the live DOM still shows
`panel-detail-modal__mode-toggle-btn` inside the sheet. I traced it — it belongs to
`BoundOrLiteralField`, which is a genuine **React component import**
(`OutputKindFields.tsx:18` → `features/panels/ui/editors/BoundOrLiteralField`), i.e. a
real, traceable, explicit dependency carrying its own CSS. That is exactly the
import-backed relationship CR6 asked for, not the phantom CSS-only coupling it objected
to. Not a finding.

#### Regression sanity pass — all round-1 clean areas hold

- **CR4 (rail chips):** re-bisected all four chips, `scrollIntoView` first. Vertical hit
  **44.50** on every chip; horizontal 245.75 / 88.50 / 301.75 / 88.50. Chips are plain
  `<button>` with correct `aria-label`s (`"Open Total Revenue by Region output"`, `"Add output"`).
- **CR6 (ARIA tabs + keyboard):** `role="tablist"` with `aria-label="Pipeline sections"`;
  both tabs carry `id` + `aria-controls`. Drove a **real browser `ArrowRight`** (not a
  synthetic dispatch): focus moved Steps → `Outputs (19)`, `aria-selected` flipped
  `[true,false]` → `[false,true]`, `tabIndex` `[0,-1]` → `[-1,0]`, `activeElement` role
  is `tab`, panel swapped to `pipeline-detail-page__tabpanel-outputs`.
- **CR7 (inline styles):** `grep 'style={{'` across `features/pipelines/ui|hooks` → one
  hit, `OpDropdown.tsx:96`. Verified **pre-existing and untouched by this branch**
  (`git log main -1` → `c0fbb56a`, and it does not appear in `git diff main...HEAD --name-only`),
  and it is legitimate computed positioning (`position: fixed` + measured top/left).
  No new inline styles.
- **HEL-629 (pie ↔ cartesian live switch):** 8 consecutive live switches in the open sheet
  through the real `role="combobox"` Select —
  `Pie → Bar → Pie → Line → Pie → Scatter → Pie → Line`. Chart canvas present and sized
  (`678px`) after every switch; trigger label tracked the selection every time. No
  exceptions.
- **Token scan:** no hex/rgb literals in any new pipelines CSS.
- **Layout:** `documentElement.scrollWidth - clientWidth = 0` on the detail page.

#### Fresh full-session console check

One clean login → pipeline detail → open Output sheet → 8 chart-type switches → **Save**
(sheet closed, persisted) → Outputs tab (19 cards) → back to Steps tab. Total console
errors for the session: **3**, all pre-existing 404s already characterised in round 1
(`/api/types` x2, `/api/pipelines/:id/schedule` x1). **Zero exceptions, zero new errors
introduced by this round's CSS/class changes.** The 18 warnings are ECharts
`grid.containLabel` / DOM-size warnings, pre-existing.

One anomaly I chased rather than reported: mid-session, several clicks bounced the page
to `/pipelines` or `/`. I reproduced and diagnosed it — the dev **session cookie had
expired** (the app correctly redirected to `/login`, which I confirmed by reading the
rendered page). After re-authenticating, every interaction behaved correctly and the
remaining bounces correlated with clicking before hydration completed. **Not a defect**;
this is exactly the "re-run before concluding" case.

#### Gates — all re-run fresh by me at `9b3d0699`

| Gate | Result |
| --- | --- |
| `npm run lint` (`eslint . --max-warnings=0`) | PASS, exit 0 |
| `npm run format:check` (`prettier . --check`) | PASS — "All matched files use Prettier code style!" |
| `npm run typecheck` (`tsc --noEmit`) | PASS, no output |
| `npm test` | PASS — `Test Suites: 282 passed`, `Tests: 3013 passed` |
| `npm --prefix frontend run build` | PASS, exit 0 (only the pre-existing >500kB chunk-size warning) |

---

### Verdict: CONFIRM

All three findings I was assigned to re-check are genuinely fixed, verified first-hand
from rendered pixels and hit-testing rather than from the executor's narrative. Nothing
in round 1's clean set regressed. All five gates are green. On my axis, this ships.

---

### Non-blocking notes

1. **Process — round 1's CR5 was silently dropped, with no disposition anywhere.**
   Round 1 raised six numbered change requests. `5fa1fc54`'s message and
   `execution-progress.md`'s Cycle entry both account for "CR1/CR2/CR3/CR4/CR6" and
   simply omit **CR5** — the Outputs gallery empty state hand-rolling markup instead of
   the shared `EmptyState` primitive. `grep -rn EmptyState` over `execution-progress.md`,
   `tasks.md`, `design.md`, `workflow-state.md` → **no match**; `grep CR5` → only an
   unrelated `outputsSlice` entry from an earlier cycle. It was not fixed, not disputed,
   and not documented as deferred. Still live at `OutputsGalleryTab.tsx:32-36`:
   ```html
   <div class="outputs-gallery-tab__empty"><p>No Outputs yet. …</p></div>
   ```
   `DESIGN.md:464` — *"**Empty:** render `EmptyState` — never render nothing"* — and §6
   lists `EmptyState` under *"reuse, don't reinvent"*. I am **not** blocking on it: it is
   cosmetic, it only renders on a zero-Output pipeline, and it does show informative text
   rather than nothing. But a numbered change request vanishing without a disposition is
   the same false/absent-provenance pattern this ticket has already been bitten by three
   times (evaluation-1 CR3/CR8, task 8.3). Recommend the orchestrator either apply the
   one-line fix or record an explicit deferral/follow-up before merge.
2. **The two competing form-row layouts in the sheet remain.** CR6 offered two remedies
   ("adopt `FormField`" **or** "at minimum re-home these rules"); the executor took the
   minimum, which is a legitimate satisfaction of the CR as written — but since the ported
   values are byte-for-byte copies, the visual symptom is unchanged. Confirmed by
   screenshot (`.playwright-mcp/hel908-sheet.png`): Name / Kind / Chart type render
   label-above, while Group by / Value field / Function / Annotation render label-left,
   in one dialog. `grep FormField features/pipelines/ui/outputEditor/` → still not used.
   Worth a follow-up.
3. **`.output-editor-sheet__add-tail` is now a dead selector** — the class survives on the
   button but is defined in no stylesheet (`grep --include=*.css` → no match). Harmless
   now that `ui-modal-btn` carries the styling, but it should be dropped or given a rule.
4. Round 1's remaining non-blocking notes that this cycle did not touch still stand:
   gallery thumbnails are icons rather than live renders; `.output-preview-table`
   hand-rolls a `<table>` where §6 names `DataGrid`; long Output names blow out gallery
   card height (no ellipsis/line-clamp, unlike `.outputs-rail__name`); the two "add an
   Output" affordances use different colors (`--app-accent` vs `--app-text-muted`);
   19 parallel `GET /api/outputs/:id/panels` on gallery mount.
5. Dark-theme card/well luminance separation is correct but slight (24.3 vs 21.1). It
   matches the token system exactly, so this is a token-scale observation, not a defect.
