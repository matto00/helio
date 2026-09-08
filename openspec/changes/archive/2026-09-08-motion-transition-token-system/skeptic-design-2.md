## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn. Everything below is derived from the files and the running app, not from the round-1
report or the orchestrator's summary of its own edits.

### What I verified (with evidence)

**Round-1 change requests — checked in the files, not taken on trust.**

- **CR1 CLOSED.** `design.md` D4 is titled "REVISED, design gate r1 CR1 — Do NOT change `PanelGrid`'s
  180ms", names the vendor values, and calls itself the best instance of D6.1. `tasks.md` 3.3 says
  "make NO change to `PanelGrid.css`"; 5.3 replaces the regression check with an observation task. I
  re-read the vendor sheet myself: `frontend/node_modules/react-grid-layout/css/styles.css:3`
  `transition: height 200ms ease`, `:6` `transition: all 200ms ease`, `:35`
  `transition-duration: 100ms`. `react-resizable/css/styles.css` carries **no** motion. Those two are
  the only non-`src` CSS imports in the tree (`DesktopPanelGrid.tsx:26-27`; a grep for non-relative
  `import "…"` finds nothing else).
- **CR1 deferral is honestly owned.** I read HEL-1032 in Linear (Backlog, v0.7 project, created
  2026-09-08). Its table carries exactly the 180/100/200 split, the vendor file, the
  `DesktopPanelGrid.tsx:26` import site, the "spread widens" reasoning, and the two out-of-scope
  reasons. It covers what D4 dropped, without overclaiming.
- **CR2 CLOSED.** D1 is retitled "Add exactly ONE token: `--app-spin-duration`"; task 2.2 now says
  leave `--toast-exit-duration` alone and verify `toast.css.test.ts` passes **unmodified**;
  `proposal.md` Impact lists `toast.css` as deliberately untouched; task 6.1a adds the DESIGN.md
  sentence. No artifact still asks for `--app-exit-duration`.
- **CR3 CLOSED.** D5 requires mutation proof "in THREE directions" including the stale-entry arm and
  requires the allowlist to pin keyframe name AND exact duration; task 4.2 mirrors all three and
  demands three pasted transcripts; 4.3 requires stating the zero-motion-file behaviour.
- **CR4 CLOSED.** Task 6.1(c) requires D7's ruling in `DESIGN.md`, naming `MobileNavSheet` and
  `RefinementChatDrawer`.
- **CR5 CLOSED.** Task 1.1 now lists Popover, Modal open/close, Toast enter/exit, both D7 drawers and
  OnboardingChecklist; 1.1a names the pipeline-run mechanism; 5.6 names `npm run build` + preview on a
  non-conflicting port.

**Running app (servers started via `scripts/concertino/start-servers.sh`, `assert-phase.sh servers` →
`PASS servers`; 5873/8780; both themes).**

- **D3 (auth card 0.45s → 0.28s) — settled, and the "38% speed-up" framing overstates it.** On
  `/login` I read the live animation: `animation: 0.45s cubic-bezier(0.3, 0.9, 0.4, 1) both
  auth-card-in`, and `--transition-slow` computes to `0.28s cubic-bezier(0.3, 0.9, 0.4, 1)` — curves
  byte-identical, as claimed. I then sampled both timings through the Web Animations API on the real
  element. That curve is heavily front-loaded, so the two are perceptually much closer than the
  nominal durations suggest:

  | t (ms) | opacity @0.45s | translateY @0.45s | opacity @0.28s | translateY @0.28s |
  | -- | -- | -- | -- | -- |
  | 50 | 0.32 | 6.81px | 0.49 | 5.10px |
  | 100 | 0.59 | 4.13px | 0.80 | 1.95px |
  | 150 | 0.78 | 2.25px | 0.94 | 0.61px |
  | 200 | 0.89 | 1.13px | 0.99 | 0.15px |

  At 0.45s the card is already 89% opaque and within ~1px of rest at 200ms; the remaining 250ms is an
  imperceptible tail. At 0.28s it reaches the same place ~50ms earlier. **This does not read as
  abrupt** — a 10px rise settling in ~200ms is squarely inside the normal entrance band, and it is the
  same curve every other entrance in the app already uses. D3 is safe; the "one place a value visibly
  speeds up by 38%" risk note is nominal, not perceptual.
- **Auth card is genuinely ONE entrance** (AC2): `card.getAnimations()` returns exactly
  `[auth-card-in]` and no descendant of `.auth-card` has any animation. Verified in dark and light
  (`/login` screenshots, both themes; card, shadow, field and button treatment all read correctly in
  each).
- **D7 — settled against the running app, not the stylesheet, and the ruling holds.** I opened
  `MobileNavSheet` at 390×844 and read both live animations: panel `mobile-nav-sheet-in` 280ms, backdrop
  `mobile-nav-sheet-backdrop-in` 160ms. Sampled trajectories: the backdrop is a pure opacity fade
  (0 → 0.96 by 120ms); the panel holds opacity 1 throughout and slides `-708px → -89px` by 120ms,
  `-10px` by 200ms. So the two land within ~40ms of each other and are doing **different halves of one
  gesture** — the backdrop establishes the scrim while the panel is still travelling, and neither is a
  second "entrance" the eye can separate. Confirmed visually in both themes. `RefinementChatDrawer.css:16/53`
  uses the identical pair (`--app-transition` backdrop + `--transition-slow` panel).
  **D7's second reading is correct; I endorse it on running-app evidence, not on reasoning alone.**
- Popover (`.user-menu__trigger`) and the assistant modal render and animate cleanly in both themes;
  the only console errors are two expected `401 /api/auth/me` while logged out.

**Frame check (what else is outside the audit's window).**

- Inline motion in TSX: exactly one — `MobileNavSheet.tsx:316` `transition: "none"` during a drag. No
  duration literal, no guard exposure.
- JS-driven animation: no `element.animate(` and no `requestAnimationFrame` choreography anywhere in
  `src`. The only motion-coupled JS constant is `Toast.tsx:22 TOAST_EXIT_MS = 200`, which pairs with
  `toast.css`'s `--toast-exit-duration` (see note 3).
- Vendor CSS: closed above — two imports, one carries motion, already owned by HEL-1032.
- UA-default/inherited motion: nothing found; no `transition` on inherited properties that would
  cascade.

### Answers to the four questions

1. **AC1 is still honestly met — but the guard as currently specified is NOT.** AC1 is qualified:
   "where a motion token applies". No token covers layout/drag motion, so leaving `PanelGrid`'s 180ms
   and reporting it under HEL-1032 does not falsify AC1. The problem is elsewhere and is real — see
   CR1. AC2/AC3/AC4 are met (AC2 verified above on the running app; AC3 is HEL-538's, verified not
   extended; AC4 is task 6.1). **No scope restatement is needed.**
2. Settled above: D3 safe, D7 endorsed on running-app evidence. D2 see note 1 — right decision, weak
   stated justification.
3. See note 3 — a PR line is not enough; a small spinoff is warranted, but it is not blocking.
4. Frame is closed; the one thing round 1 and this plan both under-weight is the CSS↔JS coupling
   (note 3's second half).

### Verdict: REFUTE

One load-bearing defect and one cheap consistency fix. Neither changes the plan's shape.

### Change Requests

1. **D5 / task 4.1 — the guard's exception list does not cover the literal D4 deliberately preserves,
   so the guard is specified to fail on day one.** D5 permits a literal duration in exactly two places:
   inside a `prefers-reduced-motion` block, and on "an explicit, commented allowlist of single-use loop
   **keyframes**" (task 4.1 names only `streaming-text-blink` and `pipeline-run-pulse`, both
   `@keyframes`). But after this change `frontend/src/features/panels/ui/grid/PanelGrid.css:10-13`
   still declares
   `transition: transform 180ms ease, width 180ms ease, height 180ms ease` — a **`transition:`
   literal, not a keyframe loop**, matched by neither exception. D4-REVISED requires that declaration to
   survive untouched; D5 requires the guard to reject it. As written the executor meets a red guard on
   first run and will resolve the contradiction ad hoc — either by folding 180ms after all (silently
   reversing D4 and shipping the false cohesion claim round 1 refuted) or by widening the allowlist with
   no stated rule (the "guard drawn around the failures" outcome). Required: state the third exception
   explicitly in D5 and in task 4.1 — a **named, commented, HEL-1032-referenced entry for
   `PanelGrid.css`'s 180ms layout transitions**, pinned to file + property + exact duration like the
   loop entries, so that changing 180ms to anything else still trips the guard and the entry is
   self-documenting as a deferral rather than a hole. Also extend task 4.2's stale-entry arm to cover
   this entry, and have 4.3 state the post-change expected literal inventory the guard should find
   (PanelGrid ×3, `streaming-text-blink`, `pipeline-run-pulse`, plus reduced-motion) so "green" is
   checked against a stated expectation instead of whatever the guard happens to accept.
2. **`design.md` "Risks / Trade-offs" and "Planner Notes" still describe the pre-revision plan and
   contradict D1/D4/D5.** Three stale statements: (a) "[Folding 180ms into 160ms degrades drag feel] ->
   D4 names the revert path and confines the change to layout motion" — D4 no longer folds anything and
   names no revert path; (b) "[The guard is vacuous] -> D5 requires mutation proof in **both**
   directions" — D5 now requires three; (c) "D1 adds exactly **two** tokens" and Planner Notes' "the
   **two-token** scale" — D1 now adds one. An implementer who reads the Risks table (a normal thing to
   do) is told the change folds PanelGrid, which is exactly the thing the round-1 refutation removed.
   Update all three to match the revised decisions.

### Non-blocking notes

1. **D2's stated justification is stronger than the evidence; the decision is still right.** The
   proposal calls the two spin speeds "the ONE inconsistency here a user can actually see". They cannot
   be seen together: no file under `features/pipelines` imports or renders the shared `Spinner`
   (`grep -rn "<Spinner\|ui-spinner" features/pipelines` → zero hits), so the 0.7s primitive and the
   0.8s `::before` copy never co-render, and 0.7 vs 0.8 on differently-sized rings is not perceptible
   sequentially. The real and sufficient justification is systemic — one role, one token, so the next
   spinner cannot invent a third speed. Recommend rewording the Why rather than defending a
   visibility claim the running app does not support.
2. **DESIGN.md's one-entrance wording (task 6.1c) needs to cover a slide, not just "fade + 4-10px
   rise".** Measured above, `MobileNavSheet`'s panel travels ~708px at constant opacity. If the new
   sentence only blesses "a backdrop fade plus its panel **rise**", a later HEL-442/444 reviewer can
   still argue these sheets are off-pattern. Suggest wording that says a backdrop fade plus its panel's
   entrance movement (rise **or** slide) is ONE entrance.
3. **Round 1's `PipelineDetailPage.css` note deserves a spinoff, not a PR line — and it is bigger than
   round 1 framed it.** `PipelineDetailPage.css:988-998` is a `::before` pseudo-element spinner with
   `0.6em` em-relative sizing, so converting it to the `Spinner` primitive is a **markup** change, not a
   CSS change — which is precisely why a PR-body sentence will not survive. F-190 already migrated every
   other hand-rolled spinner (`PanelContent.css:185`, `auth.css:253`, `MessageComposer.css:4`,
   `ActiveConversationPanel.css:56` all carry "now the shared `Spinner` primitive" comments); this is
   the last unconverted copy, and tokenising its duration makes the copy agree without removing it.
   File a small spinoff the way HEL-1032 was filed. Not blocking this change.
4. **One motion coupling no CSS guard can ever see:** `Toast.tsx:22 TOAST_EXIT_MS = 200` must stay in
   sync with `toast.css`'s `--toast-exit-duration: 200ms`. Task 2.2 correctly leaves both alone, so
   nothing is at risk here — worth one line in the DESIGN.md sentence 6.1a already adds, so the next
   reviewer knows the pair exists.
5. Reduced-motion (AC3) remains verify-don't-extend and is correctly bounded to HEL-538. Both drawer
   stylesheets carry their own `prefers-reduced-motion` `animation: none` blocks
   (`RefinementChatDrawer.css:67-70`, `MobileNavSheet.css:96-99`), so D7's untouched surfaces are
   already covered.
