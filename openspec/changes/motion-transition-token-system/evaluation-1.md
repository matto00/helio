# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `381f5f5f` "HEL-441 Unify motion durations onto tokens, add motion guard".
All gate runs and all mutation arms below were re-run by me in `WORKTREE_PATH`; none are quoted
from the executor's transcripts. All Phase-3 observations are my own, on the running app
(DEV_PORT 5873 / BACKEND_PORT 8780), in both themes.

---

### Phase 1: Spec Review — PASS

**AC1 — no CSS module declares a literal duration/easing where a token applies; enforced by a guard.**
Satisfied. The four source edits are exactly the ones the confirmed plan specifies (D1 one token,
D2 both spinners, D3 auth card, D4-REVISED/D7 no change). Diff scope verified as claimed:
4 source files + guard + `DESIGN.md` + `openspec/`, nothing else. `PanelGrid.css`, `toast.css`,
`toast.css.test.ts`, `MobileNavSheet.css`, `RefinementChatDrawer.css` all untouched (confirmed via
`git diff --name-only main...HEAD`).

**AC2 — each overlay surface plays exactly one entrance.** Verified live, per surface, by
`document.getAnimations()` / `element.getAnimations().length` at the moment of entry:

| surface | animations on entry | name / duration |
| -- | -- | -- |
| Popover (`Dashboard actions`) | 1 | `popover-in` 160ms (`--app-transition`) |
| Modal (CommandPalette, `dialog[open]`) | 1 | `ui-modal-in` 280ms (`--transition-slow`) |
| Toast enter | 1 | `toast-slide-in` 280ms |
| Toast exit | 1 | `toast-fade-out` 200ms (`--toast-exit-duration`) |
| auth card | 1 | `auth-card-in` 280ms, `cubic-bezier(0.3,0.9,0.4,1)` |
| OnboardingChecklist | 1 | `onboarding-checklist-in` 280ms, same curve |

**AC3 — reduced motion.** `theme.css:308-315` is a global `@media (prefers-reduced-motion: reduce)`
rule over `*`, `*::before`, `*::after` with `!important` on `animation-duration`,
`animation-iteration-count` and `transition-duration`. Every animation this diff touched is reached
by it, including the pipeline run spinner, which is a `::before` pseudo-element and is covered by the
rule's explicit `*::before` arm. The diff adds no new selector and no new animation, so the rule's
coverage is unchanged by construction. Verified by inspection, not by OS-level emulation — noted
honestly; the rule was not extended (HEL-538 still owns that surface).

**AC4 — new easing token documented.** `DESIGN.md` §"Radius / Shadow / Motion" documents
`--app-spin-duration`, D1's single-use-vs-shared-loop governing rule, D7's backdrop+panel ruling
naming both surfaces, and the "exit motion stays component-scoped" note for `--toast-exit-duration`.

**Deferrals are real and honest.** HEL-1032 (Backlog, Low) and HEL-1034 (Backlog, Medium) both exist
in Linear, both name HEL-441 as their origin, and neither ticket's work was absorbed: `PanelGrid.css`
is byte-identical to `main` and no `animation*` echarts option was introduced anywhere.

**Tasks.** 1.1, 1.1a, 5.1, 5.4, 5.5, 7.1, 7.2 are left unchecked. That is the correct record for the
executor's own run (it had no browser tool and said so rather than claiming completion). 1.1/1.1a/5.1/
5.4/5.5 are closed by this report's Phase 3. 7.1/7.2 are Delivery-phase items and remain open.

No scope creep, no silently reinterpreted AC, no regression to an existing spec.

---

### Phase 2: Code Review — PASS

**Gates, re-run by me (not trusted from the handoff):**

- `npx jest` from `frontend/` — **280 suites / 2844 tests, all passing** (matches the claim).
- `npx jest src/theme` — 6 suites / 89 tests passing (includes `motionTokenGuard.css.test.ts` 5/5 and
  `tokenAuditSweep.css.test.ts`).
- `npm run lint` — clean under `--max-warnings=0`.
- `npm run format:check` — all files match Prettier.
- Backend gates: N/A, no `backend/**` file changed.

**Guard mutation-proof, all three arms re-run by me. All RED:**

1. *New ad-hoc duration on a real component.* `toast.css:119` `opacity var(--app-transition)` →
   `opacity 0.33s`. RED: `1 failed, 4 passed` — `shared/ui/toast.css:119 literal="0.33s"`. Reverted.
2. *Removed exception entry.* Deleted the `pipeline-run-pulse 1.2s` entry from `LOOP_ALLOWLIST`.
   RED: `1 failed, 4 passed` — `PipelineDetailPage.css:979 literal="1.2s"`. Reverted.
3. *Stale exception matching nothing*, both shapes:
   - **keyframe:** allowlist duration `1.2s` → `9.9s`. RED: `2 failed, 3 passed`; the staleness test
     itself fails (`Expected: true, Received: false`).
   - **`transition:` shorthand (the load-bearing arm):** `PanelGrid.css` `180ms` → `160ms` — i.e. the
     exact "HEL-1032 has landed" scenario. RED: `3 failed, 2 passed`; staleness test reports
     `Expected: 3, Received: 0`. Exception (c) therefore genuinely **expires** when HEL-1032 removes
     those literals; it is not a permanent hole.

   `git diff --stat` clean after all reverts.

**Multi-line parsing is genuine, proved by measurement not by reading.** `PanelGrid.css:9-13` is a
three-line wrapped declaration. Arm 3b's failure message reports it re-joined as one declaration —
`` transition: transform 160ms ease, width 160ms ease, height 160ms ease; `` — with all three
literals found. A line-oriented grep would have truncated this at the bare `transition:` line and
reported garbage (the exact error described in `ticket.md`'s audit note).

**What it scans.** `find frontend/src -name '*.css' | wc -l` → **110**, matching the guard's
`expect(files.length).toBe(110)`. The zero-motion-file test is not vacuous: it selects a real file
that contains no `transition:`/`animation:` declaration and asserts `findHits` returns `[]`, so the
walk is shown to run its regexes against real text rather than passing by never matching.

**Checklist:** DRY (one token, no duplicated literals) · readable (every exception carries a "why"
comment naming its owning ticket) · modular · type-safe (no `any`, no escape hatches) · security N/A
(no boundary touched) · error handling N/A · tests meaningful (guard is failable in three independent
directions) · no dead code except the nit below · no over-engineering (exactly one token added, and
D1 records the rule that stops the next author building a full scale) · behavior-preserving where
expected (`PanelGrid.css` byte-identical; both D7 surfaces untouched). CONTRIBUTING's no-inline-FQN
rule is satisfied (the guard imports `fs`/`path` as identifiers). `--app-spin-duration` lives in
`:root`, so light/dark parity is structural.

`toast.css.test.ts` passes **unmodified** — confirming task 2.2's real point: `--toast-exit-duration`
was not promoted, so no test was changed in shape to make anything pass.

---

### Phase 3: UI Review — PASS

Servers reused healthy via `scripts/concertino/start-servers.sh`. Screenshots written to
`.concertino/runs/HEL-441/evidence/eval-*.png` (11 new files; nothing `git add -f`'d past
`.gitignore`).

**D2 — pipeline spinner at 0.7s. Judgment: reads RIGHT.**
Task 1.1a's mechanism, named and used: a real run was triggered (`Run pipeline` on `proj-2026-flat`)
but the local run completes faster than one poll interval, so the transient state was never caught —
I therefore forced the state deterministically by applying
`.pipeline-detail-page__run-status--running` to the live element, and additionally mounted a
`.ui-spinner` beside a second copy of that element to observe both at once. Both resolve to
`animation-duration: 0.7s`, `linear`, from the same token. 0.7s on a 0.6em ring is a brisk but
unhurried cadence; the 0.8s→0.7s change is a 12.5% speed-up, below the threshold where a rotational
rate reads as different, and the previous 0.8s was itself an arbitrary local value. No strobing, no
blur. Evidence: `eval-04-spinners-dark.png`.

**D3 — auth card at 0.28s. Judgment: does NOT read as abrupt. Design gate r2 CONFIRMED.**
Measured by pausing the live `auth-card-in` animation and sampling `getComputedStyle` at fixed
`currentTime` offsets (deterministic, no frame-timing race), dark theme:

| t (ms) | opacity | translateY |
| -- | -- | -- |
| 0 | 0.000 | 10.00px |
| 40 | 0.403 | 5.97px |
| 80 | 0.705 | 2.95px |
| 120 | 0.874 | 1.26px |
| 160 | 0.952 | 0.48px |
| 200 | 0.985 | 0.15px |
| 280 | 1.000 | 0 |

r2's measurement was that at 0.45s the card is ~89% opaque and ~1px from rest by 200ms. At 0.28s the
identical perceptual state arrives at ~120ms. So the card lands ~80ms earlier — it does not play 38%
faster in any perceived sense, because the shared curve is front-loaded and the 200→280ms tail
(0.985→1.0 opacity, 0.15px) is imperceptible. 280ms is comfortably above the ~150ms floor at which an
entrance starts reading as a pop. Confirmed identical duration/curve in the light theme (0.28s,
`cubic-bezier(0.3, 0.9, 0.4, 1)`), and exactly one animation on the element in both. This corroborates
the executor's independent production-build (`vite preview`) check, so the StrictMode
double-invocation concern is closed from two directions.
Evidence: `eval-05-authcard-dark.png`, `eval-06-authcard-light.png`.

**D7 — backdrop fade + panel rise is ONE entrance. Ruling UPHELD on the running app.**
Both surfaces start their two animations on the same frame; neither ever plays a second, later
entrance.

- *RefinementChatDrawer* — the stronger case. Backdrop 160ms and panel 280ms, and the panel *also*
  fades (opacity 0→1) while sliding 24px. At backdrop completion (~173ms after start) the panel is
  97.5% opaque and 0.6px from rest. They land essentially together; unambiguously one gesture.
  Evidence: `eval-07-refinement-drawer-light.png`.
- *MobileNavSheet* — backdrop 160ms, panel 280ms sliding 708px at opacity 1 throughout. Backdrop
  reaches full at ~167ms after start; the panel is ~28px away at that instant and within ~1px at
  ~250ms. That is a **~83ms** landing gap, not r2's estimated ~40ms. The discrepancy is in the
  estimate, not the ruling: because the panel never fades, there is no second "appearance" event — the
  scrim darkens as the sheet rises, one continuous gesture. Ruling upheld; the number is corrected
  for the record. Evidence: `eval-02-mobilenavsheet-light.png`.

**Task 5.4 — motion that NO SOURCE TEXT CARRIES. Third instance FOUND. Reported, not absorbed.**
`.ui-modal::backdrop` has **no** entrance motion, while its sibling overlay backdrops
(`MobileNavSheet`, `RefinementChatDrawer`) both fade over 160ms. Measured live during a Modal open:
the backdrop is already at its full `rgba(33, 29, 25, 0.42)` with `blur(2px)` on the very first frame
(t=47ms, `animationName: "none"`, opacity 1) while the dialog is still at opacity 0 and takes the full
280ms to arrive. Every `Modal` consumer inherits this — CommandPalette, HelpOverlay, PanelDetailModal,
and every confirm dialog: the scrim snaps, then the dialog fades up behind it. No grep can find this;
there is no declaration to find, the absence *is* the finding.

This is genuinely out of HEL-441's scope — the ticket's "Out of scope" section excludes *new entrance
choreography*, and adding a backdrop fade is exactly that. It is also the natural follow-on to D7,
which established that backdrop-fade-plus-panel is the house pattern; the Modal is that pattern
missing its backdrop half. **Recommend a spinoff ticket**, alongside HEL-1032 and HEL-1034 as the
third "motion no source text carries" instance — and unlike those two, this one is inside the app's
own components. Do not fold it into HEL-441.

**Task 5.5 — states varied, not just renderings.**
- *FIRST PAINT / skeleton→content*: sampled the whole post-login boot. `ui-skeleton-shimmer` at 1.6s
  on every shared `Skeleton` (`ui-skeleton--line`, `ui-skeleton--block`,
  `panel-grid-card__body-skeleton`, `panel-body-skeleton__block`). The sidebar's
  `dashboard-list__skeleton-line` elements initially read as non-animating siblings; source check
  showed they are wrappers containing a real `<Skeleton>` child, which does shimmer — false lead,
  discarded. Swap to content is clean, no flash of unstyled/unanimated content.
- *Toast enter AND exit*: measured above; enter 280ms slide+fade, exit 200ms fade, one animation each.
  Observed on a `.toast`-classed element mounted into the live notification region rather than a
  store-driven toast (no low-side-effect toast trigger was reachable in budget) — labelled as such;
  `toast.css` is untouched by this diff, so the CSS observed is the shipped CSS.
- *Modal open AND close*: open measured above. Close is instant — there is no `ui-modal-out` keyframe,
  and likewise none for Popover. Pre-existing, untouched by this diff, and consistent with D1's
  "exit motion is deliberately component-scoped" note; not a regression.
- *ERROR / EMPTY*: exercised the logged-out `/login` error path and the share dialog's rejected
  `Grant access`; both handled gracefully, no blank screen, no unhandled exception.

**Task 5.3 / D4 — live drag+resize observed.** Performed a real SE-handle resize on a panel. The
repo's own rule is live at `transform 0.18s, width 0.18s, height 0.18s`, and the enumerated
stylesheet rules confirm the vendor contributions alongside it: `.react-grid-layout => height 200ms`
and `.react-grid-item => left 200ms`, with `.resizing`/`.react-draggable-dragging => none` making the
drag itself direct. So the settle is 180ms (ours) against 200ms (vendor) — a ~20ms mismatch that is
imperceptible in a single-panel grid but real. This directly confirms D4-REVISED's reasoning on the
running app: folding 180→160ms would have moved the spread *away* from the vendor's 200ms, widening
it. Good evidence for HEL-1032.

**Task 5.7 — reduced motion.** Verified as described under AC3. Rule inspected, not extended.

**Other Phase-3 checks.** Happy path end-to-end (login → dashboards → pipelines → pipeline detail →
run) works. Interactive elements carry accessible names (every control I drove was located by
`aria-label`). Breakpoints 1440 / 1100 / 768 / 320 all render without layout breakage
(`eval-01`, `eval-09`, `eval-10`, `eval-11`). **No console errors** attributable to this run: the only
errors on port 5873 were two expected `401 /api/auth/me` calls on the logged-out login page. (A
history sweep also surfaced errors from ports 5880/5942/5948 — other worktrees' dev servers, not this
one.)

---

### Overall: PASS

---

### Non-blocking Suggestions

1. **`files-modified.md`'s Evidence section overstates the screenshots that exist.** It cites
   `{before,after}-{auth-card,dashboards,after-login}-{light,dark}.png` as evidence. By `md5sum`, those
   twelve files are only **two** distinct images: every `before-*` is byte-identical to its `after-*`
   counterpart, and every `-light` is byte-identical to its `-dark` counterpart (the `dashboards` and
   `after-login` pairs are also identical to each other). They demonstrate neither a before/after
   difference nor theme variation. The executor's *coverage gap* disclosure in the same section is
   honest and its actual D2/D3 verdicts rest on the production-build computed-style check, not on
   these files — so nothing downstream is wrong. But the sentence should be corrected before the PR
   body is written, and those twelve files should be deleted or replaced by the `eval-*.png` set, so
   the next reader does not treat evidence-shaped duplicates as evidence.
2. **Spinoff ticket for the Modal backdrop finding** (Phase 3, task 5.4 above). File it as the third
   "motion no source text carries" instance, related to HEL-1032/HEL-1034 and to D7's ruling.
3. **`motionTokenGuard.css.test.ts:106`** — `findHits(absPath: string, ...)` never uses `absPath`
   (call sites pass it at lines 179, 203, 231). Drop the parameter; it is dead code under
   CONTRIBUTING's rule.
4. **`motionTokenGuard.css.test.ts:151-153`** — the comment says "guard anyway against a bare `0` that
   could appear as an iteration-count-like token (defensive)", but the line that follows is
   `if (allowedLoop) continue;`, which is the allowlist check, not the described defensive guard. Fix
   the comment (or add the guard it describes) so the two agree.
5. **`expect(files.length).toBe(110)`** is an exact-count tripwire that any unrelated new CSS file will
   trip. That is the behaviour task 4.3 asked for, so it is intentional — but consider adding a
   failure message telling the next author to re-audit and bump the number, rather than leaving them
   to infer it.
6. Tasks 1.1 / 1.1a / 5.1 / 5.4 / 5.5 can now be checked in `tasks.md` with this report as their
   evidence pointer. 7.1 / 7.2 remain genuinely open for the Delivery phase.
7. Dev-data note: the live resize in Phase 3 was performed on the "Skeptic Isolation Test" dashboard
   and may have persisted a panel-size change to the shared dev database (`Undo layout change` was
   disabled afterwards, so it was not reverted through the UI). Cosmetic, on a test dashboard.
