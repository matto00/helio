## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read fresh: `skeptic-design-1.md`, `skeptic-design-2.md`, `design.md`, `tasks.md`, and the four
  live CSS files plus `PanelCard.tsx:229-240`, `PipelineDetailFooter.tsx:143-151`.
- **Round-2 CRs 2-6 are resolved.** Verified individually: `PanelGrid.css:225` is
  `var(--app-accent)` and design.md/tasks.md now say so; the full path
  `frontend/src/features/panels/ui/grid/PanelGrid.css` is used in both artifacts; the table's
  PanelCard font-size row now reads `--text-sm` (matches `PanelGrid.css:227`) and the `width: 100%`
  row is present; design.md's guard decision now says `aria-label="Pipeline name"`, matching
  `PipelineDetailFooter.tsx:147` verbatim; `TypeDetailPanel.tsx:157` is named explicitly as the
  HEL-833 deferral. `width: auto` is present in both the pipeline and type blocks.
- **No other selectors target the three classes anywhere.** `grep -rn` over `frontend/src` returns
  only: `PanelGrid.css:222` + `:233`, `PipelineDetailPage.css:579` + `:589`,
  `TypeDetailPanel.css:173` + `:187-188`, and the three TSX `className` sites. No media-query,
  descendant, or sibling variants exist — the line ranges in tasks 1.1-1.3 (222-236 / 579-591 /
  173-191) exactly cover every rule for each class. `inputs.css`'s only media block
  (`@media (max-width: 768px)`) touches `.ui-select__option` / `.ui-select__trigger` only, never
  `.ui-input`. **This question is fully cleared.**
- **Specificity math is correct on every rule.** Base `.ui-input.<local>` = (0,2,0) beats
  `.ui-input` (0,1,0). `.ui-input.<local>:hover:not(:disabled)` = (0,4,0) beats
  `.ui-input:hover:not(:disabled)` (0,3,0) — `:not()`'s argument contributes, so this clears the
  (0,3,0) tie round 2 flagged. `.ui-input.<local>:focus-visible` and `:focus` = (0,3,0) beat
  `.ui-input:focus-visible` (0,2,0). Every new rule deterministically wins independent of bundle
  order. **This question is cleared.**
- **The CSS parses.** All eleven referenced custom properties (`--app-accent`, `--app-accent-mid`,
  `--app-accent-strong`, `--app-border-subtle`, `--app-surface`, `--app-surface-soft`,
  `--app-radius-sm`, `--text-sm`, `--text-base`, `--weight-semibold`, `--app-text`) are defined in
  `theme/theme.css`. Balanced braces, valid declarations, valid comma-grouped selector lists. No
  syntax defect. **This question is cleared.**
- Container facts re-confirmed at ground truth: `.pipeline-detail-page__footer-left`
  (`PipelineDetailPage.css:544-549`) is `display: flex; flex-wrap: wrap` with the input carrying no
  `flex` — so `width: auto` is the right preservation. `.type-detail-panel__header`
  (`TypeDetailPanel.css:12-17`) is flex and the input keeps `flex: 1; min-width: 0`. Correct.
- **New finding — `frontend/src/theme/theme.css:271-277`:**
  ```css
  body, button, input, textarea, select { font: inherit; }
  ```
  This global reset is not mentioned anywhere in design.md, and it changes what "current
  appearance" actually is for two of the properties the new rules declare.

### Verdict: REFUTE

Two of the three questions I was asked (other selectors, specificity, parse-validity) come back
clean, and rounds 1-2's CRs are all genuinely resolved. But the round-2 revision derived the
"current appearance" baseline for `line-height` and `display` from the *user-agent* defaults rather
than from `theme.css:271-277`'s `input { font: inherit }` reset. Both new values are therefore
wrong, and both produce a measurable height change on controls whose stated acceptance bar
(task 3.4) is "no visible change at all". These are not cosmetic nits I can leave to executor
judgment: design.md is declared the source of truth and tasks 1.1-1.3 say "do not improvise", so an
executor following the plan literally ships the regression. Both fixes are one-word edits.

### Change Requests

1. **`line-height: normal` is wrong in all three blocks — it must be `line-height: inherit`.**
   `theme.css:271-277` applies `font: inherit` to every `input`; the `font` shorthand resets
   `line-height`, so today's three raw inputs compute `line-height: inherit` (1.5 from the body
   chain), **not** the UA `normal`. `.ui-input` sets `1.4`, and the new rules specify `normal`
   (~1.2). At `--text-sm` (14px) that is a content-box height of 21px today vs ~16.5px as
   specified — roughly a 4-5px shrink on each control, which shifts the panel-card title row, the
   pipeline footer row, and the type-detail header. Change `line-height: normal` to
   `line-height: inherit` in all three CSS blocks in design.md's Decisions section
   (`PanelGrid.css`, `PipelineDetailPage.css`, `TypeDetailPanel.css`).

2. **`display: block` should be `display: inline-block` — same root cause, same baseline error.**
   design.md's disposition paragraph reasons that "`flex` vs `block` produces no visible difference",
   but the baseline to preserve is neither: today's inputs are the UA default `inline-block`. For
   `.panel-grid-card__title-input` this matters — its parent `.panel-grid-card__title-area`
   (`PanelGrid.css:210-213`) is a block container, so the input currently sits in a line box and
   contributes the inline-block baseline/descender gap to the parent's height; `display: block`
   removes it (a few px of vertical shift). `inline-block` is safe in all three files: the pipeline
   and type inputs are flex items, where `inline-block` is blockified to `block` anyway — exactly as
   their raw `inline-block` is today. Update the value in all three blocks and amend the
   disposition paragraph to state the real baseline (UA `inline-block` under `theme.css`'s
   `font: inherit`), not "flex vs block".

Everything else in the three CSS blocks I traced declaration-by-declaration against the live rules
and found correct — including the non-obvious ones: `PanelGrid`'s hover override
(`border-color: transparent; border-bottom-color: var(--app-accent)`) correctly re-restores the
underline after the shorthand reset; `border-radius: 0` is inert-but-harmless under `border: none`;
`box-shadow: none` under `:focus` (a superset of `:focus-visible`) does suppress the shared halo;
and `min-height: auto` is safe on both flex items.

### Non-blocking notes

- design.md's Risks section says the adoption benefit includes "the shared focus ring" — but the
  design deliberately suppresses it (`box-shadow: none`) on all three controls. The sentence
  overstates what is actually gained; the real benefits listed after it (disabled styling,
  `aria-invalid`, future base fixes) do hold. Worth a one-clause correction, not a blocker.
- `.ui-input` adds `transition: border-color, box-shadow, background-color`. `PanelGrid` and the
  pipeline footer input have no transition today, so focus/hover will animate where it previously
  snapped. A motion difference, not a static-screenshot difference; I do not consider it a defect
  under this ticket's bar, but task 3.4's reviewer should expect it rather than treat it as a
  regression.
- `.ui-input[aria-invalid="true"]` is (0,2,0) — a source-order tie with the new base rules. None of
  the three call sites passes `aria-invalid`, so this is inert today; flagging only so a future
  ticket adding validation to these controls knows the tie exists.
- Round 1/2's environmental note still holds: this worktree's `scripts/concertino/` predates
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`; I used the main-repo copies
  pointed at this change directory.
