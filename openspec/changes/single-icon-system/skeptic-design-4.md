## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round-3 CR2 (lucide-only inline-size enumeration) — VERIFIED CORRECT.**
Fresh independent pass, `grep -rn 'size={[0-9]' --include=*.tsx frontend/src` (plus `--include=*.ts`,
which returns zero hits). All seven files and every count in design.md D2b / tasks.md 9a.1 reproduce
exactly:
- `app/Sidebar.tsx:40,48,48` — `size={16}` x3 (3 occurrences on 2 lines) ✓
- `app/CommandBar.tsx:209` — `size={16}` ✓
- `features/dashboards/ui/ProposalReview.tsx:142` — `size={15}` ✓
- `features/panels/ui/OutputPicker.tsx:22,23,24,25` — `size={18}` x4; `:253` — `size={28}` ✓
- `features/sources/ui/SourceDetailPanel.tsx:204` — `size={13}` ✓
- `shared/chrome/BottomNav.tsx:38` — `size={22}` ✓
- `shared/chrome/SidebarBody.tsx:219` — `size={12}`; `:236,246,248` — `size={14}` x3 ✓
The only literals my pass finds that the plan does *not* list are `OrbitMark size={18}` (x5:
LoginPage/MfaVerifyPage/OAuthCallbackPage/RegisterPage/ConnectorCompletionPage) and
`MfaEnrollModal.tsx:112` `<QRCodeSVG size={180} />`. Both are correct omissions — OrbitMark is the
brand logo (explicit Non-Goal) and QRCodeSVG is not an icon component. **This enumeration is now
exhaustive; the undercount pattern is closed.**

**FontAwesome inventory — VERIFIED.** `grep -rl "@fortawesome" frontend/src | wc -l` = 57, matching
the premise-validated count. I mechanically diffed all 57 paths against tasks.md sections 2-9 —
every one is covered (the 8 `stepConfigs/*` files via 9.3's brace expansion). No `@fortawesome`
reference exists anywhere outside `frontend/src` + `frontend/package.json` +
`frontend/package-lock.json` (checked `e2e/`, `helio-mcp/`, configs, CSS), so task 10.1's dependency
removal has no out-of-scope consumer.

**Round-3 CR1 (error-state-pattern spec delta) — the delta EXISTS and VALIDATES, but its content is
not sound.** See Change Request 1.

**Live spec baseline read directly** (`openspec/specs/error-state-pattern/spec.md`): the requirement
"EmptyState icon and cta icons accept a ReactNode" does today state `IconDefinition | ReactNode`
"selected by `React.isValidElement`", with a scenario "A FontAwesome IconDefinition still renders via
FontAwesomeIcon". Round 3's finding that D6 Situation A breaks a live contract was correct.

**`icon-system` spec, third requirement (accessible-name/aria-hidden) — challenged, holds.** Its two
scenarios are falsifiable and correctly scoped as complementary to (not overlapping) `icon-button`'s
own requirement; `IconButton.tsx`'s `aria-label` is a required non-optional prop, so no delta to
`specs/icon-button/` is needed and none is claimed. `openspec validate single-icon-system --type
change --strict` passes as-is (exit 0).

**tasks.md grouping/dependency order — challenged, holds.** 1.1 (`iconSize.ts`) precedes every
consumer; 3.4b (`step.ts` type narrowing) is listed before 9.1/9.2 consume it and 9.1 re-lists the
same two files, which is redundant but not contradictory; 3.4a's cross-reference correctly couples
`pickerEmptyState.tsx`'s `chat` entry to `SidebarBody.tsx` (task 2.2) because
`pickerEmptyState.test.ts` enforces verbatim parity — a real ordering hazard, correctly caught.

### Verdict: REFUTE

One blocking issue. The rest of the plan is, in my judgment, now sound and implementable — the
sizing enumeration, the 57-file coverage, D2/D2a/D2b's sizing mechanism, D6's two-situation split,
and the D4 red-before-green discipline all reproduce against source and I found nothing further to
object to in them.

### Change Requests

1. **`specs/error-state-pattern/spec.md`'s MODIFIED delta ships a permanently self-contradicting
   scenario into the live spec, and the stated reason it had to ("the scenario name can't be
   changed") is a tooling artifact of the MODIFIED path only — a supported, clean alternative
   exists and validates.**

   The delta keeps the scenario titled **"A FontAwesome IconDefinition still renders via
   FontAwesomeIcon"** while its body says that value is "no longer a valid input". On archive this
   lands verbatim in `openspec/specs/error-state-pattern/spec.md` forever: a future reader (or grep,
   or an agent reading the spec as ground truth) sees a scenario whose *title* asserts FontAwesome
   still renders, in a codebase where `@fortawesome/*` does not exist. A scenario title that states
   the opposite of the scenario body is not a requirement — it is a landmine, and it is exactly the
   "delivery artifact, not the diff" class of defect this repo keeps getting bitten by.

   I verified the constraint and the escape hatch empirically:
   - Dropping the scenario from the MODIFIED block fails: `[ERROR] ... MODIFIED "..." omits
     scenario(s) the current spec still has ... (a MODIFIED requirement replaces the whole block, so
     archive refuses to drop them)`. So round 3's fix was responding to a real validator constraint.
   - But that constraint is scoped to `MODIFIED`. I replaced the delta file with a
     `## REMOVED Requirements` block (the old requirement, with a `**Reason**:` line naming HEL-443
     and the `@fortawesome` removal) followed by a `## ADDED Requirements` block declaring a
     cleanly-named replacement ("EmptyState icon and cta icons accept a ReactNode only") carrying
     only the `A ReactNode icon renders directly` scenario — and
     `npx openspec validate single-icon-system --type change --strict` returned **exit 0**.
     (I restored the file to its committed state afterwards; `git status` shows the change dir
     untracked and otherwise unmodified.)

   **Required:** rewrite `openspec/changes/single-icon-system/specs/error-state-pattern/spec.md` as
   a `REMOVED` + `ADDED` pair along those lines (or any other formulation that does not archive a
   scenario whose title contradicts its body), re-run `openspec validate single-icon-system --type
   change --strict`, and update `proposal.md`'s "Modified Capabilities" bullet and `design.md`'s D6
   round-3 correction paragraph to describe the delta as remove-and-replace rather than "MODIFIED
   ... the FontAwesome scenario is kept". If the executor finds a reason the REMOVED+ADDED shape is
   wrong here, say so explicitly with evidence rather than reverting to the contradictory-title form.

### Non-blocking notes

- **Task 11.1's guard is conditional in a way AC3 is not.** AC3 requires the accessible-name proof
  to be red against a pre-fix non-compliant fixture. 11.1 only mandates a Jest test *if* the
  per-file audit turns up a hand-rolled icon-only control outside `IconButton`. If it turns up none,
  11.1's first arm produces nothing and 11.2 has no test to inject a defect into. The
  decorative-icon `aria-hidden` arm of 11.1 does guarantee at least one fixture in practice (many
  decorative icons are in scope), so I do not consider this blocking — but naming one concrete
  component up front (rather than "audit while doing the swap") would remove the chance of AC3
  evaporating silently. For grounding: a crude scan of the 57 files finds raw `<button>` elements
  containing `FontAwesomeIcon` with no `aria-label`/`title` in ~11 places (e.g.
  `shared/ui/DataGrid.tsx:940`, `shared/ui/SortableTh.tsx:34`,
  `features/settings/ui/PreferencesEditor.tsx:225,322`) — most likely have adjacent text and are
  fine, but that is the population 11.1's audit should start from rather than discovering ad hoc.
- Tasks 3.4b and 9.1 both own `pipelines/types/step.ts` + `stepNarrowing.ts`. Harmless duplication,
  but 9.1 should point at 3.4b rather than restating the work, so it can't be done twice differently.
