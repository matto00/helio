## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/raw-element-guard/spec.md`, plus round 1's `skeptic-design-1.md`.
- `frontend/src/shared/ui/inputs.css:1-66` re-read in full. Base `.ui-input` sets, beyond the
  properties design.md's table lists: `display: flex`, `align-items: center`, `gap: --space-2`,
  `width: 100%`, `border-radius: --app-radius-sm`, `color: --app-text`, `line-height: 1.4`,
  `transition`. Plus three **state** rules: `.ui-input:hover:not(:disabled) { border-color:
  --app-border-strong }` (specificity **(0,3,0)**), `.ui-input:focus-visible { outline: none;
  border-color: --app-accent; box-shadow: 0 0 0 3px --app-accent-dim }` (**(0,2,0)**), and
  `:disabled`.
- The three local rulesets re-read at ground truth:
  - `frontend/src/features/panels/ui/grid/PanelGrid.css:222-236` — note the path: it is
    `ui/grid/PanelGrid.css`, not `ui/PanelGrid.css`. Declares `width: 100%`, `background:
    transparent`, `border: none`, `border-bottom: 1px solid var(--app-accent)`, `color: inherit`,
    **`font-size: var(--text-sm)`**, `font-weight: var(--weight-semibold)`, `padding: 2px 0`; plus
    `:focus-visible { outline: none; border-bottom-color: var(--app-accent-strong) }`.
  - `frontend/src/features/pipelines/ui/PipelineDetailPage.css:579-591` — no `width` declared;
    `:focus { border-color: var(--app-accent) }`.
  - `frontend/src/features/dataTypes/ui/TypeDetailPanel.css:173-191` — `flex: 1`, plus
    `:hover, :focus { border-color: var(--app-border-subtle); background: var(--app-surface-soft) }`.
- Containers: `.pipeline-detail-page__footer-left` (`PipelineDetailPage.css:544`) is
  `display: flex; flex-wrap: wrap`, and the input is a plain flex item (`flex` not declared) — so
  its main size comes from `width`. `.type-detail-panel__header` (`TypeDetailPanel.css:12`) is
  flex and the input declares `flex: 1` (basis 0), so `width: 100%` is inert there.
- Accessible names verified in the TSX: `PanelCard.tsx:236` `"Panel title"`,
  `PipelineDetailFooter.tsx:147` `"Pipeline name"`, `TypeDetailPanel.tsx:119` `"Data type name"`.
  The spec and `tasks.md` use exactly these. `TypeDetailPanel.tsx:181` is the per-field
  `type="checkbox"` the spec carves out.
- **Round-1 CR 4 (guard spec) is resolved.** The narrowed scenario queries by the rename control's
  accessible name and explicitly carves out unrelated raw inputs — satisfiable against the real
  render tree. CR 3 (no new `TextField` variant) and CR 5 (falsified claims scoped to props) are
  also properly resolved. CR 1/2/6 are resolved *in approach* but incompletely *in content* — below.

### Verdict: REFUTE

The compound-selector mechanism is sound: `.ui-input.<local-class>` is (0,2,0) and deterministically
beats `.ui-input` (0,1,0) regardless of bundle order. But the plan applies it **only to base-state
declarations**, and the per-file property lists in tasks 1.1–1.3 are incomplete against what
`.ui-input` actually sets. Under this design's own binding standard — "zero visual diff, any visible
difference is a defect" — an executor following tasks.md literally will ship visible changes on all
three controls (a new 3px focus halo on every one, a hover border-color change on all three, and a
full-width stretch of the pipeline footer input). These are specific, small edits to the artifacts.

### Change Requests

1. **The pseudo-class state rules are entirely unaddressed and will produce a guaranteed visual
   diff on all three controls.** `.ui-input:focus-visible` (0,2,0) adds `box-shadow: 0 0 0 3px
   var(--app-accent-dim)`; none of the three local rules declares `box-shadow`, so the halo appears
   no matter what the base-state override does. And `.ui-input:hover:not(:disabled)` is **(0,3,0)**
   — it outranks even a promoted `.ui-input.type-detail-panel__name-input:hover` (0,3,0 tie →
   order-dependent) and today's bare `.panel-grid-card__title-input:focus-visible` /
   `.pipeline-detail-page__footer-output-input:focus` (0,2,0) outright. Concretely:
   `PanelGrid.css`'s accent `border-bottom` recolors to `--app-border-strong` on hover;
   `PipelineDetailPage.css`'s `--app-accent-mid` border recolors on hover; `TypeDetailPanel.css`'s
   `:hover` `--app-border-subtle` loses to `--app-border-strong`. Add to design.md's Decisions and
   to each of tasks 1.1–1.3 an explicit rule for the **state** selectors too — promote each local
   `:hover`/`:focus`/`:focus-visible` rule to the same compound form, declare `box-shadow: none`
   (or the current appearance) where today there is none, and raise specificity past `(0,3,0)` for
   hover (e.g. `.ui-input.<local>:hover:not(:disabled)`). Alternatively decide explicitly that the
   shared focus ring is a *wanted* change — but then "zero visual diff" and task 3.4's
   "no visible change at all" must be amended to say so, and it must be stated per file.

2. **Task 1.2 omits `width`, which is a real layout change.**
   `.pipeline-detail-page__footer-output-input` declares no `width` today, so as a flex item in
   `.pipeline-detail-page__footer-left` (`display: flex; flex-wrap: wrap`, input has no `flex`) it
   is intrinsically sized. `.ui-input` sets `width: 100%`, which becomes the flex base size and
   stretches/wraps the row. Add `width: auto` (matching current behavior) to task 1.2's
   re-declaration list. Also state per file whether `.ui-input`'s `display: flex` needs resetting
   to `inline-block`: it is inert for the two inputs already inside flex containers, but it is a
   property the plan never mentions and should be dispositioned, not discovered at screenshot time.

3. **design.md's contradiction table is factually wrong for `PanelCard` and must be corrected —
   downstream agents will trust it over the CSS.** It lists `PanelCard` font-size as "(inherits)";
   `PanelGrid.css:227` in fact declares `font-size: var(--text-sm)`, identical to the base, so
   there is no contradiction on that row. The table also omits that `PanelGrid.css:223` already
   declares `width: 100%` (unlike the other two files) — the one row where the files genuinely
   differ from each other on a property `.ui-input` sets.

4. **Task 1.1 names the wrong token for the underline.** It instructs re-declaring
   `border-bottom: 1px solid var(--app-accent-mid)` "(verify current accent token)"; the actual
   value at `PanelGrid.css:225` is `var(--app-accent)`, and its `:focus-visible` override is
   `--app-accent-strong`. Under "do not change any other visual property," a literal read of this
   task ships a recolored underline. Write the verified values in, don't leave a "verify" note.

5. **The file path `PanelGrid.css` is wrong in design.md/tasks.md.** The real file is
   `frontend/src/features/panels/ui/grid/PanelGrid.css` (`ui/PanelGrid.css` does not exist). Task
   1.1 says only "In `PanelGrid.css`"; give the full path as the other two tasks do.

6. **design.md's Decisions still cite a stale, unverified aria-label.** The guard-scope decision
   reads `aria-label="Pipeline output name"` (verify exact string in `PipelineDetailFooter.tsx`)`,
   while the spec and tasks.md correctly use the verified `"Pipeline name"`
   (`PipelineDetailFooter.tsx:147`). Fix the design.md string and drop the "verify" parenthetical,
   so the three artifacts do not disagree on the value the guard test asserts.

### Non-blocking notes

- `TypeDetailPanel.tsx:157` renders a raw `<input aria-label={`Display name for ${field.name}`}>`
  — a plain text input that `TextField` *does* cover, left raw and deferred to HEL-833. The spec's
  carve-out language ("other raw `<input>` elements ... e.g. per-field `type="checkbox"`") does
  cover it, so the guard stays satisfiable; but design.md's deferral paragraph would be more honest
  naming this one explicitly, since it sits in a file this slice is already editing.
- Round 1's environmental note still holds: this worktree's `scripts/concertino/` predates
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`; I used the main-repo copies
  pointed at this change directory. A `concertino sync` on this branch before the final gate would
  remove the workaround.
- The reconciliation section (HEL-725 / HEL-708 / HEL-720) and the guard-scope narrowing are solid
  and unchanged from round 1's assessment — no further objection there.
