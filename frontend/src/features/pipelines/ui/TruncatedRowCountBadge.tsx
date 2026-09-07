import "./TruncatedRowCountBadge.css";

// HEL-873 (evaluation-1.md CR3): the single shared marker for "this row count was truncated by
// the run's row cap" -- previously copy-pasted (identical role/aria-label/title/glyph) into
// PipelineDetailFooter, RunHistoryModal, and PipelineListTable, with three dead classNames
// matching zero CSS rules (each rendered in inherited body colour, unlike HEL-861's sibling
// truncation banner, which already uses the --app-warning token family). One accessible-name
// string, one stylesheet, three call sites.
export const TRUNCATED_ROW_COUNT_LABEL =
  "Partial: this row count was truncated by the run's row cap";

export function TruncatedRowCountBadge() {
  // skeptic-final-1.md: the `{" "}` that used to open this span was a no-op — `display:
  // inline-flex` (see the .css file) puts the span in its own flex formatting context, and per
  // the CSS Flexbox spec a whitespace-only text run at the start of a flex container's content is
  // discarded outright, not merely collapsed to one space. Confirmed live in both themes: the
  // badge rendered flush against the preceding number ("1,000 rows⚠ Partial") on the list table
  // and run-history modal, and only looked correct on the detail-page footer by accident (that
  // call site's own JSX happens to emit a real space OUTSIDE this component). The gap is now a
  // CSS margin on the badge's own rule, so every call site is spaced identically regardless of
  // incidental JSX whitespace at the call site — the fix belongs in the shared component, not in
  // three consumers that would each have to remember it.
  return (
    <span
      className="truncated-row-count-badge"
      role="img"
      aria-label={TRUNCATED_ROW_COUNT_LABEL}
      title={TRUNCATED_ROW_COUNT_LABEL}
    >
      ⚠ Partial
    </span>
  );
}
