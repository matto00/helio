/**
 * OrbitMark — Helio logo mark.
 *
 * Geometry: outer circle ring + quarter-arc highlight + centre dot.
 * All paths use `var(--app-accent)` so the mark responds to theme switches
 * and the accent-colour override. A drop-shadow glow is applied via CSS
 * `filter` on the wrapping <svg>.
 */
export function OrbitMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      style={{ filter: "drop-shadow(0 0 5px var(--app-accent))", flexShrink: 0 }}
    >
      {/* Outer circle ring */}
      <circle
        cx="7"
        cy="7"
        r="5.5"
        stroke="var(--app-accent)"
        strokeWidth="1.25"
        fill="none"
        opacity="0.9"
      />

      {/* Quarter-arc highlight (top-right quadrant) */}
      <path
        d="M 7 1.5 A 5.5 5.5 0 0 1 12.5 7"
        stroke="var(--app-accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        fill="none"
      />

      {/* Centre dot */}
      <circle cx="7" cy="7" r="1.5" fill="var(--app-accent)" />
    </svg>
  );
}
