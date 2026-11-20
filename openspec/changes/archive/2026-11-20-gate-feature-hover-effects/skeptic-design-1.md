## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 894a72c565e06afc90bde4c4fd0f56cf86b31164 (the change dir is untracked, so the artifacts were read from the worktree).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/gate-feature-hover-effects/HEL-1735`.
- **Inventory reproduces.** I re-ran `.concertino/scratch/HEL-1735/enum.mjs` on the worktree. Its output is byte-identical
  to `inventory-main.txt`: `files=63 rules=180 selectors=205`. Six of those rules are in `spine/PipelineSpine.css`, which
  the pipeline guard already covers. The "13 mixed" count includes one PipelineSpine rule, so 12 mixed lists are in scope.
  That is a nit, not a defect.
- **Parser blind spots.** No feature stylesheet uses CSS nesting (`&`). Every grep hit was a comment. There is no `.css`,
  `.scss` or `.less` file outside `frontend/src/`, and no TSX file has an inline `:hover`. That grep found only a comment
  at `PipelineListTable.tsx:131`. Six `onMouseEnter` handlers exist, but each drives a keyboard-highlight index, not a
  CSS hover. They are out of scope. The walk-based guard therefore sees every hover rule.
- **Reveal classification.** I grepped the inventory for every non-paint declaration (display, visibility, opacity, clip,
  size, position, overflow, transform, pointer-events, content, z-index). There is exactly one hit in scope:
  `DashboardList.css:273-284`, `.dashboard-list__item-row:hover .popover.actions-menu`. Every other descendant-hover
  selector only repaints, for example ConnectorsPage `td--actions` background. The other suspects are paint too:
  `.context-list__separator:hover::after` is a drag-handle tint, and `landing.css:314` `.hot:hover` is an outline. The
  claim that this is the single reveal holds.
- **Reveal render sites.** The design's premise is partly incomplete. `DashboardList.css` is also imported by
  `shared/chrome/SidebarItemList.tsx:7`, which renders `dashboard-list__item-row` with an `ActionsMenu` (lines 366 and
  441). Its only consumer is `app/shell/AssistantContextList.tsx`, mounted through `ContextListBody` for the `chat`
  section. Both render sites live in the context list, which `App.tsx:185-186` mounts only when
  `showRail = !isPhoneShell`. `PHONE_SHELL_QUERY` is `(max-width: 768px)`. So "touch case is a touch tablet" is correct,
  but the reveal has two render sites, not one.
- **Mixed lists and the D5(a) proof.** These mixed lists have the `:hover` member first or interleaved:
  - `App.css:124-125` and `129-130` (logo)
  - `App.css:203-209` (command-bar resets)
  - `ContextList.css:44-47` and `84-85`
  - `OutputPicker.css:67-68`
  - `landing.css:314-315`
  - `DashboardMetaRow.css:84-85` and `90-91` have the hover member second.

  D2 moves every hover member after the ungated members, so a strictly ordered per-selector flatten does not compare
  equal (see CR1).
- **Existing guards and parser.** I read `frontend/src/test/cssHoverGating.ts` and both guards. The pipeline guard keys
  files and `REVEAL_ALLOWLIST.file` relative to `features/pipelines/ui/` (`"spine/PipelineSpine.css"`), and its compact
  entry matches by ancestor. That conflicts with D4's stated base for `PIPELINE_GUARDED_FILES` (see CR4).
- **e2e prior art.** `e2e/hel1675-shared-hover.spec.ts` runs its touch describe at `viewport: { width: 390, height: 844 }`
  (lines 297-301), which is the phone shell. `e2e/support/hel1790Rest.ts` exports `trackPointer`, `settleToRest` and
  `settleToHover`. They exist because a desktop "rest" read was returning hover paint on fast runners (archive
  `2026-11-19-fix-shared-hover-select-flake/design.md`).
- **DESIGN.md.** Line 520 carries "Other feature stylesheets are not yet covered", the text D8 says it will drop.
- **Red-first.** C1 and task 2.2 ("commit its red run on unchanged CSS before 1.4") put the guard red and the e2e red
  (1.2) before any stylesheet edit (1.4). The ordering is sound, although 2.x is numbered after 1.4 in the list.

### Verdict: REFUTE

### Change Requests

1. **D5(a) structural proof contradicts D2.** D5(a) flattens each stylesheet to an ordered list of (chain without
   `@media (hover: hover)`, one selector, declarations) and asserts before equals after. D2 moves each mixed list's
   `:hover` members after its non-hover members. In at least seven in-scope lists the hover member is first or
   interleaved (App.css:124, 129, 203-209; ContextList.css:44-47, 84-85; OutputPicker.css:67-68; landing.css:314-315),
   so the ordered lists will not be equal.

   The executor would then have to improvise a normalization, and that is exactly how a proof gets weakened until it
   passes. State the normalization in design.md. For example: compare per original rule position, where a run of
   adjacent entries with the same chain and identical declarations that came from one source rule compares as a
   selector set. Also state why that is cascade-equivalent: members of one rule share their position and declarations,
   and each selector's specificity is unchanged. Say too that the detection mutation must still be caught under that
   normalization. Add a second mutation that moves a gated rule past an unrelated rule, so the proof is shown to catch
   a real order change.

2. **D5(b) desktop reads must use the HEL-1790 settle helpers.** D5(b) "hovers each named control and asserts computed
   … at rest and on hover equal a fixture". That is the read pattern that flaked in `hel1675-shared-hover`: the rest read
   returned hover paint because the pointer was still over the control. Require the new spec to import `trackPointer`,
   `settleToRest` and `settleToHover` from `e2e/support/hel1790Rest.ts` (import only, never edit, per C3). Every desktop
   rest and hover read, and the fixture recording on unchanged CSS, must go through them.

3. **D6 does not say which touch viewport each candidate needs, and several candidates do not exist on a phone.** "Touch
   context like hel1675-shared-hover" means 390x844, which is the phone shell (`PHONE_SHELL_QUERY (max-width: 768px)`).
   The rail and its user-menu trigger, the context list, and the dashboard tab bar (`usesDashboardTabBar(…,
   isPhoneShell)`) are not mounted there. Name two touch contexts in D6:
   - phone, 390x844;
   - touch tablet, for example 1024x768, `isMobile`, `hasTouch`, the same as the D3 probe.

   Then, for each candidate (home card or link, sources list row, settings section button, command-bar control,
   dashboard tab, user-menu trigger), name its context and the stylesheet:selector it exercises. Recompute the
   "escalate if fewer than four are red" threshold against that list. Also note that a feature rule which only resets a
   shared hover (`.app-rail .user-menu__trigger:hover { border-color: transparent }`) cannot go red on unchanged CSS
   for that property. Pick candidates whose own rule sets a visible paint.

4. **D4's `PIPELINE_GUARDED_FILES` path base contradicts "allowlist and assertions untouched".** D4 says the paths are
   relative to `frontend/src/`. The pipeline guard reads `path.join(__dirname, file)` and matches
   `REVEAL_ALLOWLIST.file === file` against `"spine/PipelineSpine.css"`, which is relative to `features/pipelines/ui/`.
   Pick one:
   - (a) export the paths relative to `frontend/src/`, and have the pipeline guard re-relativize them to its own
     directory for reading and allowlist matching, so its allowlist stays byte-identical; or
   - (b) rewrite the allowlist file keys.

   State which in D4 and task 2.1.

5. **The D3 reveal has two render sites; the probe and allowlist reason must cover both.** `DashboardList.css` is
   imported by `shared/chrome/SidebarItemList.tsx:7`, and the Assistant context list's conversation rows use the same
   `.dashboard-list__item-row` and `.popover.actions-menu` markup, so the same rule reveals their ⋮ trigger. Extend the
   1.3 and 2.6 probe to one Assistant context-list row on the touch-tablet context. The escalation rule (C4) applies
   per render site. Put both sites in the allowlist reason.

### Non-blocking notes

- "13 rules are mixed" includes the out-of-scope `PipelineSpine.css` rule; 12 are in scope.
- D4's "every `.css` falls in exactly one guard's set" check is close to tautological, because the third set is
  defined as the remainder. The useful half is "every `PIPELINE_GUARDED_FILES` entry exists". Keep both, but do not
  count the first as coverage evidence.
- Task 2.2 must run before 1.4 although it is numbered after it. Consider reordering the task list so the sequence is
  visible without reading the parenthetical.
- `landing/landing.css` being in scope (Planner Notes) is correct: the walk covers it either way.
