// HEL-1728 minimal repro: a bare react-grid-layout Responsive grid, no app code.
// Query toggles (D5): bare (default) | inline=1 (app-style inline dragConfig/resizeConfig) | collide=1 (noCompactor+preventCollision)
// | pos=1 (createScaledStrategy(1.5) positionStrategy) | stable=1 (dragConfig/resizeConfig memoized).
import { createRoot } from "react-dom/client";
import { useMemo } from "react";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Responsive } from "react-grid-layout";
import { noCompactor, createScaledStrategy } from "react-grid-layout/core";

const q = new URLSearchParams(location.search);
const layouts = {
  lg: [
    { i: "a", x: 0, y: 0, w: 3, h: 3 },
    { i: "b", x: 4, y: 0, w: 3, h: 3 },
    { i: "c", x: 8, y: 0, w: 3, h: 3 },
  ],
};
const cmp = { ...noCompactor, preventCollision: true };
const strat = createScaledStrategy(1.5);

function App() {
  const stableDrag = useMemo(() => ({ enabled: true, handle: ".h" }), []);
  const stableResize = useMemo(() => ({ enabled: true }), []);
  const extra: Record<string, unknown> = {};
  if (q.get("collide")) extra.compactor = cmp;
  if (q.get("pos")) extra.positionStrategy = strat;
  const drag = q.get("stable") ? stableDrag : q.get("inline") ? { enabled: true, handle: ".h" } : { handle: ".h" };
  const resize = q.get("stable") ? stableResize : q.get("inline") ? { enabled: true } : undefined;
  return (
    <Responsive
      className="grid"
      width={1200}
      layouts={layouts}
      breakpoints={{ lg: 1000, md: 800, sm: 500, xs: 0 }}
      cols={{ lg: 12, md: 10, sm: 6, xs: 4 }}
      rowHeight={40}
      dragConfig={drag}
      {...(resize ? { resizeConfig: resize } : {})}
      {...extra}
    >
      {["a", "b", "c"].map((k) => (
        <div key={k} data-k={k} style={{ background: "#ccd" }}>
          <div className="h" style={{ height: 24, background: "#889", cursor: "grab" }}>handle {k}</div>
        </div>
      ))}
    </Responsive>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
