## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket/DoD/proposal/design/tasks read in full**: `ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, and all three spec deltas (`specs/{panel-datatype-binding,markdown-panel,
  markdown-panel-content-source}/spec.md`). No `TODO`/`TBD`/placeholder language found anywhere;
  every task has a concrete acceptance signal (a scenario in the spec deltas or an explicit
  file/behavior to change).

- **HEL-244 Text precedent matches design's description exactly** — read
  `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala` in full: `TextPanelConfig`'s
  `dataTypeId: DataTypeId = DataTypeId("")` / `fieldMapping: JsObject = JsObject.empty`, tolerant
  `decode`, `Patch` absent-vs-null convention, and `withBindingCleared` clearing only the binding —
  all as Decision 1 claims Markdown will mirror.

- **Current Markdown panel is exactly the "old shape" the design describes** — read
  `backend/.../domain/panels/MarkdownPanel.scala` (content-only config, `dataTypeId: Option[DataTypeId]
  = None` hardcoded, no `buildQuery`) and `frontend/.../editors/MarkdownEditor.tsx` (plain
  `Textarea` + `updatePanelContent`). Confirms the design's baseline is accurate, not assumed.

- **`fieldOptions` duplication (rule-of-three claim)** — confirmed identical `fieldOptions` helper
  bodies in both `BindingEditor.tsx` (line 41) and `TextContentEditor.tsx` (line ~24); a third
  identical use in a new `MarkdownEditor.tsx` would indeed hit rule-of-three, justifying the planned
  extraction to `editors/fieldOptions.ts`.

- **`buildTextBindingPatch` / render-wiring claims** — read `panelPayloads.ts` in full: the function
  exists with exactly the shape described (Source: set `dataTypeId`/`fieldMapping.content`, omit
  `content`; Static: null both, set `content`); `buildCreatePanelBody`'s `markdown` case currently
  discards `dataTypeId` (line 86-87), matching the design's claim it needs to be wired like `text`
  (line 81-85). `DATA_BOUND_TYPES` in `PanelCreationModal.tsx` (line 45) is confirmed to currently
  exclude `"markdown"`.

- **Render-path wiring (Decision 4)** — read `panelNarrowing.ts` (`isBoundCapablePanel` currently
  excludes Text... wait, includes Text but excludes Markdown, confirmed), `usePanelData.ts` (generic
  per-slot mapping keyed off `getFieldMapping`/`getDataTypeId`, subtype-agnostic — will populate
  `data.content` for Markdown once `isBoundCapablePanel` widens, zero markdown-specific code needed
  as claimed), and `PanelContent.tsx` (already passes `data` to `TextRenderer`, line 112, confirming
  the claimed `MarkdownRenderer` wiring is a direct mirror). Also confirmed `MobilePanelStack.tsx` →
  `PanelCardBody` → `usePanelData`/`PanelContent` is the *same* pipeline as desktop (via
  `PanelCard.tsx`), so the "no mobile-shell changes needed" non-goal is grounded, not assumed.

- **Backend enumeration sites (task 1.3)** — grepped for `TextPanel` outside its own file:
  `PanelConfigCodec.scala`, `PanelRowMapper.scala`, `DashboardSnapshotRepository.scala`,
  `PanelServiceHelpers.scala`. Spot-checked `PanelRowMapper.scala` line 80 vs 81: the `TextPanel` case
  writes `typeId`/`fieldMapping` columns, the `MarkdownPanel` case currently does not — exactly the
  concrete gap task 1.3 tells the executor to find via grep rather than assuming. `withBindingCleared`
  is dispatched generically through `PanelService.resolveBindingsForRead` (`PanelService.scala`
  line 65-95) via the `Panel` trait method, so no separate backend enumeration is needed there once
  `MarkdownPanel.withBindingCleared` is implemented — consistent with the design's claims.

- **react-markdown v10 API claims** — `frontend/node_modules/react-markdown/package.json` confirms
  version `10.1.0`; `lib/index.d.ts` confirms `export function defaultUrlTransform(value: string):
  string` and a `urlTransform?: UrlTransform | null` prop on the component — matches Decision 5 and
  the `markdown-panel-content-source` spec exactly (no invented API).

- **Uploads route claims** — read `PublicUploadRoutes.scala` (unauthenticated `GET
  /api/uploads/image/:id`, storage-backend agnostic via `ImageUploadService`) and `UploadRoutes.scala`
  (`POST /api/uploads/image` returns `/api/uploads/image/<id>`) — confirms the design's description
  of the HEL-246 precedent and that resolution targets a real, already-public route.

- **Schema delta claim** — `schemas/panel.schema.json` currently has `TextConfig` with
  `dataTypeId`/`fieldMapping` and `MarkdownConfig` with only `content` (lines 88-103) — confirms task
  1.5's before-state and the exact mirror needed.

- **DESIGN.md read in full** for the style-debt claims in Decision 6 / task 5. Current
  `MarkdownPanel.css` does contain hardcoded, non-token values consistent with the "style debt" claim
  (`border-radius: 3px`/`4px` literal, `padding: 8px 12px` literal) — task 5.2's cleanup scope is
  grounded, not invented busywork.

### Verdict: CONFIRM

The design is unusually well-grounded: nearly every factual claim in `design.md` and `tasks.md` was
independently verified against the actual current code (not taken on faith), and all of it checked
out. No placeholders, no internal contradictions between proposal/design/tasks/specs, no scope drift
(the `fieldOptions` extraction and `buildTextBindingPatch` rename are justified, in-scope,
mechanical generalizations, not unrelated refactors), and every DoD line item traces to a task and a
spec scenario.

### Non-blocking notes

1. **`design.md` Decision 6 contains a wrong token name in its own example.** The snippet
   `.markdown-panel img { ...; border-radius: var(--radius-sm, 4px); }` references a token that does
   not exist — `DESIGN.md` §"Radius / Shadow / Motion" (line 140) names the actual token
   `--app-radius-sm` (6px, not 4px). As literally written, `var(--radius-sm, 4px)` would always
   resolve to the hardcoded `4px` fallback (the referenced variable never exists), which is precisely
   the "hardcode a value a token exists for" anti-pattern `DESIGN.md` marks `[mechanical]` and the
   ticket's elevated style bar calls out. The same Decision 6 paragraph already instructs "verify
   against actual token names, don't invent them" — the design should practice what it preaches here.
   Recommend the executor use `var(--app-radius-sm)` (no fallback) rather than copying the literal
   snippet from `design.md`. Not blocking because the paragraph's own caveat should catch this at
   execution time, and it's a one-line CSS fix, but flagging so the executor doesn't copy the wrong
   snippet verbatim.
2. Decision 3's "the old literal-only `updatePanelContent`/`buildMarkdownPatch` path stays for other
   callers if any remain; delete if orphaned" is phrased conditionally. I checked ground truth: neither
   has any caller besides the `MarkdownEditor.tsx` file being replaced (`buildMarkdownPatch` has zero
   callers anywhere already). Both will be orphaned after task 3.2 — the executor should delete them
   per the design's own stated rule, not leave them as dead exports.
