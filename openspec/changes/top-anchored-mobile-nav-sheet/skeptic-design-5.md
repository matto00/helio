## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Cold run. Every claim below is derived from files I read myself in this worktree at
`82186dd7` (HEL-774 merged); the four prior skeptic reports were read as claims to check,
not as facts.

### What I verified (with evidence)

**Round 4's CR1 (double-counted anchor) — genuinely fixed.**
- `design.md:19-27` (D1) now assigns the anchor to one element: "The **clip wrapper** (D3)
  owns the anchor: `top: var(--app-top-chrome-height)` … **The panel carries no `top` of its
  own**". `tasks.md` 1.2 ("The panel gets NO `top` of its own"), 1.7 (wrapper owns it), and
  1.8 ("Do NOT also give it `top`") agree. The only `top: var(--app-top-chrome-height)`
  declaration instruction left in `tasks.md` is 1.7's, on the wrapper (grepped).
- The geometry claim checks out against ground truth: `theme.css:132-134` declares
  `--app-top-chrome-height: calc(var(--app-command-bar-height) + var(--app-safe-top))`;
  `App.css:61-73` gives `.app-command-bar { height: var(--app-top-chrome-height) }` with
  `padding-top: var(--app-safe-top)`; `theme.css:240-242` sets `* { box-sizing: border-box }`
  so the bar's 1px `border-bottom` is inside that height; `theme.css:260-261` sets
  `body { margin: 0 }` and `.app-shell` is the first in-flow child. So the bar's
  `rect.bottom` equals the token exactly, and `tasks.md` 6.2 / the AC2 scenario's
  `sheetRect.top === commandBarRect.bottom` is an exact, unambiguous equality — no
  "height plus inset" double-count left anywhere.
- `tasks.md` 6.2's mechanism is also correct, not just plausible: `--app-top-chrome-height`
  is substituted at computed-value time **on `:root`**, so forcing `--app-safe-top` anywhere
  else silently no-ops. That matches `theme.css:120-131`'s own comment and
  `theme.css.test.ts:84-86`'s existing guard. The "three measured tops must differ" clause is
  a real anti-no-op check.

**Round 4's CR2 (D9 written against an API the hook lacks) — genuinely fixed.**
- `useCreateDashboardAction.tsx:46-57` returns exactly `{ cta, error, isPending }` — no reset,
  no success callback. `design.md:100-108` and `tasks.md` 3.9 now specify the lifecycle purely
  consumer-side: a per-open-session "attempt fired" flag reset when `open` flips true, and
  success inferred from an `isPending` true→false transition observed with `error === null`,
  with a ref to exclude the initial `false`.
- I checked the batching premise the inference rests on. `handleCreate`
  (`useCreateDashboardAction.tsx:34-44`) sets `setError(...)` in `catch` and
  `setIsPending(false)` in `finally`, both in the same post-`await` continuation; React 19
  (`frontend/package.json:28`) auto-batches these into one commit, so "pending false + error
  null" is a sound success signal and "pending false + error non-null" a sound failure signal.
  Retry re-arms correctly (`setError(null)` at `:36`). No fenced file is touched.
- The stale-error hazard the flag exists to kill is real: `MobileShell.tsx:16-35` renders
  `MobileNavSheet` unconditionally and never unmounts, while `MobileNavSheet.tsx:147` unmounts
  only the sheet's DOM — so the hook's `error` genuinely outlives a sheet close.

**Rounds 1–3's eighteen CRs — spot-checked, none regressed.** Arbitration (D6 + 3.7 + 5.5 +
"Never two create affordances at once"); empty-state prop source (D11 + 4.1 + 5.8 + the parity
scenario); wrapper stacking + a fallback that actually clips (D3, and the panel is now
`relative` so the `overflow: hidden` fallback is real); runtime reduced-motion proof (D12 +
1.10 + 6.6 + scenario); requirement rename via REMOVED+ADDED + task 7.1 for the stale Purpose
(which I confirmed is still stale at `openspec/specs/mobile-dashboard-sheet/spec.md:3-6`);
44px drag strip (D4 + 2.3 + 6.3 + scenario); the scrim decision (D2 + 1.3/1.4/6.4 +
scenarios); the dashboards flow/label/glyph honesty (AC3 + 3.5 + the "hook's own `cta`"
scenario); error/pending treatment (D9 + 3.8 + two scenarios); initial focus (D10 + 2.5 +
scenario); max-height/bottom-nav clearance (D5 + 1.5 + 6.5 + scenario); registry's corrected
premise (D7 + 3.2 + the registry scenario); aggregate `--bottom-nav-height` consumption;
`padding-bottom: env(safe-area-inset-bottom)` removal (1.2); and the spec/proposal wording no
longer promising strings the hooks cannot render.

**D2's z-index premise, independently re-derived.** `theme.css:81-82` (`--z-popover-scrim: 99`
/ `--z-popover: 100`), `App.css:2-17` (`.app-shell { position: relative; z-index: 1 }` — a
stacking context), `App.css:73-74` (`.app-command-bar { position: relative; z-index: 2 }`).
A body-portalled `inset: 0` scrim at 99 therefore does dim the entire bar including the
trigger, exactly as D2 states. I independently agree with rounds 3 and 4 that starting the
scrim at the seam is the right trade: dimming the bar destroys the one property the whole
ticket exists to buy, and the fallback (full-viewport scrim) is correctly recorded.

**Fence compliance.** The plan touches none of `SidebarBody`/`SidebarItemList`/`DashboardList`/
the HEL-548 hooks/`features/onboarding` (tasks 4.1 and 3.1/3.2 say so explicitly, and 4.1
tells the executor to escalate rather than cross). `useAddSourceAction.tsx` /
`useCreatePipelineAction.tsx` are pure flag flips with no `useEffect`, and
`useCreateDashboardAction.tsx` has none either — D8's "verified inert" across three call sites
(`CommandBar.tsx:72`, `MobileShell.tsx:18`, `App.tsx:62`) holds.

**D7's mount claim, verified structurally (AC9).** `App.tsx:206-209` mounts
`CreatePipelineModal` for every route except `/pipelines`, so `/registry` is covered with no
new mount; `SourcesPage.tsx:26` owns `AddSourceModal` on `/sources`; dashboards needs no
modal. `SidebarBody.tsx:240-249` does pass `useCreatePipelineAction().cta` as the Data Types
list's `emptyCta` with the decision recorded in a comment — so D7's desktop-parity argument is
factually grounded.

**Empty-state parity table is buildable.** All five sidebar-owned sections carry
`emptyText`/`emptyIcon`/`emptyDescription` in `SidebarBody.tsx` (`:128-130`, `:160-162`,
`:197-199`, `:239-241`, `:334-335`), with mixed lucide-`ReactNode` and FontAwesome icons —
both of which `EmptyState.tsx:25-27` accepts. Dashboards is correctly excluded from the lock
(its sidebar copy lives in the fenced `DashboardList`).

**The 44px floor, checked for the "reads right / computes wrong" trap.** `EmptyState.css:219-227`
puts `min-height: 44px` on the *base* `.ui-empty-state__cta` selector inside
`@media (max-width: 768px)`, while `:163-168` sets `height: var(--control-sm)` (28px) on the
more-specific sidebar variant. Different properties, so specificity is irrelevant and
`min-height` clamps the used height to 44px — it computes correctly today. `tasks.md` 6.3
mandates `getComputedStyle` at 430 **and 768** (the boundary where `max-width: 768px` still
matches — the case HEL-535 hid in), never reading CSS, for rows, header action,
`.ui-empty-state__cta`, and the drag strip. `tasks.md` 4.4 correctly retires
`EmptyState.css:222`'s now-false "the sidebar column is not mounted at this breakpoint"
comment.

**DESIGN.md read fresh, not recalled** (373 lines, last touched by `82186dd7`). The two
HEL-774 clauses the brief named do exist: the bottom-nav opacity carve-out at `:123-181` and
the sanctioned `::after` hit expander at `:203-209`. Nothing in the plan cites a rule that
isn't in the file, and `tasks.md` 1.1 makes "cite no rule you have not confirmed exists" an
explicit first step. Token discipline holds throughout: every value the plan names is a token
(`--app-top-chrome-height`, `--bottom-nav-height`, `--space-3`, `--z-popover`,
`--app-transition`) except the two literal `44px` tap floors, which DESIGN.md `:196-203`
explicitly sanctions as literals, and `-100vmax`, which is a clip geometry, not a spacing
value.

**Spec delta integrity.** `openspec validate top-anchored-mobile-nav-sheet --strict` →
`Change 'top-anchored-mobile-nav-sheet' is valid`. All four MODIFIED/REMOVED requirement names
match real headings in `openspec/specs/mobile-dashboard-sheet/spec.md`, and I diffed each
MODIFIED requirement against its base: no clause or scenario is silently dropped (swipe-down →
swipe-up is the one intentional inversion; "no editing affordances" → "beyond the section's
create action" is the one intentional narrowing, carried by the REMOVED/Migration note).

**Every AC traces to at least one task**: AC1→1.7/1.9/6.7, AC2→1.2/1.7/6.2, AC3→3.x/5.4/6.3,
AC4→2.1/5.6, AC5→1.10/6.6, AC6→6.7, AC7→6.8, AC8→4.1/4.2/5.7, AC9→4.3/5.4. No placeholders
survive (`TODO`/`TBD`/`--space-N`/"figure out" all grep clean).

### Design judgment (mine, not deferred)

The motion reads right. A panel translating `-100%`→`0` inside a wrapper clipped at its top
edge, emerging from beneath an undimmed command bar, with the radius/border mirrored to the
bottom edge (`tasks.md` 1.2) and the grabber on the bottom free edge, is the standard
top-sheet / notification-shade language, and it genuinely originates at the trigger's chrome
rather than merely appearing near it. Three details raise it above adequate: the `--space-3`
bottom gap deliberately matching `--bottom-nav-inset` so the sheet and the floating capsule
share one rhythm (`design.md:65`); the grabber landing at the *reachable* bottom of a sheet
that necessarily occupies the hard-to-reach top half; and D9b's chevron flip, which makes the
one glyph carry both direction and state. `variant="sidebar"` for the empty branch is the
right weight — `.ui-empty-state--main` is a 320px-min-height Fraunces hero
(`EmptyState.css:12-52`), which inside a switcher would read as a page, not a picker.

I looked for reasons to fail it on aesthetics and did not find one that survives contact with
the alternatives. The undimmed-but-inert bar is a small honesty gap, but every fix for it
(dimming the bar, greying its controls) destroys the anchoring read that is the ticket's
entire thesis, and `design.md:152-155` already routes it to visual judgment at the final gate
alongside the dark-theme tonal step (panel `--app-surface-strong` sitting *lighter* than the
bar's `--app-surface`). Those are final-gate calls on rendered pixels, not design-gate
blockers. The genuine polish deficit — no exit animation, so an upward flick dismisses with no
motion back toward the bar — is pre-existing, fenced to HEL-565, and already captured in the
Planner Notes spinoff.

### Verdict: CONFIRM

No stable, reproduced defect would produce a wrong, unverifiable, or fence-violating
implementation. The four notes below are real drift worth fixing in passing; each is
contradicted elsewhere in the same artifacts and would be caught by the plan's own gates, so
none blocks.

### Non-blocking notes

1. **`tasks.md` 3.3 and 4.2 use the singular `createAction` where D6's two-slot model needs
   `emptyCreateAction`.** Task 3.1 introduces both slots and 3.2 says registry sets **only**
   `emptyCreateAction` — but 3.3 says "Thread `createAction` through `MobileShell` into
   `MobileNavSheet`" and 4.2 says the empty branch passes "`createAction.cta` where non-null".
   Read literally, registry (whose `createAction` is null) gets no CTA anywhere and the slot
   wired in 3.2 is dead code — reintroducing exactly the dead end round 3's CR2 removed. D6,
   3.1, 3.2, 3.7, task 5.7 and the spec's "The registry offers a create action only when
   empty" scenario all point the other way, and 5.7's own test would go red, so this is
   self-correcting — but fixing the two words costs nothing.

2. **D7's dead-end rationale is overstated and should be softened before it reaches the
   archived capability.** `design.md:82-83` says omitting the registry CTA "would leave the
   phone registry empty state a dead end". `TypeRegistryBrowser.tsx:49-58` already renders
   `EmptyState variant="main"` with `cta={createPipelineAction.cta}` when the registry is
   empty, on every viewport — so the *section* is not a dead end on phone today; only the
   sheet's own empty branch would be, and the user is one dismiss away from the page's hero
   CTA. The decision itself is right and stands on its stronger argument (parity with the
   desktop sidebar's shipped `emptyCta`-not-`onAdd` treatment, `SidebarBody.tsx:242-249`).
   Given this repo's history of confidently-false documentation surviving into specs, trim
   the claim to what's true.

3. **Two `App.test.tsx` assertions on retired `emptyMessage` strings are unowned.** Task 4.3
   names only `MobileNavSheet.test.tsx:92-97` as superseded. `App.test.tsx:751`
   (`findByText("No pipelines yet.")`) and `App.test.tsx:977`
   (`findByText("No conversations yet.")`) also assert those strings, through the real
   `usePickerSelection` → `MobileShell` → sheet path, and will fail once the table supplies
   the sidebar copy ("Build your first pipeline" / "No conversations yet" without the period).
   `npm test` will surface both; worth updating rather than deleting — they are the only
   App-level integration proof that the empty branch renders end to end, which is AC8's real
   shape.

4. **Task 6.4 doesn't name its instrument, and the naive one gives a false red.** `clip-path`
   is a paint- and hit-test-time clip: during the entrance the panel's
   `getBoundingClientRect()` *will* extend above the seam even when the implementation is
   perfectly correct, because rects don't reflect clipping. An executor asserting
   `panelRect.top >= commandBarRect.bottom` mid-animation would chase a phantom and could
   "fix" working CSS. Say explicitly that the probe is `document.elementFromPoint()` at the
   bar's and the trigger's centres (hit-testing does respect `clip-path`) or a sampled-pixel
   comparison — the same "rendered pixels, never source" discipline DESIGN.md `:176-179`
   already mandates for compositing effects.

5. **Consider a static ordering lock for the two new 44px rules.** Task 5.3 enumerates only
   negative locks (no `env(safe-area-inset-top)`, no bottom-nav token in `top`, no lingering
   `padding-bottom`). `BottomNav.css.test.ts:200-211` is the cheap precedent for the positive
   one: assert the selector appears exactly once so a later equal-specificity `@media` rule
   can't silently shadow it — the HEL-535 defect class. Task 6.3's runtime measurement is the
   stronger guard and is correctly mandated; this just keeps it from rotting after the fact.

6. **D9b's chevron flip has no spec clause.** The delta already MODIFIES "Tappable command-bar
   title on phone" to add the toggle behaviour, and that requirement is the one that describes
   the chevron — adding "and the glyph SHALL indicate the sheet's open/closed state" there
   costs one line and keeps task 2.6 from shipping unspecified, untested behaviour.

7. **Cosmetic:** `tasks.md` lists 2.6 before 2.5 (an insertion artifact from round 4).
