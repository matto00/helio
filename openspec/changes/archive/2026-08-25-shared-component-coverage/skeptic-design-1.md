## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/raw-element-guard/spec.md`, `workflow-state.md`.
- **`TextField` prop surface** (`frontend/src/shared/ui/TextField.tsx`, read in full): it is a
  `forwardRef<HTMLInputElement, TextFieldProps>` over a native `<input>`, spreading `...rest` of
  `Omit<InputHTMLAttributes<HTMLInputElement>, "type">` plus a narrowed `type` union and a `mono` flag.
  **Prop-level claim CONFIRMED** — every prop the three call sites pass is covered.
- **The three call sites, read directly**:
  - `PanelCard.tsx:231-240` — `className`, `type="text"`, `value`, `autoFocus`, `aria-label`,
    `onChange`, `onKeyDown`, `onBlur`.
  - `PipelineDetailFooter.tsx:144-151` — `className`, `value`, `aria-label`, `onChange`, `onBlur`,
    `autoFocus` (no explicit `type` — `TextField`'s `"text"` default matches).
  - `TypeDetailPanel.tsx:116-124` — `type="text"`, `className`, `aria-label`, `value`, `onChange`.
  - **Ref-forwarding concern is moot**: `grep -n "useRef|Ref<|focus"` shows *none* of the three uses an
    imperative `useRef<HTMLInputElement>` for focus. All three use the declarative `autoFocus`
    attribute, which passes straight through `...rest`. (`TypeDetailPanel`'s only `useRef` is
    `previewRequestIdRef`, a number, unrelated to the input.) design.md's stated risk is real in
    principle but does not apply to any of these three files.
- **`DashboardList.tsx` exclusion**: verified via `grep -n "<input"` that the file has exactly two raw
  inputs — line 253 (`type="file"`, a legitimate exception) and line 332
  (`dashboard-list__rename-input`, the rename control). Its *create*-name field (line ~235) **already
  uses `TextField`**. Fetched HEL-708 from Linear: its Scope literally reads "Consolidate
  `DashboardList.tsx`'s dashboard-rename onto `SidebarItemList`'s `onRename` mechanism; delete the
  duplicated implementation," including a deliberate blur-semantics decision. **The cede is sound and
  not silently required** — none of the three in-scope files touch `SidebarItemList`, and the three
  ACs this slice claims are satisfiable without `DashboardList.tsx`.
- **Deferred-scope tickets are real, not asserted**: fetched HEL-833 from Linear — it exists, is
  parented under HEL-346, and carries a concrete per-file enumeration and a triage rule. design.md's
  deferral paragraph is backed by filed work, with reasoning ("require larger, separate judgment
  calls"), not a bare assertion.
- **`DESIGN.md` §6 read (lines 323-346)**: confirms `TextField` is canonical, "do not hand-roll
  equivalents", tagged `[mechanical]` + `[judgment]`. **No borderless/inline exception clause exists**,
  and no `TextField` size or chrome-less variant is documented.
- **`frontend/src/shared/ui/inputs.css` base `.ui-input` rules read (lines 1-66)**: `min-height:
  var(--control-md)`, `width: 100%`, `padding: 0 var(--space-3)`, `border: 1px solid
  var(--app-border-subtle)`, `background: var(--app-surface-soft)`, `font-size: var(--text-sm)`, plus
  hover/focus/disabled/aria-invalid states. Only modifier present: `.ui-input--mono` (line 66) — **no
  size or bare/inline variant**. `--control-md: 32px` (`frontend/src/theme/theme.css:60`).
- **The three existing local CSS rules read** — this is where the design breaks (see CR 1):
  - `PanelGrid.css:222-236` `.panel-grid-card__title-input`: `background: transparent`, `border:
    none`, `border-bottom: 1px solid var(--app-accent)`, `color: inherit`, `padding: 2px 0`,
    `font-weight: var(--weight-semibold)`; `:focus-visible { outline: none; border-bottom-color: ... }`.
  - `PipelineDetailPage.css:579-591` `.pipeline-detail-page__footer-output-input`: `background:
    var(--app-surface)`, `border: 1px solid var(--app-accent-mid)`, `padding: 2px 6px`, `outline: none`.
  - `TypeDetailPanel.css:173-191` `.type-detail-panel__name-input`: `flex: 1`, `font-size:
    var(--text-base)`, `font-weight: var(--weight-semibold)`, `background: transparent`, `border: 1px
    solid transparent`, `padding: 0.125rem 0.375rem`, `min-width: 0`.
- **Contradiction check on the guard spec**: `TypeDetailPanel.tsx:179` renders a raw
  `<input type="checkbox">` per schema field, unconditionally, in the same rendered output the guard
  test would query (see CR 4).

### Verdict: REFUTE

The slice is well-bounded, the sibling reconciliation is correct and evidence-backed, the deferred
tickets are genuinely filed, and the prop-surface analysis is right. But design.md's central technical
premise — *"This makes the swap mechanical and low-risk ... no prop surface gap, no behavior to
reconcile"* — is **true for props and false for styles**, and the one Decision that addresses styling
assumes the opposite of what the CSS actually says. As written, an executor following tasks.md
1.1-1.3 literally would ship a silent visual regression on all three controls, or would have to invent
an unspecified styling policy mid-execution. These are small, concrete revisions, not a redesign.

### Change Requests

1. **design.md "Decisions" → "Swap is additive, not restructuring": the stated premise is factually
   wrong and must be replaced.** It says the local class is kept "for any file-specific
   positioning/sizing CSS that isn't itself a duplicate of what `TextField`'s base styles already
   provide," and that pure-duplicate declarations should be removed. The three local rulesets are not
   duplicates of `.ui-input` — they **contradict** it on nearly every property. Concretely, adding
   `ui-input` to these controls introduces: `min-height: 32px` (`--control-md`) where all three
   currently have no min-height and 2px-ish vertical padding; `padding: 0 var(--space-3)` where they
   use `2px 0` / `2px 6px` / `0.125rem 0.375rem`; `background: var(--app-surface-soft)` where two are
   `transparent`; a full `1px solid var(--app-border-subtle)` box where `PanelCard`'s is
   `border: none` + accent underline and `TypeDetailPanel`'s is a transparent border; `font-size:
   var(--text-sm)` where `TypeDetailPanel` uses `--text-base`; `width: 100%` where `TypeDetailPanel`
   uses `flex: 1; min-width: 0`. Rewrite this Decision to state the *intended visual outcome* for each
   of the three controls explicitly — either "these become standard boxed `--control-md` fields (an
   accepted, deliberate visual change; screenshot before/after)" or "these stay chrome-less inline-edit
   affordances and the local class must override `.ui-input`" — and say which, per file.

2. **Specify how the override wins, because equal specificity makes the current plan order-dependent.**
   `.ui-input` and `.panel-grid-card__title-input` are both single-class selectors of identical
   specificity; with `TextField` rendering `class="ui-input panel-grid-card__title-input"`, the winner
   is decided by **stylesheet source order in the bundle, not class-attribute order** — which is an
   import-order accident, not a design. If CR 1 resolves to "keep the current look," design.md must
   name the mechanism (e.g. raise specificity to `.ui-input.panel-grid-card__title-input`, or add the
   needed resets — `min-height`, `padding`, `background`, `border`, `width` — explicitly to the local
   rule) rather than leaving the executor to discover the cascade collision at screenshot time.

3. **Decide explicitly whether `TextField` should be extended with a chrome-less/inline variant.**
   `DESIGN.md` §6 is the binding doc and the ticket's own Scope says "Where a primitive is genuinely
   missing a capability, extend the primitive rather than forking it, and call that out in the PR."
   `TextField` today exposes exactly one modifier (`mono`) — no size and no bare/borderless variant
   (`frontend/src/shared/ui/inputs.css:66`). Three of the four inventoried rename controls are
   borderless inline-edit affordances, which is precisely the "genuinely missing capability" shape.
   Either add a bounded `variant="inline"` (or `bare`) to `TextField` in this slice and say so, or
   record an explicit decision *not* to with reasoning. Right now design.md is silent, and per-file
   ad-hoc CSS overrides across three files is exactly the fork §6 forbids.

4. **`specs/raw-element-guard/spec.md`, Scenario "No raw input regression" is unsatisfiable as
   written.** It requires that querying each migrated component's rendered output "for a raw `<input>`
   that is not itself `TextField`'s internal input finds none." `TypeDetailPanel.tsx:179` renders a raw
   `<input type="checkbox">` for every schema field's nullable cell, unconditionally — a legitimate
   exception design.md itself acknowledges ("no primitive covers these"). Narrow the scenario to the
   **rename/name control specifically** (e.g. "the element with accessible name `Data type name` /
   `Panel title` / `Pipeline name` carries `TextField`'s `ui-input` class"), or add an explicit
   type-based carve-out for `checkbox`/`color`/`range`/`file`. As written the requirement contradicts
   the change's own scope and will produce either a false failure or a silently weakened assertion.

5. **Remove or qualify the two now-falsified claims so downstream agents aren't misled.** design.md
   Context: "no prop surface gap, no behavior to reconcile" → scope it to props. Goals: "byte-for-byte
   behavior preserved (value/onChange/blur/keyboard semantics unchanged)" — the parenthetical is
   accurate but "byte-for-byte" reads as covering rendered output, which CR 1 shows it cannot. State
   plainly: *behavior* preserved, *visual result* per the CR-1 decision.

6. **tasks.md needs a task for the CSS reconciliation.** Tasks 1.1-1.3 currently say only "remove
   declarations that pure-duplicate `ui-input`; keep layout-only rules," which per CR 1 describes work
   that does not exist. Add an explicit task (or sub-bullets) to reconcile `PanelGrid.css:222-236`,
   `PipelineDetailPage.css:579-591`, and `TypeDetailPanel.css:173-191` against `.ui-input`'s base rules
   per the CR-1/CR-2 decision. Task 3.4 (visual verification at desktop/430/768) is the right check and
   should be kept — but it is currently the *only* thing standing between this plan and a silent
   regression, which is too late a place to be discovering the styling policy.

### Non-blocking notes

- design.md's Risks section flags ref-forwarding for imperative focus. Verified: no call site uses
  `useRef` for focus; all three use `autoFocus`, and `TextField` forwards it via `...rest`. The risk is
  correctly reasoned but does not apply here — the executor's per-file check will be a no-op. Harmless
  to keep.
- Sibling reconciliation (HEL-725 / HEL-708 / HEL-720) is the strongest part of these artifacts:
  specific, both-directions, and each claim I spot-checked against Linear and the tree held up.
  The "reverse direction: no orphaned primitive" claim I did not independently verify (low stakes).
- Environmental note, not a blocker: the worktree's `scripts/concertino/` is missing
  `next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` (it predates them). I used the
  main-repo copies at `/home/matt/Development/helio/scripts/concertino/`, pointed at this worktree's
  change directory. Worth a `concertino sync` on this branch before the final gate.
- `PipelineShareDialog.test.tsx` (lines 1-5) is prior art for exactly this guard shape ("a raw
  `<input>` instead of the shared `TextField`") — the executor should look at it before writing task 2.1.
