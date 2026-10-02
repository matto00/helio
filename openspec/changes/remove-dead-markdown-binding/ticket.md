# HEL-1139: Markdown Output offers a bound Content mode the backend rejects and the renderer ignores

## Description
With the Output sheet's Content slot in "field" mode for a markdown Output, `buildOutputConfig.ts` persists `{content: "", fieldMapping: {content: "<column>"}}`. `OutputBindingSpec.Markdown` declares no slots, and `OutputService.validateFieldMapping` rejects the unknown `content` slot on create and merged PATCH (400). The render path (`PanelContent.tsx` -> `MarkdownRenderer content={cfg.content}`) never reads `fieldMapping`/`rawRows` (HEL-909 retired bound mode). A user can pick a mode that cannot work.

## Owner ruling (2026-10-01, binding)
Option 1: remove the dead affordance. Stop offering "field" mode for a markdown Output's Content slot so the UI only offers what `OutputBindingSpec.Markdown` supports. Do NOT make binding real. Data-bound narrative text belongs to HEL-921's planned `insight` Output kind.

## Acceptance criteria
- A user can no longer be offered, or save, a binding the backend rejects (markdown Content slot).
- Every other surface that can offer or persist `fieldMapping.content` for markdown (MCP tools, proposals, assistant schemas) is either removed from its schema or rejected with a clear message.
- A failable test proves it: red on main, green after, plus a mutation (re-enable the mode -> the test fails).
- Checked in both themes against the RUNNING app.
- Existing persisted markdown Outputs with a `content` fieldMapping: none in dev DB (query recorded in design.md).
