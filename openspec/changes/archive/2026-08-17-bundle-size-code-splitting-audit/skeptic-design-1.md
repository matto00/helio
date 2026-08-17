## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/frontend-code-splitting/spec.md` in full.
- Confirmed the `HEL-553` `workbox.maximumFileSizeToCacheInBytes` comment design.md cites actually
  exists verbatim in `frontend/vite.config.ts` (4 MiB, code-splitting-hadn't-landed-yet rationale).
- Read the actual current source of every file the design names as a lazy-boundary target:
  - `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — `export function ChartRenderer`
    (named export only, **no default export**); statically imports `ChartPanel` from `../ChartPanel`.
  - `frontend/src/features/panels/ui/renderers/MarkdownRenderer.tsx` — `export function
    MarkdownRenderer` (named export only, **no default export**); statically imports
    `MarkdownPanel` from `../MarkdownPanel`.
  - `frontend/src/features/panels/ui/ChartPanel.tsx` — imports `echarts-for-react/esm/core` +
    `echarts` at module top (the actual heavy dependency). Named export
    (`export function ChartPanel`), no default.
  - `frontend/src/features/panels/ui/MarkdownPanel.tsx` — imports `react-markdown`/`remark-gfm`
    at module top (the actual heavy dependency). Named export (`export function MarkdownPanel`),
    no default.
  - `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — named export, no default.
  - `frontend/src/app/AppRoutes.tsx` — confirmed `ProposalReviewPage` is statically imported and
    routed at `/proposals/review`; confirmed the route table has **16** `<Route path=...>` entries
    (15 unique page components, `TypeRegistryPage` reused at two paths), not the "12 routed pages"
    proposal.md's "Why" section claims. Minor factual slip, not independently blocking.
  - `frontend/src/features/panels/ui/PanelContent.tsx` — confirmed it statically, synchronously
    imports and dispatches to `ChartRenderer`/`MarkdownRenderer` via named imports
    (`import { ChartRenderer } from "./renderers/ChartRenderer"` etc.) inside an `if
    (isChartPanel(panel))`/`if (isMarkdownPanel(panel))` branch — no existing Suspense boundary
    anywhere in this file.
- Confirmed `shared/ui/index.ts` is the only barrel in the tree (`find . -iname "index.ts*"`
  returned exactly one hit) and re-exports only lightweight primitives (no echarts/react-markdown
  re-export) — the proposal's "no barrel fix needed" claim holds.
- `grep -rn "React.lazy\|Suspense"` across `frontend/src` (excluding tests) returned no hits —
  the design's "no `React.lazy`/`Suspense` usage exists anywhere today" claim holds.
- Confirmed `src/test/echartsForReactCoreMock.tsx` and `src/test/reactMarkdownMock.tsx` (cited in
  design.md's Risks section) actually exist on disk.
- Read `DESIGN.md` §7 (UI state patterns) — the cited "established spinner pattern... never a
  flash of empty content" loading convention is accurately quoted.
- Checked `git log --all` for HEL-351 (table-virtualization, flagged as a coordination dependency
  in `ticket.md`) and `package.json` for any windowing library — neither has landed, so the
  conditional "coordinate if HEL-351 adds a windowing library" dependency is correctly inert for
  this design; no gap there.

### The core problem: Decision 1 is internally contradictory and not implementable as written

Design.md's Decision 1 states:

> Convert `ChartRenderer.tsx`/`MarkdownRenderer.tsx`'s default export to `React.lazy(() =>
> import(...))`, ... rather than lazy-loading `ChartPanel`/`MarkdownPanel` directly. ... this
> needs no change to `PanelContent.tsx`'s branching logic — only the renderer files' own export
> shape changes...

This is broken on two independent grounds, both verified against the actual code above:

1. **Factually wrong premise.** Neither `ChartRenderer.tsx` nor `MarkdownRenderer.tsx` has a
   default export today — both are named-export-only. There is nothing to "convert."

2. **Not achievable without contradicting its own "no PanelContent.tsx change" claim.**
   `PanelContent.tsx` imports `ChartRenderer` via a **named** import
   (`import { ChartRenderer } from "./renderers/ChartRenderer"`). If Decision 1's literal
   instruction were followed — adding a `React.lazy`-wrapped *default* export to
   `ChartRenderer.tsx` — that new default export would be orphaned dead code unless
   `PanelContent.tsx`'s import statement is also changed to consume it (which the decision
   explicitly says isn't needed). And even if `PanelContent.tsx` did switch to a default import,
   rendering a lazy component synchronously requires an ancestor `<Suspense>` — which would have
   to be added around the `<ChartRenderer .../>` call site in `PanelContent.tsx`, again directly
   contradicting "no change to `PanelContent.tsx`'s branching logic." Either way, code-splitting
   doesn't actually happen under Decision 1's literal instruction: `ChartRenderer.tsx`'s named
   export (the thing `PanelContent.tsx` actually imports and renders) still statically imports
   `ChartPanel` (and therefore `echarts`) at module scope, so `echarts` stays in whatever chunk
   contains `PanelContent.tsx` — almost certainly the entry chunk, defeating the entire point of
   the ticket.

3. **This directly contradicts the change's own other artifacts**, which correctly describe the
   only technically-sound version of this boundary: lazy-load the **inner** heavy component
   (`ChartPanel`/`MarkdownPanel`) *from inside* the renderer file, keeping the renderer's own named
   export/signature untouched so `PanelContent.tsx` genuinely needs no changes:
   - `proposal.md`'s Impact section: "`ChartRenderer.tsx`, `.../MarkdownRenderer.tsx` — **inner
     components become lazy imports**, wrapped in `Suspense`."
   - `tasks.md` Task 3.1: "Convert `ChartRenderer.tsx`'s **inner chart component** to a
     `React.lazy(...)` target."
   - `tasks.md` Task 4.1: the equivalent for `MarkdownRenderer.tsx`.

   These two documents describe exactly the approach Decision 1 explicitly rules out
   ("rather than lazy-loading `ChartPanel`/`MarkdownPanel` directly") — and it is the *only* one
   of the two that is technically coherent given the actual code (confirmed above: `ChartPanel.tsx`
   is where `echarts-for-react`/`echarts` are actually imported; `MarkdownPanel.tsx` is where
   `react-markdown`/`remark-gfm` are actually imported — one level deeper than the renderer
   files). Decision 2 ("each `ChartRenderer`/`MarkdownRenderer` call site gets its own Suspense")
   is also only consistent with the inner-import reading (a `Suspense` local to each renderer
   function invocation), not with Decision 1's literal "renderer's default export becomes lazy"
   framing.

   This is a genuine, blocking internal contradiction between `design.md` and both `proposal.md`
   and `tasks.md` — not a stylistic nit. An implementer following `design.md`'s Decision 1 to the
   letter would either produce dead code that ships `echarts` in the entry chunk anyway (failing
   every acceptance criterion) or would have to silently deviate from the stated decision (making
   unplanned changes to `PanelContent.tsx`) to make it work at all. An implementer instead
   following `tasks.md`/`proposal.md` would do the right thing, but the design doc they're meant to
   be implementing *against* explicitly says not to.

Everything else in the design is sound and matches ground truth: the `ProposalReviewPage`
route-level lazy conversion (Decision 4) is internally consistent (it explicitly does touch
`AppRoutes.tsx`, unlike the renderer-boundary decision, and both `ProposalReviewPage` and the
route table were confirmed as described); the bundle-visualizer plan (Decision 5, gated on
`ANALYZE=true`/a dedicated script) is reasonable and matches `tasks.md` 1.1–1.3/7.1; the
tree-shaking/barrel claims (Decisions in the "no fix needed" category) are verified true against
the actual tree; the `Suspense` fallback plan matches `DESIGN.md` §7; and AC coverage in
`tasks.md` traces cleanly to all four of `ticket.md`'s acceptance criteria — *except* that AC3
("Chart/markdown/proposal surfaces load on demand... no console errors") and AC1 ("largest
non-critical dependencies... no longer in the initial entry chunk") both depend on the chart/
markdown lazy boundary actually working, which Decision 1 as written does not achieve.

### Verdict: REFUTE

### Change Requests

1. **Rewrite `design.md` Decision 1** to state the technically-correct and proposal/tasks-aligned
   approach explicitly: the `React.lazy(() => import(...))` boundary is the **inner** `ChartPanel`/
   `MarkdownPanel` import *inside* `ChartRenderer.tsx`/`MarkdownRenderer.tsx` (replacing each
   file's top-level `import { ChartPanel } from "../ChartPanel"` / `import { MarkdownPanel } from
   "../MarkdownPanel"` with a `React.lazy` call, e.g. `React.lazy(() => import("../ChartPanel").then(m
   => ({ default: m.ChartPanel })))` since `ChartPanel`/`MarkdownPanel` are also named, not default,
   exports), with a local `<Suspense>` wrapping just that inner render inside the renderer function.
   Remove the "convert the renderer's default export to `React.lazy`" framing entirely — neither
   `ChartRenderer.tsx` nor `MarkdownRenderer.tsx` has a default export today, and literally
   following that framing either produces dead code that fails to code-split `echarts`/
   `react-markdown` out of the entry chunk, or silently forces exactly the `PanelContent.tsx`
   changes the decision claims are unnecessary.
2. **Reconcile the "rather than lazy-loading `ChartPanel`/`MarkdownPanel` directly" line** with
   `proposal.md`'s Impact section and `tasks.md` Tasks 3.1/4.1, which both correctly describe
   lazy-loading the inner component. As written, `design.md` and `tasks.md` instruct two different,
   incompatible implementations of the same boundary — pick the tasks.md/proposal.md approach (the
   only one that actually works) and make `design.md` say so unambiguously, since `design.md` is
   the artifact an implementer is meant to treat as authoritative when the two disagree.
3. **(Non-blocking, fix alongside #1/#2 while editing)** Correct the "12 routed pages" figure in
   `proposal.md`'s "Why" section — `AppRoutes.tsx` currently has 16 routed paths / 15 unique page
   components. Doesn't change the technical plan (only `ProposalReviewPage` is in scope either
   way) but is a sign the design wasn't checked against the current route table.

### Non-blocking notes

- Once #1/#2 are fixed, the plan otherwise looks sound: the `ANALYZE=true`-gated visualizer, the
  `Spinner`-based `DESIGN.md` §7 fallback, the per-instance (not global) `Suspense` boundaries, the
  `ProposalReviewPage` route-level lazy conversion, and the Jest-mock continuity story
  (`echartsForReactCoreMock.tsx`/`reactMarkdownMock.tsx` intercept the same module specifiers
  regardless of which file dynamically imports them) all hold up against the real code.
- Worth a one-line addition to Decision 1's rewrite: `ChartPanel`/`MarkdownPanel` are themselves
  named exports, so the `.then(m => ({ default: m.X }))` adapter is required at each `React.lazy`
  call site — not strictly a design ambiguity, but calling it out explicitly avoids the same
  default-vs-named confusion resurfacing during implementation.
