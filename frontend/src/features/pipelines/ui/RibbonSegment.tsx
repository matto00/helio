// Static SVG ribbon used between river-view steps on the PipelineDetailPage.
// Pure decoration — no props, no state.
//
// HEL sweep F-014: this used to paint four `--app-accent`/`--app-accent-
// strong`/`--app-accent-mid` bands on *every* gap between *every* step of
// *every* pipeline at rest — a persistent accent-tinted texture across the
// whole canvas, which DESIGN.md §0 calls out directly ("if a screen looks
// tinted, accent discipline has broken"). The auth page's single accent
// glow (`auth.css`'s `.auth-page::before`) is a one-off, low-opacity,
// once-per-screen moment; this was the opposite — a saturated, repeated
// structural element. Two thin neutral bands (the same border tokens the
// rest of the app's structural chrome uses) keep the "connector between
// steps" motif without recoloring the canvas with the user's accent.
export function RibbonSegment() {
  return (
    <svg
      className="pipeline-detail-page__ribbon"
      viewBox="0 0 800 50"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d="M0,22 C400,22 400,22 800,22 L800,25 C400,25 400,25 0,25 Z"
        fill="var(--app-border-strong)"
      />
      <path
        d="M0,28 C400,28 400,28 800,28 L800,30 C400,30 400,30 0,30 Z"
        fill="var(--app-border-subtle)"
      />
    </svg>
  );
}
