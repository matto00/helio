// Static SVG ribbon used between river-view steps on the PipelineDetailPage.
// Pure decoration — no props, no state.

export function RibbonSegment() {
  return (
    <svg
      className="pipeline-detail-page__ribbon"
      viewBox="0 0 800 50"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* Band 1 */}
      <path
        d="M0,5 C400,5 400,5 800,5 L800,15 C400,15 400,15 0,15 Z"
        fill="var(--app-accent)"
        fillOpacity="0.15"
        stroke="var(--app-accent)"
        strokeOpacity="0.3"
        strokeWidth="0.5"
      />
      {/* Band 2 */}
      <path
        d="M0,17 C400,17 400,17 800,17 L800,28 C400,28 400,28 0,28 Z"
        fill="var(--app-accent-strong)"
        fillOpacity="0.12"
        stroke="var(--app-accent-strong)"
        strokeOpacity="0.25"
        strokeWidth="0.5"
      />
      {/* Band 3 */}
      <path
        d="M0,30 C400,30 400,30 800,30 L800,38 C400,38 400,38 0,38 Z"
        fill="var(--app-accent)"
        fillOpacity="0.08"
        stroke="var(--app-accent)"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
      {/* Band 4 */}
      <path
        d="M0,40 C400,40 400,40 800,40 L800,46 C400,46 400,46 0,46 Z"
        fill="var(--app-accent-mid)"
        fillOpacity="0.1"
        stroke="var(--app-accent-mid)"
        strokeOpacity="0.2"
        strokeWidth="0.5"
      />
    </svg>
  );
}
