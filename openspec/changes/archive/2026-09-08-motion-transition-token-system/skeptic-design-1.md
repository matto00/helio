## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Re-measured the premise myself** with a multi-line-aware Python parse over all CSS in
  `frontend/src` (not a line grep). Result: **110 CSS files**, **154 `transition:`/`animation:`
  declarations, 142 of which use `var()`**, and exactly **six declarations carrying a literal
  duration**: `PanelGrid.css` (`transform/width/height 180ms ease`), `PipelineDetailPage.css`
  (`pipeline-run-pulse 1.2s`, `pipeline-run-spin 0.8s`), `StreamingText.css`
  (`streaming-text-blink 1s`), `auth.css` (`auth-card-in 0.45s cubic-bezier(0.3,0.9,0.4,1)`),
  `Spinner.css` (`ui-spinner-spin 0.7s`). Plus the two reduced-motion longhands
  (`theme.css:306/308` `0.01ms !important`, `BottomNav.css:146+` `transition: none`).
  **The orchestrator's audit reproduces exactly.** The plan's four-finding scope is the real scope;
  the ticket's headline premise is indeed largely stale.
- `theme.css:64-69` confirms three motion tokens (`--app-transition` 0.16s ease, `--transition-slow`
  0.28s cubic-bezier(0.3,0.9,0.4,1), `--app-skeleton-shimmer` 1.6s) with the shorthand/loop nuance
  already written down. DESIGN.md `### Radius / Shadow / Motion` (line 279) matches. `--transition-slow`'s
  curve is byte-identical to `auth-card-in`'s literal — D3's premise holds.
- 15 `@keyframes` / 21 `animation:` declarations enumerated; the entrance inventory in ticket.md is accurate.
- `shared/ui/toast.css:41-58` — `--toast-exit-duration: 200ms` is not incidental drift: it carries an
  8-line HEL-535 D4 rationale for being **scoped to `.toast`** as the documented counterpart of
  `Toast.tsx`'s `TOAST_EXIT_MS`, and `shared/ui/toast.css.test.ts:91` **asserts the animation references
  `--toast-exit-duration` by name**.
- `DesktopPanelGrid.tsx:26-27` imports **`react-grid-layout/css/styles.css`** and
  `react-resizable/css/styles.css`. That vendor sheet declares `transition: height 200ms ease` (grid
  container), `transition: all 200ms ease` (items), and `transition-duration: 100ms`
  (`.react-grid-placeholder`). `PanelGrid.css` overrides only `.panel-grid > .react-grid-item`; the
  placeholder and container durations are **motion that no source text in `frontend/src` carries** —
  in the exact subsystem D4 touches.
- Read `.concertino/laws/verification-before-completion.md`, CONTRIBUTING.md, DESIGN.md, and all five
  change artifacts.

### Judgments you asked for

1. **D1's two-token scale is the right call.** With five categories of which four have one or two
   consumers, a `--duration-1..6` scale would ship four tokens nobody selects and would make "pick the
   wrong step" possible for the first time. The governing rule is sound *as far as it goes* — see CR2
   for where its wording does not reach.
2. **D2 (0.7s) is right in principle** — primitive over feature, otherwise every feature is a competing
   authority — and the 0.1s delta is small enough that the running-app check is a formality, not a coin
   flip. **D3 is the one real risk** and the plan handles it correctly by naming it report-don't-resolve.
   **D4 I am refuting on substance, not on feel** — see CR1.
3. **D7's ruling is correct and I endorse it.** DESIGN.md's own phrasing of one entrance is "fade +
   4-10px rise" — a backdrop fade plus a panel rise is literally that sentence expressed across two
   elements. Not changing `MobileNavSheet`/`RefinementChatDrawer` is right. But see CR4: a ruling that
   lives only in an archived change dir does not stop the later reviewer it exists to stop.
4. **D5's allowlist boundary is principled** (reduced-motion literals are mandated by spec; single-use
   loops are D1's stated rule), but the two-direction mutation proof is weaker than it reads — CR3.
5. **D6's framing is right**; the plan's blind spot is that its own worked example of "motion no source
   text carries" is sitting in `node_modules` (CR1), and two named AC surfaces never enter the
   capture list (CR5).

### Verdict: REFUTE

Five specific, cheap revisions. None of them changes the shape of the plan; four are additions to it.

### Change Requests

1. **D4 / task 3.3 — the vendor stylesheet contradicts D4's stated benefit; account for it before
   folding 180ms to 160ms.** `DesktopPanelGrid.tsx:26` imports `react-grid-layout/css/styles.css`,
   which contributes `transition: all 200ms ease` on items, `height 200ms ease` on the grid container,
   and `transition-duration: 100ms` on `.react-grid-placeholder`. `PanelGrid.css:9-13` overrides only
   `.panel-grid > .react-grid-item`. So D4's claim that it "removes a whole ad-hoc category" is false as
   written: after the change, perceived layout motion is 160ms (items) against a **100ms placeholder** and
   a **200ms container height**, i.e. the spread widens from 180/100/200 to 160/100/200. Revise D4 to
   (a) state the vendor values explicitly as the fourth-and-fifth uncovered values, (b) decide
   deliberately whether the placeholder/container are in scope or are a reported finding for a spinoff,
   and (c) drop or restate the "removes an entire ad-hoc category for effectively no visual change"
   justification, since with the placeholder unchanged the change is a *net* cohesion claim that the
   evidence does not currently support. This is also the plan's single best instance of D6.1 and should
   be named as such.
2. **D1 / task 2.2 — `--app-exit-duration` violates D1's own rule and forces a shape-change to an
   existing guard.** Exit motion has exactly ONE consumer (`toast.css`). D1's rule is "a single-use loop
   may carry its own literal; a role used by two or more surfaces needs a token" — by that rule the exit
   duration should stay local. Worse, `toast.css:41-49` documents the local scoping as *deliberate*
   (HEL-535 D4: scoped to `.toast` as the self-documenting counterpart of `Toast.tsx`'s `TOAST_EXIT_MS`),
   and `shared/ui/toast.css.test.ts:91` asserts the declaration references `--toast-exit-duration` by
   name, so task 2.2's "or replace its uses" leg would require editing that assertion to keep it green —
   a test changed in shape to pass. Required: either **drop the `--app-exit-duration` promotion** (my
   recommendation; it is one token for one consumer, the exact sprawl D1 rejects the scale for), or keep
   it and (i) generalise D1's rule beyond loops so it actually licenses the promotion, (ii) require
   `--toast-exit-duration` to survive as a `.toast`-scoped alias of the theme token so
   `toast.css.test.ts:91` passes **unmodified**, and state that requirement in task 2.2.
3. **D5 / task 4.2 — add a third mutation arm and pin values, not just keyframe names.** The two stated
   arms prove the guard reads CSS and reads the allowlist; neither proves the allowlist is *tight*.
   Required additions: (a) a **stale-entry arm** — an allowlist entry matching nothing must fail, so a
   deleted keyframe cannot leave a permanent hole; (b) the allowlist must pin **keyframe name + exact
   duration** (like `tokenAuditSweep.css.test.ts`'s file+line baselines), otherwise `pipeline-run-pulse`
   is licensed to become any value at all. Also state in 4.3 what the guard does with a CSS file that
   contains zero motion declarations, so "110 files walked" is a real assertion rather than a count that
   passes vacuously.
4. **D7 / task 6.1 — the one-entrance ruling must land in `DESIGN.md`, not only in design.md.** D7's
   stated purpose is to stop a later reviewer removing a backdrop fade the app depends on. HEL-442/444
   reviewers read `DESIGN.md`; they do not read an archived change dir. Task 6.1 currently carries only
   D1's rule into DESIGN.md. Add: one sentence under `### Radius / Shadow / Motion` recording that a
   backdrop fade plus its panel rise is ONE entrance, naming `MobileNavSheet` and `RefinementChatDrawer`
   as the reference implementations.
5. **Tasks 1.1 / 5.1 / 5.5 — the capture list does not cover the ACs or the judgment calls it must
   support.** Three gaps: (a) AC2 names **Popover** explicitly and it is absent from 1.1; (b) the D7
   surfaces (`MobileNavSheet`, `RefinementChatDrawer`) are the ones ticket.md itself says "must be
   settled against the RUNNING APP", and they are absent — a ruling made only on the stylesheet is
   exactly what the workflow-state forbids; (c) task 5.2 requires judging `pipeline-run-spin` at 0.7s but
   **no task says how to reach the pipeline-running state**, which needs a triggered run or a forced
   state — name the mechanism or that judgment will be quietly skipped. Add Popover, both drawers, and
   `OnboardingChecklist` to 1.1/5.1, and name the state-forcing mechanism in 5.2/5.5. Likewise 5.6 asks
   for a production-build confirmation but names no mechanism (`npm run build` + preview on a free port)
   — state it, since a task with no mechanism reliably becomes a checked box.

### Non-blocking notes

- The deeper cohesion fix for D2 is that `PipelineDetailPage.css` reimplements the `Spinner` primitive
  in CSS rather than rendering it. Tokenising the duration makes two copies agree; it does not remove the
  copy. Out of scope here, but worth one line in the PR body or a spinoff so the next reviewer does not
  re-derive it.
- `animation: <name> var(--transition-slow) both` works because the animation shorthand takes
  duration-then-timing-function in that order, and `Modal.css:19` / `toast.css:53` already establish the
  precedent — D3 carries no syntactic risk.
- D8 is well-judged: `main.tsx:58` StrictMode double-invocation can re-fire a mount-triggered entrance,
  so an entrance that looks fine in dev is not evidence about prod. Nothing to change.
- AC3 (`prefers-reduced-motion`) is genuinely already met by `theme.css:304-309` plus seven component
  overrides; task 5.7's verify-don't-extend framing is the correct handling of the HEL-538 boundary.
