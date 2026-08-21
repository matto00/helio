import { Skeleton } from "../../../shared/ui/Skeleton";

// A documented, fixed placeholder shape (design.md D3) — the resolved
// `DataGrid`'s actual row/column count depends on the source's real preview
// result, which isn't knowable before the fetch resolves. `.ui-data-grid--preview`
// caps real content at `max-height: 320px` (`DataGrid.css:34-39`) but is
// routinely shorter for a small result set, so this placeholder's exact
// height is an accepted delta, not a promised match — only the CONTAINER'S
// classes (border/radius/background) are shared with the real grid.
//
// skeptic-final-1.md non-blocking note — 10, not 5: the REST preview path
// returns up to 10 rows and the CSV preview path requests `limit=25`, so 5
// was a systematic under-guess (measured live: 133.4px skeleton vs 265px
// resolved for a REST preview). 10 halves that gap for free — it does not
// close it (the CSV path can still resolve taller), so the accepted-delta
// framing above still applies, just against a smaller number.
const PREVIEW_SKELETON_ROWS = 10;
const PREVIEW_SKELETON_COLS = 4;

/**
 * Initial-load placeholder for `SourceDetailPanel`'s preview section
 * (HEL-528, design.md D3). Reuses the real `.ui-data-grid`/`--preview`/
 * `--condensed` classes (`DataGrid.css`) for border/radius/background/cell
 * padding parity with the resolved `DataGrid`, with `Skeleton` lines in
 * place of cell text.
 */
export function SourcePreviewSkeleton() {
  return (
    <div
      className="ui-data-grid ui-data-grid--preview ui-data-grid--condensed"
      aria-label="Loading preview"
    >
      <table className="ui-data-grid__table">
        <thead>
          <tr>
            {Array.from({ length: PREVIEW_SKELETON_COLS }, (_, col) => (
              <th key={col}>
                <Skeleton variant="line" width="4em" height="0.7em" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: PREVIEW_SKELETON_ROWS }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: PREVIEW_SKELETON_COLS }, (_, col) => (
                <td key={col}>
                  <Skeleton variant="line" width="70%" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
