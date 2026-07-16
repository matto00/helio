## Context

HEL-243 (Metric) built the field-or-literal config pattern (`BoundOrLiteralField`, `useBoundOrLiteralState`,
`DataTypePicker` in `frontend/src/features/panels/ui/editors/`); HEL-244 (Text) applied it to a long-form
content slot, adding `dataTypeId`/`fieldMapping` to `TextPanelConfig` end-to-end. Markdown is the last
content panel still on the old shape: `MarkdownPanelConfig(content)` only, a plain-textarea
`MarkdownEditor`, and `MarkdownPanel.scala` hardcoding `dataTypeId = None`. HEL-246 shipped uploads:
`POST /api/uploads/image` (authenticated) and `GET /api/uploads/image/:id` (public byte-serving,
storage-backend agnostic behind `HELIO_UPLOADS_BACKEND`). Its design deliberately stored plain
`/api/uploads/image/<uuid>` URLs for the Image panel; HEL-245's DoD adds a stable `helio://` scheme for
markdown-embedded refs. Both prerequisites are merged to main.

Session constraints (binding): DESIGN.md strictly; mobile (<768px, MobilePanelStack) is a first-class
verification target; style-debt cleanup in files already edited only.

## Goals / Non-Goals

**Goals:** Markdown content bindable to a DataType field (Source) or authored literally (Static);
`helio://uploads/image/<id>` refs resolve through the uploads route; config UI mirrors Text/Metric;
docs for the URL scheme.

**Non-Goals:** image-upload UI in the editor; backend markdown processing; changes to
`BoundOrLiteralField`; mobile-shell changes; migrating Image panel URLs to `helio://`.

## Decisions

### 1. Mirror `TextPanelConfig` wholesale — config shape, Patch semantics, no migration

`MarkdownPanelConfig` (Scala) gains `dataTypeId: DataTypeId = DataTypeId("")` and
`fieldMapping: JsObject = JsObject.empty` with the same tolerant `decode` and the same `Patch`
absent-vs-null convention as `TextPanelConfig` (`backend/.../panels/TextPanel.scala`). `MarkdownPanel`
implements `dataTypeId`/`fieldMapping`/`buildQuery` exactly as `TextPanel` does, and
`withBindingCleared` clears only the binding, preserving literal `content` (same data-loss rationale as
HEL-244). No Flyway migration: `panels.type_id`/`field_mapping` are generic columns already populated by
metric/chart/table/text. *Alternative considered:* a shared `ContentPanelConfig` base for Text+Markdown —
rejected; the sealed-trait ADT keeps per-kind companions flat and HEL-244 already chose per-kind duplication.

**spray-json caution:** like Text, the config case class uses defaults, not `Option`, so all three fields
always serialize; `Patch` is where absence matters. Backend tests must exercise PATCH bodies with fields
*absent* (not just null) — spray-json omits `Option=None` on the wire.

### 2. New-shape `MarkdownEditor` mirrors `TextContentEditor`; `fieldOptions` extracted at third use

`MarkdownEditor.tsx` is rebuilt on `useBoundOrLiteralState` + mode-gated `DataTypePicker` (Source) +
`BoundOrLiteralField` with `literalMultiline` (Static), copying `TextContentEditor.tsx` structure
including the mode-default heuristic: bound panel defaults to Source, unbound to Static
(`defaultBoundOrLiteralMode(initialTypeId === null)`), since content is always present and can't signal
"literal is set". The `fieldOptions` helper is now needed a third time (`BindingEditor`,
`TextContentEditor`, here) — extract it to `editors/fieldOptions.ts` and update the two existing callers
(rule of three; mechanical, in-scope). *Alternative:* third duplication — rejected, CONTRIBUTING favors
extracting reusable units and HEL-244's "duplicate rather than extract" note anticipated exactly this
re-evaluation.

### 3. Patch builder generalized, thunk duplicated

`buildTextBindingPatch` (`panelPayloads.ts`) produces exactly the patch Markdown needs (Source: set
`dataTypeId`/`fieldMapping.content`, omit `content`; Static: null both, set `content`). Rename it
`buildContentBindingPatch` and call it from both Text and Markdown paths (update `panelPayloads.test.ts`
mechanically). Add a separate `updatePanelMarkdownBinding` thunk + service fn + `panelsSlice` fulfilled
case mirroring `updatePanelTextBinding` — thunks stay typed per panel kind (`MarkdownPanel` vs
`TextPanel`), matching the existing per-kind thunk convention. The old literal-only
`updatePanelContent`/`buildMarkdownPatch` path stays for other callers if any remain; delete if orphaned.

### 4. Render resolution: `data?.content ?? config.content`, generic slot mapping

`isBoundCapablePanel` (`panelNarrowing.ts`) widens to include `MarkdownPanel`; `usePanelData`'s generic
per-slot mapping then populates `data.content` with zero markdown-specific code. `MarkdownRenderer`
gains the `data` prop (wired from `PanelContent`, which already passes `data` to `TextRenderer`) and
resolves `data?.content ?? panel.config.content || null`. Creation flow matches Text:
`DATA_BOUND_TYPES` in `PanelCreationModal.tsx` gains `"markdown"`, and `buildCreatePanelBody`'s
`markdown` case wires `dataTypeId` through (currently discards it) — "config UI matches sibling
redesigns" per DoD.

### 5. `helio://` resolution is a frontend render-time `urlTransform`

react-markdown v10's default `urlTransform` **strips unknown protocols**, so `helio://` yields empty
`src` without intervention. Add a pure util (`frontend/src/features/panels/ui/markdownUrls.ts`):
`resolveMarkdownUrl(url)` maps `helio://uploads/image/<id>` → `/api/uploads/image/<id>` (id validated as
a safe path segment) and delegates everything else to react-markdown's exported `defaultUrlTransform`.
Pass it as `urlTransform` on the `ReactMarkdown` element in `MarkdownPanel.tsx`. It applies to links and
images alike — acceptable and desirable (a `helio://` link resolves to the same asset). Plain
`/api/uploads/image/<id>` URLs already survive the default transform (relative), so both forms work; docs
recommend `helio://`. *Alternative considered:* backend-side content rewriting — rejected: render-time
resolution is storage-agnostic, keeps stored content portable across environments, and matches the
"resolution goes through the uploads route" constraint.

### 6. Image sizing + in-scope style cleanup in `MarkdownPanel.css`

Add `.markdown-panel img { max-width: 100%; height: auto; border-radius: var(--app-radius-sm); }` (real
token per DESIGN.md — skeptic-verified; do not use a hardcoded fallback) so
embedded images never overflow the panel or the mobile stack. While editing this file, apply the
session's style-debt pass: tokenize raw radii/sizes where DESIGN.md tokens exist, keep spacing on the
scale, remove dead rules. Executor must read DESIGN.md before touching CSS; verify against actual token
names, don't invent them.

### 7. Docs: `docs/uploads.md`

New doc covering `POST /api/uploads/image`, `GET /api/uploads/image/:id`, and the
`helio://uploads/image/<id>` markdown scheme (what resolves it, where it works, that raw
`/api/uploads/image/<id>` also renders). Satisfies the DoD "documentation updated" bullet.

## Risks / Trade-offs

- [Regression in old markdown save path] `updatePanelContent` callers (e.g. detail-modal flows) may
  assume the old editor → keep PATCH semantics: Static save must not clobber binding fields
  unintentionally; covered by patch-builder tests with fields absent.
- [urlTransform over-matching] A non-image `helio://` URL family later collides → scheme util matches the
  full `helio://uploads/image/` prefix only; anything else falls to default transform (stripped).
- [Mobile overflow from wide images/tables] → `max-width: 100%` for images; tables already scroll via
  `overflow: auto` on `.markdown-panel`; verified at 390×844 by evaluator+skeptic (briefed).
- [Schema drift] `schemas/panel.schema.json` `MarkdownConfig` must gain `dataTypeId`/`fieldMapping` in the
  same change (repo rule: schema updates ship with the code).

## Migration Plan

Pure additive config fields with tolerant decode; existing markdown panels (content-only JSON) decode to
unbound configs unchanged. No data migration, no rollback steps beyond revert.

## Planner Notes (self-approved)

- `helio://uploads/image/<id>` chosen over inventing a different scheme — ticket names it explicitly.
- `fieldOptions` extraction + `buildTextBindingPatch` rename are small cross-file generalizations
  justified by rule-of-three and identical shapes; both were flagged as anticipated in HEL-244's notes.
- Markdown added to `DATA_BOUND_TYPES` (creation-time binding) to fully match the sibling pattern.
- No escalation triggers: no new deps, no API breaks, no architectural change, scope matches ticket.
