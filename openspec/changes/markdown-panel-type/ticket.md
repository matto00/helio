# HEL-164 — Markdown Panel Type

## Title
Markdown panel type

## Description
CommonMark renderer for panel content. Editable content field (plain text / Markdown source). No DataType binding required — content is stored directly on the panel. Rendered read-only in the grid; editable via the panel detail view edit mode.

## Acceptance Criteria
- A new panel type "markdown" is available when creating a panel
- The markdown panel stores a `content` field directly on the panel (no DataType binding)
- The content is rendered as CommonMark HTML in read-only mode in the dashboard grid
- The content is editable as plain text/Markdown source in the panel detail view edit mode
- The backend stores the markdown content field and exposes it via the panels API
- The frontend renders the markdown using a CommonMark-compliant renderer

## Project
Helio v1.2 — Panel System

## Priority
High
