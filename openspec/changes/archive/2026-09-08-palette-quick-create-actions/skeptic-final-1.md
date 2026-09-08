# Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every conclusion below is from ground truth I produced myself: the diff, the running
app on dev 5948 / backend 8855, gates run from `frontend/`, and mutation probes I executed and
reverted (`git status` clean afterwards apart from the pre-existing untracked `evaluation-2.md`).

## What I verified (with evidence)

### Gates — run by me, from `frontend/` (evidence rule 1)
- `cd frontend && npx jest` → **280 suites / 2855 tests passed**. Not root `npm test`.
- `cd frontend && npm run typecheck` → clean. `npm run lint` (`--max-warnings=0`) → clean.
- `DEV_PORT=5948 BACKEND_PORT=8855 npx playwright test e2e/hel516-palette-quick-create.spec.ts`
  → **10/10 passed (45.7s)** against the live servers.

### Acceptance criteria — traced
| AC | Evidence |
|---|---|
| Create actions for dashboard/source/pipeline/panel, no duplicated creation logic | `builtInActions.ts:buildCreateActions` builds `title`/`icon`/`run` straight off each seam's `cta`; `CreateCommandActions.tsx` calls all four HEL-548 hooks and writes zero creation logic. Live palette shows exactly the four rows (screenshot `skeptic-palette-dark.png`). |
| Panel unavailable with no selected dashboard | `useCreatePanelAction` sets `disabled` on `selectedDashboardId === null`; `buildCreateActions` OMITS `create.panel` when disabled. e2e case 2 constructs the dashboard precisely because the action is absent otherwise. |
| **Every action works from a route where its host is NOT mounted** | Proven in a real browser, not jsdom: e2e reach cases 1–4 all passed for me. I independently re-drove it by hand from `/pipelines`: "Add source" opened `dialog[aria-label="Add data source"]` in place (`skeptic-addsource-offroute-light.png`), "Add panel" opened `dialog[aria-label="Add panel"]` in place (`skeptic-outputpicker-offroute-light.png`), URL unchanged. |
| Palette closes and focus lands in the opened modal | Measured live: after running "Add source" from `/pipelines`, `document.activeElement` is the modal's `H2` inside `dialog[aria-label="Add data source"]` — focus IS transferred into the dialog. The h2-vs-first-field nuance is HEL-1029 (pre-existing `Modal` behavior, identical on every other entry point, explicitly out of scope). |
| Tokens + `.eyebrow` group, light/dark | `CREATE` eyebrow renders identically to `NAVIGATION`/`GENERAL`; Create rows reuse `.command-palette__item` with no new item styling. Verified both themes plus hover and keyboard focus (`skeptic-palette-dark-focus.png`, `skeptic-palette-light-hover.png`) — no HEL-866-style light-theme collision. 0 console errors. |
| KeyCap via the existing `shared/ui/KeyCap` | `git diff origin/main...HEAD -- frontend/src/shared` is **empty** — the atom was NOT restyled to sit inline. The only addition is a palette-scoped margin rule. The owner's "same atom, different placement" ruling is honored. See CR2 for the one place fidelity slips. |

### Guards — I re-ran the mutations rather than trusting the reports
Given this ticket's three prior false-passing assertions, I mutated the source and confirmed each
guard actually goes red:
1. **CR1 determinism guard** — reverted the `useMemo` deps to the pre-fix form
   (`[createDashboardAction, addSourceAction, createPipelineAction, createPanelAction]`):
   `CreateCommandActions.test.tsx` → **RED** (`Expected: <= 5, Received: 10`). Genuinely failable,
   and it measures register/dispose churn, not final id order — the exact defect that false-passed before.
2. **CR2 collision guard** — deleted `if (isAddSourceModalAlreadyOpen()) return;` → **RED**.
3. **Shell mount** — short-circuited the `AddSourceModal` shell mount → **2 App tests RED**.
4. **Empty-dashboard fallback arm** — replaced the `items.length === 0 && loadedDashboardId === … &&
   status === "succeeded"` arm with `false` → **1 App test RED**. The arm is reached, not decorative.

### `useCreatePanelAction` is the only seam that sets `disabled` — verified
Read all four seams in full and grepped `disabled` across `features/*/hooks/useCreate*` +
`useAddSource*`: the only assignment is `useCreatePanelAction.tsx:36`. Dashboard's seam varies
`cta.label` ("Creating…"), which IS in the deps. So the CR1 memo's primitive dep list is complete
for today's seams. (It is complete *by inspection of the current seams*, not by construction — an
`eslint-disable exhaustive-deps` list cannot enforce that a future seam adding `disabled` updates
it. Noted below, not blocking.)

### e2e mount-timing race (c317e244 / HEL-1030)
`registerAndLogin` in this file's own copy carries the post-mount wait **inside the helper** and on
the **correct side** of the navigation — `await page.waitForURL("/")` then
`await expect(page.getByRole("button", { name: "Add dashboard" })).toBeVisible()`, before any
Cmd/Ctrl+K is pressed. Correct.

### Judgment call 2 — determinism e2e layering
The framing is honest and the layering holds. The deterministic, mutation-proven detector is the
unit guard (item 1 above); the 5-boot e2e is labelled in-file as a symptom check that "cannot prove
WHY the order is stable". I would not accept it standalone either, and it is not standing alone.
Its weakness is a different one, which CR1 fixes: it asserts self-agreement, so it cannot catch a
*stable but changed* order.

## Verdict: REFUTE

Two required revisions. Both are narrow; neither disputes the reach work, which is the ticket's
hard part and is genuinely well done and well proven.

## Change Requests

### 1. Declare the palette's section order explicitly — the current order is a byproduct of an unrelated bug, and no shipped test can catch it flipping (judgment call 1: **this BLOCKS**)

I did not stop at "undeclared but stable". I probed *why* it is stable, and reproduced the failure mode:

- Registration order alone predicts `Navigation, General, Create` (`BuiltInCommandActions` is
  mounted and registers before `CreateCommandActions` in `App.tsx:315-316`; `rankActions` with an
  empty query returns registration order; `commandRegistry` is a `Map`, i.e. insertion-ordered).
- The running app shows **`Create, Navigation, General`**. That is only possible if `BuiltIn`
  *re-registers* after `Create` registered — i.e. the order users see is produced by render churn,
  not by anything declaring it.
- Root cause, probe-confirmed: `HelpOverlay.tsx:121` passes a fresh object literal as its context
  value (`value={{ open: () => setIsOpen(true) }}`), so `useHelpOverlay().open` changes identity every
  render, so `BuiltInCommandActions`'s `useMemo` re-runs and `useCommandActions` disposes+re-registers
  every render, pushing Navigation/General to the tail of the Map.
- **Mutation probe:** I memoized only that context value (nothing else) and reloaded. The palette
  reordered to **`Navigation, General, Create`**. Reverted; tree clean.

So a routine, obviously-correct perf cleanup in an unrelated file silently changes the palette's
information architecture, and nothing catches it: the determinism e2e asserts only that five boots
agree *with each other*, and its sanity check is `arrayContaining` (order-insensitive).

That is what makes this blocking, and it is a robustness argument, not an aesthetic one — **I am not
preempting the owner's IA call about which order is right.** Required:
1. Add an explicit section-order declaration (e.g. a `SECTION_ORDER` constant consulted by
   `groupBySection` in `CommandPalette.tsx:25-36`, with unlisted sections falling back to
   registration order after the declared ones — HEL-519/HEL-503 will register more sections, and
   this is the surface they inherit).
2. Change the e2e assertion at `e2e/hel516-palette-quick-create.spec.ts:262-265` from
   "all boots agree with the first" to the **fixed expected order**, which is only meaningful once
   (1) exists. That closes judgment call 2's residual weakness too.
3. Whatever order the owner picks goes into the constant; if they pick Create-first, the shipped
   behavior is unchanged and this is a pure hardening.

### 2. Palette key caps use a different intra-combo rhythm than the help overlay's identical combo

Measured live via `getComputedStyle`/`getBoundingClientRect` on the same `Ctrl`+`J` combo:

| Surface | margin-inline-start on 1st cap | on 2nd cap |
|---|---|---|
| `.help-overlay__row-combo` | 0px | **4px** (`--space-1`) |
| `.command-palette__item-title` (this diff) | 8px | **8px** (`--space-2`) |

`CommandPalette.css:107-110` scopes `margin-inline-start: var(--space-2)` to *every* `.ui-keycap`
in the title, so the gap *inside* one combo is double the help overlay's. The atom is correctly
untouched and the inline-vs-right-aligned placement is the owner's settled ruling — this is neither.
It is the same combo drawn with two different internal spacings in two surfaces, i.e. exactly the
kind of small UI/UX gap that later needs filling, on a surface HEL-519/HEL-503 will render more caps
into. Fix is one rule, e.g. keep `--space-2` only on the first cap (`:first-of-type`) and use
`--space-1` between caps, matching `help-overlay__row-combo`. (Flagging for the owner rather than
ruling: if they prefer the palette's looser intra-combo rhythm, say so and I will withdraw this.)

## Non-blocking notes

- `CreateCommandActions.tsx`'s primitive dep array is correct **today** but is enforced only by an
  `eslint-disable exhaustive-deps` plus a code comment. A future seam that starts varying
  `cta.disabled` (or any other shape-determining field) will not be caught. Worth a one-line comment
  in `EmptyStateCta`/the seams, or a deriving helper, when HEL-519 touches this.
- While `useCreateDashboardAction` is in flight, the palette row's title becomes "Creating…" (it
  reads `cta.label` verbatim). Harmless — the palette closes on run — but it means the action's
  displayed title is not a constant.
- `openspec/changes/palette-quick-create-actions/evaluation-2.md` is currently untracked; ensure it
  is committed with the delivery.
- Screenshots I took live under `.concertino/runs/HEL-516/evidence/`
  (`skeptic-palette-dark.png`, `skeptic-palette-dark-focus.png`, `skeptic-palette-light-hover.png`,
  `skeptic-addsource-offroute-light.png`, `skeptic-outputpicker-offroute-light.png`). Nothing was
  written to `openspec/**`; no `git add -f`.
