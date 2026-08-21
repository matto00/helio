# Evaluation Report — Cycle 2 (evaluation-2.md)

Ticket: HEL-535 · Change: `toast-notification-consistency`
Commit under review: `9c543968` ("Address evaluation-1.md cycle-1 change requests (CR1-CR4)"), on `839cd7fe`.
Cycle-1 report: `evaluation-1.md` (FAIL, 4 change requests).

All four cycle-1 change requests are **genuinely fixed** — each re-verified by the same measurement that
caught it, not by reading the diff. Nothing that passed in cycle 1 regressed.

---

## Cycle-1 Change Requests — all four closed

### CR1 — 44px mobile tap floor now actually resolves ✅

The fix splits `.toast__close`'s mobile override out of the line-24 media block into its own
`@media (max-width: 768px)` block placed after the base rule (and after `:hover`), which is exactly the
remedy CR1 specified. I re-measured `getComputedStyle` live rather than trusting the source order:

| viewport | `matchMedia('(max-width: 768px)')` | computed `width`/`height` | computed `margin` | rect |
| --- | --- | --- | --- | --- |
| 430 | `true` | **44px / 44px** | `-12px -12px 0px 0px` | 44×44 |
| 768 | `true` | **44px / 44px** | `-12px -12px 0px 0px` | 44×44 |
| 769 | `false` | 20px / 20px | `-2px -4px 0px 0px` | 20×20 |
| 1440 | `false` | 20px / 20px | `-2px -4px 0px 0px` | 20×20 |

Cycle 1 measured `20px / 20px` with the base margin at 430 **and** 768. The floor now resolves, the
intended `-12px` margin comes with it, and the boundary is exactly right — `DESIGN.md` §3's mobile-only
floor applies at ≤768 while §5's blessed 20px desktop size is untouched at 769 and above.
Visually confirmed at 430: the card grows to accommodate the larger hit area, the × stays vertically
centred, and the layout is not broken.

### CR2 — the new CSS guard genuinely discriminates ✅ (proven, not read)

The orchestrator asked for proof rather than a reading, and a source-order fix is precisely the kind that
can look right in the file while still losing the cascade — so I proved the guard's discriminating power
directly, without modifying any repo file.

I extracted the **shipped** `findMediaBlockFor` helper verbatim from
`git show 9c543968:frontend/src/shared/ui/toast.css.test.ts`, stripped only its TypeScript annotations,
and ran it plus the guard's exact assertion
(`css.indexOf(".toast__close {")` vs the media block's `start`) against both CSS revisions:

```
pre-fix  CSS (839cd7fe, CR1 bug present): FAIL  (baseRuleIndex=1008, mediaBlockStart=892)
post-fix CSS (9c543968):                  PASS  (baseRuleIndex=3573, mediaBlockStart=4216)
```

For contrast, the cycle-1 text-only guard applied to the same two files:

```
pre-fix  CSS contains 44px text: true   (so the old guard PASSED on the buggy file)
post-fix CSS contains 44px text: true
```

That is the requirement met exactly: the new assertion fails if the media block is moved back above the
base rule, and the old one did not. The helper was also correctly generalised — it now scans *every*
`@media` block with a matching prelude and selects by body selector, which `toast.css` needs since it
deliberately carries two separate `(max-width: 768px)` blocks. The downstream "stays 20px above the
breakpoint" test was correctly simplified to a plain first-match lookup, which is now valid precisely
because the override is source-ordered after the base rule.

### CR3 — user-phrased copy now reaches the user ✅

Fixed at the source (`panelThunks.ts`), which is the right place: the table fallback was never the
problem, the thunk's own literal was. Re-ran the identical forced-failure path from cycle 1 — a real
keyboard column-resize on a table panel with the PATCH forced to 500:

```
cards: [{"msg":"Failed to resize columns.","cls":"toast toast--error"}]
assertive region children: ["Failed to resize columns."]
```

Cycle 1 produced `Failed to persist column widths.` on this exact path. The user-phrased wording task 3.2
required is now what renders.

- `panelThunks.ts:308` → `"Failed to resize columns."`, `:420` → `"Failed to save panel changes."`;
  both now match `toastListeners.ts:174`/`:173` exactly, and both carry a comment stating that the thunk
  literal *is* the user-visible toast and that the table fallback is unreachable — so the next editor
  can't re-introduce the drift.
- **No other consumer of either rejection payload**, re-confirmed by grep across `frontend/src`. The only
  other reference is `panelsSlice.test.ts:255`, which constructs `updatePanelsBatch.rejected(null, "req-batch", {...})`
  — no `payload` argument at all — and asserts only on `pendingPanelUpdates`. The old strings
  (`"Failed to persist column widths."`, `"Failed to update panels."`) no longer appear anywhere in the
  codebase.
- `toastListeners.test.ts:281-313` now dispatches each thunk's **real** `rejectWithValue` string as
  `payload` instead of `payload: undefined`, with a comment explaining why the old form tested a state
  these thunks cannot produce. That is the reachable path.

### CR4 — `aria-atomic` removed; stacked toasts no longer re-announce ✅

Re-ran the burst that produced the finding — four distinct real failures on the pipeline detail page.
Raw DOM at the moment three messages are live:

```html
<div class="sr-only" role="status" aria-live="polite"></div>
<div class="sr-only" role="alert" aria-live="assertive"><span>Failed to delete step: locked by run 2</span><span>Failed to delete step: locked by run 3</span><span>Failed to delete step: locked by run 4</span></div>
```

`aria-atomic` is absent from both regions (`null`, not `"false"`) while the assertive region holds three
children, so a new toast now announces only its own added node. Roles and politeness are unchanged
(`status`/`polite`, `alert`/`assertive`). The code comment explaining why atomic is wrong for an
N-message region is thorough and explicitly says not to add it back — good guard against a future
"restore".

Critically, **removing `aria-atomic` did not break the coalesced-repeat re-announcement** that depends on
a fresh node being mounted. My first probe compared `outerHTML` and gave a false negative (two distinct
nodes with identical text serialise identically), so I re-ran it by **node identity**: tagged the live
region's child with a JS property after the first failure, then fired the identical failure again.

```
after coalesced repeat: {"childCount":1,"text":"Failed to delete step: Step is locked.","stillTheSameNode":false}
RESULT: fresh DOM node mounted -> the repeat IS re-announced (correct)
```

---

## Phase 1: Spec Review — PASS

- Cycle-1's only Phase-1 issue was task 2.7 being checked off while the spec delta's tap-target scenario
  went unsatisfied. That scenario ("its dismiss control meets the mobile minimum tap-target size") is now
  satisfied in the running app, so the checked task and the delivered behaviour agree.
- **Charter re-confirmed.** `toastListeners.ts` and `toastsSlice.ts` are **byte-unchanged** by this
  commit, so cycle 1's entry-by-entry verification against `main` (15 pre-existing success entries + 18
  pre-existing error entries, all preserved; nothing removed; only `createSqlSource`'s intentional
  `"connected." → "created."` de-duplication) still stands. No toast that is a failure's only report was
  removed, and no existing failure path's announcement posture was altered.
- The `panelThunks.ts` copy change is not a scope excursion — it is the minimal, correct location for
  CR3's fix and touches nothing but two string literals inside two `catch` blocks.
- **Scope fence intact.** `frontend/src/features/panels/ui/PanelList.tsx` is absent from
  `git diff --name-only main...HEAD` (confirmed independently — my gate too, not just the orchestrator's).
  Grepping this commit's frontend diff for `skeleton|isLoading|EmptyState` returns zero hits. `theme.css`,
  `AddSourceModal.tsx` and `PipelineDetailPage.tsx` are all untouched by this commit.
- No API/schema surface touched.

## Phase 2: Code Review — PASS

### Gates — re-run fresh in `WORKTREE_PATH` at `9c543968`

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm run check:schemas` | in sync (66 checked / 47 protocol files; 7 panel-type surfaces) |
| `npm run check:scala-quality` | clean (128 pre-existing soft warnings) |
| `npm test` | **226 suites / 2473 tests, all passing** |
| `npm --prefix frontend run build` | succeeds |

2473 = cycle 1's 2471 + the two tests this commit adds (the source-order guard and the
`aria-atomic`-absent companion). Exactly the commit's claim, and above the 224/2427 pre-change baseline.

**The `git commit -n` bypass remains legitimate and complete.** I ran all six `.husky/pre-commit` checks.
Five pass; `check:openspec` fails with only
`change "toast-notification-consistency" is complete (42/42) but not archived` — the disclosed HEL-657
false positive. Nothing else was bypassed.

### Review

- Both new tests are real guards, not decoration: CR2's is proven above to fail on the pre-fix file, and
  CR4's asserts the attribute is absent **while two messages are present**, which is the only condition
  under which the bug mattered.
- The three explanatory comments added (`toast.css`'s CR1 block, `Toast.tsx`'s CR4 block,
  `panelThunks.ts`'s two CR3 notes) each record *why* the shape is what it is and what not to change
  back. That is the right response to a cascade/ARIA subtlety that reads as arbitrary otherwise.
- No dead code, no leftover TODO/FIXME, no new `any`, no over-engineering. Diff is tightly scoped to the
  four CRs.
- Behaviour-preserving where required: nothing outside the four CRs moved.

## Phase 3: UI Review — PASS

Servers on the assigned ports (5967/8874); `assert-phase.sh servers` → `PASS servers`. Driven with my own
headless Chromium instance throughout — the shared MCP Playwright session was not used.

Beyond the four CR re-verifications above, everything that passed in cycle 1 was re-checked rather than
assumed — `toast.css` was edited again, so the surface contract in particular needed re-measuring:

- **Mobile nav clearance (re-checked, `toast.css` edited):** at 768 and 430 the viewport still resolves to
  `bottom: 72px`; toast bottom 788 vs `BottomNav` top 804 — **clears with a 16px gap** at both. The
  `.toast-viewport` offset was correctly left in the original media block (its base rule already precedes
  it), and splitting `.toast__close` out did not disturb it.
- **Cap:** four distinct real failures → exactly **3** cards and 3 region children; oldest evicted, newest
  three retained in order.
- **Coalescing:** two identical real failures → exactly **1** card, **1** region child, fresh node.
- **Optimistic restore (D5):** rejected step deletes still restore — 4 steps before, 4 after, server count
  unchanged at 4.
- **Intent routing:** error → assertive only, success → polite only, both simultaneously in their own
  regions, in both themes.
- **Card semantics:** `role`, `aria-live` both `null` on `.toast`; `.toast__message` `aria-hidden="true"`.
- **Reduced motion genuinely disables rather than shortens:** sampled 60ms into the entrance with the
  preference — `animation-name: none`, `opacity: 1`, `transform: none`; without it — `toast-slide-in`,
  `0.28s` (`--transition-slow`), mid-flight `opacity 0.34` and a 13px translate. Dismissal latency
  **12ms** vs **213ms**.
- **Tokens, both themes:** light surface `#ffffff` / error `rgb(199,58,42)` / success `rgb(26,127,78)`;
  dark surface `#262320` (`--app-surface-strong`) / error `rgb(240,117,97)` / success `rgb(76,195,138)`.
  Body type `12px` (`--text-xs`) in both. Single entrance animation. No literal colours.
- **Zero console errors and zero unhandled exceptions** across every flow, both themes, every breakpoint
  — the only console output was the 4xx/5xx I injected deliberately.

---

## Overall: PASS

All four cycle-1 change requests are fixed at the root cause and verified by the measurements that caught
them; the CR2 guard is proven to discriminate; no regression in the charter, the cap, the sticky
exemption, coalescing and its re-announcement, intent routing, reduced motion, the surface tokens, or the
mobile nav clearance. Gates all green at 226/2473.

---

## Non-blocking Suggestions

Carried forward unchanged from `evaluation-1.md` — none of these caused the cycle-1 FAIL and none are
newly introduced by `9c543968`:

- **`PipelineDetailPage.tsx:460-461` doubles its own message on a non-HTTP failure**
  (`"Failed to delete step: Failed to delete step."` when `extractErrorMessage` falls back). All five
  siblings in that file share the pattern and the plan said to mirror them, so fixing it here alone would
  trade a wart for an inconsistency. Worth a follow-up covering all six sites together.
- **`--bottom-nav-height` is defined in `theme.css` but `BottomNav.css:27` and `App.css:424` still inline
  the same calc** — a two-line change would complete the de-duplication the token was introduced for.
  Deliberately outside the stated Impact scope.
- **`Toast.tsx`'s exit `setTimeout` is not stored in `timerRef` and not cleared on unmount.** Harmless
  today (dismissing an already-removed id is a no-op filter), but a toast evicted by the cap mid-exit
  leaves a pending timer.
- **At 430 the 340px viewport with `right: var(--space-6)` leaves an asymmetric ~66px left gutter.**
  Pre-existing; the spec delta explicitly blesses the `340px` literal. Flagged for the skeptic's eye, not
  as a defect.
- **On desktop the stack overlaps the pipeline detail footer's "Run pipeline" button** for its 4s life —
  a pre-existing consequence of §7's mandated bottom-right placement, unchanged by this ticket.

## Shared dev-DB side effects from this cycle — disclosed

Cycle 2 was **read-only against persisted state**. Every mutation I triggered was either intercepted
before reaching the backend (metric deletes, panel PATCHes, pipeline-step deletes all fulfilled locally
by the route handler) or rejected by design. I re-confirmed after the burst that `union-eval-pipeline`
still has **4 steps server-side** — unchanged by this cycle.

Cycle 1's disclosure still stands and should keep travelling to the human: during cycle 1 one step was
really deleted from `union-eval-pipeline` (an HEL-384 eval artifact, 5 → 4) when a route intercept missed
the real `/api/pipeline-steps/:id` path on the first attempt; a static source was created and deleted
again through the UI; and a pipeline schedule created for the header-toggle test was cleared afterwards.

## Verification provenance

Every gate result and every Phase-3 claim in this report is from my own fresh run at `9c543968`. Nothing
is carried over from the executor's report, and nothing that was re-checked was assumed from cycle 1 —
the four CRs were re-measured by the probes that originally caught them, and the surface contract was
re-measured because `toast.css` changed again. `EVALUATOR_CLEAN_WORKTREE` is false, so gates ran in the
delivery worktree as normal. No repo file was modified by this evaluation (the CR2 proof ran the shipped
helper against `git show` output in a scratch directory).
