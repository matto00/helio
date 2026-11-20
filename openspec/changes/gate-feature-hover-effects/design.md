## Context

See proposal.md (Why). Two guards exist, both on the shared parser `frontend/src/test/cssHoverGating.ts`
(`parseRules`, `ungatedHoverSelectors`, `mixedGatedRules`): `shared/sharedHoverGating.css.test.ts` walks
`shared/**/*.css` with an empty allowlist; `features/pipelines/ui/pipelineHoverGating.css.test.ts` lists nine pipeline
page files by hand and keeps a REVEAL allowlist (HEL-1668: a hover rule that makes a control visible/reachable, e.g.
`.spine-row:hover .spine-row__menu { opacity: 1 }`, stays ungated with a reason; every fill is gated).

Planning inventory (a parser clone run on main 894a72c56; scratch `enum.mjs`, re-run and committed by the executor):
180 ungated hover rules / 205 selectors in 63 files outside `shared/`. Six of them are `spine/PipelineSpine.css`, all
already on the pipeline allowlist. In scope: about 174 rules in 62 files across `app/`, `features/*` and `landing/`.
13 rules are mixed lists (12 in scope; one is PipelineSpine.css) (`:hover` with `:focus-visible`, `:focus-within`, `:has(...)`, `--active` and similar).
Reveal candidates by declaration (display/visibility/opacity/clip/size/pointer-events on a descendant of the hovered
element): exactly one, `features/dashboards/ui/DashboardList.css` `.dashboard-list__item-row:hover .popover.actions-menu`
(HEL-1003 visually-hidden recipe undone on reveal; same list carries `:focus-within` and
`:has(.actions-menu__trigger[aria-expanded="true"])`). Its trigger's own `:hover` fill is a fill. The context list that
renders it is not shown in the phone shell (`App.tsx` `showRail = !isPhoneShell`), so its touch case is a touch tablet.

## Goals / Non-Goals

**Goals:** no feature control keeps a hover effect after a tap; every desktop computed style identical; the third guard
covers every stylesheet under `frontend/src/` the other two do not; the reveal keeps its touch behaviour.

**Non-Goals:** re-touching `shared/` or the pipeline guard's nine files; redesigning any reveal; new touch affordances.

## Decisions

**D1. Gate in place (HEL-1675 D1).** Wrap each hover rule in `@media (hover: hover) { … }` at its current source
position; consecutive hover rules may share one block only when nothing un-gated sits between them. A media block adds
no specificity and keeps cascade order. A hover rule already inside another at-rule (`@media (max-width: …)`,
`@container`, `@supports`) gets the gate nested inside that block. Themed overrides (`:root[data-theme="dark"] …:hover`)
are gated like any other. Rejected: a global reset or a JS `.has-hover` root class (changes specificity/order).

**D2. Split mixed lists (HEL-1675 D2).** The non-hover members keep the same declarations ungated at the same position;
the `:hover` members move into the gate immediately after. The reveal unit in D3 is the one exception and is left as is.

**D3. Reuse the HEL-1668 reveal/fill classification.** A rule is a FILL when its declarations only repaint (background,
border, color, outline, box-shadow, filter, text-decoration, transform, cursor and similar); it is a REVEAL when the
hover makes a control visible or reachable (display, visibility, opacity, clip, size, position, pointer-events on a
descendant). The executor's inventory script tags each rule by its declaration properties and lists every non-fill rule
for a written per-rule decision in evidence. Expected result: one reveal, the DashboardList actions-menu unit, which goes
on the allowlist as one entry (file + its `:hover` selector, reason "HEL-1003 row actions-menu reveal, mixed with
:focus-within / aria-expanded; rendered by DashboardList (dashboards context list) and SidebarItemList (Assistant
context list conversation rows); left exactly as is") and stays byte-identical. It has TWO render sites, both in the
context list (mounted only outside the phone shell, `PHONE_SHELL_QUERY (max-width: 768px)`):
`features/dashboards/ui/DashboardList.tsx` and `shared/chrome/SidebarItemList.tsx` (imports `DashboardList.css`, used by
`app/shell/AssistantContextList.tsx`). Its touch path is measured per render site, not assumed: on the touch-tablet
context (D6 context T: 1024x768, `isMobile`, `hasTouch`), tap one dashboard row and one Assistant conversation row, then
read whether that row's ⋮ trigger is painted and a tap on it opens the menu, on unchanged CSS and after the change
(identical expected, since the rule is not edited). If either site's ⋮ is NOT reachable on touch today, the executor
stops and escalates for that site (product question: no touch path); it does not add one. Any further reveal the script finds is handled the
same way (allowlist + touch probe), and an unplanned reveal is reported in files-modified.md.

**D4. Third guard, one parser.** Move the pipeline guard's file list into `cssHoverGating.ts` as an exported
`PIPELINE_GUARDED_FILES`, paths relative to `frontend/src/` (`features/pipelines/ui/spine/PipelineSpine.css`, ...). The
pipeline guard imports it and re-relativizes each entry to its own directory (`path.relative(__dirname,
path.join(SRC, f))`) for reading and for allowlist matching, so its `FileRules.file` values and its `REVEAL_ALLOWLIST`
stay byte-identical (`"spine/PipelineSpine.css"`) and its assertions are untouched (option (a); the allowlist is not
rewritten). New `frontend/src/featureHoverGating.css.test.ts` walks `frontend/src/**/*.css`, excludes
`shared/` and `PIPELINE_GUARDED_FILES`, and asserts: no ungated `:hover` selector outside the named allowlist (output
`file: selector`); no gated mixed list; every allowlist entry still matches a rule (rot check, as the pipeline guard
does); a non-vacuity floor (file count and hover-rule count, the measured post-change values); and an existence check
that every `PIPELINE_GUARDED_FILES` entry is a real file (so a renamed pipeline file cannot silently drop out of every
guard). (A "falls in exactly one guard" assertion is tautological for a remainder set and is not counted as evidence.) **Red first (C12):** the guard is committed and its failing run on unchanged CSS
recorded in evidence before any stylesheet is edited. **Mutations**, scripted with a transcript in evidence: for each
gated file, un-gate one hover rule and record the guard failing naming that file and selector; plus one mixed-list
mutation, one allowlist-rot mutation (rename the reveal's selector) and one new-file mutation (an ungated rule in a new
`features/<x>/tmp.css`). Each mutation is reverted.

**D5. Desktop unchanged: structural proof plus live comparison.** (a) A committed evidence script parses every
touched stylesheet, before (main) and after, into an ordered list of RULE GROUPS: each entry is (at-rule chain with
`@media (hover: hover)` removed, normalized declaration block, SET of selectors). Normalization, stated once: a maximal
run of ADJACENT after-entries that have the same chain and byte-equal declarations is merged into one group whose
selector set is the union (this is exactly what D2's split produces from one source rule, since the split halves sit
next to each other with the same declarations); before-entries are taken one per source rule. The script asserts the
two group lists are equal, element by element, in order. Why this is cascade-equivalent under `(hover: hover)`: a
media block adds no specificity; each selector keeps its own specificity; members of one source rule share one source
position and one declaration block, so splitting them into two adjacent rules with identical declarations changes no
winner (any rule that could interleave between them is excluded by the adjacency requirement); and every other rule
keeps its relative order. A split that is NOT adjacent (something else lands between the halves) fails the check.
Output committed. Detection mutations, each run under the same normalization and each required to FAIL the check: (i)
change one declaration in one gated rule; (ii) move one gated rule past an unrelated neighbouring rule (a real order
change); (iii) insert an unrelated rule between the two halves of one split mixed list. (b) Live: the D6 spec's desktop test (mouse, hover-capable; 1280x800 for
tablet-context controls, 390x844 for phone-only controls; light and dark) hovers each named control and asserts computed `background-color`, `border-color`, `color` (and
`outline`/`filter`/`transform` where the rule sets them) at rest and on hover equal a fixture recorded from unchanged
CSS and committed in the spec. Every desktop rest and hover read, including the fixture recording, goes through
`trackPointer`, `settleToRest` and `settleToHover` imported from `e2e/support/hel1790Rest.ts` (import only, never edited):
a rest read with the pointer still over the control is the HEL-1790 flake.

**D6. Touch e2e, red first (HEL-1675 C1).** New `e2e/hel1735-feature-hover.spec.ts`, tap primitive `realTap`
(`e2e/support/hel1668.ts`), lane-private DB (DC14), two touch contexts (both `isMobile`, `hasTouch`,
`deviceScaleFactor: 2`): P = phone 390x844 (phone shell: no rail, no context list, no dashboard tab bar) and T = touch
tablet 1024x768 (rail, context list and tab bar mounted). Candidate controls, each a rule that itself sets a visible
paint (never a rule that only resets a shared hover, e.g. `.app-rail .user-menu__trigger:hover { border-color:
transparent }`, which cannot go red), and the executor confirms each one's selector, context and mount before writing:
1. P: home page card/link, a `features/home/ui/HomePage.css` hover fill.
2. P: sources list row, `features/sources/ui/SourceListTable.css` hover fill.
3. P: settings section control, e.g. `features/settings/ui/PreferencesEditor.css` or `ApiTokensSection.css` hover fill.
4. P or T: command-bar logo, `app/App.css` `.app-command-bar__logo:hover` (background).
5. T: dashboard tab, `features/dashboards/tabs/ui/DashboardTabBar.css` hover fill.
6. T: a dashboards context-list row button, `features/dashboards/ui/DashboardList.css` hover fill (not the reveal rule).
A candidate whose control does not stay mounted after a tap, or whose rule does not apply in the named context, is
replaced by another feature fill in the same context and the substitution recorded. Read rest, tap, wait on a real
signal (state change visible, `getAnimations()` empty), re-read, expect rest, light and dark. Committed and run on
UNCHANGED CSS first; only instances red there count as e2e-covered, the rest are listed in the PR as "guard +
structural proof only". Escalate if fewer than four of the six are red, or if fewer than two of the red ones are in
context T.

**D7. e2e blast radius.** Before editing, grep `e2e/` for every class name in a gated selector; list each spec that
reads hover or rest paint of those controls (plus `hel1675-shared-hover`, every user of `e2e/support/hel1790Rest.ts`)
and run those full spec files green after the change, unchanged. Specs HEL-1789 is splitting (hel1582-sweep-375,
state-surface-contrast-guard, hel1582-mobile-pipeline, hel1684-draft-structural, hel1573-motion-primitives,
hel1575-dashboard-tabs) may be RUN but never edited; if one would need an edit, stop and escalate.

**D8. DESIGN.md.** §5's hover paragraph names the third guard (what it walks, its allowlist) and drops "Other feature
stylesheets are not yet covered (HEL-1735)".

## Risks / Trade-offs

- [Wide CSS diff] → mechanical wrap, D5(a) proves desktop equivalence over every file, D4 mutations per file.
- [A feature override of a shared hover (e.g. `.app-command-bar .cmd-btn:hover { border-color: transparent }`)] →
  both now gated, so on touch neither applies (rest), on desktop D5(a) shows order unchanged.
- [Reveal loses its touch path] → left byte-identical and probed before/after; escalate rather than redesign.
- [Touch e2e flake] → wait on real signals and `getAnimations()`, never a timeout.

## Planner Notes

- Self-approved: `landing/landing.css` is in scope (it is a stylesheet under `frontend/src/` served to touch visitors).
- Self-approved: the guard lives at `frontend/src/` root because it walks the whole source tree.
- Ticket premise: no drift (`.concertino/runs/HEL-1735/evidence/premise-validation.md`).
