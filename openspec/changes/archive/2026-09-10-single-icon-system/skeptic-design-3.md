## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

All four re-check items from the round-2 fix summary were verified directly against source
in the worktree. Three of four are clean; the fourth surfaced a new, adjacent defect.

**(d) CR5 token math — CORRECT.** `frontend/src/theme/theme.css:24-27`:
`--text-xs: 0.75rem /*12px*/`, `--text-sm: 0.875rem /*14px*/`, `--text-base: 1rem /*16px*/`,
`--text-lg: 1.125rem /*18px*/`. `IconButton.css:38-53` confirmed: `--xs` → `--text-sm` (14),
`--sm` → `--text-base` (16), `--md` → `--text-lg` (18). So D2's mapping is right:
xs→ICON_SIZE.sm(14) unchanged, sm→ICON_SIZE.md(16) unchanged, md→ICON_SIZE.lg(20) = +11%
increase (correctly labelled as deliberate). D2a's `--text-xs`=12 → 14 = +16.7%, stated as
"+17%" — accurate.

**(a) CR1/CR2 withdrawal — CORRECT and coherent.** `IconButton.tsx:11` is `icon: ReactNode`;
the seven text-glyph call sites are exactly as cited and complete (`grep -rn 'icon="'` over
`frontend/src` returns precisely those 7: `TableDisplayFields.tsx:135,144,152,161`,
`DashboardList.tsx:207`, `PanelCard.tsx:294`, `SidebarItemList.tsx:305`). Leaving
`IconButton.tsx`/`.css` untouched and requiring an explicit `size` at each migrated call site
is internally coherent — `IconButton` renders `{icon}` opaquely inside `.ui-icon-btn__icon`,
so a per-call-site `size` prop is the only mechanism available short of an API change, and it
composes with the surviving `font-size` rules (which lucide simply ignores).

**(b) CR3 Situation A/B — factually CORRECT.** Verified each of the five Situation-A files:
`EmptyState.tsx:1-2,16,27,48-64` (`isValidElement` dispatch, HEL-539 comment);
`PageStatus.tsx:40` union + `:131` `icon={icon ?? <TriangleAlert />}`;
`pickerEmptyState.tsx:9` union with 4 lucide element entries and exactly one `faComments`
entry; `SidebarItemList.tsx:41-45` union with the HEL-548 task-7.2 comment;
`MobileNavSheet.tsx:65-88` `renderCreateActionIcon` with its own `isValidElement` branch.
Situation B also verified clean: `pipelines/types/step.ts:11,18` is `icon: IconDefinition`
with no union, and `grep -rn 'opType.icon\|\.icon}' features/pipelines/` returns exactly the
two consumers named (`OpDropdown.tsx:115`, `StepCard.tsx:206`). `stepNarrowing.ts:99-116+`
holds the producer assignments. (Nit: step.ts imports `IconDefinition` from
`free-solid-svg-icons`, not `fontawesome-svg-core` as the other files do — immaterial, both
go away.)

**(c) CR4 em-sized CSS sites — all REAL.** Every cited line confirmed: `InlineError.css:23,62`,
`MobileNavSheet.css:181`, `StatusMessage.css:22`, `OnboardingChecklist.css:116,131`,
`DashboardList.css:126`, `SchemaFieldViewer.css:74`, `EmptyState.css:180,210`. The narrowed
spec requirement text ("sized via an inline `size` prop/literal ... icons sized instead via
CSS ... are outside this requirement's scope") does not contradict task 9a.1, which only
touches inline literals. Consistent.

**New fresh-pass checks (this round):**
- `grep -rn 'size={[0-9]' --include=*.tsx frontend/src` — see CR2 below.
- `grep -rln 'IconDefinition\|emptyIcon' openspec/specs/` — see CR1 below.
- Confirmed `MfaEnrollModal.tsx:112 size={180}` is `QRCodeSVG`, not a lucide icon (correctly
  not in scope); `OrbitMark size={18}` ×5 is the brand logo, explicitly a Non-Goal.

### Verdict: REFUTE

Two defects, both specific and mechanical to fix. Neither reopens the round-1/round-2 ground.

### Change Requests

1. **A live spec requirement contradicts task 3.4a, and no spec delta is planned for it.**
   `openspec/specs/error-state-pattern/spec.md:26-38` contains:

   > ### Requirement: EmptyState icon and cta icons accept a ReactNode
   > The `EmptyState` component's `icon` prop, and its `cta.icon`/`secondaryCta.icon` props,
   > SHALL each accept either a FontAwesome `IconDefinition` (existing behavior, rendered via
   > `FontAwesomeIcon`) or a `ReactNode` (rendered directly), selected by
   > `React.isValidElement`.
   >
   > #### Scenario: A FontAwesome IconDefinition still renders via FontAwesomeIcon
   > - **WHEN** `EmptyState` is rendered with `icon={faTableColumns}`
   > - **THEN** the icon renders identically to its pre-existing behavior

   Task 3.4a deletes exactly this behavior (drops the `IconDefinition` arm, deletes the
   `isValidElement` branches). design.md D6 asserts of Situation B that "unlike Situation A's
   five files, there is no existing spec/capability contract this touches" — which concedes
   Situation A *does* touch one, but the change directory contains only
   `specs/icon-system/spec.md`. Without a delta, this change ships a repo whose spec says
   `EmptyState` renders `faTableColumns` via `FontAwesomeIcon` while `@fortawesome/*` no
   longer exists in `package.json`.

   Required: add a `specs/error-state-pattern/spec.md` delta to the change (a `MODIFIED
   Requirements` block rewriting that requirement to `ReactNode`-only and removing the
   FontAwesome scenario — or a `REMOVED` + `ADDED` pair, whichever openspec validation
   accepts), and add a task under section 3 that authors it. Also correct D6's Situation-A
   paragraph, which currently implies no contract is affected.

2. **D2b's "four lucide-only files carry non-standard inline-literal sizes" is incomplete —
   at least three more exist, one of them in no task section at all.** Fresh
   `grep -rn 'size={[0-9]' --include=*.tsx frontend/src` (excluding the `QRCodeSVG` and
   `OrbitMark` cases noted above) finds, beyond the four enumerated:
   - `shared/chrome/BottomNav.tsx:38` — `<Icon className="bottom-nav__icon" size={22} />`,
     where `Icon` is `destination.icon: LucideIcon` (`shared/chrome/navDestinations.ts:15`).
     **22 is not 14/16/20**, so it is a violation of the icon-system sizing requirement as
     written. `BottomNav.tsx` imports neither FontAwesome nor `lucide-react` directly, so it
     appears in no task in sections 2-9 and is reachable only via 9a.1's "re-grep" hedge.
     Dropping 22→20 is a visible shrink of the mobile bottom-nav glyphs that no artifact has
     ruled on.
   - `shared/chrome/SidebarBody.tsx:219` `size={12}` (also not 14/16/20), plus `:236,246,248`
     `size={14}` raw literals. This file *is* in scope (task 2.2) for its FA icons, but its
     existing lucide literals are not mentioned.
   - `app/CommandBar.tsx:209` `size={16}` — compliant *value*, raw literal, i.e. exactly the
     case `Sidebar.tsx`'s `size={16}` was enumerated for.

   Task 9a.1's trailing "re-grep ... not a guaranteed-exhaustive list" instruction is good
   and partly mitigates this, but the same class of confidently-stated-and-wrong enumeration
   has now been the basis of a REFUTE in all three design rounds, and one of these
   (`BottomNav` 22→20) is a judgment call, not a mechanical rename.

   Required: extend task 9a.1's enumeration with `shared/chrome/BottomNav.tsx` (`size={22}`),
   `shared/chrome/SidebarBody.tsx` (`size={12}`, `size={14}`×3) and `app/CommandBar.tsx`
   (`size={16}`), state the intended target for each, and correct D2b's "Four lucide-only
   files" sentence to match. State explicitly whether `BottomNav`'s 22→`ICON_SIZE.lg` (20) is
   accepted as a deliberate size reduction in the mobile nav (with visual verification
   required), or whether that file is instead carved out as a Non-Goal — either is fine, but
   it must be decided in the artifacts rather than left to the executor's re-grep.

### Non-blocking notes

- `pipelines/types/step.ts:2,7`'s file-header comments describe the icon as "FontAwesome" —
  worth updating alongside task 3.4b so the comment doesn't outlive the dependency.
- `pickerEmptyState.tsx`'s header comment claims `sources`/`pipelines`/`chat` entries "match
  `SidebarBody.tsx`'s `SidebarItemList` props verbatim" and are locked by
  `pickerEmptyState.test.ts`. `SidebarBody.tsx` imports `faComments` (line 6) — so the
  `faComments`→`<MessagesSquare />` conversion in 3.4a must be made in both files together or
  that lock test will fail. Task 2.2 covers `SidebarBody.tsx` and 3.4a covers
  `pickerEmptyState.tsx`, in different sections; a cross-reference between them would help.
