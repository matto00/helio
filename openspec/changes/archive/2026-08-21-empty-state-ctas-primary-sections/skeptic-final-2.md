## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Commit under review: `0a844517` on `feature/empty-state-ctas-primary-sections/hel-548`
(base `2eaf1d26` = `main`).

Cold spawn. Every conclusion below is derived from ground truth I read or measured myself.
`evaluation-1.md`, `files-modified.md` and `skeptic-final-1.md` were read as **claims to
verify**, not facts — round 1's confirmations were re-derived independently, not inherited.

Browser work used my **own** headless Chromium (`chromium-1208`) launched directly via
`playwright-core` 1.55.1. The shared MCP Playwright session was never touched. No other run's
worktree or ports (6204/9111, 6206) were entered. All browsers were closed
(`pgrep chrome-linux64/chrome` → none left). My probe artifacts live entirely in the session
scratchpad — the worktree's `git status` on exit is byte-identical to entry (only the
orchestrator's own `workflow-state.md` bookkeeping edit). No repo-root `*.png` was touched.

---

### What I verified (with evidence)

#### 1. Round 1's CR1 — fixed, measured in a real browser on every in-scope section

Registered a genuinely empty account through the real signup form, then measured
`button.querySelector("svg").getAttribute("class")` on both the sidebar and main CTA of every
section, in **both themes**:

| Section | sidebar CTA | sidebar glyph | main CTA | main glyph | parity |
| --- | --- | --- | --- | --- | --- |
| Dashboards | New dashboard | `lucide lucide-plus` | New dashboard | `lucide lucide-plus` | **match** |
| Data Sources | Add source | `lucide lucide-plus` | Add source | `lucide lucide-plus` | **match** (was NONE) |
| Data Pipelines | New pipeline | `lucide lucide-plus` | New pipeline | `lucide lucide-plus` | **match** (was NONE) |
| Data Types | New pipeline | `lucide lucide-plus` | New pipeline | `lucide lucide-plus` | **match** (no regression) |

Identical in `dark` and `light` (12-row sweep). `/registry`, which was already correct, is
unchanged — no regression. Screenshots: `sources-{dark,light}-1440.png`,
`pipelines-{dark,light}-1440.png`, `registry-{dark,light}-1440.png`,
`dashboards-{dark,light}-1440.png`.

*Probe discriminates:* the same selector returns `"NONE"` for the four "Clear filter" CTAs in the
same build — those are built as `{label, onClick}` with no `icon`, i.e. exactly the pre-fix
fallback shape. So the probe genuinely reads a per-button glyph, and a no-icon descriptor
genuinely produces no `<svg>`.

#### 2. The fix broke nothing it touches

- **D8's Metrics/Assistant hero exclusion still holds.** `git diff main...HEAD -- SidebarBody.tsx`
  leaves `emptyIcon={faGaugeHigh}` (Metrics) and `emptyIcon={faComments}` (Assistant) untouched;
  only the three in-scope `emptyIcon` values converted to lucide. Confirmed live: the Metrics hero
  still measures `svg-inline--fa fa-gauge-high`.
- **No layout, spacing or tap-target disturbance.** Full geometry sweep at 1440 and 430 over all
  five sections' CTAs: `iconCenterOffsetY: 0` on **every** glyph (the icon's optical centre is
  exactly the button's centre — `EmptyState.css:181`'s pre-existing `display: block` rule sizes and
  centres the new glyph, so no new CSS was needed), `gap: 8px` uniform, icon 9.59px in the sidebar
  / 11.19px on main (both `0.8em`), `overflowsSidebar: false` and `scrollWidth <= clientWidth` on
  every button at every width. Sidebar CTA heights stay `--control-sm` 28px; main stay 32px at
  desktop and 44px at ≤768.
- **Accessible names unchanged.** Every CTA icon wrapper carries `aria-hidden="true"`; the focused
  `/pipelines` CTA's accessible name is still exactly `"New pipeline"`. The added glyph does not
  pollute the name.
- `EmptyState.css` is **byte-identical to `main`** — the round-2 change adds zero CSS.

#### 3. Headline claims — re-verified independently, each with a discriminating control

**Panel-area blank closure (HEL-528 D11).** Built the real path end to end on a real account:
created a dashboard via the rewired empty-state CTA → created a Text panel through the full 4-step
modal (type → template → datatype → name) → deleted it via the panel kebab → `Confirm`. Network log
confirms the real mutation: `DELETE /api/panels/cb22438a-…`.

I reached the live Redux store through the react-redux Provider fiber and evaluated **both gates**
against the actual runtime state at the terminal frame:

```
redux: status="idle", items=0, loadedDashboardId=null,
       staleDashboardId="3ed1beec…", selectedDashboardId="3ed1beec…"
MAIN_GATE   (status==="succeeded" && items.length===0)                          -> false
BRANCH_GATE (sel!==null && items===0 && (succeeded || stale===sel))             -> true
DOM: title="No panels yet", cta="Add panel", cards=0, skeletons=0
```

Across all 16 sampled frames: `MAIN_GATE` **false in every frame**, `BRANCH_GATE` **true in every
frame**, title `"No panels yet"` in every frame, **zero skeletons in every frame**.

This is a direct, in-browser proof of discrimination: `main`'s own predicate, evaluated against the
live state this path actually produces, returns `false` — so the unfixed build renders nothing there,
permanently, and the fixed build renders the empty state. The probe detects the defect it claims to.

**No cold-boot flash (D11/2.4b not re-created).** Throttled the panels fetch by 1.8 s and sampled
every 100 ms from navigation commit:

```
frame 0–5    sk:0  es:null           <- bootstrap
frame 6–24   sk:13 es:null           <- SKELETON holds the whole window (t≈718–2542ms)
frame 25+    sk:0  es:"No panels yet" <- empty state only after (t≈2744ms)
```

`firstSkeletonFrame: 6`, `firstEmptyStateFrame: 25`, `skeletonPrecedesEmptyState: true`,
`sawSkeleton: true`. No frame paints the empty state before the skeleton.

**A failed dashboard create is announced (the toast is gone).** Injected a `422` carrying a sentinel
string that `grep -rn` proves exists **nowhere** in `frontend/src` or `backend/src`, so it can only
have arrived from the HTTP body. Both dispatch paths, on fresh empty accounts:

*PanelList empty-state CTA path:*
```
cls:  "ui-empty-state ui-empty-state--main ui-empty-state--error"
role: "alert"     ariaLabel: null
title:"Couldn't create dashboard"
desc: "Workspace dashboard quota exceeded (SKEPTIC-R2-PROBE-548-XYZZY)."
hero: "lucide lucide-triangle-alert"   cta:"New dashboard" (+ plus glyph, retryable)
toasts: []
```

*DashboardList sidebar path* (entered create mode, filled the inline form, submitted; injected `409`):
```
sidebarInlineError: cls "inline-error inline-error--banner", role "alert",
                    glyph "lucide lucide-triangle-alert",
                    text "Name collides with an archived dashboard (SKEPTIC-R2-SIDEBAR-XYZZY)."
mainEmptyState:     role null, title "No dashboards yet"   <- stays NEUTRAL
toasts: []          sentinelOccurrences: 1
```

So the failure is **reported, not swallowed** — the hook does not eat the rejection; it is announced
in a live region, persistent, carries the server's own words, and is retryable from the same surface.
`sentinelOccurrences: 1` proves "reported exactly **once**" — no double report. And the neutral
branch stays neutral (`role: null`, `aria-label="No dashboards yet"`, no alert role) before failure.

**Registry CTA opens the pipeline modal in place.**
```
urlBefore == urlAfter == http://localhost:5980/registry   noRouteChange: true
modal: { present: true, title: "Create pipeline" }
deadCreateTypePath (/new type|add type|create type/i over rendered body): false
```

**44px floor — measured on laid-out boxes, with a discriminating non-floored control.**
Never `getComputedStyle(...).minHeight` as the verdict; `getBoundingClientRect().height` on real
laid-out elements:

| Width | main-variant CTA height | computed `min-height` | control `.panel-list__add` |
| --- | --- | --- | --- |
| 1440 | **32.00** | `auto` | **28.00** |
| 768 | **44.00** | `44px` | **28.00** |
| 430 | **44.00** | `44px` | **28.00** |

44.00 on every reachable main-variant CTA at 430 and 768 across `/`, `/sources`, `/pipelines`,
`/registry`. **The control discriminates twice over**: `.panel-list__add` reads 28 at the *same*
viewport where the CTA reads 44 (so the probe is reading per-element layout, not a blanket value),
and the CTA itself reads 32 at 1440 (so the media block is correctly scoped to phone widths, per
DESIGN.md §3's "does not apply at desktop widths"). The HEL-535 inert-cascade failure mode is
therefore ruled out by measurement, not by reading CSS. Sidebar CTAs measure 0×0 at ≤768 because
`.app-sidebar` is `display:none` there, as D7 predicts.

**Fraunces (§6) — by canvas advance width, not `document.fonts.check()`.**
```
family: 'Fraunces, "Iowan Old Style", Georgia, serif'  @ 500 24px
asResolved 151.29 == pureFraunces 151.29
bogus      131.96 == genericSerif 131.96      (delta to resolved: 19.33)
FRAUNCES_LOADED: true    BOGUS_EQUALS_GENERIC: true
```
The bogus-family control measures identically to generic serif and **differs** from the resolved
face — so Fraunces is genuinely loaded and applied on the `main` variant. Re-confirmed at 430
(`267.76` vs `231.30`).

**Filter-empty vs no-data-empty.** Uniform across all four filterable sidebar sections: distinct
icon (`lucide lucide-search-x`), distinct title ("No matches"), description quoting the query
(`No data pipelines match "zzqqx".`), and a "Clear filter" CTA that is deliberately *not* the
create action. Distinct by icon **and** title **and** wording **and** action — not colour alone (§8).

**§8 accessibility.** Focused CTA: `BUTTON`, name from text, `outline: rgb(249,115,22) solid 2px`
at `outline-offset: 2px` — exactly §8's global rule. **Enter** activated it (modal opened). CTA
icons `aria-hidden`. Error surfaces carry `role="alert"`; neutral heroes carry `aria-label` and no
alert role.

**Console.** Zero console errors across the entire tour (six sections × two themes × 1440/768/430,
the create/delete panel lifecycle, both failure paths, all filter surfaces, the keyboard pass). The
only entries were two pre-auth `401`s on the session check and my deliberately injected `422`/`409`.

#### 4. Every pre-commit hook re-run individually, exit status read

`.husky/pre-commit` runs six gates. I ran each myself in the worktree and read its output:

| Gate | Exit | Output |
| --- | --- | --- |
| `npm run lint` | **0** | `eslint . --max-warnings=0`, clean |
| `npm run format:check` | **0** | repo-wide `prettier . --check` → "All matched files use Prettier code style!" |
| `npm run check:schemas` | **0** | "schemas in sync with JsonProtocols (66 checked across 47 protocol files)" |
| `npm run check:openspec` | **1** | **sole** issue: `change … is complete (67/67) but not archived` |
| `npm run check:scala-quality` | **0** | "clean (128 soft warning(s))" |
| `npm test` | **0** | `242 suites / 2581 tests passed` |

**The executor's disclosure is accurate.** `check:openspec`'s single listed issue is exactly the
pre-approved HEL-657 false positive (a change cannot be archived mid-cycle), and nothing else is
reported. The 128 Scala soft warnings cannot be new — the diff touches **zero** backend files.
`format:check` genuinely ran repo-wide. Test count 2580 → **2581** = exactly the one added test,
counted as *passed*, so it executes and is not skipped.
`openspec validate empty-state-ctas-primary-sections` (CLI 1.2.0) → "is valid", exit 0.
`tasks.md`: 67 checked, **0 unchecked**.

*The new test discriminates:* `EmptyState.tsx:59`'s `renderCtaIcon` returns `null` when
`icon === undefined`, and the CTA button has no other `<svg>` source — and I confirmed this
**empirically in the live DOM**, where the four no-icon "Clear filter" CTAs return null for the
test's exact selector `button.querySelector("svg")`. So the assertion genuinely fails pre-fix.

#### 5. Fences, citations, disclosure

- `git diff --name-only main...HEAD` contains **no** root `DESIGN.md`, no `BottomNav.*`, no
  `App.css`, no `index.html`, no `theme.css`. Both parallel runs' fences intact; `DESIGN.md`
  read-only requirement met.
- **No invented `DESIGN.md` citation.** The only `§` references anywhere in the frontend diff are
  `§7`, which exists (`DESIGN.md:276`, "Empty: render `EmptyState` — never render nothing"). Every
  other `design.md` reference points at a change's own design doc. I checked the round-2 comment's
  `D8` claim against `design.md:313` and its "Explicitly out — Metrics and Assistant" paragraph:
  the comment's characterisation is accurate.
- **Token discipline: zero literals.** The complete set of added CSS across the whole diff is three
  `width/height: 1em` icon-sizing pairs. No hex, no `rgb()`, no colour/spacing/type literals. The
  comments citing "`InlineError.css`'s identical pattern" are **true**
  (`InlineError.css:21-25`).
- **`files-modified.md` is complete and contains no false claims.** Diffed its file list against
  `git diff --name-only`: zero files claimed-but-absent, zero undisclosed (the five apparent gaps
  are the `.test.tsx` / `/ .css` shorthand forms at lines 33–35, 52 and 61). Round 2's own entry
  was appended.
- **Spec deltas are truthful**, and I checked them against what I measured rather than against
  their own prose. `frontend-panel-empty-state` describes exactly the terminal state I captured;
  `loading-state-pattern` matches my frame trace; `toast-emission-integrity` matches the measured
  toast-free, once-only reporting; `datasource-ux-empty-states` matches the live registry
  behaviour. Notably `sidebar-dashboard-filter` scopes its scenario to "no dashboard is currently
  selected" — an honest acknowledgement of the pinning constraint, not an overclaim.

#### 6. Design judgment — mine, formed independently

**Cross-section consistency (the ticket's premise) is met.** All five `main`-variant heroes share
one structure: tokenised icon-wrap, 24px Fraunces title, `--text-sm` body, one primary CTA with a
leading `Plus` at `0.8em` and `gap: 8px`, geometry identical to the pixel (32px desktop / 44px
phone; 139.03px wide for both "New pipeline" CTAs). The sidebar variant is now uniform too — which
is what round 1 refused on and what round 2 fixed. Light/dark parity is clean at 1440/768/430:
surfaces, accent, icon-wrap tint and Fraunces all flip correctly with no hardcoded leakage.

**The copy is a real deliverable, not filler.** Read in order, the four section descriptions teach
the strict source→pipeline→type→panel model without ever stating it as a rule — each names the
*next* link: Sources "…shape into a bindable type with a pipeline"; Pipelines "…typed rows you can
chart"; Registry "Types are created by pipelines… bind to panels"; Panels "…start building your
dashboard." That is well-judged product writing in the app's own voice.

**The Type Registry case — the sharp one — is right.** "Types are created by pipelines. Create or
run a pipeline to generate a type you can bind to panels." states the constraint plainly, and the
CTA names what it actually creates ("New pipeline") rather than a euphemism. It opens the pipeline
modal in place with no route change, and I confirmed by regex over the rendered body that no
"create type" path is offered anywhere. It also correctly uses `emptyCta` rather than `onAdd`, so
no persistent "+" appears under a "Data Types" heading. I reached this view independently and
agree with round 1.

**"No matches" as a filter-empty title** reads well: a terse label, with the description doing the
work and quoting the query, and "Clear filter" supplying the exit. Uniform across all four
surfaces and unmistakably distinct from each section's no-data copy. No change requested — again
my own reading, not deference.

---

### Verdict: CONFIRM

Round 1's single blocking change request is **fixed and measured fixed**, on all four in-scope
sidebar sections at once, in both themes, with no regression to `/registry` and no disturbance to
layout, spacing, centring, accessible names or the 44px floor. Every headline claim I was asked to
re-verify independently held under a probe with its own discriminating control — most decisively
the panel-area closure, where `main`'s own gate evaluates to `false` against the live runtime state
while this branch's evaluates to `true`. All six pre-commit gates pass on my own re-run, and the
executor's `git commit -n` disclosure is accurate in every particular.

This ships.

---

### Non-blocking notes (for delivery triage)

1. **Metrics' two CTA glyphs are now lucide-vs-FontAwesome rather than glyph-vs-none.**
   On `/metrics` with zero metrics, the sidebar CTA "New metric" renders `lucide lucide-plus`
   (11.19 × 11.19) while the main CTA "New metric" renders `svg-inline--fa fa-plus`
   (14 × 11.19) — same action, one screen. This is **not a regression**: before this change the
   sidebar CTA had *no* glyph at all, and by round 1's own reasoning (which I re-derived and agree
   with) glyph-vs-no-glyph is a larger delta than FA-vs-lucide. I compared them at rendered size in
   `crop-metrics-dark-{sidebarES,mainES}.png` and they read as the same "+"; the FA plus is ~25%
   wider and marginally bolder. Metrics is also explicitly outside the ticket's five in-scope
   sections. Closing it is a two-token change at
   `frontend/src/features/metrics/ui/MetricEmptyState.tsx:18` (`icon: faPlus` → `icon: <Plus />`),
   and it belongs with the HEL-346 iconography tail rather than here.
2. **`DataTypeSelectStep`'s no-data title is the only empty-state title with a trailing period** —
   "No data types are registered yet." versus "No dashboards yet", "No types defined", "No panels
   yet", "No matches", "Connect a data source", "Build your first pipeline". Pre-existing (this
   diff changed only its icon), but visible inside a change whose subject is empty-state
   consistency. `DataTypeSelectStep.tsx:178`.
3. **Empty-state title register is mixed without a governing rule.** Two are imperative invitations
   ("Connect a data source", "Build your first pipeline"), three are neutral status statements
   ("No dashboards yet", "No types defined", "No panels yet") — and the split does not track
   whether the resource is directly creatable. Both moods are idiomatic and the sidebar/main pair
   *within* each section always matches, so a user never sees the mismatch side by side. Worth one
   editorial pass someday; not worth holding anything for.
4. Round 1's notes 1–3 (`.panel-list__add` at 28px — I re-measured it at 28.00 at both 430 and 768
   and confirm it is not a regression from this change; `CreateActionResult` declared four times;
   `DashboardList`'s unreachable filtered empty state) are already triaged as follow-ups and I do
   not re-raise them.
5. **Test-account residue.** Verifying empty states through the real application path required
   genuinely empty workspaces, so I registered three throwaway accounts on the shared dev DB
   (`skeptic548r2+…`, `skeptic548r2b+…`, `skeptic548r2c+…`). One holds a single "Untitled
   dashboard" created by the CTA under test. Isolated to those accounts; no existing data touched.
