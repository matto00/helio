## REMOVED Requirements

### Requirement: Markdown panel content is editable in the panel detail view
**Reason**: The data-bound "Source mode" of a markdown panel (`dataTypeId`/`fieldMapping`,
`DataTypePicker` + field select) was removed outright by HEL-904 task 4.1 — the V94 migration
converted every data-bound markdown panel into a `markdown`-kind Output + `OutputPanel`
placement, so `MarkdownPanelConfig` now only ever carries `content` (static text). No live
markdown panel carries a binding, and `MarkdownEditor.tsx` no longer renders a `DataTypePicker` or
Source-mode toggle.
**Migration**: A data-bound markdown use case is now expressed as a `markdown`-kind Output
(computed by a pipeline) placed via `OutputPanel`, not a bound markdown panel. The Static-mode
multiline content editor itself is unchanged and still saves via `PATCH /api/panels/:id`.
