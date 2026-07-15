# HEL-301 — Mobile viewer grid — read-only stack and native-feeling panel sizing

- **URL:** https://linear.app/helioapp/issue/HEL-301/mobile-viewer-grid-read-only-stack-and-native-feeling-panel-sizing
- **Priority:** High
- **Project:** Helio Mobile — PWA
- **Blocked by:** HEL-300 (MERGED to main as PR #226 — phone breakpoint is ratified in `DESIGN.md`)

## Orchestrator context (from the human, 2026-07-15)

- Branch base is current origin/main (`a7b914fd`, PR #226 merge). HEL-300 follow-ups branch is NOT part of this base.
- HEL-302 is being worked in parallel in its own worktree. Stay strictly within this ticket's scope: viewer grid / panel sizing. **Navigation is out of scope.**
- Terminal state is **"ready for device testing"** — a build plus an ordered test plan handed back to the user — NOT "done." The evaluator and skeptic must NOT accept desktop-viewport evidence as device verification.

## Ticket description

**"It's very important that dashboard sizing feels right on mobile — that's half the reason I'm doing this rather than keeping it in the browser."** If the sizing is merely acceptable, this project has failed at its own premise. This ticket is the primary deliverable of the whole project.

`notes/mobile-pwa-handoff.md` **is the binding spec.** Read it in full first, including its §0 instruction to read `DESIGN.md` and `CONTRIBUTING.md`. This ticket is spec sections **W4, W5, and hazard §4.1**.

### 🔴 Hazard §4.1 — the phone can silently corrupt saved layouts

**Read this before touching `PanelGrid`. This is a correctness requirement, not a preference.**

`PanelGrid.tsx:233` wires `onLayoutChange={handleLayoutChange}` → `markLayoutChanged()` → the auto-save pipeline in `usePanelGridSave.ts` → `updateDashboardLayout` → `PATCH /api/dashboards/:id`.

**React Grid Layout fires `onLayoutChange` on mount and on every width/breakpoint change — not only on drag.** Layouts persist per breakpoint (`dashboardGridCols = {lg:12, md:10, sm:6, xs:2}`) and `xs` is a **real stored layout**, not a derived one.

So *merely opening a dashboard on a phone can PATCH a phone-derived `xs` layout to the server* — corrupting it for every client. Changing how `xs` renders makes this worse.

**Requirement:** below the phone breakpoint the grid must be **structurally incapable of persisting layout**. Not "drag disabled" — RGL still fires `onLayoutChange` with `isDraggable={false}`. **Prefer not rendering `<Responsive>` at all on phone:** render a plain single-column stack of `PanelCard`s ordered by the `xs` layout's `y` then `x`. That path cannot call `markLayoutChanged`, which is the only guarantee worth having.

**Do not change `dashboardGridCols.xs` from `2`** — it is part of the persisted contract.

Worth checking while you're here: whether this already bites on phone *browsers* today. `areDashboardLayoutsEqual` / `persistedLayoutRef` may already suppress a no-op PATCH, in which case it only fires when the resolved layout differs from stored. Confirm rather than assume.

### W4.2 — Why you must NOT honour the stored `h`

The instinct is to keep each panel's stored height (`h × rowHeight`, `rowHeight: 52`, `margin: [18,18]`). **Resist it. This is the thing that will make the app feel like a squashed website** — precisely what the PWA is meant to avoid.

`h` encodes intent *inside a 12-column desktop grid*. A 6col × 5row panel was ~640×332 — landscape. Full-width on a phone it becomes ~358×332, nearly square. The number survives; the proportion it was chosen for does not. A `metric` panel at `h=5` becomes 332px holding one number — ~80% whitespace. **That single case is the biggest "this is just the website" tell in the app.**

What *is* real signal in `h` is **relative** intent: a chart made tall vs one made short.

> **Rule: height is content-appropriate per panel kind, modulated by `h` within a clamped band. Never `h × 52`.**

### W4.3 — Per-kind height policy

`PanelKind = "metric" | "chart" | "table" | "text" | "markdown" | "image" | "divider"` (`features/panels/types/panel.ts:52`). Let `w` = panel content width (≈344–358px at a 390px viewport).

| Kind | Policy |
| -- | -- |
| `metric` | **Content-sized, ~104–132px. Ignore `h` entirely.** One number and a label. Highest-impact fix here. |
| `chart` | Aspect-driven: `clamp(200px, w × 0.62, 340px)`. Use `h` to pick within the band — `h ≤ 4` → compact end, `h ≥ 8` → tall end. |
| `table` | `min(60dvh, header + rows × rowHeight)`. **Must cap** — unbounded tables wreck page scroll. Internal scroll (W5). |
| `markdown` | **Fully intrinsic.** No fixed height, no cap, no internal scroll. Let text flow and the page scroll. |
| `text` | Same as `markdown`. |
| `image` | Natural aspect ratio, `max-width: 100%`, `height: auto`. |
| `divider` | Intrinsic hairline. No card chrome at all. |

**These numbers were derived by reading code, not by looking at a phone. They are a starting point, not a spec — tune them on device and show matto00.** "Feels right" is his judgment call, not yours.

**Nested scroll containers are the enemy** — the worst-feeling thing in an iOS web view and the clearest "website in a shell" signal. Only `table` gets one, and only because the alternative is worse.

### W4.4 — Density and chrome

At 390px, chrome is the tax that decides whether this feels native:

- **Gutters:** desktop `margin: [18,18]` and its container padding are too fat. Use `--space-3` (12px) rhythm between cards and for container padding. **Tokens only**, per `DESIGN.md` §3.
- **Card chrome:** drop `.panel-grid-card__footer`'s type badge and the drag handle on phone. Keep title and freshness.
- **Kill the zoom widget.** `PanelList.tsx:138` renders zoom in/out/reset — meaningless on a phone (iOS has pinch) and it eats header space. Hide below the phone breakpoint.
- **Metric typography:** classic failure is a large value clipping or wrapping. Use the `DESIGN.md` type scale, keep tabular numerals, test with something long like `1,234,567.89`.

### W4.5 / W5 — Detail modal and renderers

- `PanelDetailModal` full-screen on phone, dismissible without a hover target.
- **ChartRenderer/ECharts:** verify resize on rotation (ECharts needs an explicit resize on container change). Fix legend/axis overflow via ECharts config, not CSS — consider hiding legends below the phone breakpoint.
- **TableRenderer/`DataGrid.css`:** must scroll horizontally *within the panel*; the page body must never scroll sideways.
- **MetricRenderer:** should look *better* on phone.
- **Markdown/Text/Image:** long words, code blocks, wide images must not force body scroll.
- Container queries on `panel-card` already exist (`DESIGN.md` §4) and are the right tool. Prefer them over new media queries.

### Out of scope

Navigation (HEL-C), PWA shell (HEL-300), any panel *editing* on phone, backend or `schemas/` changes.

## Acceptance criteria

- [ ] **No layout write-back from phone**, proven by the check below. Non-negotiable.
- [ ] Single-column read-only stack below the phone breakpoint, ordered by `xs` layout.
- [ ] Per-kind heights implemented; no metric panel is mostly whitespace; no chart squashed or stretched.
- [ ] Table scrolls horizontally within its panel; body never scrolls sideways.
- [ ] Markdown flows with no nested scrollbar.
- [ ] Zoom widget hidden on phone; card chrome trimmed per W4.4.
- [ ] Desktop and iPad ≥768px visually and behaviourally unchanged.
- [ ] `npm run lint && npm test` clean; Husky passes. No backend or schema changes.

## ⚠️ Verification is human-performed — read before claiming done

**A 390px desktop viewport proves nothing here.** `.concertino/laws/verification-before-completion` requires fresh evidence and you cannot produce it on a physical iPhone. **The correct terminal state is "ready for device testing", not "done."**

Two checks must be run by matto00, and you must hand back with a build (`npm --prefix frontend run build && npx vite preview --host`, phone on same wifi) plus an ordered plan:

1. **The layout-corruption check (do not skip):** note a dashboard's `xs` layout server-side → open it on the phone → background the app → wait → reopen → re-read the layout. **It must be byte-identical.** If it changed, §4.1 is not satisfied and the work is not done.
2. **The sizing check:** build a dashboard with **one of every** `PanelKind` and read it on the phone. Screenshot it — this is the deliverable he'll judge.

**Do not let the evaluator or skeptic accept your own desktop evidence.** Expect to iterate on the W4.3 numbers after feedback; that iteration *is* the work, not a sign of failure.
