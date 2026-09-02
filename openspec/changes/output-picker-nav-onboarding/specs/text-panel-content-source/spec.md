## REMOVED Requirements

### Requirement: Text panel content can be sourced from a DataType or authored statically
**Reason**: DataTypes are retired outright (HEL-903 decision 11); data-bound text panels migrate to `markdown` Outputs (source-of-truth spec line 76). A dashboard-native text panel is literal-only from this change forward.
**Migration**: A data-bound text panel becomes a `markdown` Output, placed via `output-picker` like any other Output. Literal text panels are unaffected — they keep their existing literal-content editor.

### Requirement: Bound content takes precedence over literal content at render time
**Reason**: Same as above — there is no bound mode left to take precedence over anything.
**Migration**: N/A.

### Requirement: Switching modes and saving persists the correct config shape
**Reason**: Same as above — there is no Source/Static mode toggle left to switch between.
**Migration**: N/A — `TextContentEditor.tsx` is literal-only after this change (see design.md's "TextContentEditor / MarkdownEditor" resolution).
