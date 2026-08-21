# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `6c3463e9` on `feature/empty-state-ctas-primary-sections/hel-548`
(parent / base: `2eaf1d26`, which is `main`).

All evidence below is from my own fresh runs — no gate result, measurement or claim in
`files-modified.md` / the commit body was taken on trust.

Browser work used my **own headless Chromium**
(`/home/matt/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`) driven by the repo's
`playwright` module; the shared MCP Playwright session was never touched. To satisfy the
reproduce-then-fix standard I ran a **second, temporary Vite dev server from the main repo
checkout at `main` (the unfixed build) on port 5991**, sharing the same backend (8887), and
stopped it afterwards; the three live worktree dev servers (5980 / 6204 / 6206) were left
untouched, and no other worktree was entered.

---

### Phase 1: Spec Review — PASS

Issues: none.

| Ticket acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Every listed section renders `EmptyState` (main variant, Fraunces title) with a working primary CTA; no section renders blank | PASS | Live tour of a **freshly registered, genuinely empty account**: `/` → "No dashboards yet"; `/sources` → "Connect a data source"; `/pipelines` → "Build your first pipeline"; `/registry` → "No types defined"; panel area → "No panels yet". All four page heroes are `ui-empty-state--main`, title `font-family` resolves to `Fraunces, "Iowan Old Style", Georgia, serif`, each with one primary-recipe CTA (`background rgb(249,115,22)` = `--app-accent`, `color rgb(24,21,17)` = `--app-accent-ink`). |
| Registry empty state guides toward pipelines, no dead create-type path | PASS | Copy: "Types are created by pipelines. Create or run a pipeline to generate a type you can bind to panels." CTA "New pipeline". `queryByRole(/add type\|new type\|create type/i)` finds nothing; live DOM has no create-type affordance on either registry surface. |
| Filter-empty vs no-data-empty visually/verbally distinct where filtering exists | PASS | Verified live on all three filtering surfaces + the modal: `SearchX` icon, title "No matches", description quoting the query (`No data sources match "zzz-no-match-probe".`), CTA "Clear filter" which restores the list (52 / 37 / 81 rows returned). Distinct icon **and** title **and** wording — not colour alone (§8). |
| Tokens + §5 CTA, light/dark correct, keyboard-accessible names (§8) | PASS | See Phase 3. Zero hardcoded colour/spacing/type literals introduced (`git diff -- '*.css'` grep for `#hex`/`rgb`/`px`/`rem` on added lines returns nothing; the only added CSS is `width/height: 1em`, matching `InlineError.css:21-23/61-62`'s existing lucide-sizing pattern). |
| `npm run lint` / `npm test` pass, zero new warnings | PASS | Re-run by me — see Phase 2. |
| **HEL-770 absorbed** — failed create renders error-intent, `role="alert"` EmptyState with error title + icon and the **specific** rejection message | PASS | Reproduced on `main` first (neutral state, hardcoded "Failed to create dashboard.", toast fired), then on this branch: `ui-empty-state--main ui-empty-state--error`, `role="alert"`, `lucide lucide-triangle-alert`, title "Couldn't create dashboard", description = the server's own message. |
| HEL-770 — neutral branch stays neutral, no alert role | PASS | No-failure state: `role` null, `aria-label="No dashboards yet"`, no `[role=alert]` anywhere in `.panel-list`. |
| HEL-770 — `createDashboard.rejected` emits no toast; reported once on both paths | PASS | `main`: toast `toast toast--error` "Failed to create dashboard." fires. This branch: toast viewport empty on **both** dispatch paths; `PanelList` reports via the error EmptyState, `DashboardList` via `inline-error--banner` (`role="alert"` + `lucide-triangle-alert`) carrying the specific message. |
| **HEL-528 D11 inherited gap** — deleting a dashboard's last panel renders "No panels yet" + working CTA, not a blank area; no skeleton flash re-created | PASS | Reproduced on `main` first (see Phase 3 §D11), then confirmed fixed. |
| **HEL-554 CTA seam** exposed and recorded in `design.md` | PASS | Four hooks with the uniform `{cta, error, isPending}` shape; `EmptyStateCta` exported; D5/D5a/D5b record the decision *and* its reach constraint. |

Other Phase-1 checks:

- **No AC silently reinterpreted.** The two deliberate deviations (the "Select a dashboard"
  prompt carries no CTA; `MobileNavSheet`'s bare `<p>` is excluded) are both argued in
  `design.md`'s Non-Goals **and** written into the `empty-state-cta-pattern` delta as an
  explicit selection-prompt carve-out, rather than over-claimed in the spec and contradicted
  by the code.
- **All task items done and matching what was implemented.** 67/67 checked; I spot-verified
  the load-bearing ones (1.4/1.4a threading, 2.2's comment replacement, 3.1's source fix,
  3.6a's guard removal, 4.2a's cleanup effect, 5.3's `emptyCta`, 7.1a's "+" non-conversion,
  7.2b's Metrics/Assistant fence) against the diff. Nothing marked done that was not done.
- **No scope creep.** Every touched file is inside the declared territory. `DESIGN.md`,
  `BottomNav.*`, `App.css`, `index.html`, `theme.css` and `MobileNavSheet.tsx` are all
  untouched — both parallel runs' fences are honoured (`git diff --name-only` confirms).
- **No regressions to behaviour covered by other specs.** HEL-528's other `PanelList`
  loading tests are unmodified and green; the D11 test's `.ui-skeleton` absence assertion is
  kept verbatim; `SidebarItemList`'s four pre-existing call sites still get the `onAdd`
  fallback CTA (locked by a new test).
- **API contracts / schemas:** no backend, schema or HTTP change; `npm run check:schemas`
  green.
- **Planning artifacts reflect the final behaviour.** `openspec validate
  empty-state-ctas-primary-sections` → "is valid" (CLI 1.2.0, positional form).
  `proposal.md`'s Impact line correctly states the two shared-component prop additions and
  the one type-only `EmptyState` export rather than claiming the API is untouched.

---

### Phase 2: Code Review — PASS

#### Gates — every pre-commit hook re-run individually by me in `WORKTREE_PATH`

| Hook | Exit | Result |
| --- | --- | --- |
| `npm run lint` | **0** | clean, `--max-warnings=0` |
| `npm run format:check` (**repo-wide**, `prettier . --check`) | **0** | "All matched files use Prettier code style!" |
| `npm run check:schemas` | **0** | clean |
| `npm run check:scala-quality` | **0** | clean |
| `npm run check:openspec` | **1** | *only* `change "empty-state-ctas-primary-sections" is complete (67/67) but not archived` — the known HEL-657 false positive |
| `npm test` (root jest → `npm --prefix frontend test`) | **0** | 242 suites, **2580/2580** tests passed |
| `npm --prefix frontend run build` | **0** | clean production build |
| `openspec validate empty-state-ctas-primary-sections` | **0** | "is valid" |

**Commit-bypass disclosure: VERIFIED TRUE.** The commit body claims `-n` skipped only
`check:openspec`'s HEL-657 false positive and that the other five hooks were run individually
and passed. I re-ran all six myself, capturing each exit status: five are `0` and the sixth
fails with exactly — and only — the "complete but not archived" line. Notably `npm run
format:check`, which runs repo-wide and is where a sibling run's identical disclosure proved
false today, is **green**. The disclosure is accurate.

**No invented `DESIGN.md` citations.** `DESIGN.md` is **not** in the diff (the only `design.md`
present is this change's own `openspec/changes/.../design.md`), so HEL-774's fence holds.
Grepping every added source line for `DESIGN.md`/`§` yields exactly two comments, both citing
`§7`; `DESIGN.md` §7 is indeed "UI state patterns (loading / empty / error)" containing
"**Empty:** render `EmptyState` — never render nothing". The artifacts' further citations also
check out against the real file: §4 = Breakpoints (1440/1100/768/430), §5 = Buttons (primary
recipe, "one primary per view/section"), §6 = Shared components ("**EmptyState** (variants
`main`/`sidebar`; `main` titles are Fraunces)"), §8 = Accessibility baseline (accessible names;
"Color is never the sole carrier of meaning"; `outline: 2px solid var(--app-accent)` at
`outline-offset: 2px`). No cited section, rule or exception is fabricated.

#### Canonical standards

- **`CONTRIBUTING.md`** — Imports & Qualifiers: no inline FQNs (frontend-only change;
  `check:scala-quality` green anyway). Redux for shared state, behaviour moved into hooks,
  no `any`. The single `@ts-expect-error` (`panelsSlice.test.ts`) is in a test and carries a
  documented reason ("test store has fewer slices than the full RootState"). No secrets.
  `git commit -n` used within the disclosed, pre-authorised exception and called out in the
  commit body as CONTRIBUTING requires.
- **`DESIGN.md` [mechanical] rules** — token-only styling (verified by grep **and** by
  computed values in the browser); breakpoints untouched (no new media queries); §5 primary
  recipe on every CTA (`--app-accent` / `--app-accent-ink`, `--control-md/sm` heights); §6
  shared-component reuse (`EmptyState`, `InlineError`, `IconButton`, `TextField` — nothing
  hand-rolled); §8 accessible names + the exact focus ring, measured live.

#### Checklist

- **DRY** — mostly good (the shared filter-empty branch in `SidebarItemList` serves all five
  sidebar sections by construction). One nit: the `CreateActionResult` interface is declared
  verbatim four times, once per hook — see Non-blocking Suggestions.
- **Readable** — comments are unusually load-bearing here and are accurate; the
  `showPanelGridSkeleton` / "No panels yet" gates each explain *why* they are not the widening
  HEL-528 task 2.4b forbade. The now-false comment at `PanelList.tsx:75-84` was replaced, as
  task 2.2 required — I diffed it: the old "widening to `idle` there would park a permanent
  skeleton over either state" sentence is gone.
- **Modular** — the four hooks are small and single-purpose; `emptyCta` is additive and
  defaulted; the `EmptyState` primitive's rendering is genuinely untouched (the only edit is
  adding `export` to an existing interface).
- **Type safety** — no `any`, no untyped escape hatches in source. `SidebarItemList`'s
  `emptyIcon` widening to `IconDefinition | ReactNode` matches `EmptyState.renderIcon`'s
  `isValidElement` dispatch.
- **Security** — no new input handling, no new boundary, no injection surface. The one
  user-visible string newly rendered from the server (`extractErrorMessage`) goes through React
  text interpolation, and `extractErrorMessage` deliberately never surfaces raw transport
  strings.
- **Error handling** — this change *improves* it: the rejection is no longer laundered into a
  fixed sentence at the thunk, the hook does not swallow it, and both dispatch surfaces report
  it inline, announced, exactly once. The removal ordering (3.3/3.4 before 3.6) was respected.
- **Tests meaningful** — the added tests would catch real regressions: the hook test asserts a
  *non-generic* message reaches `result.current.error`; the `PanelList` failure test drives the
  **rewired** `cta.onClick` (so a swallowing hook fails it); the `fetchPanels`-`condition` test
  reads `status` **before** awaiting, which is what makes it distinguish "skipped" from
  "dispatched"; the modal test opens the modal first as a positive control before asserting the
  negative.
- **Deliberately changed tests — both changed the intended way, neither weakened:**
  - `PanelList.test.tsx` D11 mirror-image: renamed, `queryByText("No panels yet")).not.toBeInTheDocument()`
    inverted to `getByLabelText("No panels yet")` + `getByRole("button", {name: "Add panel"})`,
    and the sibling `expect(container.querySelector(".ui-skeleton")).not.toBeInTheDocument()`
    is **kept unchanged**. The fix was not bent to fit the old test — the production gate
    genuinely changed, and a new sibling test locks the *other* half (pre-dispatch frame →
    skeleton, no empty state).
  - `toastListeners.test.ts`: the `createDashboard.rejected` regression-guard entry is removed
    with a comment naming HEL-548/HEL-770 and pointing at the two conforming surfaces, **and**
    a dedicated "no longer toasts" test was added, so the coverage is inverted rather than
    silently deleted.
- **No dead code** — the now-unused `.panel-creation-modal__datatype-no-match` CSS rule was
  deleted and no reference to that class survives anywhere. No TODO/FIXME introduced. Unused
  imports would have failed `--max-warnings=0`.
- **No over-engineering** — a `useWorkspaceCreateActions()` registry was explicitly rejected as
  speculative (matching this repo's `OutputFieldContract` precedent).
- **Behaviour-preserving where expected** — the CTA rewiring is a true refactor: the
  quick-create still sends `"Untitled dashboard"`, the in-flight label still swaps without
  disabling (matching the old handler), `DashboardList`'s named-create form is **not**
  collapsed onto the hook, and the header "Add panel" button keeps its disabled precondition.
  Measured: `.panel-list__add` is `28px` tall on **both** builds — the icon swap changed only
  the glyph box (15×12 FA → 12×12 lucide, so the button is 3px narrower).

#### `staleDashboardId` gate audit (task 2.2/2.3)

Enumerating the reachable states with `selectedDashboardId !== null`:

| State | `showPanelGridSkeleton` | "No panels yet" | Renders |
| --- | --- | --- | --- |
| `loading`, items empty | true | — (suppressed by the skeleton wrapper) | skeleton |
| `idle`, `staleDashboardId !== selected` (pre-dispatch) | true | — | skeleton |
| `idle`, `staleDashboardId === selected` (post-delete terminal) | **false** | **true** | empty state |
| `succeeded`, items empty | false | true | empty state |
| `succeeded`, items present | false | false | grid |
| `failed` | false | only if `stale === selected` | `StatusMessage` + (rare) empty state — accepted knowingly in D2 |

No reachable state renders a permanent skeleton, and no reachable state renders blank. Confirmed
by frame-tracing the live app (below).

---

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`). Servers started with the canonical script:
`start-servers.sh` → `READY backend`/`READY frontend`; `assert-phase.sh servers` → `PASS servers`.

Every state below was reached through the **real application path** — a freshly registered
zero-data account (`hel548-eval-…@helio.dev`), real creates/deletes through the UI, and real
filter typing — never by forcing props. The populated-account surfaces (sidebar filters, the
panel-creation data-type step) used the existing dev account read-only.

#### Reproduce-then-fix (each defect proven on `main` first, then proven gone)

**D11 panel blank.** Real path on `main` (5991): create dashboard → add a Text panel → panel
actions → Delete → Confirm. Result: `zoomChildren: 0`, `zoomContainer` height `0`,
`.ui-skeleton` count `0`, `.ui-empty-state` count `0`, `.panel-list` innerText collapses to
`"0 panels Add panel − 100% + Reset"` — i.e. **nothing at all**, still nothing after a further
3s settle. Identical path on this branch (5980): `.ui-empty-state` count `1`, title
"No panels yet", CTA "Add panel", `.ui-skeleton` still `0`, stable after settle. Probe proven
discriminating.

**Toast + laundered message.** `main`: `[role=alert]` only the `sr-only` live region;
`.toast--error` "Failed to create dashboard."; the `PanelList` hero stays neutral with the
generic description; `DashboardList` shows a bare `.inline-error` `<p>` with **no role and no
icon**. This branch, same forced 422 (`{"error":"Workspace dashboard limit reached (eval
probe)."}`): `ui-empty-state--main ui-empty-state--error` with `role="alert"`,
`lucide lucide-triangle-alert`, title "Couldn't create dashboard", description = the server's
message; `DashboardList` shows `inline-error inline-error--banner`, `role="alert"`,
`lucide-triangle-alert`, the server's message; **no toast on either path**.

**Filter-to-zero bare paragraph.** `main`: `p.dashboard-list__status` "No matches" on
`/sources`, `/pipelines`, `/registry`, with zero `.ui-empty-state`. This branch: zero bare
paragraphs, one sidebar `EmptyState` each with `lucide-search-x`, "No matches", the quoted
query, and a "Clear filter" CTA that restores the list.

#### Cold boot — no empty-state flash, no blank frame (rAF frame trace on `/`)

`| 0 | null | 0` (pre-mount) → `SKEL | 0 | null | 0` at 954ms (3 skeleton cards, zoom container
682px) → `| 1 | No panels yet | 0` at 1004ms. The skeleton is the **first** thing the panel
area paints; the empty state never appears before it. `.panel-list` rect is `y 48 / h 852` in
both frames — no layout shift across the swap, so HEL-528's headline criterion is not regressed.

#### CTAs perform the same operation as their existing counterparts (task 8.4)

| Surface | CTA | Result |
| --- | --- | --- |
| `/registry` main hero | New pipeline | modal "Create pipeline" opens, `location.pathname` stays `/registry` — **no navigation** |
| `/registry` sidebar | New pipeline | same modal, same route |
| `/sources` main hero | Add source | modal "Add data source" |
| `/pipelines` main hero | New pipeline | modal "Create pipeline" |
| `/` main hero (0 dashboards) | New dashboard | creates "Untitled dashboard", panel area moves to "No panels yet" |
| `/` panel area | Add panel | modal "Choose panel type" (step 1 of 2) |
| filtered states ×4 | Clear filter | query cleared, list restored |

#### 44px touch floor — measured with `getBoundingClientRect().height` on the laid-out element

| Surface | 1440 | 1100 | 768 | 430 |
| --- | --- | --- | --- | --- |
| `PanelList` "No panels yet" CTA | 32 | 32 | **44** | **44** |
| `SourcesPage` CTA | 32 | 32 | **44** | **44** |
| `PipelinesPage` CTA | 32 | 32 | **44** | **44** |
| `TypeRegistryBrowser` CTA | 32 | 32 | **44** | **44** |
| `DataTypeSelectStep` modal "Clear filter" CTA | **28** | — | **44** | **44** |
| sidebar-variant CTA (discriminating control) | **28** | 28 | n/a (sidebar `display:none`) | n/a |

Identical in **both** themes. The probe is proven discriminating: it reads 28 on the
non-floored sidebar/modal control at desktop width and 44 only where the floor applies — it
does not return 44 unconditionally. `getComputedStyle(...).minHeight` was never used as
evidence (it reads `auto` at 1440 and `44px` at 768/430, consistent with the measured boxes).

**This closes the one item the executor flagged as unverified** — `DataTypeSelectStep`'s modal
filtered "Clear filter" CTA at 430/768. Reached through the real path (dev account → Add panel
→ Metric → Start blank → Choose a data type → filter "zzz-no-match-probe"): 44px at both.

#### Themes, breakpoints, consistency

Swept `{light, dark} × {1440, 1100, 768, 430} × {/, /sources, /pipelines, /registry}` = 32
combinations. `document.documentElement.dataset.theme` confirmed flipping and title colour
flipping `rgb(33,29,25)` ↔ `rgb(242,239,233)`. **Zero** horizontal overflow
(`scrollWidth <= innerWidth`) and **zero** empty states overflowing the viewport in all 32.
Side-by-side comparison of the four page heroes: identical structure, identical icon-wrap
treatment, identical Fraunces title at `24px`, identical primary CTA recipe and geometry — the
ticket's consistency premise is met on the page surfaces. One sidebar-variant asymmetry is
noted below for the skeptic.

#### Accessibility (§8)

- Every empty-state CTA is a native `<button type="button">`, `tabIndex 0`, accessible name =
  its label, CTA icon wrapped `aria-hidden="true"`.
- Focus ring measured on the focused CTA: `outline: 2px solid rgb(249,115,22)`,
  `outline-offset: 2px` — exactly §8's global rule.
- **Enter** and **Space** each activate the CTA (both opened "Create pipeline").
- Error surfaces announce (`role="alert"` on the error EmptyState and on the
  `inline-error--banner`); the neutral heroes carry `aria-label` and **no** alert role.
- Fraunces is genuinely loaded, not merely declared: canvas `measureText` advance width for the
  same string is `386.535` at `500 24px Fraunces` vs `338.602` for `"Iowan Old Style"`,
  `Georgia`, generic `serif` **and** a deliberately bogus family. (`document.fonts.check()`
  returned `true` even for the bogus family — exactly the trap the verification standard warns
  about, so it was not used as evidence.)

#### Console

Zero console errors and zero warnings across every flow above — the tour, all 32
theme×breakpoint×route combinations, the create/delete panel lifecycle, the modal
open/navigate/return cycle, all four filter surfaces, and the keyboard pass. The only entries
observed anywhere were (a) the deliberate `422` I injected, (b) two pre-auth `401`s on the
`/register` page before the account existed, and (c) one transient
`net::ERR_CERT_VERIFIER_CHANGED` that also occurs on `main`.

#### Modal-flag lifecycle (D5a)

With real client-side navigation (not a reload, which would clear Redux trivially): open the
panel-creation modal → `Ctrl+K` (quick launcher opens *over* it, confirming the listener is
ungated) → navigate to `/sources` → back to `/` ⇒ modal **not** open. Repeat with browser Back
⇒ modal **not** open. Positive control: the probe does detect the modal when it is open.

---

### Overall: PASS

The implementation matches the ticket and the five-round-hardened design, the gates are green
on my own fresh runs, the commit-bypass disclosure is accurate, and every headline behaviour
was reproduced as broken on `main` before being proven fixed here. None of the traps flagged in
`skeptic-design-4.md`/`-5.md` were walked into: the D11 test was inverted rather than deleted
and keeps its no-skeleton assertion; the skeleton gate was not widened to bare `idle`; the hook
does not swallow the rejection; the toast was removed only after both surfaces conformed; the
registry CTA opens the pipeline modal in place with no route change and offers no create-type
path; and the 44px floor was measured on laid-out boxes with a discriminating control rather
than read off CSS.

### Change Requests

None.

### Non-blocking Suggestions

1. **Sidebar-variant CTA icon asymmetry — flagged for the skeptic's judgment, not failed here.**
   Across the five enumerated sections' *sidebar* empty states, two CTAs carry a leading lucide
   `Plus` and two do not: Dashboards ("+ New dashboard", from `DashboardList`'s own
   `EmptyState`) and Data Types ("+ New pipeline", from `useCreatePipelineAction`'s descriptor)
   have the glyph; Data Sources ("Add source") and Data Pipelines ("New pipeline") do not,
   because `SidebarItemList`'s `onAdd` fallback builds `{label, onClick}` with no `icon`
   (`SidebarItemList.tsx:265-271`). Measured: `ctaIconSvgClass` is `lucide lucide-plus` on the
   first two and `null` on the second two; visible in the screenshots. This is **pre-existing**
   in kind (the `onAdd` fallback never had an icon and `DashboardList` always did) and does not
   violate any `DESIGN.md` [mechanical] rule or any spec delta — §5 does not require an icon on
   a primary button, and the ticket's AC scopes consistency to the `main` variant, which **is**
   uniform. But the requester's premise is cross-section consistency, so it is a legitimate
   [judgment] call and I am handing it to the skeptic rather than deciding it. Minimal in-fence
   fix if wanted: pass an explicit `emptyCta` carrying `icon: <Plus />` for the Data Sources and
   Data Pipelines sections in `SidebarBody.tsx` (leaving Metrics/Assistant on the icon-less
   fallback, so D8's fence is untouched).
2. **`CreateActionResult` is declared four times, verbatim.** `useCreateDashboardAction.tsx:8-12`,
   `useCreatePanelAction.tsx:7-11`, `useAddSourceAction.tsx:7-11`,
   `useCreatePipelineAction.tsx:7-11` each export an identical five-line interface. Since the
   whole point of D5 is "one uniform shape", and HEL-554 will have to import one of four
   identical types arbitrarily, a single shared declaration (e.g. beside `EmptyStateCta`, or a
   small `features/.../createAction.ts`) would express the contract once.
3. **`DashboardList`'s filtered empty state is unreachable through the UI.**
   `DashboardList.tsx:176-185` pins the active dashboard outside the filter, and
   `dashboardsSlice.ts:254-264` guarantees `selectedDashboardId` is non-null whenever `items` is
   non-empty — so `visibleItems.length === 0` with a query active cannot occur in the running
   app. I confirmed this live: filtering to `zzz-no-match` always leaves the ACTIVE row pinned.
   The change is still an improvement (it replaces an equally unreachable bare `<p>`) and
   `tasks.md` 6.5 acknowledged the constraint, but a follow-up could either make the branch
   reachable (drop the pin when a query is active) or delete it.
4. **`.panel-list__add` is 28px tall at 430** — below the 44px touch floor. Measured
   **identical on `main`** (28px there too), so this change did not regress it; it only swapped
   the icon. Worth a spinoff since this change touched the control.
5. **`PanelList.tsx` is now 466 lines** (424 on `main`), past `CONTRIBUTING.md`'s "~400 lines →
   propose a split" threshold. The growth is almost entirely explanatory comments, but the file
   is a recurring edit target and a split proposal would be timely.
6. Two micro-nits: the JSX IIFE at `PanelList.tsx:414-432` only aliases
   `createDashboardAction.error` to a local const and could be a plain ternary on
   `createDashboardAction.error !== null`; and `panelsSlice.ts:43` reads "telling apart
   panel-list `PanelList`'s two `idle` states" (stray words).

### Verification-environment note (not a defect)

Reproduce-then-fix required driving the unfixed build against the same backend. The backend's
CORS allowlist contains only `http://localhost:5980`, so writes from the temporary `main` dev
server on 5991 were rejected `403` until I normalised the forwarded `Origin` header at the
Playwright network layer. That is a property of the two-server verification setup, not of the
application — reads and writes on the real worktree origin (5980) were never intercepted for
CORS, and the only response I ever faked was the deliberate `422` used to force a create
failure. The temporary 5991 server has been stopped; the three worktree dev servers
(5980 / 6204 / 6206) are still up and untouched, the worktree is clean apart from the
orchestrator-owned `workflow-state.md`, and the ~109 stray `*.png` at the repo root were left
alone (count unchanged; my screenshots went to the session scratchpad).
