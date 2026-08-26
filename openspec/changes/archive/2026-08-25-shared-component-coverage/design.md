## Context

`frontend/src/shared/ui/TextField.tsx` is a thin `forwardRef` wrapper around a native `<input>`: it applies the
`ui-input` class (plus `ui-input--mono` when requested), merges any caller-supplied `className`, and forwards
every other `InputHTMLAttributes` prop (including `ref`, `value`, `onChange`, `aria-label`, etc.) straight through.
This makes the swap mechanical and low-risk **at the prop level** for the three files below — every prop each call
site passes is covered, and none of the three relies on an imperative `useRef` for focus (all three use the
declarative `autoFocus` attribute, which passes through `TextField`'s `...rest`).

**At the style level this is not a duplicate-removal exercise — `.ui-input`'s base rules actively contradict all
three local rulesets**, not merely overlap with them (round-1 design-gate skeptic finding, verified against
`frontend/src/shared/ui/inputs.css:1-66` and each local `.css` file):

| property | `.ui-input` base | `PanelCard` (`frontend/src/features/panels/ui/grid/PanelGrid.css:222-236`, `.panel-grid-card__title-input`) | `PipelineDetailFooter` (`PipelineDetailPage.css:579-591`, `.pipeline-detail-page__footer-output-input`) | `TypeDetailPanel` (`TypeDetailPanel.css:173-191`, `.type-detail-panel__name-input`) |
| --- | --- | --- | --- | --- |
| min-height | `--control-md` (32px) | none | none | none |
| width | `100%` | `100%` (matches — no diff) | none (intrinsic; flex item with no `flex`, sized by `width`) | `flex: 1` (basis 0; `width` inert) |
| padding | `0 var(--space-3)` | `2px 0` | `2px 6px` | `0.125rem 0.375rem` |
| background | `--app-surface-soft` | `transparent` | `--app-surface` | `transparent` |
| border | `1px solid --app-border-subtle` | `none` + `border-bottom: 1px solid var(--app-accent)` | `1px solid var(--app-accent-mid)` | `1px solid transparent` |
| font-size | `--text-sm` | `--text-sm` (matches — no diff, corrected from round-1's wrong "(inherits)") | `--text-sm` (matches) | `--text-base` |
| `:hover:not(:disabled)` (base is **(0,3,0)**, outranks a same-specificity local `:hover`) | `border-color: --app-border-strong` | none today (bare `<input>` has no hover rule) | none today | `border-color: --app-border-subtle; background: --app-surface-soft` (already matches local `:focus`, so functionally a no-op collision, not a new diff) |
| `:focus-visible` (base **(0,2,0)**) | `box-shadow: 0 0 0 3px --app-accent-dim` | `border-bottom-color: --app-accent-strong`, no `box-shadow` today | local uses `:focus` not `:focus-visible`, `border-color: --app-accent`, no `box-shadow` | local uses `:hover, :focus` combined, no `box-shadow` |
| `display`/`gap`/`line-height` | `flex; gap: --space-2; line-height: 1.4` | none declared (browser default `inline-block`, inherited line-height) | none declared | none declared |

`TextField` exposes exactly one modifier (`mono`) — no size or chrome-less variant. Per round-2 skeptic review, the
base `:hover`/`:focus-visible` **state** rules and the `display`/`width` layout properties are just as real a
contradiction source as the base-state properties round 1 caught, and are addressed explicitly below.

**Reconciliation (task requirement — recorded here per instruction, full reasoning also posted as Linear
comments on each ticket):**

- **HEL-725** (PageShell/PageHeader/PageStatus + route-container migration) — genuinely distinct. Targets
  page-level containers/headers/loading-state chrome for top-level routes. HEL-440 targets form-control/table/
  modal/menu primitives inside feature views. No overlap either direction; ships independently.
- **HEL-708** (inline-rename consolidation onto `SidebarItemList` + its decomposition) — real overlap on
  `frontend/src/features/dashboards/ui/DashboardList.tsx`'s rename input, which is also a raw-`<input>` rename
  control HEL-440's inventory found. HEL-708 already owns consolidating that exact interaction onto
  `SidebarItemList`'s `onRename` mechanism, including its own deliberate blur-semantics decision. **HEL-440
  excludes `DashboardList.tsx` entirely** rather than migrating it to bare `TextField` first and having HEL-708
  redo the same file. This slice's file list is limited to `PanelCard.tsx`, `PipelineDetailFooter.tsx`,
  `TypeDetailPanel.tsx` — none of which HEL-708 touches.
- **HEL-720** (TextSourceForm/PdfSourceForm/ImageSourceForm de-dup) — genuinely distinct. Structural
  de-duplication of three near-identical forms, not a raw-element swap; their raw `type="file"` inputs are a
  legitimate exception (no primitive covers file inputs). No overlap.

**Both-directions enumeration (full results, condensed — see the Planning-phase research for per-file detail):**
Raw `<select>`/`<textarea>` in `features/**`: zero hits (already fully migrated). Raw `<input>`: several
legitimate exceptions (`type="file"`, `type="checkbox"`, `type="color"`, `type="range"` — no primitive covers
these) plus four rename-shaped `TextField` candidates, of which this slice takes three (see above). Raw
`<table>` (12 files), ad-hoc dropdown/menu markup (17 files, largely unconfirmed grep hits), non-rename raw
`<input>` fields in editors/step-configs/settings, and two bespoke dialog/overlay surfaces
(`QuickLauncherOverlay.tsx`, `RefinementChatDrawer.tsx`) are all real candidates but require larger, separate
judgment calls — deferred to HEL-831 (table→DataGrid), HEL-832 (dropdown/menu triage), HEL-833 (remaining raw
inputs), HEL-834 (dialog/overlay review), HEL-835 (FormField adoption). HEL-836 files the missing repo-wide
mechanical raw-element guard (this change adds only a narrow guard scoped to its own three files, per its own
AC — the CI-wide version is out of scope here). Reverse direction: no orphaned primitive found — every
`shared/ui`/`shared/chrome` component has at least one real consumer.

## Goals / Non-Goals

**Goals:**
- Migrate the three in-scope hand-rolled rename `<input>` usages to `TextField`, with *behavior* preserved
  (value/onChange/blur/keyboard semantics unchanged) *and* current *visual appearance* preserved exactly (see
  Decisions — this is a zero-visual-diff migration, not a restyle).
- Add a narrow raw-element regression guard scoped to these three files' rename controls specifically.
- Confirm button/loading/empty/error states in the touched files already comply with DESIGN.md §5/§7 (no known
  violations found in these three files during Planning; verify, don't blindly rewrite).

**Non-Goals:**
- `DashboardList.tsx` (ceded to HEL-708).
- Any of the six deferred-scope areas (tables, menus, remaining inputs, dialogs, FormField adoption, CI-wide
  guard) — filed as HEL-831 through HEL-836.
- Introducing a new shared `Button` component.

## Decisions

- **Visual outcome: all three controls keep their exact current chrome-less/compact appearance — this is
  explicitly not a restyle.** Rejected the alternative (let `TextField`'s boxed `--control-md` styling win,
  treating the visual change as an accepted side effect) because none of the three controls is a standard-height
  boxed form field today (all are inline, in-place rename affordances embedded in a title/header row — a
  `panel-grid-card` title, a footer output name, a detail-panel header name), and DESIGN.md §6/the ticket's own
  Scope require *behavior-preserving* migration, which this design reads as covering rendered appearance for a
  pure primitive swap, not just JS behavior.
- **Mechanism: raise the local class to a compound selector so it deterministically wins over `.ui-input`,
  independent of stylesheet bundle order — applied to base state AND to the `:hover`/`:focus`/`:focus-visible`
  state rules, since `.ui-input:hover:not(:disabled)` is specificity **(0,3,0)** and `.ui-input:focus-visible` is
  **(0,2,0)**, both of which outrank a same-specificity bare local state selector.** `TextField` renders
  `class="ui-input <local-class>"`. Full CSS per file (round-2 revision — corrects round-1's base-state-only
  plan, which left the shared focus halo, hover recolor, and footer-input full-width stretch as unaddressed
  regressions):

  **`PanelGrid.css` (full path `frontend/src/features/panels/ui/grid/PanelGrid.css`) — replace lines 222-236:**
  ```css
  .ui-input.panel-grid-card__title-input {
    display: inline-block;
    min-height: auto;
    gap: 0;
    width: 100%;
    padding: 2px 0;
    border: none;
    border-bottom: 1px solid var(--app-accent);
    border-radius: 0;
    background: transparent;
    color: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    line-height: inherit;
  }

  .ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus) {
    border-color: transparent;
    border-bottom-color: var(--app-accent);
  }

  .ui-input.panel-grid-card__title-input:focus-visible {
    outline: none;
    box-shadow: none;
    border-bottom-color: var(--app-accent-strong);
  }
  ```

  **`PipelineDetailPage.css` — replace lines 579-591:**
  ```css
  .ui-input.pipeline-detail-page__footer-output-input {
    display: inline-block;
    min-height: auto;
    gap: 0;
    width: auto;
    background: var(--app-surface);
    border: 1px solid var(--app-accent-mid);
    border-radius: var(--app-radius-sm);
    color: var(--app-text);
    font-size: var(--text-sm);
    padding: 2px 6px;
    line-height: inherit;
    outline: none;
  }

  .ui-input.pipeline-detail-page__footer-output-input:hover:not(:disabled):not(:focus) {
    border-color: var(--app-accent-mid);
  }

  .ui-input.pipeline-detail-page__footer-output-input:focus,
  .ui-input.pipeline-detail-page__footer-output-input:focus-visible {
    outline: none;
    box-shadow: none;
    border-color: var(--app-accent);
  }
  ```
  (`width: auto` matches today's intrinsic sizing inside `.pipeline-detail-page__footer-left`'s
  `display: flex; flex-wrap: wrap` — `.ui-input`'s `width: 100%` would otherwise become the flex base size and
  stretch/wrap the row, per round-2 CR 2.)

  **`TypeDetailPanel.css` — replace lines 173-191:**
  ```css
  .ui-input.type-detail-panel__name-input {
    display: inline-block;
    min-height: auto;
    gap: 0;
    width: auto;
    flex: 1;
    min-width: 0;
    font-size: var(--text-base);
    font-weight: var(--weight-semibold);
    color: var(--app-text);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--app-radius-sm);
    padding: 0.125rem 0.375rem;
    line-height: inherit;
    outline: none;
  }

  .ui-input.type-detail-panel__name-input:hover:not(:disabled),
  .ui-input.type-detail-panel__name-input:focus,
  .ui-input.type-detail-panel__name-input:focus-visible {
    outline: none;
    box-shadow: none;
    border-color: var(--app-border-subtle);
    background: var(--app-surface-soft);
  }
  ```

  `display: inline-block` (reset from `.ui-input`'s `display: flex; align-items: center; gap: --space-2`) is a
  deliberate, stated disposition, not an oversight: none of the three inputs render an icon or secondary child
  node, so `flex` vs `inline-block` produces no visible difference for a lone text node — but the property is
  real and round-2 CR 2 is right that it must be dispositioned explicitly rather than left silent. `inline-block`
  (not `block`) matches a native `<input>`'s own default display, avoiding an unintended full-line-box change.
  `line-height: inherit` (not a literal `normal`) is used per round-3 review: `frontend/src/theme/theme.css:271-277`
  applies `font: inherit` (which includes `line-height`) to every `input` element repo-wide, so the pre-migration
  line-height was already inherited from each input's ancestor, not the UA-default `normal` — `line-height: inherit`
  reproduces that exactly, while a literal `normal` would not if any ancestor's line-height differs from `normal`.
- **Explicit decision: do not extend `TextField` with a new chrome-less/inline variant in this slice.** The
  ticket's Scope says extend a primitive when it's "genuinely missing a capability" rather than fork it — but a
  compound-selector override is not a fork of the component (call sites still render the real `TextField`, get
  its focus ring, aria-invalid styling, and any future base-class fixes for free); it is a scoped, standard CSS
  override for three specific call sites whose existing look predates this migration and is out of this ticket's
  scope to redesign. Introducing a new `variant="inline"` prop now would be a second, un-reviewed design surface
  (its own default styling, its own future consumers) for a one-slice need — deferred to whichever future ticket
  actually wants a reusable chrome-less `TextField` for more than three call sites. Recorded here per CR 3 rather
  than left silent.
- **Guard test scope, narrowed per CR 4.** Rather than asserting no raw `<input>` at all in each component's
  rendered output (unsatisfiable — `TypeDetailPanel.tsx` unconditionally renders per-field
  `<input type="checkbox">` controls, a legitimate exception no primitive covers), the guard asserts specifically
  that **the element with the rename control's accessible name** (`aria-label="Panel title"` /
  `aria-label="Pipeline name"` / `aria-label="Data type name"` — verified directly against
  `PanelCard.tsx:236`, `PipelineDetailFooter.tsx:147`, `TypeDetailPanel.tsx:119`) carries `TextField`'s
  `ui-input` class. `PipelineShareDialog.test.tsx` is prior art for this exact assertion shape — read it before
  writing task 2.1.

  Non-blocking, noted per round-2 review: `TypeDetailPanel.tsx:157` also renders a raw
  `<input aria-label={`Display name for ${field.name}`}>` — a plain text input `TextField` genuinely covers, but
  left raw here and deferred to HEL-833 (it is a per-field, not the file's own name control, and out of this
  slice's bounded scope). The guard spec's carve-out language already covers it as an "other raw `<input>`
  element" not asserted against.
- **No new capability beyond the guard.** The proposal's only `New Capability` is `raw-element-guard`; everything
  else is implementation detail of already-specified components (`panel-title-edit`, pipeline output naming,
  data-type CRUD) whose external behavior does not change.

## Risks / Trade-offs

- `TextField` forwards `ref`; verified none of the three call sites relies on `useRef<HTMLInputElement>` for
  imperative focus — all three use the declarative `autoFocus` attribute, which passes through `TextField`'s
  `...rest`. Low risk, already ruled out; no per-file check needed at execution time.
- The compound-selector approach means each local `.css` file still exists and still carries real declarations
  (this is not primitive-adoption in the "delete all local CSS" sense) — the primitive-adoption benefit here is
  the shared focus ring, aria-invalid styling, disabled styling, and hover/base behavior `TextField`/`.ui-input`
  defines once, plus closing the raw-`<input>`-in-`features/` gap the ticket's AC targets, not a CSS reduction.
  This is a real, bounded trade-off worth stating plainly rather than implying full CSS consolidation.
