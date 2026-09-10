## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Round-1 change requests, re-checked against source (not against the prose):

- **CR1 (IconButton CSS sizing) — acknowledged, but the resolution is unsound.** D2's correction of
  the mechanism is right; its prescription is not. See CR1 below.
- **CR2 (SortableTh) — RESOLVED.** `frontend/src/shared/ui/SortableTh.css:31-34` still carries
  `font-size: var(--text-xs)` with the HEL-1022 comment; D2a names the file, the history, and
  requires the declaration be removed, and task 3.2a implements it. Correct.
- **CR3 (spec broader than tasks) — resolved for the *literal* case only.** Task 9a.1 covers the four
  files; I re-confirmed the literals (`Sidebar.tsx:40` `size={16}`, `ProposalReview.tsx` 15,
  `OutputPicker.tsx` 18×4/28, `SourceDetailPanel.tsx` 13). A second population makes the spec
  requirement still false on shipping — see CR4.
- **CR4 (IconDefinition prop shape) — acknowledged, but D6 is factually wrong about 5 of the 7
  files.** See CR3 below.
- **CR5 (faClone citation) — RESOLVED.** `grep -rn faClone frontend/src` → only
  `features/pipelines/state/stepNarrowing.ts:16,114` (`{ id: "dedupe", label: "Dedupe rows" }`).
  D5's table, Risks, and task 9.2 now all say `Files`, not `Copy`. Correct.
- **CR6 (task 11.1 pointer) — RESOLVED.** `e2e/focus-presence-guard.spec.ts` and
  `e2e/hel520-focus-presence-guard.regression.spec.ts` both exist (`ls e2e/`), and 11.1 now correctly
  says they are *not* reusable for accessible-name coverage, pointing instead at IconButton's
  compile-time `aria-label` and a co-located Jest pattern. Followable.
- **Counts — RESOLVED.** `grep -rl lucide-react frontend/src | wc -l` → 35 (design.md now says 35);
  `grep -rl @fortawesome frontend/src | wc -l` → 57.

Fresh checks I ran this round (files read in full or at cited lines):
`shared/ui/IconButton.tsx`, `shared/ui/IconButton.css:33-55`, every `<IconButton>` call site
(`grep -rn -A6 "<IconButton"`), `shared/ui/EmptyState.tsx`, `shared/ui/PageStatus.tsx`,
`shared/chrome/{pickerEmptyState,SidebarItemList,MobileNavSheet}.tsx`, `pipelines/types/step.ts`,
`shared/chrome/InlineError.{tsx,css}`, `features/onboarding/ui/OnboardingChecklist.css`,
`theme/theme.css:24-27`, and `grep -rn "width: 1em" --include=*.css frontend/src`.

### Verdict: REFUTE

The four "resolved" items above are genuinely resolved. The two decisions written *to* resolve CR1
and CR4 — D2's canonical mechanism (implemented by task 1.3) and D6 — are each contradicted by the
code they describe, and 1.3 in particular would break seven live call sites and a shipped
em-relative sizing convention. Round 1's diagnosis was accepted; the prescriptions were not
validated against the call sites.

### Change Requests

1. **D2/task 1.3's "the `font-size` declarations are dead weight, remove them" is false — they still
   size live content.** `IconButton`'s `icon` prop is `ReactNode` (`IconButton.tsx:11`), and seven
   call sites pass a **bare text character**, not an icon component:
   `features/panels/ui/PanelCard.tsx:294` (`icon="×"`),
   `features/panels/ui/editors/TableDisplayFields.tsx:135,144,152,161` (`"⤒" "↑" "↓" "⤓"`),
   `features/dashboards/ui/DashboardList.tsx:207` and `shared/chrome/SidebarItemList.tsx:305`
   (`icon="+"`). For those, `font-size` is the *only* sizing mechanism and no `size` prop can replace
   it. Separately, `shared/chrome/InlineError.css:61-64` sizes an **already-lucide** icon
   (`InlineError.tsx:78`'s `<RotateCw className="inline-error__retry-icon" />`, rendered inside
   `<IconButton size="xs">`) as `width/height: 1em` — i.e. it inherits from exactly the
   `.ui-icon-btn--xs` `font-size` D2 wants deleted. Removing those three declarations shrinks or
   distorts all of the above. Revise D2 to state what happens to text-glyph `icon` values and to
   em-sized icons before declaring the CSS dead (options: keep the `font-size` declarations as the
   text-glyph mechanism and let the `size` prop govern SVGs; or convert the seven text glyphs to
   lucide components as part of this change — but say which, since 1.3 currently assumes neither
   case exists).

2. **Task 1.3's narrowing of `icon` from `ReactNode` to a `LucideIcon` component reference is an
   unscoped breaking API change with no decision behind it, and it loses per-call-site props.**
   Beyond the seven string call sites in CR1, it breaks `shared/chrome/InlineError.tsx:78`, which
   passes `<RotateCw aria-hidden="true" className="inline-error__retry-icon" />` — a component
   *reference* cannot carry that `className`, and `IconButton` exposes no `iconClassName` passthrough.
   `IconButton.test.tsx` uses `icon={<span>x</span>}` at eight sites (1.3 acknowledges the test
   update but not that the fixture shape itself becomes illegal). Also note this changes the
   published contract of a spec'd capability (`openspec/specs/icon-button/spec.md`) with no
   `specs/icon-button/` delta planned in this change. Either (a) keep `icon: ReactNode` and have
   call sites pass `<Trash2 size={ICON_SIZE.md} />` (no IconButton API change; costs the
   variant→size auto-wiring), or (b) keep the narrowing but add a decision covering the string
   glyphs, a `className`/props passthrough, the test fixtures, and the `icon-button` spec delta.
   Right now 1.3 asserts the change in one line and D2 never discusses the prop's current type.

3. **D6 is wrong about five of the seven files: they are already `IconDefinition | ReactNode`, and
   already have shipped lucide producers.** D6 says the prop "type[s] an icon as a data object
   (`IconDefinition`)" and prescribes changing it to `LucideIcon` with producers passing component
   references. Actual source:
   - `shared/ui/EmptyState.tsx:16,27` — `icon?: IconDefinition | ReactNode`, with
     `renderIcon`/`renderCtaIcon` (lines 48-64) branching on `isValidElement` (HEL-539).
   - `shared/ui/PageStatus.tsx:40` — same union; line 132 already defaults to `<TriangleAlert />`.
   - `shared/chrome/pickerEmptyState.tsx:9` — same union; four of its five entries already pass
     rendered lucide **elements** (`<LayoutDashboard />`, `<Database />`, `<GitBranch />`), only
     `faComments` (line 47) is FontAwesome.
   - `shared/chrome/SidebarItemList.tsx:45` — `emptyIcon?: IconDefinition | ReactNode` (HEL-548
     task 7.2 explicitly widened it).
   - `shared/chrome/MobileNavSheet.tsx:77-88` — `renderCreateActionIcon(icon: IconDefinition |
     ReactNode | undefined)`.
   Only `features/pipelines/types/step.ts:18` is genuinely `IconDefinition`-only. So D6's
   prescription would *reverse* the already-shipped element-valued convention at five sites and force
   rewriting producers that are already lucide-clean. The minimal, non-regressive migration is the
   opposite: drop the `IconDefinition` arm of the union, keep `ReactNode`, delete the
   `isValidElement` branches, and convert only the remaining FontAwesome producers — with
   `step.ts` handled on its own terms. Rewrite D6 (and task 3.4) against what those files actually
   declare. Note this also contradicts CR2's option (b): the codebase's established icon-prop
   convention is element-valued, not component-reference-valued.

4. **The `icon-system` spec's sizing requirement is still false on shipping — a second unaddressed
   population.** At least ten CSS rules size a lucide icon relatively via `width/height: 1em`
   (`shared/chrome/InlineError.css:23,62`, `shared/chrome/MobileNavSheet.css:181`,
   `shared/chrome/StatusMessage.css:22`, `features/onboarding/ui/OnboardingChecklist.css:116,131`,
   `features/dashboards/ui/DashboardList.css:126`, `shared/ui/SchemaFieldViewer.css:74`,
   `shared/ui/EmptyState.css:180,210`). Those instances are sized by neither an inline literal nor
   `ICON_SIZE`, so the requirement "**every** `lucide-react` icon instance SHALL be sized via [the]
   shared size constant" is violated by them regardless of tasks 9a.1 and 1.3 — which enumerate only
   the four *literal-size* files. Resolve the same way CR3 was resolved: either widen the task list to
   normalize (or explicitly bless) em-sized icons, or scope the spec requirement to inline `size`
   literals and record the em convention as an accepted alternative in Non-Goals. This also interacts
   with CR1 — deleting `font-size` under an `em`-sized child is exactly the failure mode.

5. **Two sizing claims in D2/D2a don't match the token values.** `theme/theme.css:24-27` gives
   `--text-xs: 12px, --text-sm: 14px, --text-base: 16px, --text-lg: 18px`. D2's mapping is
   `xs→14, sm→16, md→20` and claims it "preserv[es]" the visual size relationship — `md` actually
   grows from 18px to 20px (+11%). D2a maps `SortableTh`'s `--text-xs` glyph to `ICON_SIZE.sm` (14)
   and calls that "match[ing] the existing `--text-xs` visual weight" — it is 12px today, a +17%
   change in a header the HEL-1022 comment says is ~10px tall. Neither is necessarily the wrong
   call, but state them as deliberate size changes (with the visual check that implies) rather than
   as preservation, so the executor doesn't treat a visible difference as a mistake.

### Non-blocking notes

- The `Group` / `Columns3` pre-check note from round 1 was carried into Risks — good; still worth
  doing before the swap rather than discovering it at `tsc` time across 20 pipeline files.
- `IconButton.tsx:9-10`'s doc comment ("The icon glyph (e.g. a `FontAwesomeIcon`)") will need
  updating whichever way CR2 lands; not currently mentioned in task 1.3.
