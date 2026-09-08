import { useNavigate, useLocation } from "react-router-dom";

import { useAppDispatch } from "../../hooks/reduxHooks";
import { setSelectedDashboardId } from "../../features/dashboards/state/dashboardsSlice";

/**
 * HEL-519 design.md D1 — the three kinds recents shipped with. HEL-503 design.md Decision 1
 * WIDENS this to a fourth kind, `"output"` (ruled explicitly — skeptic CR2, round 2). `panel` and
 * `connector` remain deliberately excluded: `panel` has no selected-panel concept or global
 * registry yet (HEL-1038), and there is no `/connectors/:id` route (HEL-1041).
 */
export type ResourceKind = "dashboard" | "source" | "pipeline" | "output";

/**
 * HEL-503 design.md Decision 1 — a DISCRIMINATED UNION, not an optional `pipelineId?` on one
 * flat record. An Output is not expressible as `{kind, id}` alone — it needs a pipeline id AND
 * an output id — and an optional field that is required for exactly one kind is precisely the
 * shape that compiles while being wrong (it would let a caller construct an Output ref with no
 * pipeline). The union makes that state unrepresentable.
 */
export type ResourceRef =
  | { kind: "dashboard" | "source" | "pipeline"; id: string }
  | { kind: "output"; id: string; pipelineId: string };

/**
 * Resolves the URL a resource lives at, or `null` when it has none (design.md D1, round-1 CR4).
 * A dashboard has NO route id — its route is `/`, carrying no state — so `null` is the honest
 * answer, not a lossy one; returning `"/"` would send a middle-click to the wrong place (it
 * would open whichever dashboard happens to be selected at click time, not the one referenced).
 * Recents itself never calls this (it only ever *activates* a result); it exists because HEL-503
 * needs a real `href` for middle-click / open-in-new-tab / copy-link on sources, pipelines, and
 * (as of this ticket) outputs.
 *
 * `switch` is a VALUE-returning switch, so TypeScript enforces exhaustiveness here automatically
 * (an unhandled kind is a compile error, TS2366 "not all code paths return a value") — unlike
 * `useResourceNavigator` below, which returns `void` and needs an explicit assertion instead.
 */
export function hrefFor(ref: ResourceRef): string | null {
  switch (ref.kind) {
    case "dashboard":
      return null;
    case "source":
      return `/sources/${ref.id}`;
    case "pipeline":
      return `/pipelines/${ref.id}`;
    case "output":
      // HEL-909's existing convention (`usePipelineDetailPage.ts:574-594` reads `?outputId=`,
      // opens the sheet, strips it) — do NOT invent a second one (design.md D1).
      return `/pipelines/${ref.pipelineId}?outputId=${ref.id}`;
  }
}

/**
 * The opaque "take me to this resource" dispatcher HEL-503 inherits (design.md D1). The caller
 * never learns whether a kind is route-expressed (`source`/`pipeline`/`output`) or
 * state-expressed (`dashboard`, which has no route id at all — selection lives purely in Redux).
 * Must be called from within a component mounted under both the app's `<Provider>` and its
 * router.
 */
export function useResourceNavigator(): (ref: ResourceRef) => void {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const location = useLocation();

  return (ref: ResourceRef) => {
    switch (ref.kind) {
      case "dashboard":
        dispatch(setSelectedDashboardId(ref.id));
        if (location.pathname !== "/") {
          navigate("/");
        }
        return;
      case "source":
      case "pipeline":
      case "output": {
        const href = hrefFor(ref);
        if (href !== null) {
          navigate(href);
        }
        return;
      }
      default: {
        // HEL-503 design.md D1 / task 1.3 (skeptic CR6) — this function returns `void` and
        // branches with early `return`s, so a `void` function may legally fall off the end:
        // TypeScript does NOT enforce exhaustiveness here the way it does for `hrefFor`'s
        // value-returning switch. Without this explicit assertion, an unhandled kind would
        // silently do nothing — a result row that appears to work and goes nowhere. `ref`
        // being typed `never` here is itself the guard: adding a kind without a `case` above
        // fails typecheck on this line.
        const _exhaustive: never = ref;
        return _exhaustive;
      }
    }
  };
}
