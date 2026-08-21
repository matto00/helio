## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit evaluated: `a4bb19219a1772e1576030d36e79dae832714965`
(cycle-1's `16eb3fcae5149a7963a8ad7d11f0b2beb6581c0d` unchanged beneath it)

Cycle 1's single change request is fixed and independently re-measured. Every gate was
re-run individually with its exit status read, not inferred from the commit message. All
browser work used my own headless Chromium (Playwright required from
`/home/matt/Development/helio/node_modules`), never the shared MCP session.

### Phase 1: Spec Review — PASS

**CR-1 (the blocking defect) — fixed and verified.**
`PanelDetailModal.mobile.css:36` now reads
`padding-top: calc(var(--app-safe-top) + var(--space-4))`. `--space-4` is exactly
`Modal.css:116`'s own top value, so the treatment is additive rather than a substitution.

**CR-2 (artifacts) — done, and done properly.**
- `tasks.md` §5.3 now prescribes the additive form and states *why* the bare form is
  wrong, so the archived artifact no longer preserves the defect.
- `specs/mobile-app-shell-anchoring/spec.md` gained the requested scenario under
  "Full-viewport mobile surfaces account for the top inset": *"A treated surface degrades
  to its pre-change spacing where no inset exists"* — generalised to any treated surface
  rather than hard-coded to this one modal, which is the right level.
- `files-modified.md` records the cycle-2 correction and the new lock.
- The executor went one better than the CR asked and added
  `PanelDetailModal.mobile.css.test.ts` (a static lock), which the CR listed as optional.

**Diff is small and confined, exactly as expected.** `git diff --name-only 16eb3fca..a4bb1921`:
the one CSS file, its new test, and four artifact files. Nothing else.

**Scope creep: none. No un-asked-for edits.** I hashed every other source file across the
two commits — `App.css`, `theme.css`, `UserMenu.css`, `index.html`, `DESIGN.md` and
`RefinementChatDrawer.css` are all **byte-identical** to cycle 1.

**Fences still clean.** `git diff --name-only main...HEAD` matches nothing in
`BottomNav|DashboardList|SourcesPage|PipelinesPage|TypeRegistryBrowser|PanelCreationModal|EmptyState|IconButton`,
and `App.css`'s `.app-content` bottom-clearance rule diffs byte-identical against `main`.

### Phase 2: Code Review — PASS

**Gates — each hook run individually, exit status read (per the orchestrator's HEL-774 concern):**

| Command | Exit | Notes |
| --- | --- | --- |
| `npm run lint` | **0** | clean under `--max-warnings=0` |
| `npm run format:check` | **0** | repo-wide: "All matched files use Prettier code style!" |
| `npm run check:schemas` | **0** | 66 checked / 47 protocol files |
| `npm run check:openspec` | **1** | **one line only**: `change "anchor-mobile-command-bar" is complete (61/61) but not archived` |
| `npm run check:scala-quality` | **0** | 128 pre-existing soft warnings, no backend file touched |
| `npm test` | **0** | 239 suites / **2518 tests**, 0 failures (+1 suite, +1 test = the new lock) |
| `npm --prefix frontend run build` | **0** | built, only the pre-existing chunk-size advisory |

**The HEL-774 failure mode is specifically not present here.** That sibling's `git commit -n`
was masking a repo-wide `format:check` failure on DESIGN.md. I ran `format:check` repo-wide
(exit 0) **and** targeted it explicitly at this change's DESIGN.md and both changed files:

```
npx prettier --check DESIGN.md                                    -> exit 0
npx prettier --check PanelDetailModal.mobile.css{,.test.ts}       -> exit 0
```

Nothing other than `check:openspec`'s documented HEL-657 line is failing. The commit
message's per-hook exit-status disclosure matches my own run exactly. Legitimate bypass,
correctly disclosed.

**The fix itself.** Additive `calc()`, both operands tokens — no literal introduced, so
DESIGN.md token discipline holds. It matches the idiom the same change already uses at
`RefinementChatDrawer.css:48` and `App.css:43`, so the three treated surfaces are now
consistent. The expanded rule comment states the failure mode and the browsers it affects,
which is the right level of "why" for a non-obvious CSS declaration. Specificity and the
compound-selector reasoning are unchanged and still correct.

**The new lock is meaningful — I mutation-tested it** (helper functions replicated,
mutations applied to the real CSS in memory; no repo file modified):

| Mutation | Result |
| --- | --- |
| revert to the bare `var(--app-safe-top)` (the exact cycle-1 defect) | **RED** (both assertions) |
| `var(--space-4)` → literal `16px` | **RED** |
| `var(--space-4)` → `var(--space-3)` | **RED** |
| declaration deleted entirely | **RED** |

The `not.toMatch(/padding-top:\s*var\(--app-safe-top\)\s*;/)` negative assertion is the one
that pins the regression specifically, and it is not redundant with the positive one — it
would still fire if someone added a second, later bare declaration.

Cycle 1's other 14 lock mutations were re-verified as still valid by construction: the
files they cover are byte-identical to cycle 1.

### Phase 3: UI Review — PASS

Dev servers already healthy on 6204/9111.

**1. The specific defect, re-measured at 430x932 and 375x812, both themes, 12 configurations:**

| `--app-safe-top` | `padding-top` | title `rect.top` | "Edit panel" `rect.top` | "Close" `rect.top` |
| --- | --- | --- | --- | --- |
| none (`0px` fallback) | **16** | **16** | **16** | **16** |
| 47px | **63** | **63** | **63** | **63** |
| 59px | **75** | **75** | **75** | **75** |

Identical in light and dark at both viewports. Compare cycle 1's before-state, which read
`padTop: 0px` with all three at `rect.top: 0`. Nothing renders above the inset's lower edge
in any configuration. The other three padding sides are untouched at every inset
(right 20 / bottom 16 / left 20 — `Modal.css:116`'s `--space-5`/`--space-4`), so the fix
overrides only what it means to. The 16px no-inset value matches `main`. Visually confirmed
by screenshot: the header now has proper breathing room instead of type and buttons
flush against the modal's top edge.

**Discriminator — the probe still detects the defect class.** Re-injecting the old bare form
in-page reproduces the cycle-1 reading exactly (`padTop: 0`, title and both buttons at
`rect.top: 0`) in all four theme/viewport combinations; removing it returns the header to 16.
So the green result above is a real measurement, not a probe that cannot fail.

**2. Sibling surfaces undisturbed — including the one that must NOT have been "fixed":**

- **`App.css:66`'s bare `padding-top: var(--app-safe-top)` on the command bar is intact.**
  App.css hashes identical to cycle 1, and it measures correctly at a 47px inset:
  `rect.top` 0, border-box **103** (56 + 47), `padding-top` **47**, content box **55**.
  The bare form is right there because the bar's height token already adds the inset and
  its base padding-top is 0 — the executor correctly did not "consistency-fix" it.
- `.app-skip-link:focus-visible` still additive: focused top **12 / 59 / 71** at insets
  none / 47 / 59, and still first in tab order.
- `.refinement-drawer` still additive: `padding-top` **67** at a 47px inset (47 + `--space-5`),
  sides 20/20/20.

**3. Cycle-1 spot-check at HEAD — nothing drifted:**

- 430/light `/`, 375/dark `/`, 430/dark `/chat`: content box **55**, bar `rect.top` **0**,
  scroll trace `[0,0,0,0]`, scrolling root `scrollHeight <= clientHeight`.
- Tap targets by measurement: painted controls **28x28** box with **44x44** `::after`;
  unpainted **44** tall by rect; real `elementFromPoint` hit extent **43.75** for the
  abutting icon buttons and **44.5** elsewhere, every axis.
- Desktop 1440x900: content box **47**, painted controls 28px with **no** `::after`
  (mobile-only), full desktop control set present — unchanged from `main`.
- Modal header controls measure **44px** tall, so `IconButton.css`'s global floor is still
  doing its job outside `.app-command-bar`.
- Zero console errors post-login across every flow exercised, both themes.

**4. No legibility claim.** Re-checked the new commit message, the new comment, the new test
file and `files-modified.md`: the change still makes no claim about iOS status-bar glyph
legibility, and the commit message does not reintroduce one.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

Carried forward from cycle 1, unchanged and still non-blocking:

- `frontend/src/app/App.css` is 520 lines (437 on `main`), past `CONTRIBUTING.md`'s ~400-line
  "propose a split rather than grow it" threshold. It was already over before this change;
  worth naming in the PR description or filing a follow-up to split the command-bar rules out.
- `UserMenu.css`'s `::after` hit expander is scoped to the file's `<=768px` block rather than
  to `.app-command-bar`. Correct today (the trigger has exactly one render site,
  `CommandBar.tsx:254`) and the comment says so; just something to remember if `UserMenu` is
  ever reused on another mobile surface.
- The `auth.css` **exempt** verdict is right, but for a sharper reason than the one recorded:
  at a short viewport (measured 430x420) the auth card's top is 24px, inside a 47px inset.
  The exemption holds because iOS reports `safe-area-inset-top: 0` in landscape, which is the
  only way to reach a viewport that short on a notched device.
- Task 7.11's gap-overlap discriminator only bites on routes where `.app-command-bar__right`
  holds two or more controls. On `/chat` it holds only the user menu, so forcing the gap back
  to `--space-2` there correctly changes nothing — use `/` as the discriminating route.

One new, minor observation:

- The cycle-2 comment edit incidentally replaced an em dash with `--` on one pre-existing
  line of `PanelDetailModal.mobile.css`'s comment (line 25), while the rest of that comment
  block still uses em dashes. Purely cosmetic, passes `format:check`, no action needed.
