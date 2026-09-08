## Context

See proposal.md - Why. The measured audit is in `ticket.md` and
`.concertino/runs/HEL-441/evidence/premise-validation.md`.

The app's motion today falls into five real categories, not the two DESIGN.md names:

| category | current value(s) | token? |
| -- | -- | -- |
| hover / colour state change | 0.16s ease | `--app-transition` (51 uses) |
| surface entrance | 0.28s cubic-bezier(0.3, 0.9, 0.4, 1) | `--transition-slow` |
| layout / drag | 180ms ease (`PanelGrid` only) | none |
| exit | 200ms ease (`toast` only) | file-local `--toast-exit-duration` |
| continuous loop | 0.7s, 0.8s, 1s, 1.2s, 1.6s | only `--app-skeleton-shimmer` (1.6s) |

DESIGN.md already states the non-obvious part: the first two tokens are transition SHORTHANDS (duration and easing
combined) and a loop "needs its own duration token rather than reusing either (0.28s repeated indefinitely strobes)".
So the shape of the answer is constrained — loops cannot simply be folded onto the existing tokens.

## Goals / Non-Goals

**Goals:**

- Remove the divergences that let the scale rot — chiefly a design-system primitive and a local copy of it disagreeing
  on the same value. (Not "what a user can see side by side": the two spinners never co-render.)
- Leave the app moving the way it already moves everywhere it already agrees with itself.
- Leave behind a rule and a guard that stop the next component inventing a sixth value.

**Non-Goals:**

- See proposal.md - Non-goals. Additionally: no change to the two established tokens' VALUES. 51 surfaces depend on
  `--app-transition`; re-timing it would be a re-design of the whole app's feel under cover of a consolidation ticket.

## Decisions

**D1 (REVISED, design gate r1 CR2) - Add exactly ONE token: `--app-spin-duration`.** The original plan also promoted
`--toast-exit-duration` to a theme token. That is withdrawn: exit motion has exactly ONE consumer, so promoting it
violates this decision's own rule, and `toast.css:41-49` documents the local scoping as DELIBERATE (HEL-535 D4 — it is
scoped to `.toast` as the self-documenting counterpart of `Toast.tsx`'s `TOAST_EXIT_MS`). Worse,
`shared/ui/toast.css.test.ts:91` asserts the declaration references `--toast-exit-duration` BY NAME, so promoting it
would force that assertion to be edited — a test changed in shape to pass, which this run treats as a defect symptom.
Exit motion instead gets one documenting sentence in DESIGN.md recording that it is deliberately component-scoped.
So: one new token, for the one role two surfaces actually disagree on. The governing rule, which goes into DESIGN.md: *a single-use loop may carry its own
literal; a loop role used by two or more surfaces needs a token.* Alternative rejected: a full duration scale
(`--duration-1..6`). It reads tidy and is the standard design-system move, but this app has five categories and four
of them have exactly one or two consumers — a six-step scale would be mostly unused tokens, and unused scale steps
are an invitation to pick the wrong one. Cohesion here means fewer choices, not more.

**D2 (rationale CORRECTED at design gate r2) - Unify the spinners on the shared primitive's value (0.7s), not the
feature's (0.8s).** First, correct the justification: an earlier draft called this "the one inconsistency a user can
actually see". That is FALSE and the reviewer was right to strike it — the two spinners NEVER CO-RENDER, so no user
observes them side by side. The honest reason to unify them is narrower and still sufficient: a design-system
primitive and a local copy of it should not disagree on the same value, because that divergence is how a scale rots
one component at a time. **The strongest form of that argument, which this decision should carry explicitly:**
`PipelineDetailPage`'s `::before` ring is the LAST unconverted copy of the `Spinner` primitive — `PanelContent.css:185`,
`auth.css:253`, `MessageComposer.css:4` and `ActiveConversationPanel.css:56` were all converted by F-190. This is not
re-timing a shipped duration on a whim; it is finishing a conversion the codebase already committed to and left one
file short. `Spinner.css` is the
design-system primitive; `PipelineDetailPage`'s spinner is a local copy of the same idea. When a primitive and a
feature disagree, the primitive is the source of truth, otherwise every feature becomes a competing authority. The
20% speed increase on the pipeline spinner is the visible change and must be confirmed in the running app to look
right rather than merely consistent. **If it looks wrong at 0.7s, that is a finding to report, not to silently
resolve by keeping two speeds.**

**D3 - `auth-card-in` moves to `--transition-slow`.** Its curve is already byte-identical to the token's; only the
duration differs (0.45s vs 0.28s). DESIGN.md explicitly lists the auth card alongside modals and popovers as
"animate in once (fade + 4-10px rise)", and its 10px rise is already within that range — so the token is the
documented intent and 0.45s is drift. Risk: the auth card is a full-page hero entrance where a slower reveal may be
deliberate. An earlier draft called this "the one place a value visibly speeds up by 38%". **Design gate r2 measured it on the
running app and that framing is wrong**: the shared curve is front-loaded, so at 0.45s the card is already 89% opaque
and ~1px from rest by 200ms — moving to 0.28s lands roughly 50ms earlier, not a perceived 38% jump. Still judge it on
the running app in both themes, and if the faster entrance reads as abrupt, report it rather than inventing a third
entrance duration.

**D4 (REVISED, design gate r1 CR1) - Do NOT change `PanelGrid`'s 180ms. Report the layout-motion spread instead.**
The original plan folded 180ms into `--app-transition` (160ms), claiming it "removes an entire ad-hoc category for
effectively no visual change". **That claim is false, and the evidence is in `node_modules`.**
`DesktopPanelGrid.tsx:26` imports `react-grid-layout/css/styles.css`, which contributes `transition: all 200ms ease`
on items, `transition: height 200ms ease` on the grid container, and `transition-duration: 100ms` on
`.react-grid-placeholder`. `PanelGrid.css` overrides ONLY `.panel-grid > .react-grid-item` (it styles the placeholder
visually — radius, background, border, opacity — but never its duration). So layout motion is today 180/100/200, and
folding items to 160ms would make it 160/100/200: the spread WIDENS. The change buys no cohesion.

The only genuine fix would override the vendor placeholder and container durations too — but that is
`react-grid-layout` feel, HEL-1023's open subsystem, and the placeholder's faster 100ms snap may well be deliberate
vendor design (the drag ghost leading the item it follows). Unifying them could easily feel worse, which is precisely
the new UI/UX gap the owner's mandate forbids. So this ticket does not touch it: the three-value spread is REPORTED as
a finding and owned by a real filed ticket, **HEL-1032**, not absorbed. (A deferral is only real if a ticket owns it.)

**This is the plan's single best instance of D6.1 — motion that no `frontend/src` text carries — and it was found by a
reviewer looking in `node_modules`, not by any audit of our own source.** That is the lesson, recorded here so the
next motion ticket starts by reading the vendor stylesheets its components import.

**D5 - The guard must forbid what is new without forbidding what is legitimate.** A blanket "no literal durations in
CSS" rule would fail on the reduced-motion overrides (`0.01ms`) and on the single-use loops D1 deliberately keeps.
The guard therefore asserts: no `transition:` or `animation:` declaration carries a literal duration EXCEPT (a) inside
a `prefers-reduced-motion` block, (b) an explicit, commented allowlist of single-use loop keyframes, and (c) — added at
design gate r2 CR1 — `PanelGrid.css`'s three `180ms` transition literals, pinned to those exact declarations and
values and annotated with **HEL-1032**, the ticket that will remove them. Exception (c) exists because D4-REVISED
deliberately LEAVES those literals in place; without it the guard is specified to fail on day one and would be
"resolved" ad hoc during implementation, which is how a guard quietly becomes whatever makes the suite green. It must be
**mutation-proven in THREE directions** (design gate r1 CR3): adding a new ad-hoc duration to a real component makes
it RED; removing an allowlist entry makes it RED; and a STALE exception entry — one matching NOTHING in the tree,
whether a keyframe OR a `transition:` shorthand — makes it RED, so a removed declaration cannot leave a permanent
licensed hole. **This wording matters and round 2's version was wrong** (design gate r3 CR2): exception (c) covers
`PanelGrid.css`'s `transition:` shorthand, not a keyframe, so a keyframe-only staleness check would let exception (c)
survive forever after HEL-1032 removes those literals. What makes (c) a principled boundary rather than a hole is
precisely that it can EXPIRE. The allowlist pins **keyframe name AND
exact duration**, following `tokenAuditSweep.css.test.ts`'s file+line baseline precedent; a name-only allowlist would
license `pipeline-run-pulse` to silently become any value at all. A guard that has only ever been green has not been
shown able to catch anything.

**D6 - Token compliance is not visual cohesion, and the guard cannot see the interesting failures.** Two classes of
defect are invisible to any source-text check and must be judged on the running app:
1. **Motion that no source text carries.** A surface that does NOT animate where its siblings do is an inconsistency
   with no grep signature — the same class as lane B's 40px misalignment inherited from UA defaults, which lint,
   typecheck, 2801 unit tests and 6/6 Playwright cases all passed over. **This ticket found TWO real instances, and
   neither is in `frontend/src`:** (i) `react-grid-layout`'s vendor stylesheet contributing 100ms/200ms layout
   durations (HEL-1032); and (ii) **every chart panel entering at echarts' default `animationDuration: 1000`**
   (`echarts/lib/model/globalDefault.js:118`) — measured at 957ms and 941ms across 56 canvas repaints, **3.6x
   `--transition-slow`**, on the app's most numerous animated surface, with `ChartPanel.tsx:452`'s `notMerge={true}`
   replaying that entrance on every option change. No `animation*` option is set anywhere in `src`, so no CSS guard
   can see it. Owned by **HEL-1034**; NOT re-timed here, because re-timing the most numerous animated surface is a
   visual-design decision, not a token-consolidation side effect. A third frame was checked and is INERT, recorded so
   the next motion ticket does not rediscover it: FontAwesome injects a runtime stylesheet carrying `.fa-spin`,
   `@keyframes fa-beat` and `--fa-animation-duration`, but there are zero `fa-spin` usages and it ships its own
   reduced-motion block, so nothing is at risk today. **The generalisable lesson: a motion audit must
   start by enumerating the animation defaults of every rendering library the app embeds, not by grepping its own
   source.**
2. **State-dependent motion.** A transition correct on a loaded, populated surface can be wrong on EMPTY, LOADING,
   ERROR or FIRST PAINT. The skeleton-to-content swap, toast enter AND exit, and modal open AND close are the
   specific transitions where this bites.

**D7 - "One entrance per surface" is a judgment this ticket must make explicitly.** `MobileNavSheet` and
`RefinementChatDrawer` each run TWO animations: a backdrop fade (`--app-transition`) plus a panel rise
(`--transition-slow`). Read strictly that is two entrances; read as DESIGN.md intends ("fade + 4-10px rise") it is one
entrance expressed in two elements, because a backdrop and its panel are one surface. **This design takes the second
reading**, so those surfaces are compliant and are NOT changed. Stated here because leaving it unstated would let a
later reviewer "fix" a non-defect and remove a backdrop fade the app depends on. **This ruling MUST land in
`DESIGN.md`, not only here** (design gate r1 CR4): HEL-442/444 reviewers read `DESIGN.md`, not an archived change
directory, so a ruling recorded only in this file protects nothing.

**D8 - Verify under StrictMode reality.** `main.tsx:58` wraps the app in `React.StrictMode`, whose double-invoked
effects can mask or double-fire entrance animations in dev — lane B found it hiding a production-only bug. Entrance
verification must note whether it was observed under StrictMode and, where an entrance is the thing under test, be
confirmed in a production build.

## Risks / Trade-offs

- [The pipeline spinner at 0.7s or the auth card at 0.28s reads worse than today] -> Both are named in D2/D3 as
  report-don't-silently-resolve. Consistency that looks worse is a new UI/UX gap, which is exactly what the owner's
  mandate forbids. **Design gate r2 measured D3 on the running app and cleared it**: the shared curve is front-loaded,
  so at 0.45s the auth card is already 89% opaque and ~1px from rest by 200ms — moving to 0.28s lands roughly 50ms
  earlier, NOT a perceived 38% jump.
- [Layout motion stays inconsistent] -> ACCEPTED and owned by **HEL-1032**. D4-REVISED makes no change to
  `PanelGrid.css`, because folding 180ms to 160ms would widen the 180/100/200 spread rather than narrow it.
- [The guard is vacuous] -> D5 requires mutation proof in THREE directions (new ad-hoc duration, removed allowlist
  entry, stale allowlist entry).
- [The guard goes RED on day one] -> D4-REVISED deliberately preserves `PanelGrid.css`'s three `180ms` transition
  literals, which D5's reduced-motion/loop exceptions do NOT cover. D5 therefore carries an explicit third exception,
  pinned to those exact declarations and referencing HEL-1032 as the ticket that removes it. Without that the guard
  fails immediately and gets "resolved" ad hoc at implementation time — the worst possible outcome for a guard.
- [Over-tokenizing creates the sprawl this ticket exists to remove] -> D1 adds exactly ONE token and states the rule
  that bounds future additions.

## Planner Notes

Self-approved: `skip_specs: true` (no spec-level behaviour change); the ONE-token outcome and the single-use-loop
rule, both grounded in the measured category table above rather than a standard scale imported from elsewhere.
