## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **DataGrid primitive already has the claimed scroll/sticky contract.** Read
   `frontend/src/shared/ui/DataGrid.css:1-21` — `.ui-data-grid { overflow: auto }` (both axes, applies
   to both `--full` and `--preview` variants since it's the shared base class) and
   `.ui-data-grid__table thead th { position: sticky; top: 0; ... }`. `DataGrid.tsx` confirms `.ui-data-grid`
   is the direct parent of `<table>` (single scroll box, sticky context matches). This is exactly what
   design.md/proposal.md claim; no code change to `DataGrid.tsx`/`.css` is needed, only spec
   formalization. The new spec delta's requirements/scenarios (`specs/data-grid/spec.md`) accurately
   describe this existing behavior.

2. **`.panel-grid-card` still has `overflow: hidden`.** Confirmed at `frontend/src/features/panels/ui/PanelGrid.css:44`.
   Traced the DOM chain: `PanelGrid.tsx` → `.panel-grid-card` (flex column) → `PanelContent` →
   `TableRenderer.tsx:25/58` renders `<div className="panel-content panel-content--table"><DataGrid variant="full" .../></div>`.
   `.panel-content` is `flex:1`/`min-height:0`; `.panel-content--table` adds `overflow-y:auto`/`min-height:0`;
   `.ui-data-grid--full` is `width:100%;height:100%`. Confirmed empirically (see finding 5 below) that this
   chain resolves to a definite, bounded box, so the design's "provably inert" claim for the *table* case
   holds.

3. **`.panel-detail-modal__view-body` still has `overflow: hidden`.** Confirmed at
   `frontend/src/features/panels/ui/PanelDetailModal.css:134`. Same `PanelContent` tree is rendered
   inside it in view mode, same reasoning applies.

4. **`.source-detail-panel__schema-table` is a genuine, still-live raw-`<table>` `overflow: hidden` hit.**
   Confirmed at `frontend/src/features/sources/ui/SourceDetailPanel.css:138-145` (`overflow: hidden` directly
   on the `<table>` rule) and `SourceDetailPanel.tsx:96-113` (a raw `<table>`, separate from the
   `DataGrid variant="preview"` used later in the same file for the source's row preview at line 127). The
   proposed fix (wrap in a new div, move the clip to `overflow: auto` on the wrapper) is a standard,
   low-risk pattern and doesn't collide with the DataGrid-based preview section. Checked
   `SourceDetailPanel.test.tsx:56-63` — it queries by role/text, not by class/DOM structure, so the new
   wrapper div won't break existing tests (no missing test-update task needed).

5. **Empirically verified `container-type: size` (declared on `.panel-grid-card`, `PanelGrid.css:28,30`)
   does not itself force clipping, and does not depend on `overflow != visible` to evaluate container
   queries.** This wasn't discussed anywhere in design.md/proposal.md and is exactly the kind of subtle
   CSS containment interaction that could silently break `@container panel-card (...)` rules
   (`PanelGrid.css:249-283`, `PanelContent.css:171-235`) if the containment spec required non-visible
   overflow. I built two minimal repros and ran them in the actual browser via Playwright (not just
   recalled the spec text):
   - Test 1: `container-type: size` + explicit `width/height` + **no `overflow` declared** (default
     `visible`) → an inner `@container (max-width: 219px)` query still matched correctly. Container
     queries do not require non-visible overflow to function, at least in this engine.
   - Test 2: same setup with an oversized (300×200) absolutely-positioned child inside a 100×60 box with
     `overflow: visible` → the child **visibly painted outside the box** (screenshot confirms), i.e.
     `container-type: size` does *not* implicitly clip content the way `overflow: hidden` does.
   Net: removing `overflow: hidden` from `.panel-grid-card` is a real, non-inert behavior change for any
   panel content that isn't self-contained (confirming the design's own stated risk in design.md's
   "Risks / Trade-offs" — that risk is real and correctly identified, just not connected explicitly to
   `container-type: size`), and it does **not** endanger the panel's container-query responsiveness. So
   the design's mitigation (audit every panel-type CSS + a Playwright visual pass across panel types in
   task 1.4 / tasks 2.3-2.4) is the right and sufficient safeguard — I found no gap here, just confirmed
   the underlying mechanism the design is relying on.

6. **Audited every other panel-type CSS the design claims is unaffected.** `ImagePanel.css:1-8`
   (`.image-panel { overflow: hidden; width:100%; height:100% }` — self-clips, independent of the card).
   `MarkdownPanel.css:1-3` (`.markdown-panel { overflow: auto; height: 100% }` — self-scrolls).
   `DividerPanel.css` — no overflow risk (small fixed content, no absolute positioning). `.panel-content--text`
   (`PanelContent.css:45-50`) — `overflow-y: auto` already. `.panel-content--metric` — bounded, clamped
   fonts, no overflow risk. `PanelCreationPreview.tsx` (`.panel-creation-preview__content`,
   `overflow: hidden`, untouched by this change) renders `<PanelContent panel={previewPanel} />` with no
   `data`/`rawRows` passed, so for a table-type preview it always falls into `TableRenderer`'s static
   3-row placeholder skeleton branch (`TableRenderer.tsx:63-88`), never a real `DataGrid` — correctly out
   of scope, not a live DataGrid wrapper the DoD's grep check would flag.

7. **Confirmed the two stale ticket-named audit surfaces no longer exist.**
   `grep -rn "preview-table__wrapper" frontend/src/` and
   `grep -rn "pipeline-detail-page__step-preview-table-wrapper" frontend/src/` both return no hits —
   design.md's claim that these were superseded by HEL-251's DataGrid migration is correct, not
   hand-waving.

8. **Checked `openspec/specs/panel-content-sizing/spec.md` for contradiction.** Its "Table panel with
   multiple rows exceeding panel height" requirement (line 72-74) only constrains `.panel-content--table`
   (unchanged by this proposal) and says the "panel card boundary SHALL NOT be exceeded" — a visual
   outcome, not a mechanism. Since the DataGrid box stays sized to fill its parent exactly (finding 2),
   this outcome still holds after removing the card's `overflow: hidden`; no contradiction between the
   two specs.

9. **Checked the current (pre-delta) `data-grid` spec** (`openspec/specs/data-grid/spec.md`) — no
   existing scroll/overflow requirement exists there today, so the delta is purely additive, consistent
   with proposal.md's "ADDED Requirements" framing.

10. **Scope check against the ticket.** All four DoD bullets are covered (no `overflow: hidden` on a
    DataGrid wrapper; scroll in both directions; sticky header; 30-col/200-row manual verification task
    2.3). Non-goals correctly exclude HEL-252 (density) and HEL-253 (drag-resize) — no scope creep found.
    The ticket's explicit instruction to "call out the seam" through the shared `DataGrid` primitive is
    honored (design.md's Context section and the spec delta both center on `DataGrid` as the primitive
    that already provides the fix, even though the actual bugs live in ancestor wrappers).

### Verdict: CONFIRM

The design accurately reflects ground truth in every place I checked (I did not just trust the
proposal/design narrative — I read the actual CSS/TSX and ran a live browser repro for the one claim
that seemed most likely to hide a subtle CSS-containment bug). Scope is right-sized, decisions are
sound and specifically justified, and the plan doesn't complicate the HEL-252/HEL-253 follow-ons.

### Non-blocking notes

- design.md doesn't explicitly mention `.panel-grid-card`'s `container-type: size` when justifying the
  `overflow: hidden` removal. It isn't a problem (verified in finding 5), but an explicit sentence
  acknowledging "container queries still resolve because sizing here is explicit/definite via
  react-grid-layout's inline height, independent of overflow" would make the design's already-correct
  reasoning more self-evidently complete for a future reader.
- The outer `.panel-detail-modal` dialog shell itself (`PanelDetailModal.css:10`, distinct from
  `__view-body`) still has `overflow: hidden` and is left untouched by design — that's fine (it's
  functionally inert for the same reason `.panel-grid-card`'s was inert pre-fix — the DataGrid's own box
  never grows past its bounded parent), but wasn't called out; worth a one-line mention during
  implementation/evaluation so nobody flags it as a missed surface.
