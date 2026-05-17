import "./DividerPanel.css";

interface DividerPanelProps {
  orientation?: string | null;
  weight?: number | null;
  color?: string | null;
}

export function DividerPanel({ orientation, weight, color }: DividerPanelProps) {
  const isVertical = orientation === "vertical";
  const thickness = weight ?? 1;
  const resolvedColor = color ?? "var(--color-border)";

  return (
    <div
      className={`divider-panel ${isVertical ? "divider-panel--vertical" : "divider-panel--horizontal"}`}
      aria-hidden="true"
    >
      <div
        className="divider-panel__rule"
        style={
          isVertical
            ? { width: thickness, backgroundColor: resolvedColor, height: "100%" }
            : { height: thickness, backgroundColor: resolvedColor, width: "100%" }
        }
      />
    </div>
  );
}
