## REMOVED Requirements

### Requirement: Markdown content resolves bound data over literal content
**Reason**: DataTypes are retired outright (HEL-903 decision 11); data-bound markdown panels migrate to `markdown` Outputs (source-of-truth spec line 76, decision 14). A dashboard-native markdown content panel is literal-only from this change forward.
**Migration**: A data-bound markdown panel becomes a `markdown` Output (row-interpolated, per decision 14), authored on the pipeline page and placed via `output-picker`. Literal markdown content panels are unaffected.

### Requirement: Markdown source/static editing mirrors the sibling field-or-literal pattern
**Reason**: Same as above — there is no Source/Static mode toggle left in `MarkdownEditor.tsx` (see design.md's resolution); the sibling `panel-config-field-or-literal-pattern` capability this mirrored is also retired by this change.
**Migration**: N/A.

## Unaffected requirements (kept, no delta needed)

`helio uploads URL scheme resolves to the uploads route`, `Rendered markdown images are constrained to the panel`, and `The uploaded-image URL scheme is documented` describe literal-markdown image rendering, unrelated to the DataType-bound mode retired above. They are unchanged by this ticket.
