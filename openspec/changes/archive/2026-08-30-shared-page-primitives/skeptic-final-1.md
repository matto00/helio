## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold, independent pass. Derived from `git diff main...HEAD`, the files themselves, and
the live app at `http://localhost:6157` (backend `:9064`). The evaluator's PASS was not
used as input.

### What I verified (with evidence)

#### Gates — all five re-run fresh by me

```
npm run lint          → eslint src --max-warnings=0            EXIT=0
npm run typecheck     → tsc --noEmit                           EXIT=0
npm run format:check  → "All matched files use Prettier code style!"
npm test              → Test Suites: 274 passed, 274 total
                        Tests:       2960 passed, 2960 total
npm run build         → dist/sw.js + workbox emitted, precache 28 entries, no error
scripts/concertino/assert-phase.sh servers → PASS servers
```

#### Binding design decisions

- **Decision 0 (exclusions).** `git diff --stat main...HEAD` touches **no**
  `TypeRegistryPage`/`TypeDetailPage`/`MetricsPage`/`MetricDetailPage` file. Confirmed
  their loading/error CSS is the only surviving `page__loading|page__error` recipe in the
  tree (`grep -rln` → exactly `features/metrics/ui/MetricsPage.css`,
  `MetricDetailPage.css`), correctly handed to HEL-909 and tracked by tasks.md 5.4.
- **Decision 3a (SettingsPage = three independent `PageStatus`).** Not collapsed —
  verified live, not just in code. I monkey-patched `XMLHttpRequest` to fail only
  `/api/preferences` and remounted the route: Preferences rendered
  `.ui-page-status--section-error` ("Failed to load preferences.", `role="alert"`,
  `rgb(240,117,97)` = `--app-error`, **18px tall**), while **Agent memory, Security, and
  Personal access tokens all rendered normally**. Screenshot
  `.playwright-mcp/hel725/03-settings-section-error.png`. F-047 gating is intact and the
  section treatment is compact/inline, not a page hero.
- **Decision 4 (PageHeader on exactly three routes).**
  `grep -rln PageHeader frontend/src/features/` returns exactly `SettingsPage.tsx`,
  `PipelinesPage.tsx`, `SourcesPage.tsx`. ChatPage and PipelineDetailPage have none.

#### AC #1 — one shared loading/error implementation; duplicated recipes deleted

Every migrated route's dead selector is gone (all `grep` counts **0** across the whole
`frontend/src`): `settings-page__title`, `settings-page__loading`, `settings-page__error`,
`chat-page__loading`, `chat-page__error`, `sources-page__header`, `pipelines-page__header`,
`proposal-review__loading`, `pipeline-proposal-review__loading`,
`combined-proposal-review__loading`, `patch-set-review__loading`. `ChatPage.css` deleted
outright. No leftover dead CSS from the migration.

#### AC #2 — header visual consistency (measured, not eyeballed)

`getComputedStyle` + `getBoundingClientRect` on the live app at 1440×900:

| route | shell padding | `.page-title` | title rect |
|---|---|---|---|
| `/sources` | `20px 24px` | Fraunces / 24px / 600 | x=264 y=68 h=29 |
| `/pipelines` | `20px 24px` | Fraunces / 24px / 600 | x=264 y=68 h=29 |
| `/settings` | `20px 24px` | Fraunces / 24px / 600 | x=264 y=68 h=29 |

Pixel-identical origin and typography across all three. Settings' tighter `gap: 20px` and
`max-width: 720px` are its pre-existing deliberate overrides, correctly left as the only
route-specific rules. SettingsPage's title moved from its bespoke `.settings-page__title`
onto the shared `.page-title` — a real de-drift, not a no-op.

#### PipelineDetailPage full-bleed (the cycle-1 regression)

Measured on the resolved route: root element `class="pipeline-detail-page"` with **no**
`page-shell` class, `padding: 0px`, rect `{x:240, y:48, w:1200, h:852}` — **exactly equal
to `<main>`'s rect**. Its first child `.pipeline-detail-header` sits flush at x=240/y=48.
Footer region flush at the bottom edge (screenshot `04-pipeline-detail.png`). The cycle-2
fix (dropping `PageShell` from the resolved-content return) is real and correct.
The one console error on that route is a pre-existing `404 /api/pipelines/:id/schedule`
for a pipeline with no schedule — unrelated to this change.

#### All 9 routes driven live

Sources, Pipelines, PipelineDetail (loaded + not-found error), Chat, Settings (loaded +
per-section error), ProposalReviewPage, PatchSetReviewPage (empty + preview-error +
loading), PipelineProposalReviewPage, CombinedProposalReviewPage. Screenshots in
`.playwright-mcp/hel725/`. No console errors introduced anywhere.

- **PatchSetReviewPage error action.** Forced `previewError` by failing
  `/api/patch-sets/preview`. The error hero rendered with the `intent="error"` triangle,
  and **"Back to dashboards" was present and functional — I clicked it and landed on `/`**
  (`09-patchset-preview-error.png`).
- **Page-level spinner.** Forced by swallowing the preview XHR: `role="status"`,
  `aria-label="Loading patch set preview"`, `<span class="ui-spinner ui-spinner--xl">`,
  `padding: 32px 0`. This *replaces* a previously invisible `aria-busy` blank div — a
  DESIGN.md §7 improvement ("never a flash of empty content"), not just a swap.
- **Retry semantics preserved per-route** (design.md's named risk): Sources/Pipelines keep
  `forbidden`/`not-found` → no Retry; PipelineDetail's not-found state correctly showed the
  search-error icon and **no** Retry cta (`05-pipeline-detail-error.png`);
  ProposalReviewPage keeps Retry + "Back to dashboards" as `secondaryCta` alongside it.

#### Light/dark parity

Toggled the theme and re-drove the surfaces. Dark: `01`, `02`, `03`, `04`, `05`, `06`, `07`,
`08`, `09`, `10`, `11`. Light: `12-settings-light-section-error.png`,
`13-sources-light-error.png`, `14-page-spinner-light.png`. Section-error text picks up the
light-theme `--app-error` (`#c73a2a`) with adequate contrast; the accent spinner and header
read correctly on both. No hardcoded colors — every new rule uses `--app-*`/`--space-*`/
`--text-*`/`--control-*`/`--weight-*` tokens, all of which I confirmed exist in
`theme/theme.css`. Theme restored to dark afterwards.

#### PageHeader back-link

No route passes `backTo`/`onBack` today (`grep` across `frontend/src` — the only hits are
unrelated wizard-step props). It is unexercised-in-app but spec'd (ticket Scope: "optional
back link"), consumed by HEL-908/909, and unit-covered: `PageHeader.test.tsx` asserts
`backTo` renders a **react-router `Link`** with the right `href` (not a full-document
anchor), `onBack` renders a `<button>`, both carry `aria-label="Back"`, and `onBack` wins
when both are given. The implementation matches.

### Verdict: CONFIRM

Both acceptance criteria are traceable to real, observed evidence; the three binding
design decisions hold; all five gates are green from my own runs; and the cycle-1
full-bleed regression is genuinely fixed rather than merely claimed. Ships.

### Non-blocking notes

- `PageStatus`'s `size="section"` branch has no unit test (the other branches do). I
  verified it live, but a test would lock in the F-047 treatment against future drift.
- `.chat-page` and `.pipeline-detail-page`'s loading/error usages now carry a class with no
  remaining CSS rule of its own — `.chat-page` survives purely as a selector for three
  existing tests. Harmless, but worth a `data-testid` swap next time someone is in there.
- `PageStatus`'s `variant="skeleton"` + `loadingLabel` path renders `aria-label` on a bare
  `<div>` with no role, which most screen readers don't expose. This is byte-for-byte what
  `PipelineDetailPage` already did on `main`, so it is not a regression — but a
  `role="status"` there would make the label actually reachable.
- On `PatchSetReviewPage`'s error states, "Back to dashboards" is now the sole action yet
  renders with the *secondary* recipe (the primary slot is reserved for Retry). It matches
  its `ProposalReviewPage` sibling, so it is consistent — just slightly quieter than the
  adjacent "No patch set to review" screen's primary-styled version of the same action.
