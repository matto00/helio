# HEL-245 — Markdown panel config redesign + uploaded-image references

- **Ticket:** HEL-245 (https://linear.app/helioapp/issue/HEL-245/markdown-panel-config-redesign-uploaded-image-references)
- **Priority:** Medium
- **Project:** Helio v1.5 — Panel System v2 (parent: HEL-239)
- **Status:** In Progress

## Description

Two concerns:

1. Apply the panel-config redesign pattern (same as Metric/Text) so a Markdown panel can render markdown derived from a DataType field — useful for AI-generated narrative summaries, report-style text rendered by pipelines, etc.
2. **Support referencing uploaded images** (from the image-upload endpoint added in the sibling Image panel ticket). A markdown panel should be able to embed `![alt](helio://uploads/image/<id>)` (or similar URL scheme) and have it resolve to the actual uploaded asset.

## Definition of done

- Markdown panel can either author static markdown OR render from a DataType field
- Markdown rendering resolves `helio://uploads/image/<id>` references to actual uploaded assets
- Documentation updated to describe the URL scheme for image refs
- Config UI matches the pattern from sibling panel redesigns

Depends on Image panel + FileSystem upload (sibling) — **both HEL-244 (Text pattern) and HEL-246 (image upload endpoint `POST /api/uploads/image`) are merged to main.**

## Session-specific scope emphasis (user-directed, binding)

1. **Elevated style/UX bar:** strictly honor DESIGN.md (tokens, spacing/type scales, shared components, UI state patterns). The new Markdown config UI must reuse the established `BoundOrLiteralField` / `useBoundOrLiteralState` / `DataTypePicker` pattern from `frontend/src/features/panels/ui/editors/` (set by HEL-243, reused by HEL-244 with `literalMultiline`).
2. **Mobile is a first-class verification target:** the app has a mobile shell below 768px (read-only MobilePanelStack, BottomNav, MobileNavSheet — HEL-300/301/302). At a phone viewport (~390×844): (a) the Markdown panel must render well in the mobile panel stack, including image refs; (b) nothing in the new config UI or panel rendering may break or overflow the mobile shell; (c) touch targets in any new UI must be ≥44px.
3. **Style-debt cleanup in-scope-files-only:** while touching Markdown panel styles, clean up style/UX debt encountered in files already being edited (dead CSS, non-token colors, inconsistent spacing). No unrelated refactors.

## Known constraints (verify against code, don't trust blindly)

- Panel DataType-binding needs NO DB migration — `panels.type_id`/`field_mapping` are generic across panel kinds.
- spray-json omits Option=None fields on the wire — normalize at the service boundary and test with fields absent.
- Uploads storage backend is configurable (`HELIO_UPLOADS_BACKEND` local/gcs); markdown image-ref resolution must go through the existing uploads route, not filesystem paths.
