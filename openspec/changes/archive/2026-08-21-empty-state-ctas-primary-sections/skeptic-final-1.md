## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `6c3463e9` on `feature/empty-state-ctas-primary-sections/hel-548`
(base `2eaf1d26` = `main`).

Cold spawn. Every conclusion below is derived from ground truth I read or measured myself.
`evaluation-1.md` and `files-modified.md` were read as **claims to verify**, not facts.

Browser work used my **own** headless Chromium (`chromium-1208`) on CDP port `9333`, driven by
`playwright-core` — the shared MCP Playwright session was never touched, and no other run's
worktree or ports (6204/9111, 6206) were entered. My browser was terminated at the end
(`/json/version` confirmed down); the live dev servers on 5980/8887 were left running.

---

### What I verified (with evidence)

#### Gates — all four re-run fresh by me in the worktree

| Gate | Command | Exit | Output |
| --- | --- | --- | --- |
| lint | `npm run lint` | **0** | `eslint . --max-warnings=0`, clean |
| format | `npm run format:check` | **0** | "All matched files use Prettier code style!" |
| test | `npm test` | **0** | `Test Suites: 242 passed, 242 total` / `Tests: 2580 passed, 2580 total` |
| build | `npm --prefix frontend run build` | **0** | `✓ built in 1.02s`, PWA 28 precache entries |
| openspec | `openspec validate empty-state-ctas-primary-sections` (CLI 1.2.0) | **0** | "is valid" |

`tasks.md`: 67 checked, **0 unchecked**.

#### Fences honoured

`git diff --stat main...HEAD` contains **no** `DESIGN.md`, no `BottomNav.*`, no `App.css`, no
`index.html`, no `theme.css`, no `MobileNavSheet.tsx`. Both parallel runs' fences are intact.
`DESIGN.md` read-only requirement met. My own `git status` on exit is byte-identical to entry
(only the evaluator's pre-existing `workflow-state.md` edit + untracked `evaluation-1.md`).

#### Acceptance criteria — traced individually against the running app

Reached through a **freshly registered, genuinely empty account** (real signup, no forced props).

| AC | Verdict | Evidence I produced |
| --- | --- | --- |
| Every listed section renders `EmptyState` (main, Fraunces) + working CTA; none blank | **MET** | Live tour: `/` "No dashboards yet"; `/sources` "Connect a data source"; `/pipelines` "Build your first pipeline"; `/registry` "No types defined"; panel area "No panels yet". All `ui-empty-state--main`, all with one primary CTA. |
| Registry guides to pipelines, no dead create-type path | **MET** | Main CTA click → `Create pipeline` modal opens, `urlBefore === urlAfter === /registry`, **no route change**. Regex `/new type\|add type\|create type/i` over the rendered body → `false`. |
| Filter-empty distinct from no-data-empty | **MET** | Live on Sources/Pipelines/Types: icon `lucide lucide-search-x`, title "No matches", description quotes the query (`No data sources match "zzqqx".`), CTA "Clear filter". Distinct icon **and** title **and** wording — not colour alone (§8). |
| Tokens + §5 CTA + light/dark + §8 keyboard | **MET** | See below. |
| lint/test pass, zero new warnings | **MET** | Table above. |
| **HEL-770** — failed create → error-intent, `role="alert"`, error title + icon, **specific** message | **MET** | See below. |
| **HEL-770** — neutral branch stays neutral | **MET** | No-failure state: `role` null, `aria-label="No dashboards yet"`, no alert role. |
| **HEL-770** — no toast, reported once on both paths | **MET** | Toast viewport empty after the injected failure. Only two `createDashboard` dispatch sites exist app-wide (`useCreateDashboardAction.tsx:38`, `DashboardList.tsx:57`) — grep-verified — and both now report inline. |
| **HEL-528 D11** — deleted last panel renders empty state, no skeleton, no cold-boot flash | **MET** | See below. |
| **HEL-554 CTA seam** | **MET** | Four hooks, uniform `{cta, error, isPending}`; `EmptyStateCta` exported; D5/D5a/D5b record reach constraints. |

#### The headline inherited gap (HEL-528 D11) — reproduced through the real UI

Built the real path end to end: registered → created a dashboard via the **rewired** empty-state
CTA → created a Text panel through the 4-step modal → deleted it via the panel kebab → inline
`Confirm`. Network log confirms the real mutation: `DELETE /panels/c2b4b35e-…`.

Frame-by-frame sampling across the transition (120 ms cadence), **no reload**:

```
{"sk":0,"es":null,"cards":1}            <- panel still present
{"sk":0,"es":"No panels yet","cards":0} <- terminal state, immediately
... (11 further frames, all identical)
TERMINAL: {"panelCount":"0 panels","skeletons":0,"gridCards":0,
           "title":"No panels yet","desc":"Add a panel to start building your dashboard.",
           "cta":"Add panel","ariaLabel":"No panels yet"}
```

**Zero skeletons in every sampled frame** — HEL-528's no-skeleton assertion is not regressed.

*Probe discriminates:* on `main` the gate is `status === "succeeded" && items.length === 0`
(`git show main:…/PanelList.tsx:408`); the terminal state is `status === "idle"`, so the
unfixed build renders nothing there. The probe detects the defect it claims to detect.

**Cold-boot pre-dispatch frame** (panels fetch throttled 1.5 s), sampled every 100 ms:

```
 100–400ms  sk:0  es:null            <- bootstrap
 500–2000ms sk:13 es:null cards:3    <- SKELETON holds the whole window
2100ms+     sk:0  es:"No panels yet"  <- empty state only after
```

No frame shows the empty state before the skeleton. The D11/2.4b flash was **not** re-created.

#### No layout shift at the skeleton→empty-state swap (HEL-528's headline criterion)

Browser-native `PerformanceObserver({type:'layout-shift', buffered:true})` across the whole
cold boot, with the skeleton window confirmed observed (`sawSkeleton: true`):

```
LAYOUT SHIFTS: [{"v":0.00033,"t":553,"src":["app-command-bar__right"]},
                {"v":0.00001,"t":943,"src":["app-command-bar__breadcrumb","app-command-bar__sep"]}]
CLS total: 0.00034
shifts attributed to panel area: 0
```

Panel-area container origin identical across the swap (`x:264, y:120, w:1152` before and after).
Both recorded shifts are pre-existing command-bar chrome, not this change's surfaces.

#### A failed dashboard create reports something (the toast was removed)

Injected a `422` with a sentinel body through the **real rewired CTA**:

```
{"cls":"ui-empty-state ui-empty-state--main ui-empty-state--error",
 "role":"alert",
 "title":"Couldn't create dashboard",
 "desc":"Workspace dashboard quota exceeded (SKEPTIC-PROBE-548).",
 "iconSvgClass":"lucide lucide-triangle-alert",
 "ctaLabel":"New dashboard",
 "toasts":[]}
```

*Probe discriminates:* `grep -rn "SKEPTIC-PROBE-548" frontend/src backend/src` → **no match**, so
the string can only have arrived from the HTTP body. On `main`, `createDashboard`'s
`catch { return rejectWithValue("Failed to create dashboard."); }` makes the payload a fixed
string — the specific message is genuinely new behaviour, not laundered. Failure is announced,
persistent, carries the server's own words, and is retryable from the same surface.

#### The 44px touch floor — measured on laid-out boxes, with a discriminating control

Never `getComputedStyle(...).minHeight`. (Confirming the trap: that property reads `44px` even on
the 0×0 sidebar CTAs that never laid out.)

| Width | main-variant CTA (`getBoundingClientRect().height`) | sidebar-variant probe against shipped CSS |
| --- | --- | --- |
| 1440 | **32.00** | **28.00** |
| 768 | **44.00** | **44.00** |
| 430 | **44.00** | **44.00** |

Measured 44.00 on every reachable main-variant CTA at 430 and 768 across `/`, `/sources`,
`/pipelines`, `/registry`. **The control proves the probe discriminates**: at 1440 the same probe
returns 28 and 32, not 44. The `min-height` genuinely clamps the sidebar variant's
`height: var(--control-sm)` (28 → 44 at ≤768), so the floor is live, not inert — and the media
block sits **last** in `EmptyState.css` (:219), after the base rule at :165, so the HEL-535
source-order failure is not repeated. Sidebar CTAs measure 0×0 at ≤768 because `.app-sidebar` is
`display:none` there, exactly as D7 predicted.

#### Fraunces (§6) — verified by advance width, not `fonts.check()`

```
computedFontFamily: 'Fraunces, "Iowan Old Style", Georgia, serif'   @ 500 24px
widthAsResolved: 371.93   widthFraunces: 371.93
widthSerifGeneric: 326.60 widthBogus: 326.60
sidebar title font: "Schibsted Grotesk", system-ui, …
```

A bogus family measures identically to generic serif (326.60) and **differs** from the resolved
face (371.93) — Fraunces is genuinely loaded and used on the `main` variant. Sidebar titles
correctly use the sans, per §6.

#### Token discipline — zero literals

Every added CSS line in the diff, filtered for colour/spacing/type literals, is exactly three
`width/height: 1em` icon-sizing pairs. No hex, no `rgb()`, no `px`, no `rem`. The three comments
citing "`InlineError.css`'s identical pattern" are **true** — `.inline-error__icon { width: 1em;
height: 1em }` at `InlineError.css:21-25`.

#### DESIGN.md citations in the diff

`git diff main...HEAD -- 'frontend/**' | grep -iE "DESIGN\.md|§[0-9]"` returns only references to
HEL-528's `design.md` and `§7` — **no `DESIGN.md` section citations at all**, so the false-citation
failure mode a sibling run hit today is not present here.

#### §8 accessibility

Focused CTA: `BUTTON`, accessible name from text, `outline: 2px solid rgb(249,115,22)`,
`outline-offset: 2px` — exactly §8's global rule. **Enter** activated it (modal opened).
CTA icons are `aria-hidden`. Error surfaces carry `role="alert"`; neutral heroes carry
`aria-label` and no alert role.

#### D5a lifecycle hazard (Redux modal flag outliving its component)

Real browser Back/Forward, the path the design names:

```
1. at: /                      2. modal open: true
3. after Back  -> /sources    modal: false      (PanelList unmounted, flag reset)
4. after Forward -> /          5. MODAL REOPENED UNBIDDEN: false
```

The unmount cleanup works. The hook is also unconditional — I confirmed `PanelList` has a single
top-level `return (` at :234 and no early return above the new `useEffect` at :193, so no
rules-of-hooks violation was introduced by moving that code.

#### Console

Zero console errors across the entire tour, both themes, 1440/768/430, the create/delete panel
lifecycle, the modal navigate/return cycle, all filter surfaces, and the keyboard pass. The only
entries were my deliberately injected `422` and two pre-auth `401`s on the session check.

#### Light/dark parity and side-by-side consistency

Captured all four sections in both themes at 1440, plus 430 mobile. Light/dark parity is clean —
surfaces, accent, icon-wrap tint and Fraunces titles all flip correctly with no hardcoded
leakage. **On the `main` variant the five sections are genuinely uniform**: identical structure,
identical icon-wrap, identical 24px Fraunces title, identical primary CTA recipe and geometry.
That half of the ticket's premise is fully met.

The `sidebar` variant is **not** uniform — see the Change Request.

---

### Verdict: REFUTE

One blocking item. Everything else above passed, much of it exemplary: the D11 closure is the
cleanest part of the change, the error-intent parity carries a genuinely specific message, the
44px floor is real, and the design's five rounds of hardening show in the code.

I am refusing this on the ticket's **own stated premise** — cross-section consistency — because
the change leaves the identical action rendering two different ways **on a single screen**, which
is precisely the defect class its own `design.md` D8 declares it exists to remove.

---

### Change Requests

**1. Give `SidebarItemList`'s `onAdd` fallback CTA the same leading `Plus` glyph the explicit
`emptyCta` descriptors carry, so the same action stops rendering two ways on one screen.**

`frontend/src/shared/chrome/SidebarItemList.tsx:263-271` — `renderEmpty()`'s fallback builds the
descriptor as `{ label, onClick }` with **no `icon`**, while `emptyCta` (Data Types) and
`DashboardList`'s own `EmptyState` both pass `icon: <Plus />`. Measured across the ticket's five
sections' sidebar empty states:

| Section | sidebar CTA | glyph |
| --- | --- | --- |
| Dashboards | "New dashboard" | `lucide lucide-plus` |
| Data Sources | "Add source" | **NONE** |
| Data Pipelines | "New pipeline" | **NONE** |
| Data Types | "New pipeline" | `lucide lucide-plus` |

The sharp part is not the 2-2 split across sections — it is **within one screen**, both CTAs
visible simultaneously:

```
/pipelines : SIDEBAR "New pipeline" glyph:NONE  |  MAIN "New pipeline" glyph:lucide-plus
/sources   : SIDEBAR "Add source"   glyph:NONE  |  MAIN "Add source"   glyph:lucide-plus
/registry  : SIDEBAR "New pipeline" glyph:plus  |  MAIN "New pipeline" glyph:lucide-plus   <- correct
```

On `/pipelines` a user sees the *same label*, invoking the *same action*
(`setCreatePipelineModalOpen(true)`), rendered with and without a glyph at the same moment. D8's
own words for why its fence extends to sibling controls are "the same action, two glyphs, one
screen — and that is a sharper inconsistency than it fixes." Glyph-vs-no-glyph is a larger visual
delta than the FontAwesome-vs-lucide delta D8 went out of its way to eliminate.

Screenshots: `sources-dark-1440.png` / `pipelines-dark-1440.png` (bare sidebar button) versus
`registry-dark-1440.png` / `panels-dark-1440.png` (glyphed sidebar button).

I checked before raising this: it is **not** a recorded trade-off. D4a discusses `emptyCta`
versus `onAdd` solely in terms of the persistent header "+", and none of the five design-gate
rounds examined the fallback descriptor's missing icon. It is an unexamined gap, not a decision.

Fix — one line, inside this change's own fence, no behaviour change:

```tsx
// SidebarItemList.tsx, renderEmpty()'s fallback
? { label: addLabel ?? `Add ${heading.toLowerCase().replace(/s$/, "")}`,
    icon: <Plus />,          // <- add
    onClick: onAdd }
```

`Plus` is already imported in sibling modules and `EmptyState.renderCtaIcon` already dispatches on
`isValidElement`, so nothing else changes. This lands the glyph on all five in-scope sidebar
sections at once (Metrics and Assistant ride the same shared branch — that is a *gain* in
uniformity, and it touches no `emptyIcon`, so D8's Metrics/Assistant hero fence is untouched).

Please add or extend a `SidebarItemList` test asserting the fallback CTA renders its icon, so the
uniformity is locked rather than re-derived.

---

### Non-blocking notes

1. **`.panel-list__add` is 28px tall at 430**, below the 44px touch floor. I verified this is
   **not** a regression: the `.panel-list__add` CSS block is byte-identical between `main` and
   this branch (`height: var(--control-sm)`, no media floor on either side) — the change only
   swapped its icon. Worth a spinoff ticket, especially given this repo's five prior floor
   regressions; not a reason to hold this change.
2. **`CreateActionResult` is declared four times verbatim** (`useCreateDashboardAction.tsx:8`,
   `useCreatePanelAction.tsx:7`, `useAddSourceAction.tsx:7`, `useCreatePipelineAction.tsx:7`).
   Since D5's whole point is "one uniform shape", and HEL-554 will have to import one of four
   identical types arbitrarily, a single shared declaration would express the contract once. I
   independently reached the same conclusion the evaluator did here.
3. **`DashboardList`'s filtered empty state is effectively unreachable.**
   `DashboardList.tsx:176-185` always pins the active dashboard into `visibleItems`, and
   `deleteDashboard.fulfilled` re-selects via `getMostRecentDashboardId`, so
   `visibleItems.length === 0` with an active query cannot occur while any dashboard exists. I
   confirmed live: filtering to `zzqqx` leaves the ACTIVE row pinned, and the new `EmptyState`
   never renders. The change is still an improvement (it replaced an equally unreachable bare
   `<p>`), but a follow-up should either drop the pin when a query is active or delete the branch.
4. **"No matches" as a title** — I was asked to judge this specifically. It reads fine: the title
   is a terse label, the description does the work and quotes the query, and the "Clear filter"
   CTA supplies the way out. It is uniform across all three surfaces and clearly distinct from
   each section's no-data copy. No change requested.
5. **Registry copy** — "Types are created by pipelines. Create or run a pipeline to generate a
   type you can bind to panels." teaches the model in one sentence, in the app's voice, and the
   CTA names what it actually creates. This is the sharp case the ticket called out and the
   change gets it right.
6. **Test-account residue**: my verification required a genuinely empty workspace, so I registered
   one throwaway account (`skeptic548+<ts>@helio.dev`) on the shared dev DB and left one
   "Untitled dashboard" inside it. Isolated to that account; no existing data was touched.
