## Evaluation Report — Cycle 1

**Note on provenance:** This cycle's evaluator run was interrupted mid-UI-phase by a session
limit and re-instantiated. No prior report existed; the full three-phase evaluation below was
performed fresh in this session (static gates re-run, live browser verification done from
scratch). Leftover `.playwright-mcp/*.png` files from the earlier interrupted run were treated as
untrusted and not relied upon.

### Phase 1: Spec Review — FAIL

Issues:

- **AC2 ("No broken or misleading edit affordance … every reachable edit path works end-to-end
  with ≥44px targets") is violated.** Live measurement (`getBoundingClientRect`, 390×844) of the
  Chart Display section in `PanelDetailModal` — reachable by tapping any Chart-kind panel (bar,
  line, pie, scatter all share this UI) and pressing Edit — found four checkbox rows
  (`.panel-detail-modal__chart-label`: "Show legend", "Enable tooltip", "Show X-axis label", "Show
  Y-axis label") rendering at **~19px tall** (checkbox itself 13×13px), well under the 44px
  minimum. This selector is **not** in the 768px media block added by this ticket or by any prior
  HEL-245/248/247/255 cycle — confirmed by reading `PanelDetailModal.css:582-829` and
  `PanelDetailModal.css.test.ts`. The executor's files-modified.md and tasks.md both assert this
  surface was "already covered … verify, don't redo," but the static (browser-less) audit did not
  catch this real gap. See Phase 3 for full measurements.
- Secondary, same-file, same-flow finding: `.panel-detail-modal__color-swatches input[type="color"]`
  (the 7 Series-color swatches, also in the Chart Display section) render at **32×28px**, also under
  44px. Native color inputs behave differently across mobile browser engines, so this is a softer
  finding than the checkbox rows, but it sits in the same reachable flow and the same touched file.
- All other ACs verified PASS with fresh live evidence (see Phase 3): sheet-row 44px minimum (AC1),
  panel-kind sweep incl. collection with real multi-row data (AC3), token compliance of the diff's
  new rules (AC4), and the HEL-301/304 byte-identity guard (AC5 — zero `PATCH /api/dashboards/:id`
  observed across all browsing + content-edit + config-edit flows tested).
- No scope creep: diff is limited to the three named files + their CSS-lock tests, matches
  proposal/design/tasks. Planning artifacts (proposal.md, design.md, tasks.md, specs deltas) are
  internally consistent with the implemented diff.
- The collection-panel collapse bug found and fixed by the executor (container-type/height
  override + nested-scroller removal) is a legitimate, well-scoped, evidence-gated CSS fix per
  Decision 3/4 of design.md — verified live with real multi-row data in Phase 3, works correctly.

### Phase 2: Code Review — PASS (with one note)

Issues: none blocking.

- Diff is small, focused, mirrors the established `@media (max-width: 768px) { … min-height: 44px }`
  pattern exactly (`MobileNavSheet.css:151-157`, `PanelDetailModal.css:623-640`). No new tokens, no
  new breakpoints (canonical 768px only). No hardcoded colors introduced.
- CSS-lock tests (`MobileNavSheet.css.test.ts`, extensions to `PanelDetailModal.css.test.ts` /
  `MobilePanelStack.css.test.ts`) are well-commented, explain *why* jsdom can't render-test this
  (no real layout/containment), and mirror the existing `findMediaBlock`/`findRuleBody` scan
  approach — no reinvention.
- `MobilePanelStack.css` collection fix (`--collection` added to the intrinsic-height override
  list + `.panel-content--collection` intrinsic-sizing rule) is behavior-preserving for every other
  kind (verified: table/markdown/text/image entries unchanged in the diff) and the root-cause
  writeup in files-modified.md is a genuine probe-confirmed diagnosis (container-type: size on an
  auto-height ancestor), not a guess.
- File-size note (non-blocking): `PanelDetailModal.css` is now 1024 lines (was ~1006 pre-diff),
  well over CONTRIBUTING.md's ~400-line "propose a split" threshold. This is pre-existing debt the
  ticket incrementally added 18 lines to, not a new violation introduced by this diff; the
  executor already flagged the broader spacing-token debt in the same file as a spinoff candidate.
  Recommend folding a "propose a file split" note into that same spinoff.
- No dead code, no untyped escape hatches, no security/error-handling surface (CSS + test files
  only). Tests added are meaningful for what they lock, but see Phase 1 — the audit that produced
  them had a real completeness gap (missed the chart-label/color-swatch controls).

### Phase 3: UI Review — FAIL

Servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both PASS,
reused already-healthy instances on 5476/8383.

**Gates re-run fresh (this session):**
- `npm run lint` — clean (0 warnings)
- `npm run format:check` — clean
- `npm test` (full suite) — 103 suites / 1106 tests passed
- Targeted rerun (`MobileNavSheet|PanelDetailModal|MobilePanelStack|mobilePanelHeights|dashboardLayout`) — 15 suites / 167 tests passed

**AC1 — MobileNavSheet ≥44px (PASS).** Measured via `getBoundingClientRect` at 390×844, both
themes:
- `/` dashboard-switcher sheet: 18 rows, all exactly 44.0px (light + dark)
- `/sources` section sheet: 21 rows, min/max 44.0px
- `/pipelines` section sheet: 9 rows, min/max 44.0px
- `/registry` section sheet: 38 rows, min/max 44.0px

**AC2 — Edit-affordance audit (FAIL).** On the "HEL-303 Panel Kind Sweep" dashboard (real seeded
data, Netflix pipeline output):
- Header `Edit` (`.panel-detail-modal__edit-btn`): 47.4×44px — PASS
- Header `Close` (`.panel-detail-modal__close`): 44×44px — PASS
- Footer `Cancel`/`Save` (`.panel-detail-modal__btn`): 79.8×44 / 66.1×44px — PASS
- Table config controls (density trigger, column row, move button): all ≥44px — PASS
- Chart Display checkboxes (`.panel-detail-modal__chart-label`, present for every chart type —
  confirmed identical markup opening a newly-created Pie chart panel): **label rect 19px tall,
  checkbox 13×13px** — **FAIL**, real touch-target violation
- Series-color swatches (`input[type="color"]`): 32×28px — secondary finding, see Phase 1
- End-to-end persistence verified twice at 390px, network-captured: (1) content edit — renamed
  "Metric Collection" panel title → `POST /api/panels/updateBatch` (200) → reload → title
  persisted, zero `PATCH /api/dashboards/:id`; (2) config edit — Table cell density Normal →
  Condensed → `PATCH /api/panels/:id` (200) → reload → "Condensed" persisted, zero dashboard PATCH.
- No drag/resize/layout affordance found anywhere in the stack or modal — confirmed by DOM
  inspection, matches executor's claim.
- Non-blocking, out-of-scope note: found a **pre-existing, unrelated stale-form-state bug**
  (opening panel B's edit form while panel A's edit form was still mounted showed panel A's stale
  title value under panel B's correct dialog `aria-label`) — reproduced once via rapid panel
  switching without closing the modal first, did not reproduce with a normal open→close→reopen
  flow. This is pre-existing PanelDetailModal state-management behavior untouched by this diff —
  reporting as a spinoff candidate, not a blocker for this style-only change.

**AC3 — Panel-kind sweep (PASS).** All 10 kinds present across seeded dashboards checked at
390×844, both themes, via `getBoundingClientRect`/`scrollWidth` (no visual eyeballing):
Metric, Text, Markdown, Image, Table, Chart (bar ×3, line; pie created live via Add Panel to
confirm the shared Chart Display UI — the checkbox gap above reproduces identically), Collection.
Zero horizontal overflow on any panel (`scrollWidth ≤ clientWidth` for every item, and
`document.body.scrollWidth === window.innerWidth === 390` throughout). Collection verified with
real multi-row data (5-item Netflix metric-collection, both `-list` and `-grid` variants present):
`rectHeight === scrollHeight` for both (313px / 341px), `overflow-y: visible`, no internal
scroller, item grid computed a single 257px column at this content width with no clipping — the
executor's collapse fix works correctly live.

**AC4 — Token compliance (PASS).** New rules added by this diff use only the sanctioned literal
`44px` tap-target convention (per design.md Decision 5) — no hex/rgb colors, no non-canonical
breakpoints (768px only, matches DESIGN.md §4). Did not re-audit `PanelDetailModal.css`'s
pre-existing broad spacing debt (out of scope per the executor's own spinoff note and this
ticket's own framing that pre-existing debt in untouched rules is not a cycle FAIL).

**AC5 — Layout byte-identity (PASS).** Explicit network capture across: browsing dashboards/routes
with no edits, one content-edit save, one config-edit save — zero `PATCH /api/dashboards/:id`
requests in any case (filtered network log, `dashboards/[a-f0-9-]+$` matched nothing).

**Breakpoint sweep (PASS).** 1440 / 1100 / 768 / 430 all screenshotted — no layout breakage, no
horizontal scrollbars, desktop grid at 1440/1100, mobile stack + bottom nav at 768/430.

**Console (PASS).** Zero console errors across the entire session (only 4 pre-existing
`selectPipelineOutputDataTypes` memoization warnings, unrelated to this diff, in an unrelated
selector file — not touched by this change).

### Overall: FAIL

### Change Requests

1. In `frontend/src/features/panels/ui/PanelDetailModal.css`, add
   `.panel-detail-modal__chart-label` to the existing `@media (max-width: 768px)` block (around
   line 682, alongside the HEL-248 `.panel-detail-modal__toggle-row` rule it sits next to in the
   Chart Display section) with `min-height: 44px;` (and `align-items: center` is already present
   on the base rule, so the label's own flex row will meet the tap minimum). This fixes the "Show
   legend" / "Enable tooltip" / "Show X-axis label" / "Show Y-axis label" checkboxes, which are
   reachable in every chart panel's edit flow (bar/line/pie/scatter all share this markup) and
   currently measure ~19px.
2. Extend `PanelDetailModal.css.test.ts`'s HEL-248 (or a new HEL-303) describe block with a lock
   for `.panel-detail-modal__chart-label` `min-height: 44px`, mirroring the existing
   `toggle-row`/`slider` assertions at lines 132-138.
3. Decide and implement (or explicitly document as an accepted exception) sizing for
   `.panel-detail-modal__color-swatches input[type="color"]` (currently 32×28px) at the 768px
   breakpoint — e.g. `min-width: 44px; min-height: 44px;` on the input, adjusting
   `.panel-detail-modal__color-swatches` gap/wrap if needed to avoid crowding. If the team decides
   native color-input tap behavior is an acceptable exception (platform-native controls often have
   larger effective hit areas than their CSS box), say so explicitly in files-modified.md rather
   than leaving it silent.
4. Re-verify both fixes live at 390×844 (both themes) with `getBoundingClientRect` before
   resubmitting, the same way this evaluation did — a static/jsdom check will not catch this class
   of defect (it did not catch it the first time either).

### Non-blocking Suggestions

- Report the stale-form-state bug (PanelDetailModal shows the previously-open panel's title value
  when jumping directly from one panel's open edit form to another without closing first) as a
  spinoff candidate — pre-existing, behavioral, out of this style-only ticket's scope.
- Fold a "propose a file split" note for `PanelDetailModal.css` (1024 lines, well over the
  ~400-line CONTRIBUTING.md soft-budget threshold) into the spacing-token-debt spinoff already
  recommended in files-modified.md.
- Consider whether the shared `ui-select` popover's option rows (34px, seen via the Table density
  dropdown) should get a similar mobile-scoped 44px treatment in a future ticket — it's a shared
  component outside this ticket's touched-file scope, so not a blocker here, but it's the same
  class of defect and reachable in the same edit flows this ticket audited.
