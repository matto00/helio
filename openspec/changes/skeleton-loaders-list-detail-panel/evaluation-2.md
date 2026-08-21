## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed `11ce766b` on top of `0ea1692b`; base still `3d93e82a`. All gates re-run
independently. All UI claims re-measured from scratch in the running app.

### Correction to evaluation-1.md CR1 — my cycle-1 number was the wrong one

The orchestrator asked me to settle this plainly, including the possibility that
I was mistaken. **I was.** The executor's original `43px / 18px / 15px` was
correct; my `46px / 19px / 17px` was an artifact of my own instrument, and the
3px layout shift I reported in CR1 **never existed** in the shipped
configuration.

Root cause, found and then confirmed by controlled experiment: my cycle-1
harness booted the app inside a hand-authored iframe via `document.write`, and
the HTML I wrote **omitted the Google Fonts `<link>`** that the real
`frontend/index.html` carries. The iframe therefore rendered in the fallback
(`system-ui`), whose `line-height: normal` line boxes are taller than Schibsted
Grotesk's. I even had the evidence in front of me in cycle 1 — I logged
`[...document.fonts]` as an empty array — and misread an empty font set as
"fonts fine" rather than "no webfont ever loaded".

A/B control this cycle, same browser, same commit, same page, differing **only**
in whether that `<link>` is present:

| | fonts loaded (real `index.html`) | fonts absent (my cycle-1 harness) |
| --- | --- | --- |
| rendered family (canvas advance-width probe) | Schibsted Grotesk (192.951) | system-ui (198.869) |
| `document.fonts.size` | 34 | 0 |
| `.dashboard-list__name` | **18px** | 19px |
| `.dashboard-list__subtitle` | **15px** | 17px |
| stacked row | **43px** | 46px |
| `1lh` @ `--text-sm` / `--text-xs` | **18 / 15** | 19 / 17 |

Cross-checked in the **top-level page** (no iframe at all, i.e. the real app):
row-height histogram over all 81 registry rows is `{32: 44, 43: 37}`, name 18px,
subtitle 15px. That matches the executor and not me.

Two further notes for the record, since both parties leaned on font checks:

- **`document.fonts.check()` cannot support either party's claim.** Measured
  live: `document.fonts.check('14px "Totally Not A Real Font 12345"')` returns
  **`true`**. The method is vacuously true when no matching face exists, so it
  cannot distinguish "webfont loaded" from "webfont absent". The executor's
  stated verification method was not sound either — it happened to reach the
  right answer because its environment genuinely had the font. A canvas
  `measureText` comparison against the family alone vs. the fallback (what I used
  above) is the check that actually discriminates.
- **The executor's own two artifacts contradicted each other in this same
  commit**: `DashboardList.css:555-560` says "verified live … fonts loaded: 19px
  for --text-sm, 17px for --text-xs" (my numbers), while `files-modified.md` says
  18px/15px (its own). See non-blocking item 2 — the CSS comment is the one
  that's wrong.

**The `1lh` change is still correct and worth keeping**, for a different reason
than CR1 gave. Measured both ways, `1lh` tracks whatever font actually renders,
so skeleton and resolved row agree in *both* conditions:

| | skeleton row | resolved row |
| --- | --- | --- |
| fonts loaded | 43px | 43px |
| fallback font (FOUT window / webfont blocked) | 46px | 46px |

The superseded `18px`/`15px` literals were right only in the first column; in
the second they would have been 43 against 46 — a real 3px-per-row mismatch
during the font-swap window and permanently for any user whose webfont request
fails. So the fix converts a configuration-dependent match into an unconditional
one. My CR1 diagnosis was wrong; the remedy it asked for is nonetheless a genuine
improvement, and I'd keep it.

### Phase 1: Spec Review — PASS

- All five cycle-1 change requests addressed; nothing else in the ticket's scope
  regressed (re-verified live, below).
- CR4's corrections to `specs/loading-state-pattern/spec.md` and D10 accurately
  describe what I measured: exact match in the fully-covered and fully-empty
  cases, an accepted positional/size delta beyond the covered prefix under
  partial coverage. The new scenario is well-formed and `openspec validate
  skeleton-loaders-list-detail-panel --strict` passes (`/usr/bin/openspec`).
- Tasks still 56/57 with 6.9 correctly deferred to archive.
- One artifact inaccuracy remains (non-blocking item 3): D10's Correction cites
  the wrong dashboard for the 140px counter-example.

### Phase 2: Code Review — PASS

**Gates (my own fresh run in `WORKTREE_PATH`, not the commit message):**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0, zero warnings |
| `npm run format:check` | exit 0 |
| `npm test` | exit 0 — root 8/186 + frontend **235 suites / 2493 tests** (matches the claim; +2 vs cycle 1) |
| `npm --prefix frontend run build` | exit 0 |
| `node scripts/check-openspec-hygiene.mjs` | exit 0 — `openspec/ is clean` (confirms no hook bypass was needed) |
| `node scripts/check-schema-drift.mjs` | exit 0 |
| `openspec validate … --strict` | `Change 'skeleton-loaders-list-detail-panel' is valid` |

**CR5 mechanical items — both verified:** `transformOrigin` now appears exactly
once in `PanelList.tsx` (the shared `zoomContainerStyle` const), and the two
inline `import("../types/panel").Panel` FQNs are gone from
`PanelCardBody.predispatch.test.tsx`. The only remaining inline `import(...)`
type references are inside `jest.mock` factories, where hoisting makes them
necessary, plus genuine dynamic imports.

**The `zoomContainerStyle` extraction is behaviour-preserving** — verified, not
assumed: at a saved zoom of `scale(0.8)` the skeleton and the resolved grid are
still pixel-identical (container `1152×518.4`, cards `(497.6,120,918.4,209.6)`
and `(264,344,452,209.6)` in both states).

**`1lh` / `8ch` browser support — asked and answered:**

- `lh` is supported in Chrome/Edge 109+, Safari 16.4+, Firefox 120+. The repo
  declares no `browserslist` and no explicit Vite build target, so the effective
  floor is whatever shipped CSS already demands — and `EmptyState.css` (HEL-539,
  already on `main`) uses `color-mix(in srgb, …)`, which needs Chrome 111 /
  Safari 16.2 / Firefox 113. `lh` therefore **does not raise the baseline this
  app already requires**. `ch` has been universal for a decade.
- Degradation if it were unsupported: the declaration is dropped, the wrapper
  falls back to `height: auto`, and the row under-measures — i.e. it fails the
  way the pre-fix code did, not with a crash or a blank. Worth knowing, not worth
  blocking.
- **jsdom is unaffected.** `jest.config.cjs:8` maps `\.(css)$` to
  `src/test/styleMock.js`, so `DashboardList.css` never reaches jsdom at all. The
  inline `height="1lh"`/`width="8ch"` on `<Skeleton>` do reach jsdom's `cssstyle`;
  I ran them directly through jsdom and both are retained verbatim
  (`cssText: "height: 1lh; width: 8ch;"`) with **no warnings and no dropped
  declarations**. Corroborated by the full suite passing clean.

### Phase 3: UI Review — PASS

Re-measured live at 1440, fonts verified as actually-rendered Schibsted Grotesk
via canvas advance-width probe on every run.

**CR1 — `/registry` stacked rows, post-fix.** Skeleton rows at
`y = 348, 393, 438, 483, 528`, each `x=12 w=215 h=43`, gap 2. Resolved rows at
`y = 348, 393, 438, 483, 528, 573`, each `x=12 w=215 h=43`, gap 2. **Row-for-row
pixel-identical**; wrappers measure name 18 / subtitle 15. Also re-run in the
fallback-font control: 46 vs 46, still identical. No shift in either condition.

**CR2 — panel-count pill.** Height collapse fixed:

| case | skeleton | resolved |
| --- | --- | --- |
| "6 panels" (8 chars) | `x=1226.16 w=75.59 h=22` | `x=1226.14 w=75.61 h=22` |
| "1 panel" (7 chars) | `x=1226.16 w=75.59 h=22` | `x=1233.34 w=68.41 h=22` |

The 15.59px→23px height collapse I flagged is gone (22px in every state). Width
is now exact for the 8-character case and off by exactly one monospace advance
(7.18px) when the label is 7 or 9 characters — inherent to not knowing the count
pre-fetch, explicitly documented at `PanelList.tsx:231-235`, and the adjacent
"Add panel" button does not move at all (`x=1309.75` in every state), so nothing
clickable shifts. Accepted; see non-blocking item 1.

**CR3 — both directions, live against the real backend.** I forced a genuine
zero-dashboard response without touching data or code by rewriting the app's own
`GET /api/dashboards` to `?limit=1&offset=99999` (a real, empty page from the
real server, `total: 42`) and delaying it 4s, then sampling every frame:

- `t=397ms → t=4417ms` (the whole in-flight window): `[aria-label="Loading panels"]`
  present, 3 placeholder cards, 5 sidebar skeleton rows, and
  `"No dashboards yet"` **absent**, `"New dashboard"` button **absent**. The false
  empty state is gone.
- `t=4417ms` (fetch resolves to zero): skeleton gone, `"No dashboards yet"`
  **present**, `"New dashboard"` CTA **present**. The F-003 / HEL-554 bootstrap
  path still works, with no blank frame between the two states.

On the real 42-dashboard account with no stubbing and no delay, the cold-boot
trace is now `t=398ms` grid skeleton up → `t=561ms` resolved, with `noDashYet`
false at **every** sampled frame (cycle 1: true from 367→423ms). Also clean of
`--`, "No data" and "Select a dashboard" throughout.

The two new Jest tests lock both directions and would catch a revert (removing
`showBootstrapSkeleton` makes `queryByText("No dashboards yet")` non-null); the
pre-existing F-201/F-003 tests now pin `status: "succeeded"`, locking the other
half.

**`PageContentSkeleton`** (non-blocking suggestion taken): `ui-empty-state--main`
box still `1152×320` (the floor is preserved), and the icon slot is now the real
`ui-empty-state__icon-wrap` at `64×64` with `border-radius: 14px` — a rounded
square matching the real `EmptyState`, not the circle the literal produced.

**No console errors.** A clean top-level session (no harness) driving a dashboard
switch plus `/sources`, `/pipelines`, `/registry` and back reports **0 errors,
0 warnings**. The `createRoot`/`removeChild` errors visible earlier in this
session were artifacts of my own harness repeatedly `document.write`-ing into a
reused iframe window, not app behaviour — stated explicitly so they are not
mistaken for a finding.

### Overall: PASS

All five change requests are resolved, with the honest caveat that **CR1 was a
false positive of mine**: there was no 3px shift before this cycle, and the
executor was right to push back. The `1lh` change it prompted is still a net
improvement (it removes two hardcoded pixel values and holds under the fallback
font), so nothing needs reverting. CR2, CR3, CR4 and CR5 were all real and are
all correctly fixed, CR3 now verified live in both directions against the real
backend rather than only in Jest.

### Non-blocking Suggestions

1. **`8ch` is exact only for the 8-character label.** "1 panel" (7 chars) and any
   count ≥ 10 ("10 panels", 9 chars) leave a one-advance (~7.2px) width delta on
   the pill. Already documented in code and harmless (nothing interactive moves).
   If you want it exact, `.panel-list__count` could carry a `min-width` in `ch`
   for both states, so the pill is one fixed box whatever the digit count — that
   also stops the real pill resizing between "9 panels" and "10 panels" today.
2. **`DashboardList.css:555-560` still states the wrong numbers.** The comment
   says "verified live at /registry, both themes, fonts loaded: 19px for
   --text-sm, 17px for --text-xs", and `:572-576` repeats that the old literal
   was "1px short of the real 19px row". With fonts loaded the real values are
   **18px / 15px** (43px row) — 19/17 is the fallback-font case. The rule itself
   is correct; only the prose is wrong, and it currently enshrines my mistake in
   the codebase. Worth a one-line correction (e.g. "18px/15px with the webfont,
   19px/17px on the fallback — which is exactly why this is `1lh` and not a
   literal", which is the strongest argument for the change anyway).
3. **D10's Correction paragraph names the wrong dashboard.** It cites
   "`Skeptic Isolation Test`'s dev-DB profile at 4 saved entries / 6 real panels"
   for the 140px delta. `Skeptic Isolation Test` has an **empty** saved layout
   (0 entries / 2 panels) and was my *fully-empty* case; the 4-of-6 partial-coverage
   counter-example was **`skeptic-output overview`**. The reasoning is right, the
   citation is not.
4. **A failed dashboards fetch still shows "No dashboards yet".** When
   `dashboardsStatus === "failed"`, `showBootstrapSkeleton` is false and the
   ladder falls through to the same CTA, so a fetch failure reads as "you have no
   dashboards" in the main pane (the sidebar does show the error). Pre-existing,
   unchanged by this cycle, and error-state territory (HEL-539/HEL-548) rather
   than this ticket's — noted so it isn't lost.
5. **The two new CR3 tests assert `container.querySelector(".panel-grid-shell")`.**
   That class is shared by `PanelGridSkeleton` and the resolved `PanelGrid`; it is
   sound here only because the resolved branch can't render with no dashboard
   selected. `[aria-label="Loading panels"]` is unambiguous and is what the
   executor itself used for the live check — worth using in the test too.
6. Still open from cycle 1, all still non-blocking: `role="status"` on the
   role-less loading wrappers; `PipelineDetailSkeleton`'s `28px` circle (the
   executor's reason for leaving it — no grounded real-class substitution exists —
   is sound); `PipelineDetailPage`'s header/footer band deltas (`31→37`, `49→123`);
   `DashboardList.tsx` / `SidebarItemList.tsx` both over the ~400-line budget, to
   be called out in the PR body; task 6.3a's "EIGHT files" should read five.
