import { useNavigate, useLocation } from "react-router-dom";

import { useAppDispatch } from "../../hooks/reduxHooks";
import { setSelectedDashboardId } from "../../features/dashboards/state/dashboardsSlice";

/**
 * HEL-519 design.md D1 — the three kinds this ticket's recents feature (and HEL-503's search
 * results, which inherit this module) can address today. `panel` is deliberately excluded — it
 * has no selected-panel concept or global registry yet (HEL-1038).
 */
export type ResourceKind = "dashboard" | "source" | "pipeline";

export interface ResourceRef {
  kind: ResourceKind;
  id: string;
}

/**
 * Resolves the URL a resource lives at, or `null` when it has none (design.md D1, round-1 CR4).
 * A dashboard has NO route id — its route is `/`, carrying no state — so `null` is the honest
 * answer, not a lossy one; returning `"/"` would send a middle-click to the wrong place (it
 * would open whichever dashboard happens to be selected at click time, not the one referenced).
 * Recents itself never calls this (it only ever *activates* a result); it exists because HEL-503
 * needs a real `href` for middle-click / open-in-new-tab / copy-link on sources and pipelines.
 */
export function hrefFor(ref: ResourceRef): string | null {
  switch (ref.kind) {
    case "dashboard":
      return null;
    case "source":
      return `/sources/${ref.id}`;
    case "pipeline":
      return `/pipelines/${ref.id}`;
  }
}

/**
 * The opaque "take me to this resource" dispatcher HEL-503 inherits (design.md D1). The caller
 * never learns whether a kind is route-expressed (`source`/`pipeline`) or state-expressed
 * (`dashboard`, which has no route id at all — selection lives purely in Redux). Must be called
 * from within a component mounted under both the app's `<Provider>` and its router.
 */
export function useResourceNavigator(): (ref: ResourceRef) => void {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const location = useLocation();

  return (ref: ResourceRef) => {
    if (ref.kind === "dashboard") {
      dispatch(setSelectedDashboardId(ref.id));
      if (location.pathname !== "/") {
        navigate("/");
      }
      return;
    }
    const href = hrefFor(ref);
    if (href !== null) {
      navigate(href);
    }
  };
}
