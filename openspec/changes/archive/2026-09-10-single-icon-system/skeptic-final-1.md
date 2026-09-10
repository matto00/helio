## Skeptic Report — final gate (round 1, skeptic-final-1.md)

All checks below were run fresh by me against HEAD `b114e75b`. No prior
report's claim is inherited; where a claim from evaluation-1/2.md is
restated here, I re-derived it myself.

### What I verified (with evidence)

**AC1 — zero `@fortawesome/*` anywhere. VERIFIED.**
- `grep -rn "fortawesome" frontend/src` → **0 hits** (case-insensitive too).
- `grep -n fortawesome frontend/package.json` → no match (exit 1).
- `grep -c fortawesome frontend/package-lock.json` → **0**.
- Repo-wide (excluding `openspec/`), the only remaining files naming
  fortawesome are `scripts/check-dependabot-groups.mjs` and its selftest —
  both historical rationale comments, not dependencies.

**AC2 — every icon at a standardized size. VERIFIED, by two independent
methods rather than a spot-check.**
- *Static:* I wrote my own AST-ish scanner (`/tmp/scan443.mjs`) that, for
  every `.ts/.tsx` file in `frontend/src`, parses the `lucide-react` import
  list (resolving `as` aliases) and finds every JSX usage of each imported
  symbol, extracting the **full tag across line breaks with brace-depth
  tracking** (so a `size=` on a later line is not a false negative). 73
  usages carry no inline `size`. I classified all 73 by reading each:
  - EmptyState/PageStatus/pickerEmptyState/SidebarItemList/cta `icon=`
    prop-passthrough (case (b), sized by CSS) — the large majority, plus
    `EmptyState.test.tsx` fixtures and the AC3 guard fixtures.
  - The handful of *direct-render* unsized sites each have an explicit CSS
    sizing rule, which I read directly: `CommandPalette.css:19-23`
    (`width/height: var(--text-base)`), `DashboardList.css:125-128`
    (`.dashboard-list__filter-clear svg { width/height: 1em }`, shared with
    `SidebarItemList.tsx:329`), `OnboardingChecklist.css:88-91`
    (`width/height: 100%` inside a 20×20 indicator),
    `InlineError.css`, `StatusMessage.css`.
  - The only unsized sites *introduced by this diff* are `AppRoutes.tsx:60`
    `<Compass />` and `pickerEmptyState.tsx:45` `<MessagesSquare />`, both
    `EmptyState` `icon=` props → case (b). **No remaining gap found.**
- *Static, non-standard literals:* a second scan for numeric `size={N}` on
  lucide elements found exactly **one** hit, `iconAccessibility.guard.test.tsx:38`
  (`size={16}`, a test fixture, and 16 is a standard value anyway). Every
  other site sources from `ICON_SIZE`.
- *Runtime (the check that actually settles it):* in the running app I
  measured `getBoundingClientRect()` of **every** rendered `<svg>` across
  `/dashboards`, `/sources`, `/pipelines`, `/connectors`, `/assistant`,
  `/settings` and a pipeline detail page. Every icon rendered at 14, 16 or
  20 px, with exactly one class of exception: `ui-empty-state__icon` at
  24px, which is the documented case-(b) mechanism (`EmptyState.css:30-31`
  `font-size: var(--text-2xl)` consumed by the `1em` rule), not lucide's
  default. **No 24px "unsized lucide default" blowout anywhere.**

**Case-(b) CSS claim — INDEPENDENTLY VERIFIED (4th time, by reading source).**
Not just the `svg` descendant rules but the *em base* they resolve against,
which is the half that actually makes the mechanism work:
- `EmptyState.css:180-184` `.ui-empty-state__cta-icon svg { width/height: 1em }`
  against base `:167-168` `font-size: 0.8em`.
- `EmptyState.css:210-214` `.ui-empty-state__icon svg { ... }` against bases
  `:30-31` (`--text-2xl`, main) and `:71-72`/`:78` (`--text-sm`, sidebar).
- `MobileNavSheet.css:180-184` against base `:164-165` `font-size: 0.8em`.
The runtime measurement above independently corroborates this (sidebar
empty-state `SearchX` renders small; main variant renders 24px, matching
`--text-2xl`).

**AC3 — accessible names / `aria-hidden`. VERIFIED.**
`iconAccessibility.guard.test.tsx` contains a genuinely non-compliant
fixture (raw `<button>` with an icon and no naming mechanism) asserted to
have an empty accessible name, paired with the compliant `IconButton` shape
asserted green — satisfying the ticket's "red before / green after" wording
rather than asserting compliance against an already-compliant fixture. The
file also honestly records a probe finding (lucide's `<svg>` is
`aria-hidden` by default) explaining why the decorative half has no RED
counterpart. Matches `specs/icon-system/spec.md`.

**AC4 — bundle + gates. ALL RE-RUN FRESH BY ME AGAINST HEAD.**
- `npm run lint` (`eslint src --max-warnings=0`) → PASS, exit 0.
- `npx tsc --noEmit` → PASS, no output.
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → **301/301 suites, 3197/3197 tests, 1 snapshot** passed.
- `rm -rf dist && npm run build` → PASS; `grep -ril fontawesome dist/` →
  **0 hits**.
- Console: `Total messages: 3 (Errors: 0, Warnings: 0)` on port 5875. (The
  shared Playwright session's error log is full of `removeChild` /
  `useTheme` stack traces — I checked, **every one is from ports 5965 /
  6480 / 6298, i.e. other worktrees**; `grep -c 5875` over that log is 0.)

**D7 dependabot fix — VERIFIED CLEAN.**
`node scripts/check-dependabot-groups.mjs` → "OK — 4 declared families each
resolve to a single group; every production dependency accounted for."
`check-dependabot-groups.selftest.mjs` → 6/6 fixture cases pass (including
the split-family and stale-declaration cases). No `@fortawesome` entry
remains in `DECLARED_INDEPENDENT` or in `.github/dependabot.yml`
(`grep -ci fortawesome .github/dependabot.yml` → 0); the only mentions left
are the rationale comments at `check-dependabot-groups.mjs:6,15`.

**`b114e75b` comment-only — VERIFIED.**
`git show b114e75b -U0`, filtered to non-comment, non-blank added/removed
lines, produces **empty output**. Only `MobileNavSheet.css` and
`EmptyState.css` touched; zero selector or declaration changes.

**FontAwesome mentions in CSS — count VERIFIED as 3**, matching the
executor's claim: `DashboardList.css:120`, `MobileNavSheet.css:175`,
`SortableTh.css:33`. All three are historical rationale explaining why an
em-relative rule exists or no longer sizes the glyph. Legitimate.

**design.md flagged-risk spot-checks — all correct in final state.**
- `SortableTh.tsx:36-46` — three-state glyph preserved (`ChevronUp` asc /
  `ChevronDown` desc / `ArrowUpDown` neutral), all three explicitly
  `size={ICON_SIZE.sm}` and `aria-hidden`. `SortableTh.css:36-46` correctly
  retains only the *colour* rules, with the HEL-1022 hazard documented.
  Verified visually in the running app — legible, not oversized.
- `StepCard.tsx` — `faCopy → Copy` (line 289); `stepNarrowing.ts:113`
  `faClone → Files`. The distinction design.md flagged is **preserved**;
  the two did not collapse onto one glyph.
- Theme toggle `SettingsPage.tsx:70` — `Sun`/`Moon` swap intact,
  `ICON_SIZE.sm`. Confirmed live: dark theme shows Sun + "Light mode".

**UI / design judgment (screenshots, both themes).**
Dashboards, pipeline detail, sidebar filter-to-zero empty state, and
Settings captured in light and dark. Stroke weight, optical size and
alignment are uniform across sidebar nav, StepCard action cluster, table
sort glyphs and empty states; the migration reads as one coherent icon
family and is visibly better matched to the app's hairline aesthetic than
the previous mixed set. The StepCard action cluster — the specific AC2
regression evaluation-1.md caught — renders correctly small and evenly
spaced, no overflow of its 24×24 buttons. Light/dark parity is clean, no
contrast or layout-shift problems.

### Verdict: REFUTE

Everything above passes. The single blocking objection is below. It is not
visual and not an AC violation, but it is squarely the defect class this
ticket exists to eliminate, and it was **introduced by this change**.

### Change Requests

1. **The change introduces lucide's deprecated legacy icon aliases, and in
   one case ships the same component under two different names — in the
   very ticket whose purpose is "single icon system" consistency.**

   Verified against the installed `lucide-react@1.40.0`'s own export list
   (`node_modules/lucide-react/dist/lucide-react.d.ts:27050`), which
   declares the alias direction explicitly:
   ```
   TriangleAlert as AlertTriangle
   CircleCheck   as CheckCircle2
   CircleX       as XCircle
   ```
   and confirmed at runtime (`require('lucide-react').AlertTriangle ===
   require('lucide-react').TriangleAlert` → `true`; same for
   `XCircle === CircleX`, `CheckCircle2 === CircleCheck`).

   Sites introduced by this diff (none of these names existed in
   `frontend/src` on `main` — `git grep AlertTriangle main -- frontend/src`
   returns nothing):
   - `frontend/src/features/pipelines/ui/StepCard.tsx:19,209` — `AlertTriangle`
   - `frontend/src/features/pipelines/ui/stepConfigs/AggregateConfig.tsx:13,228` — `AlertTriangle`
   - `frontend/src/shared/ui/Toast.tsx:26-31` — `AlertTriangle`, `CheckCircle2`, `XCircle`

   Meanwhile the canonical `TriangleAlert` is already used in **7** files on
   `main` and still is at HEAD (`PageStatus.tsx`, `MobileNavSheet.tsx`,
   `OnboardingStep.tsx`, `PanelList.tsx`, `pickerEmptyState.tsx`, …). So
   after this change the codebase renders the identical warning glyph under
   two import names. Concretely: a future `grep TriangleAlert` — the
   obvious way anyone would enumerate warning icons — now silently misses
   three sites, which is exactly the enumeration hazard `MISTAKES.md`
   warns about and exactly what a "consistency pass" is supposed to remove.

   **Required:** rename to the canonical lucide names at the five call
   sites above — `AlertTriangle → TriangleAlert`, `CheckCircle2 →
   CircleCheck`, `XCircle → CircleX` (import specifier + JSX/`variantIcon`
   references). This is a pure rename: the components are identical
   objects, so there is **zero** rendered-pixel change and no
   screenshot/UI re-review is needed. Re-run lint/typecheck/test; the
   `SortableTable.test.tsx.snap` snapshot is unaffected (different
   component), but confirm rather than assume, since lucide sets a
   `lucide-<name>` CSS class derived from the canonical name — verify no
   test asserts on `lucide-alert-triangle`/`lucide-x-circle`/
   `lucide-check-circle-2` class strings before assuming the snapshot is
   inert.

### Non-blocking notes

- `SortableTh.tsx:37,39` use a pointless template literal for a constant
  class string (`` className={`sortable-th__glyph`} ``) where a plain
  string literal would do. Pre-existing style, not introduced here; harmless.
- evaluation-2.md's suggestion of a CI/lint rule flagging lucide JSX with
  no `size=` and no exempting parent CSS is worth a follow-up ticket. My
  scanner (73 candidate hits, all of which required manual classification)
  is direct evidence that this class of gap is not cheaply greppable — it
  took three prior passes plus this one to converge, which is precisely the
  argument for mechanizing it.
- The 24px `ui-empty-state__icon` hero size coincides numerically with
  lucide's unsized default. That is a coincidence of `--text-2xl`, not a
  bug — but it means "is it 24px?" is a false signal for detecting unsized
  icons in empty states specifically. Worth noting for whoever writes the
  lint rule above.
