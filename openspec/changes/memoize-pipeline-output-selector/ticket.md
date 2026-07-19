# HEL-312 — Memoize selectPipelineOutputDataTypes — unstable selector warning across bound editors

URL: https://linear.app/helioapp/issue/HEL-312
Priority: Low
Project: Helio v1.5 — Panel System v2

## Context

Recurring non-blocking finding flagged across multiple v1.5 and bug-bash reviews
(HEL-245, HEL-307, and the shared bound-editor family). `selectPipelineOutputDataTypes`
returns a new array reference each call (unmemoized), triggering React-Redux's
"selector returned a different result" console warning on render — observed in
`MarkdownEditor.tsx:33` and shared by the Metric/Text/Markdown/Collection editors
that consume it.

Not a correctness bug (the value is stable in content), but it defeats render bailout
and spams the console. Worth fixing once at the source.

## What

Memoize the selector with `createSelector` (reselect) so it returns a stable reference
for unchanged input state; verify the console warning disappears across every consuming
editor.

## Acceptance criteria

- [ ] `selectPipelineOutputDataTypes` returns a referentially stable result for unchanged inputs
- [ ] No "selector returned a different result" warning in any bound-editor render (Metric/Text/Markdown/Collection)
- [ ] Test covering selector reference stability across unrelated state changes
