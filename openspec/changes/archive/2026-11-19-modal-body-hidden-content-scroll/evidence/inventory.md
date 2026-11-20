# HEL-1774 inventory: modals whose scrolling body holds absolutely positioned content

Probe: `e2e/hel1774-modal-scroll-*.spec.ts` (six files; originally one `hel1774-modal-scroll-extent.spec.ts`, split in cycle 3) (logs `[HEL-1774 natural|injected|abs]` per modal, viewport, theme),
using the same `measure` and `listPositioned` helpers for every modal. Geometry is dialog/body `scrollHeight` against
the in-flow content bottom (inner column / last in-flow child + padding), after finite animations settle, eps 2 px; a
box that fills its container (the phone step sheet body) is bounded by max(content bottom, its own clientHeight).
Viewports 375x812, 390x844, 1280x800, light and dark.

Raw runs in this directory:
- `red-run.txt`: committed red run (commit `3129212f4`, unfixed CSS). Its spec had 7 modal cases: output-editor,
  create-pipeline, add-source, pipeline-share, pipeline-schedule, help-overlay, dashboard-share.
- `mutation-a-shared-rule-removed.txt`: cycle 1 run with the shared rule removed; adds panel-detail-edit.
- `cycle2-unfixed-css-run.txt`, `cycle2-abs-*.txt`: cycle 2 run of the then-single spec with the rule removed. It
  ran with `RATE_LIMIT_REQUESTS_PER_WINDOW` and `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` raised to 100000 and is
  SUPERSEDED by cycle 3 (its green counterpart was deleted): that single spec 429'd under CI defaults.
- Cycle 3 (current). The guard is split into six spec files by modal group (`e2e/hel1774-modal-scroll-*.spec.ts`,
  sharing `e2e/support/modalScrollExtent.ts`), each test registering its own user and logging/asserting its `/api`
  traffic with `apiRequestCounter.ts` (max 60 s window <= 90, zero 429). Groups: pipeline-editor, pipeline-palettes,
  pipeline-dialogs (also holds the popover GUARD), dashboard-panels, dashboard-dialogs, shell.
  - `cycle3-fixed-default-limits-run.txt`: all 6 files plus the 2 popover guards, 38/38 green on the fix (superseded by the cycle 4 run below, which reports the 4 dashboard-dialogs phone tests as skipped, not passed), against
    servers started with NO `RATE_LIMIT_*` / `SOURCE_FETCH_RATE_LIMIT_*` overrides (CI defaults: 120 per 60 s general,
    30 per 60 s source fetch). Max requests in any 60 s window: 74 shell desktop, 70 shell phone, 63 palettes desktop (all
    under the 90 target), 0 x 429 in every test (`[HEL-1774 api]` lines).
  - `cycle4-fixed-default-limits-run.txt`: cycle 4, the four dashboard-dialogs phone tests (all its cases are
    desktop-only) now `test.skip` with a reason, so a green phone run no longer reads as coverage. All six files on
    the fix, again with NO rate-limit overrides: 34 passed, 4 skipped, 0 failed; max window 74 (shell desktop), 70
    (shell phone), 63 (palettes desktop), 0 x 429. The dashboard-dialogs file alone: 2 passed, 4 skipped
    (`cycle4-dashboard-dialogs-run.txt`). The unfixed-CSS run below predates the skip: its "6 green" counted those 4
    as passed; they are skipped now and run no case.
  - `cycle3-unfixed-css-run.txt`: the same 38 tests with the shared rule removed, same default limits: 32 red, 6 green
    (the 2 popover guards plus the 4 phone tests of dashboard-dialogs, whose cases are all desktop-only so they run
    nothing). Re-scored from the logged geometry: 106 injected cases ran, 94 red, 12 green = step-palette and
    command-palette at all 6 viewport/theme configs (GUARD only, `// GUARD only` on their case objects). Zero natural
    cases red, zero injected or natural cases red on the fix.
  - `cycle3-abs-before-fix.txt` / `cycle3-abs-after-fix.txt`: positioned descendants unfixed vs fixed; identical ignoring
    `containingBlock` except the Output history chart canvas on the phone, which appears in one run and not the other
    (async chart render timing; it has its own positioned ancestor and is not a moved child).
  Rows 8-20 "cycle 2 unfixed-CSS run" below are re-proven by `cycle3-unfixed-css-run.txt`.
- `regression-sweep-regress.txt`, `regression-sweep-regress2.txt`: the Decision 5 regression specs (37 + 30 passed).

## Per-consumer table (30 files from `grep -rln "<Modal\b\|<BottomSheet\b" frontend/src --include=*.tsx`, tests excluded)

Natural = body scrollHeight / content bottom, dialog scrollHeight / content bottom at 375x812 light (other viewports and
themes are in `cycle3-fixed-default-limits-run.txt`; every natural case is within 2 px of content, so every natural case is a GUARD,
green on unfixed CSS too). "Injected red" names the run that proved the injected `.sr-only` case red.

| # | Consumer (case id) | Natural body | Natural dialog | Positioned body descendants (containing block, unfixed CSS) | Injected red proven by |
| - | --- | --- | --- | --- | --- |
| 1 | OutputEditorSheet (`output-editor`) | 1982/1982 | 729/730 | Toggle input, `.sr-only` (div/details `.output-editor-sheet__group`), canvas (ECharts div) | committed red run |
| 2 | CreatePipelineModal (`create-pipeline`) | 201/201 | 319/320 | none | committed red run |
| 3 | AddSourceModal (`add-source`) | 892/892 | 729/730 | none (default tab) | committed red run |
| 4 | PipelineShareDialog (`pipeline-share`) | 252/252 | 403/404 | none | committed red run |
| 5 | PipelineScheduleDialog (`pipeline-schedule`) | 295/295 | 446/447 | none | committed red run |
| 6 | HelpOverlay (`help-overlay`) | 332/332 | 393/394 | none | committed red run |
| 7 | DashboardShareDialog (`dashboard-share`, desktop) | 447/447 | 580/581 | none | committed red run |
| 8 | PanelDetailModal (`panel-detail-edit`) | 694/714 | 812/812 | `.panel-detail-modal__scroll-fade` (in `.panel-detail-modal__scroll-area`) | cycle 1 mutation a (not the committed red run) |
| 9 | OutputHistoryModal (`output-history`) | 556/556 | 617/618 | canvas (ECharts div) | cycle 2 unfixed-CSS run |
| 10 | ShapePickerModal (`shape-picker`) | 507/507 | 658/659 | none | cycle 2 unfixed-CSS run |
| 11 | AddRootModal (`add-root`) | 130/130 | 248/249 | none | cycle 2 unfixed-CSS run |
| 12 | CreateConnectorModal (`create-connector`) | 217/217 | 386/387 | none | cycle 2 unfixed-CSS run |
| 13 | QuickLauncherOverlay (`quick-launcher`) | 499/499 | 560/561 | none | cycle 2 unfixed-CSS run |
| 14 | MfaEnrollModal (`mfa-enroll`) | 492/492 | 553/554 | none | cycle 2 unfixed-CSS run |
| 15 | MobileStepSheet + BottomSheet (`mobile-step-sheet`, phone only) | 730/522 (fills the sheet, clientHeight 730) | 795/796 | none | cycle 2 unfixed-CSS run (4 of 4 phone configs) |
| 16 | AskDrawer + BottomSheet (`ask-drawer`, desktop) | see run | see run | 2 `.sr-only` (p, span), containing block dialog on unfixed CSS, body on fixed | cycle 2 unfixed-CSS run |
| 17 | PanelFullscreenOverlay (`panel-fullscreen`, desktop) | 642/642 | 718/719 | canvas (div); nested closed `dialog.ui-modal` (hidden, 0x0, dialog on unfixed, body on fixed) | cycle 2 unfixed-CSS run |
| 18 | PanelInspectView (`panel-inspect`, desktop) | 185/185 | 303/304 | none | cycle 2 unfixed-CSS run |
| 19 | OutputPicker (`output-picker`, desktop) | 364/364 | 425/426 | none | cycle 2 unfixed-CSS run |
| 20 | RunHistoryModal (`run-history`, desktop) | 89/89 | 150/151 | none | cycle 2 unfixed-CSS run |
| 21 | StepPalette (`step-palette`) | 571/571 | 632/633 | svg in `.command-palette__search` (positioned) | GUARD only: injected is green on unfixed CSS |
| 22 | CommandPalette (`command-palette`) | 571/571 | 632/633 | svg in `.command-palette__search` (positioned) | GUARD only: injected is green on unfixed CSS |

StepPalette and CommandPalette share `.command-palette .ui-modal__body { display: flex; flex-direction: column;
min-height: 0 }`: the injected spacer shrinks inside the flex column and their own list scrolls, so no hidden element
can reach the dialog's scroll extent there. Both cases are labelled guards; they do not discriminate the rule.

Consumers 23-30 of the 30-file list (not opened live), with the reason, the actual grep, and the nearest positioned
ancestor of every absolute descendant found:

| # | Consumer | Why not opened live | Static finding |
| - | --- | --- | --- |
| 23 | EditConnectorModal | needs an existing live connector (external service) | only `.connectors-page__btn::after` tap expander, parent `.connectors-page__btn { position: relative }` |
| 24 | RotateCredentialModal | same | same |
| 25 | ProposalReview | needs a model-generated dashboard proposal | `.proposal-review__remove::after` (parent `position: relative`), `.proposal-review__preview-cell` (parent `.proposal-review__preview { position: relative }`) |
| 26 | PatchSetReview | needs a model-generated patch set | no `position: absolute|fixed` in `PatchSetReview.css` |
| 27 | CombinedProposalReview | needs a model proposal | no `position: absolute|fixed` in `CombinedProposalReview.css` |
| 28 | PipelineProposalReview | needs a model proposal | no `position: absolute|fixed` in `PipelineProposalReview.css` |
| 29 | PipelineDraftDialogs | confirm dialogs opened only after a multi-step cascading draft save | `.draft-notice__btn::after` tap expander only (in the notice, not the dialog body); `draft-cascade__*` has no positioned rule |
| 30 | BottomSheet (shared) | reached through #15 and #16 | `.bottom-sheet .ui-modal__body` sets padding and overscroll only |

Grep run for rows 23-29 (from `frontend/src`):
```
grep -nE "position:\s*(absolute|fixed)" features/dashboards/ui/ProposalReview.css features/patchSets/ui/PatchSetReview.css features/proposals/ui/CombinedProposalReview.css features/pipelines/ui/proposalReview/PipelineProposalReview.css features/connectors/ui/ConnectorsPage.css features/pipelines/ui/PipelineDraftNotices.css
features/pipelines/ui/PipelineDraftNotices.css:71:    position: absolute;
features/dashboards/ui/ProposalReview.css:102:    position: absolute;
features/dashboards/ui/ProposalReview.css:156:  position: absolute;
features/connectors/ui/ConnectorsPage.css:304:    position: absolute;
grep -nE "position:\s*relative" <same files>
features/connectors/ui/ConnectorsPage.css:73:  position: relative;
features/connectors/ui/ConnectorsPage.css:298:    position: relative;
features/pipelines/ui/PipelineDraftNotices.css:66:    position: relative;
features/dashboards/ui/ProposalReview.css:97:    position: relative;
features/dashboards/ui/ProposalReview.css:147:  position: relative;
```
Each `position: absolute` above has a `position: relative` parent rule (ConnectorsPage.css:298/304, DraftNotices
66/71, ProposalReview 97/102 and 147/156), so none has the dialog as containing block. The shared components inside
these modals (Toggle, `.sr-only`, tap-target expanders) are the same ones covered by the live rows above.

Unreachable on phone (reasons): dashboard-share (Share is absent from the phone dashboard kebab for the seeded owner),
run-history (no Run history item in the phone pipeline header menu), panel-fullscreen / panel-inspect /
output-picker / ask-drawer (the phone dashboard is a MobilePanelStack with no card menu, fullscreen button or Add
panel in this probe). mobile-step-sheet is phone-only by construction.

## Finding

No modal other than the Output editor has a naturally escaping hidden element in its default state (every natural case
is green on unfixed CSS). The defect is a latent class: the injected case is red on unfixed CSS for every modal in
rows 1-20 (rows 1-7 proven by the committed red run, rows 8-20 by the rule-removed runs named above) and green on the
fix. Rows 16 (AskDrawer) is the one modal that naturally contains `.sr-only` elements in a body that can overflow
(a long conversation), with containing block = dialog on unfixed CSS; it is not red naturally only because its
default body is short. Mutation b (also removing the HEL-1763 group rule) reproduces HEL-1763's numbers on the Output
editor (dialog 1490 vs 729.8 at 375; 1211 vs 719 at 1280).

## Moved children

`cycle2-abs-before-fix.txt` vs `cycle2-abs-after-fix.txt`: 106 lines each; identical in every field except
`containingBlock` for exactly these children, whose containing block was the dialog and is now the body:
- AskDrawer `p.sr-only` and `span.sr-only`: hidden (1x1, clipped); rect identical (top 407.5/420.5, left 390/824).
  Hidden text, placement irrelevant.
- PanelFullscreenOverlay nested closed `dialog.ui-modal`: hidden, 0x0 at (0,0); rect identical. Not rendered.
Every visible positioned descendant (canvases, scroll-fade, search icons) already had a positioned ancestor inside the
body and did not move. Nothing visible moves, so no before/after-rect visual change exists.

## Popovers at rest

`popover-rects.txt`: a `Select` listbox (`position: fixed`, portalled) opened in the schedule dialog at 375 and 1280
has identical rects with and without the rule (a GUARD, green both ways). `position: relative` is not a containing
block for fixed descendants. ActionsMenu, ProvenancePopover, OutputSchemaDisclosure, date inputs and tooltips were not
separately probed: fixed elements are unaffected by construction and in-place absolute ones fall under "Moved children".
