## Context

Premise-validated inventory (2026-09-10, `origin/main` `d8d398ca`, re-derived at branch time):
`@fortawesome/*` imports in 57 files / 67 distinct symbols; `lucide-react` imports in **35 files**
(corrected during design-gate round 1 — the skeptic re-measured and found 35, not the 32 this
document originally stated; non-load-bearing, D1's justification is aesthetic not usage-count-based,
but the number itself should be accurate). Of those 35 lucide-only files, 4 currently use a
non-standardized inline `size` literal (see D2b below).
FontAwesome is the more broadly used system today — inverted from the original ticket's stated
rationale. `frontend/src/app/App.tsx`, the file the ticket named as the starting point, imports
neither icon library today; that specific claim is stale (see
`.concertino/runs/HEL-443/evidence/premise-validation.md`). A shared `IconButton` primitive
(`shared/ui/IconButton.tsx`, HEL-718, `openspec/specs/icon-button/spec.md`) already enforces a
required `aria-label` at the TypeScript level for icon-only buttons and a visible default tooltip —
that guarantee is reused, not rebuilt, for the ~55 files where `FontAwesomeIcon` already sits inside
an `IconButton`-shaped control. `DataGrid.tsx` (`shared/ui/DataGrid.tsx`) is confirmed NOT touched by
HEL-520 (`git show --stat 7a14601f`) and still imports FontAwesome directly — it's in scope here.

## Goals / Non-Goals

**Goals:**
- Zero `@fortawesome/*` imports/dependencies anywhere in `frontend/src` / `frontend/package.json` /
  `frontend/package-lock.json`.
- One consistent glyph size scale (14/16/20px) expressed via a shared constant, replacing today's
  arbitrary inline `size={16|18|22|28|...}` literals.
- Every icon-only interactive control keeps (or gains) an accessible name; every decorative icon is
  `aria-hidden`, provably — including against a fixture that is NOT already compliant pre-fix (per
  MISTAKES.md's "assertion whose precondition guarantees it" trap: a guard that only ever sees
  already-compliant icons proves nothing).

**Non-Goals:**
- Redrawing/re-theming individual glyphs beyond the direct lucide equivalent.
- The OrbitMark brand logo.
- Reworking `IconButton`'s `xs`/`sm`/`md` container-size scale (hit-target size, not glyph size).
- Auditing/fixing accessible-name gaps that predate this change and are unrelated to the icon-library
  swap (e.g. a button with no icon at all) — out of scope; this change touches icon usages only.
- Normalizing pre-existing, already-lucide icons sized via CSS `width/height: 1em` (em-relative,
  inherited from `font-size`) rather than an inline `size` literal — at least 10 such sites exist
  (see design-gate round 2, CR4, in "Decisions" → sizing-scope correction). Out of scope: unrelated
  to the FontAwesome-to-lucide swap, and normalizing them is a materially larger, separate effort the
  driver ruling did not authorize. The `icon-system` spec's sizing requirement is scoped to inline
  `size` props/literals accordingly.
- Changing `IconButton.tsx`'s `icon: ReactNode` prop type or deleting `IconButton.css`'s `font-size`
  rules — both still serve non-icon-library text-glyph call sites (see D2's correction) and remain
  untouched by this change.

## Decisions

### D1 — lucide-react is the surviving system, justified on stroke-aesthetic grounds, not usage share
The original ticket's rationale ("lucide already broader") is refuted by measurement (57 FA files
vs 32 lucide files). Kept anyway: lucide-react is a stroke-based icon set matching `DESIGN.md`'s
hairline/border aesthetic; FontAwesome's solid-fill glyphs do not. Recorded explicitly here so a
future reader checking the usage numbers doesn't conclude the wrong system won.

### D2 — Standardized glyph sizes: a shared `ICON_SIZE` constant, not a new component
Add `frontend/src/shared/ui/iconSize.ts`:
```ts
export const ICON_SIZE = { sm: 14, md: 16, lg: 20 } as const;
```
Call sites pass `size={ICON_SIZE.sm|md|lg}` to the lucide icon component directly (lucide icons
already accept a `size` prop; no wrapper component needed — introducing one would be scope beyond
"swap the icon set"). Existing literal sizes map to the nearest standardized value based on context
(dense chrome: sm/14; default UI icon: md/16; larger/empty-state icon: lg/20) — the executor records
each non-trivial size decision inline as a one-line comment only where the mapping isn't obvious
(e.g. a 28px empty-state icon collapsing to 20px).

**Correction (design-gate round 1 REFUTE, CR1/CR2):** the claim that `IconButton`'s `xs`/`sm`/`md`
scale is "distinct and unrelated" to glyph size was wrong. `IconButton.css:38-53` sizes the *glyph*
via `font-size` on `.ui-icon-btn--{xs,sm,md}` (`--text-sm`/`--text-base`/`--text-lg`) — that's today's
glyph-size mechanism for a `FontAwesomeIcon` inside an `IconButton`, because FontAwesome's SVG
defaults to `1em` and so inherits its size from the surrounding `font-size`. lucide icons do not
inherit `font-size` this way — they render at a fixed 24px unless given an explicit `size` prop.

**Round-1's proposed fix (deleting the `font-size` rules and narrowing `IconButton`'s `icon` prop to
a component-reference type) was itself REFUTEd at design-gate round 2 and is withdrawn.** Verified
against source: `IconButton`'s `icon: ReactNode` (`IconButton.tsx:11`) is not exclusively an icon —
seven call sites pass a bare text character with no icon component at all
(`features/panels/ui/PanelCard.tsx:294` `icon="×"`;
`features/panels/ui/editors/TableDisplayFields.tsx:135,144,152,161` `"⤒"`/`"↑"`/`"↓"`/`"⤓"`;
`features/dashboards/ui/DashboardList.tsx:207` and `shared/chrome/SidebarItemList.tsx:305`, both
`icon="+"`). Those glyphs have no lucide/FontAwesome equivalent to swap to — they're plain
characters, sized by inheriting `font-size`, exactly as `IconButton.css` provides today. Deleting the
`font-size` rules would shrink/distort all seven; narrowing the prop type would make every one of
them a type error. Neither is in scope here — this change touches icon *library* usage, not these
unrelated text-glyph call sites.

**Actual, non-breaking mechanism (resolves CR1/CR2 without an API or CSS change to `IconButton`):**
- `IconButton.tsx`'s `icon: ReactNode` prop and `IconButton.css`'s `font-size` rules are **left
  exactly as they are** — no change, no `specs/icon-button/` delta needed. They keep serving the
  seven text-glyph call sites above (and any other non-icon-library content passed into `icon`).
- Every call site being migrated from `<FontAwesomeIcon icon={faX} />` to a lucide component
  (`<IconComponent />`) inside an `IconButton`'s `icon` prop must now pass an **explicit** `size`
  prop sourced from `ICON_SIZE`, because — unlike FontAwesome's default `1em` behavior — lucide does
  not pick this up from the surrounding `font-size` on its own. Leaving `size` unset would silently
  change the rendered glyph from today's font-size-derived value to lucide's fixed 24px default.
- Guidance mapping (which `ICON_SIZE` value to pass, by the `IconButton` variant the icon sits in):
  `xs` variant (`--text-sm`, 14px today) → `ICON_SIZE.sm` (14, unchanged); `sm` variant
  (`--text-base`, 16px today) → `ICON_SIZE.md` (16, unchanged); `md` variant (`--text-lg`, 18px
  today) → `ICON_SIZE.lg` (20, **a deliberate +11% size increase**, not a preservation — see the
  corrected framing in Risks). This is call-site guidance, not an `IconButton`-internal auto-wiring;
  `IconButton` itself does not compute or pass a size.
- `shared/chrome/InlineError.tsx:78`'s `<RotateCw className="inline-error__retry-icon" />` (sized by
  `InlineError.css:61-64`'s `width/height: 1em`, itself driven by `IconButton`'s `xs` `font-size`) is
  **already lucide** and entirely outside this change's scope — not touched, not migrated, cited only
  as evidence that the em-relative mechanism is still live elsewhere and must not be deleted wholesale.

### D2a — `SortableTh.tsx`'s glyph sizing has a documented prior regression; treat it as a hazard,
not a generic case
**(design-gate round 1 REFUTE, CR2.)** `SortableTh.css`'s `.sortable-th__glyph` also sizes via
`font-size: var(--text-xs)`, carrying an explicit code comment recording HEL-1022's own prior
incident: a relatively-sized (`0.7em`) glyph against a 10px header computed to an illegible 7px, and
was deliberately fixed by sizing from a token instead of inheriting. A blind component swap here
reintroduces exactly the class of bug HEL-1022 fixed, just via a different mechanism (lucide's 24px
default in a header sized for ~10-12px glyphs, rather than a too-small relative glyph). Apply D2's
"pass an explicit `size` prop, remove the CSS `font-size` declaration" rule here specifically, sized
to `ICON_SIZE.sm` (14). **Correction (design-gate round 2, CR5):** `--text-xs` is 12px
(`theme/theme.css:24-27`), not 14 — mapping to `ICON_SIZE.sm` is a **deliberate +17% size increase**
in a header the HEL-1022 comment describes as ~10px tall, not a preservation of the existing visual
weight. State it as such so the executor treats a visible size difference as intended, and verify the
rendered result at that size (not just that it typechecks) given the file's own regression history —
if 14px reads as too large against the actual rendered header, this is the one place in the change
where dropping to a non-standard size may be justified; flag it rather than force-fitting `ICON_SIZE.sm`.

`IconButton`'s own `size` prop (`xs`/`sm`/`md`, control-height tokens) remains the button's own hit-
target scale, distinct from the glyph-size scale — but, per the correction above, the two are now
explicitly *wired together* via the mapping above, not independent as originally (incorrectly)
stated.

### D3 — Accessible-name/`aria-hidden` coverage: reuse `IconButton` where possible, extend where not
- Any FontAwesome icon-only control already wrapped in `shared/ui/IconButton` keeps its existing
  required `aria-label` — swapping the icon prop is a pure substitution, the accessibility contract
  doesn't change.
- Any hand-rolled icon-only control NOT using `IconButton` (the design.md/DESIGN.md-documented
  escape hatch: sub-24px, off-scale sizing) must carry its own `aria-label`/`title` directly — this
  change does not migrate such controls onto `IconButton` (that's a separate refactor), only ensures
  the accessible name survives the icon swap.
- Purely decorative icons (next to a text label that already states the meaning — e.g. a `Database`
  glyph beside the word "Database") get `aria-hidden="true"` if not already so.
- New spec capability `icon-system` (see `specs/icon-system/spec.md`) states this as a durable
  requirement, distinct from `icon-button`'s narrower (button-only) scope.

### D2b — The `icon-system` spec's sizing requirement covers lucide-only files too, not just the
57 FontAwesome files
**(design-gate round 1 REFUTE, CR3.)** `specs/icon-system/spec.md`'s sizing requirement says every
`lucide-react` icon instance is sized via the shared constant — that is broader than "the 57 files
being migrated," and the original tasks.md only covered those 57. Resolved by **widening the task
list** (not narrowing the spec) — normalizing existing lucide call sites is in scope, since the spec
requirement is correct as stated and this change is the natural point to close the gap rather than
leave a known violation on record. **Boundary correction (design-gate round 2, CR4):** this widening covers only *inline `size` literal*
call sites. A separate, larger population — at least ten CSS rules sizing a lucide icon relatively
via `width/height: 1em` (`shared/chrome/InlineError.css:23,62`, `shared/chrome/MobileNavSheet.css:181`,
`shared/chrome/StatusMessage.css:22`, `features/onboarding/ui/OnboardingChecklist.css:116,131`,
`features/dashboards/ui/DashboardList.css:126`, `shared/ui/SchemaFieldViewer.css:74`,
`shared/ui/EmptyState.css:180,210`) — is **explicitly out of scope** for normalization here (see
Non-Goals): these are pre-existing, already-lucide, unrelated to the FontAwesome-to-lucide swap this
ticket is about, and normalizing an open-ended set of CSS-driven relative-sizing sites across the
codebase is a materially different, larger effort than what the driver ruling authorized (restating
scope to match AC1's FontAwesome-file inventory, not an open-ended lucide-wide sizing audit). The
`icon-system` spec's sizing requirement is scoped accordingly (see `specs/icon-system/spec.md`'s
updated requirement text) to icons sized via an inline `size` prop/literal — the em-relative CSS
mechanism is recorded as an accepted, pre-existing alternative, not a violation of this requirement.

**Enumeration corrected at design-gate round 3 (CR2) — three more files found on a fresh-pass
`grep -rn 'size={[0-9]' --include=*.tsx frontend/src`, beyond the four found at round 1:**

Seven lucide-only files carry non-standard *inline-literal* sizes in scope for this change:
`app/Sidebar.tsx` (`size={16}` ×3 — already a compliant *value* but still a raw literal, not sourced
from `ICON_SIZE`), `features/dashboards/ui/ProposalReview.tsx` (`size={15}`),
`features/panels/ui/OutputPicker.tsx` (`size={18}` ×4, `size={28}`),
`features/sources/ui/SourceDetailPanel.tsx` (`size={13}`), `shared/chrome/BottomNav.tsx:38`
(`size={22}`), `shared/chrome/SidebarBody.tsx` (`size={12}` line ~219, `size={14}` ×3 lines
~236/246/248), `app/CommandBar.tsx:209` (`size={16}` — compliant value, raw literal). Map each to the
nearest `ICON_SIZE` value: 15→`sm`/14, 18→`md`/16, 28→`lg`/20 (a visible size reduction for the
`OutputPicker` empty-state icon, acceptable since 20px is this change's documented ceiling),
13→`sm`/14, 12→`sm`/14 (`SidebarBody`'s pin badge — a small deliberate increase, visual check
required since it's a small status-indicator glyph, not a primary action icon), 14→`sm`/14 (value
unchanged, source from `ICON_SIZE` instead of a raw literal), 16→`md`/16 (value unchanged, likewise).

**`BottomNav.tsx`'s `size={22}` → `ICON_SIZE.lg` (20) is a decided, deliberate 2px reduction in the
mobile bottom-nav icons**, not left to the executor's judgment: 20px is this change's documented
ceiling and there is no case for a fourth size tier just for mobile nav. The file's own code comment
(lucide emits `width`/`height` as SVG presentation attributes, and `box-sizing: border-box` then
resolves the lozenge's padding/border inward from that value) means the `size` prop change alone is
sufficient — no companion CSS change is implied, since nothing styles the `<svg>` directly per that
same comment. Visual verification of the mobile bottom nav in both themes is still required (this is
touch-target-adjacent chrome), not just a typecheck.

### D6 — `IconDefinition`-typed icon props: two genuinely different situations, not one
**(design-gate round 1 REFUTE, CR4; corrected at design-gate round 2, CR3 — the original D6
mischaracterized 5 of these 7 files. Verified directly against source this round.)**

**Situation A — five files already accept `IconDefinition | ReactNode`, and already have shipped
lucide-element producers; the `IconDefinition` arm is legacy, not the live convention:**
`shared/ui/EmptyState.tsx:16,27` (`renderIcon`/`renderCtaIcon`, lines 48-64, branch on
`isValidElement` — HEL-539), `shared/ui/PageStatus.tsx:40` (already defaults to
`<TriangleAlert />` at line 132), `shared/chrome/pickerEmptyState.tsx:9` (4 of its 5 entries already
pass rendered lucide elements — `<LayoutDashboard />`, `<Database />`, `<GitBranch />`; only its
`faComments` entry is FontAwesome), `shared/chrome/SidebarItemList.tsx:45` (widened to this union by
HEL-548 task 7.2, deliberately), `shared/chrome/MobileNavSheet.tsx:77-88`
(`renderCreateActionIcon(icon: IconDefinition | ReactNode | undefined)`). For these five: **the
minimal, non-regressive move is the opposite of narrowing to a component-reference type** — drop the
`IconDefinition` arm of the union (keep `ReactNode`), delete the now-dead `isValidElement` branches,
and convert only the remaining FontAwesome producer(s) (e.g. `pickerEmptyState.tsx`'s `faComments`
entry) to pass a rendered lucide element (`<MessagesSquare />`), matching what the other four entries
in that same file already do. `EmptyState.test.tsx`'s fixture follows `EmptyState.tsx`'s change.

**Situation B — `pipelines/types/step.ts:18` is genuinely `IconDefinition`-only** (`OpType.icon:
IconDefinition`, no union, no existing lucide producer), rendered at exactly two consumer sites via
`<FontAwesomeIcon icon={...} />`: `pipelines/ui/OpDropdown.tsx:115` and
`pipelines/ui/StepCard.tsx:206`. This one file/pattern genuinely is the "producer passes a component
reference, consumer renders it directly" shape the original D6 described — narrow `OpType.icon`'s
type to `LucideIcon` (from `lucide-react`), have each op-type's definition (in `stepNarrowing.ts`,
where `faClone`/`faCopy`/etc. are currently assigned) pass the lucide component reference, and update
both consumer sites to render it directly (`const Icon = step.opType.icon; <Icon aria-hidden="true"
size={ICON_SIZE.md} />`) instead of wrapping it in `FontAwesomeIcon`. This is a narrower, contained
breaking change (one type, two producers via `stepNarrowing.ts`, two consumers) with no existing
spec/capability contract on `step.ts` itself and no existing lucide-element producer convention to
preserve.

**Correction (design-gate round 3 REFUTE, CR1):** Situation A *does* touch a live spec contract —
`openspec/specs/error-state-pattern/spec.md`'s "EmptyState icon and cta icons accept a ReactNode"
requirement explicitly names `IconDefinition`/`FontAwesomeIcon` as current behavior, with a scenario
asserting `icon={faTableColumns}` still renders via `FontAwesomeIcon`. Dropping the `IconDefinition`
arm (as this change does) breaks that requirement as written. A `specs/error-state-pattern/spec.md`
delta is included in this change — see `proposal.md`'s Modified Capabilities and the delta file itself.

**Further correction (design-gate round 4 REFUTE):** the first attempt at this delta used a
`MODIFIED Requirements` block, which `openspec validate` requires to carry forward every scenario
the current spec has (it refuses to silently drop one) — so the delta kept a scenario literally
titled "A FontAwesome IconDefinition still renders via FontAwesomeIcon" while rewriting its body to
say that's no longer true. That's a landmine: the scenario *title* would ship into the canonical
spec forever, asserting the opposite of its own body. The delta is instead a `REMOVED` + `ADDED`
pair: the old requirement is removed (with a `**Reason**`/`**Migration**` pointing at its
replacement), and a cleanly-named successor requirement ("...accepts a ReactNode only") is added
carrying just the surviving `A ReactNode icon renders directly` scenario. `openspec validate
single-icon-system --type change --strict` passes against this shape.

### D4 — Verification must be provably red before the fix, not just green after
Per MISTAKES.md's repeated "assertion whose precondition guarantees it" trap (bitten every lane this
batch): any new Jest/e2e guard for AC3 (accessible name / `aria-hidden`) must be demonstrated to fail
against a deliberately non-compliant fixture (an icon-only control with no `aria-label`/`title`, or a
decorative icon missing `aria-hidden`) before it's trusted to pass on the real, fixed tree. The
evaluator/skeptic final gate re-checks this by mutation, not by reading the assertion's source text.

### D5 — Icon symbol mapping (guidance, not exhaustive — executor verifies each import resolves via
`tsc --noEmit`)

| FontAwesome (fa*)                          | lucide-react equivalent            |
| ------------------------------------------- | ----------------------------------- |
| faAlignLeft                                 | AlignLeft                           |
| faArrowDownLong / faArrowUpLong             | ArrowDown / ArrowUp                 |
| faArrowRightFromBracket                     | LogOut                              |
| faArrowRotateLeft / faArrowRotateRight      | RotateCcw / RotateCw                |
| faArrowsUpDown                              | ArrowUpDown                         |
| faArrowUp                                   | ArrowUp                             |
| faBrain                                     | Brain                               |
| faCalculator                                | Calculator                          |
| faCalendarWeek                              | CalendarDays                        |
| faChartColumn                               | BarChart3                           |
| faChartLine                                 | LineChart                           |
| faCheckCircle                               | CheckCircle2                        |
| faChevronDown / faChevronRight / faChevronUp| ChevronDown / ChevronRight / ChevronUp |
| faCircleExclamation                         | AlertCircle                         |
| faCircleQuestion                            | HelpCircle                          |
| faCircleXmark                               | XCircle                             |
| faClipboardCheck                            | ClipboardCheck                      |
| faClockRotateLeft                           | History                             |
| faClone                                     | `Files` (NOT `Copy` — see Risks: `faClone`'s only use site, `stepNarrowing.ts`'s "Dedupe rows" step-op icon, is rendered in the same `StepCard.tsx` view as `faCopy`'s own copy-action icon; a distinct glyph is required so the two actions don't look identical) |
| faCodeBranch                                | GitBranch                           |
| faComments                                  | MessagesSquare                      |
| faCompass                                   | Compass                             |
| faCopy                                      | Copy                                |
| faDatabase                                  | Database                            |
| faExclamationTriangle / faTriangleExclamation | AlertTriangle                     |
| faFillDrip                                  | PaintBucket                         |
| faFilter                                    | Filter                              |
| faFont                                      | Type                                |
| faGear                                      | Settings                            |
| faGripVertical                              | GripVertical                        |
| faHeading                                   | Heading                             |
| faImage                                     | Image                               |
| faInfoCircle                                | Info                                |
| faKey                                       | Key                                 |
| faLayerGroup                                | Layers                              |
| faLink                                      | Link2                               |
| faLock                                      | Lock                                |
| faMoon                                      | Moon                                |
| faObjectGroup                               | Group (fallback: Layers if no direct export) |
| faPencil                                    | Pencil                              |
| faPlug                                      | Plug                                |
| faPlus                                      | Plus                                |
| faPowerOff                                  | Power                               |
| faRankingStar                               | Award                               |
| faRightLeft                                 | ArrowLeftRight                      |
| faSliders                                   | SlidersHorizontal                   |
| faSort                                      | ArrowUpDown                         |
| faSortDown                                  | ChevronDown (or ArrowDownWideNarrow if it's a "sort direction" indicator distinct from a plain chevron elsewhere in the same view) |
| faSortUp                                    | ChevronUp (or ArrowUpWideNarrow, same caveat) |
| faSquareCheck                               | CheckSquare                         |
| faSun                                       | Sun                                  |
| faTable                                     | Table                                |
| faTableCells                                | Table2                              |
| faTableColumns                              | Columns3 (verify export name)       |
| faTableList                                 | List                                |
| faTags                                      | Tags                                |
| faThumbtack / faThumbtackSlash              | Pin / PinOff                        |
| faTrash                                     | Trash2                              |
| faUser                                      | User                                |
| faWrench                                    | Wrench                              |
| faXmark                                     | X                                   |

Where a listed lucide name doesn't actually exist in the installed `lucide-react` version, the
executor picks the closest available equivalent and records the substitution in the commit — this
table is guidance, `tsc --noEmit` + visual review are the actual gate.

## Risks / Trade-offs

- **57-file mechanical swap is large but uniform** — the risk is drift/inconsistency across files
  (e.g. missing an `aria-hidden` on a decorative icon in file 40 of 57), not conceptual difficulty.
  Mitigated by grouping tasks by directory and requiring a final zero-`@fortawesome` grep plus the
  `icon-system` spec's mechanical scenarios.
- **`faSortUp`/`faSortDown`/`faSort`** are a correctly-flagged risk in `SortableTh.tsx` (confirmed by
  design-gate round 1: three-state render, `aria-sort` + `aria-hidden` already correct so this is
  purely a visual-distinction concern, not an accessibility one). `ChevronUp`/`ChevronDown` collide
  visually with the generic chevrons used elsewhere in the app for unrelated affordances (expand/
  collapse) — executor must verify the rendered three-state result reads as a sort indicator, not
  just typecheck, and should prefer a distinct pair (e.g. `ArrowDownWideNarrow`/`ArrowUpWideNarrow`)
  over plain chevrons if the visual collision is a problem in practice.
- **`faClone` vs `faCopy` collision — corrected citation (design-gate round 1 REFUTE, CR5):** the
  original citation (`OutputGalleryCard.tsx`/`RunHistoryModal.tsx`) was wrong. `faClone` has exactly
  one use site, `pipelines/state/stepNarrowing.ts:114` (the "Dedupe rows" step-op icon); the actual
  adjacency is `pipelines/ui/StepCard.tsx`, which imports `faCopy` directly (a copy-action icon,
  line 296) AND renders step-op icons sourced from `stepNarrowing` — so a dedupe step's glyph and the
  card's own copy action appear in the same view. Resolved in D5: `faClone` maps to `Files`, not
  `Copy`, specifically to avoid this collision.
- **Icon sizing is a CSS-mechanism change, not just a prop swap (design-gate round 1 REFUTE, CR1/CR2)**
  — see D2/D2a/D2b. The risk isn't the swap itself but silently reverting `IconButton`'s and
  `SortableTh`'s existing glyph-size behavior (the latter with a documented HEL-1022 regression
  history) by leaving now-dead `font-size` CSS in place after lucide ignores it.
- **`Group` (`faObjectGroup`) and `Columns3` (`faTableColumns`)** in the D5 mapping table are worth
  pre-checking against the installed `lucide-react` version before relying on them (design-gate round
  1 note) — if either doesn't exist as named, fall back to the closest available equivalent per D5's
  general rule (`tsc --noEmit` is the actual gate, this table is guidance).
- **Bundle-size verification** — AC4 requires confirming FontAwesome is actually gone from the
  built bundle, not just from source; `npm run build` + a build-output grep (not just `npm run lint`)
  is required evidence, since a leftover transitive reference could survive a source-level check.

### D7 — Dependabot's `fortawesome` co-versioning group must be retired in step with the package
removal, not ahead of it

`.github/dependabot.yml` declares a `fortawesome:` group over the four packages this change deletes;
`scripts/check-dependabot-groups.mjs`'s `DECLARED_FAMILIES` hardcodes the same family. That check
runs at `.husky/pre-commit` and in CI, and it enforces an invariant that must hold at **every**
commit, not just at the start and end of this change: every production dependency in
`frontend/package.json` must be accounted for, either inside a declared family or in
`DECLARED_INDEPENDENT`.

A design-gate round 5 REFUTE first found this as a stale-declaration problem, and a driver ruling
(recorded in `.concertino/runs/HEL-443/events.jsonl`) chose `proceed-to-delivery` over a 6th design
round, reasoning that the fix was "self-verifying — pre-commit fails immediately if it's wrong."
**That reasoning was wrong and is not carried forward.** Applying the fix exactly as first specified
(delete the group and the `DECLARED_FAMILIES` entry, standalone, before Task 10 removes the packages)
makes `check-dependabot-groups.mjs` FAIL with 4 "unaccounted production dependency" errors —
discovered by the executor in Execution cycle 1, with no source files touched yet. Not because the
fix was wrong, but because the plan's own commit ordering (group removed in Task 0, packages removed
later in Task 10) breaks the invariant above for the entire span between those two commits. The hook
checks that invariant, not the fix's correctness — "the hook will catch it if it's wrong" was never a
safe argument for this specific in-between state, and the ruling's underlying claim is corrected here
rather than left standing.

**Resolution (driver-ruled, option A):** the four `@fortawesome/*` packages get an interim
`DECLARED_INDEPENDENT` entry for exactly the span between Task 0 and Task 10 — this is the documented
treatment `check-dependabot-groups.mjs` already has for a dependency with no co-versioning family
(`lucide-react` itself already sits in `DECLARED_INDEPENDENT`), not a new, one-off mechanism invented
to get past a gate:

1. **Task 0 commit:** delete the `fortawesome:` group block from `.github/dependabot.yml` (currently
   lines ~38-44, between the `groups:` key and the `echarts:` group); delete the `fortawesome` entry
   from `DECLARED_FAMILIES` in `scripts/check-dependabot-groups.mjs` (currently the array's first
   entry, lines ~42-52); **add** the four `@fortawesome/*` packages to `DECLARED_INDEPENDENT` in that
   same file, with an inline comment naming HEL-443 and stating explicitly that the entry is
   temporary and must be deleted in the same Task 10 commit that removes the packages — do not let
   the two changes land in separate commits, the interim entry exists only to bridge this one gap.
   Do **not** touch `scripts/check-dependabot-groups.selftest.mjs` — its `fortawesome`/
   `FORTAWESOME_GROUP` references are self-contained fixture literals, never imported from or
   compared against the real `DECLARED_FAMILIES`/`DECLARED_INDEPENDENT` exports, so this change
   doesn't affect any selftest case; rewriting them would be scope creep.
2. **Spec delta** (included in this change): `specs/dependabot-update-grouping/spec.md`, a `REMOVED`
   + `ADDED` pair (not `MODIFIED` — the validator refuses to let a `MODIFIED` block silently drop the
   surviving "FontAwesome family upgrades together" scenario title, same landmine rule as
   `error-state-pattern`'s delta) replacing "Co-versioned families arrive as a single pull request"
   with a cleanly-named successor carrying an `echarts` scenario instead of the FontAwesome one.
3. **Task 10 commit** (dependency removal — tasks.md section 10): alongside
   `npm uninstall @fortawesome/*`, **remove** the interim `DECLARED_INDEPENDENT` entry added in
   Task 0, in the same commit as the package removal — this pairing is stated from both task
   directions in tasks.md, not just here.

**Known gap, explicitly not this ticket's to fix:** `check-dependabot-groups.mjs`'s coverage loop
checks `DECLARED_FAMILIES` members for staleness (`"declared member ... is not in package.json —
stale declaration"`) but performs **no equivalent staleness check on `DECLARED_INDEPENDENT`
entries** — a package named there that is no longer installed is silently accepted, not flagged.
Confirmed by direct probe: simulating a `frontend/package.json` with the four `@fortawesome/*`
packages removed while leaving the interim `DECLARED_INDEPENDENT` entry in place produces zero errors
from `checkDependabotGroups()`. This means step 1's temporary entry would **not** be mechanically
caught if step 3/Task 10's cleanup were forgotten — enforced only by task discipline, not by the
script. Per `MISTAKES.md`'s "an exception pinned in a guard must be able to expire" principle, this
is a real defect in the checker itself; the driver is tracking it as a separate spinoff ticket, not
folded into HEL-443.

**Proof required (not a design-gate re-confirmation):** the pre-commit hook (`npm run
check:dependabot`, what `.husky/pre-commit` runs) running and passing is the evidence for both Task 0
(with the interim `DECLARED_INDEPENDENT` entry included) and Task 10 (with it removed again) — record
that it ran and passed on each commit. If it still fails after applying this fix, that is a *new*
finding, not grounds to iterate silently — stop and escalate.

## Gate-Chain Implications Checklist

This change modifies `scripts/check-dependabot-groups.mjs`, a script `.husky/pre-commit` invokes
(CON-132's gate-chain classifier). Added after Delivery's mechanical check flagged it — D7 already
documents the substance of this change (removing/re-adding the `fortawesome` family and its interim
`DECLARED_INDEPENDENT` bridge); this section restates it in the checklist's required shape.

**What does it execute?** A pure Node.js script (no external dependencies — the file's own header
comment states this is deliberate, "so it runs as a `.husky/pre-commit` gate in linked worktrees where
the root `node_modules` may be absent entirely"). It parses `.github/dependabot.yml` with a
purpose-built subset YAML parser, cross-references every declared family/independent entry against
each ecosystem directory's manifest (`package.json`), and exits non-zero if any of three invariants
break (a family split across groups, a stale family/independent declaration naming an absent package,
or an unaccounted manifest dependency).

**What environment does it inherit, and from where?** Whatever environment `.husky/pre-commit` itself
runs under — the committer's shell, `node` on `PATH`, and the repo's own filesystem (it reads
`.github/dependabot.yml` and every `package.json` under the declared directories via `readFileSync`
relative to the script's own resolved location). No environment variables, no network access, no
credentials of any kind.

**Does it write anything outside its own sandbox?** No. The script is read-only — it never writes to
disk, never mutates `.github/dependabot.yml` or any `package.json`; its only output is `stdout`/`stderr`
diagnostics and its process exit code.

**Does it behave differently from a linked worktree than from a main checkout?** No — this is the
exact property the file's own header comment calls out as the reason it has zero dependencies: it must
run identically whether `node_modules` exists at the repo root (main checkout) or not (a linked
worktree, where `node_modules` may not be installed/symlinked). Nothing in this change altered that
property; the diff only edits `DECLARED_FAMILIES`/`DECLARED_INDEPENDENT` data and
`.github/dependabot.yml`'s own group declarations, not the script's execution model.

**What happens on its first run?** Nothing different from every other run — the script is idempotent
and stateless (no cache, no first-run initialization branch). The first invocation after this change
lands is the same `node scripts/check-dependabot-groups.mjs` the pre-commit hook always runs; it either
passes (every family/independent declaration is consistent with the manifest at that commit) or fails
with a specific, named reason. This change's own Task 0/Task 10 commit sequence (D7) was specifically
designed around this fact — the interim `DECLARED_INDEPENDENT` bridge exists because the invariant is
checked at every commit, not just once.
