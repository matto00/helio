import { useCallback, useState } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { createPanel } from "../../panels/state/panelsSlice";
import { createOutput } from "../../pipelines/state/outputsSlice";
import type { CreateOutputPayload, Output } from "../../pipelines/types/output";
import { refreshOutputInsight } from "../../panels/insight/insightService";
import { pinInsight } from "../services/askService";
import type { AskPin, AskScope } from "../types/ask";

export type AskPinState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "pinned"; placed: boolean }
  | { status: "error" };

/** HEL-1746 D4: pins an answer as an insight Output. The POST body is `pin.request`, unchanged. When the pipeline's Output list
 *  is loaded the create goes through the existing thunk (the list updates); otherwise through the service, because the thunk's
 *  fulfilled case would fake a loaded list. From a dashboard, when the signed-in user owns it, a panel bound to the new Output
 *  is placed (the thunk marks the panels stale and refetches); a non-owner, or a failed placement, leaves the Output saved. */
export function useAskPin(scope: AskScope, pin: AskPin | null) {
  const dispatch = useAppDispatch();
  const listLoaded = useAppSelector(
    (state) => pin !== null && state.outputs?.byPipeline?.[pin.pipelineId] !== undefined,
  );
  const userId = useAppSelector((state) => state.auth?.currentUser?.id ?? null);
  const dashboardOwnerId = useAppSelector((state) =>
    scope.kind === "dashboard"
      ? state.dashboards?.items?.find((d) => d.id === scope.id)?.ownerId
      : undefined,
  );
  const [state, setState] = useState<AskPinState>({ status: "idle" });

  const run = useCallback(async () => {
    if (pin === null || state.status === "pending" || state.status === "pinned") return;
    setState({ status: "pending" });
    let created: Output;
    try {
      created = listLoaded
        ? await dispatch(
            createOutput({
              pipelineId: pin.pipelineId,
              payload: pin.request as unknown as CreateOutputPayload,
            }),
          ).unwrap()
        : await pinInsight(pin);
    } catch {
      setState({ status: "error" });
      return;
    }
    // HEL-1743 D13: a pin renders once, with trigger `pin`. The refresh is started, not awaited, and a failure of it never fails
    // or reverts the pin (the new insight just shows its not-yet-rendered state until a render exists).
    void refreshOutputInsight(created.id, "pin").catch(() => undefined);
    let placed = false;
    if (scope.kind === "dashboard" && userId !== null && dashboardOwnerId === userId) {
      try {
        await dispatch(
          createPanel({
            dashboardId: scope.id,
            type: "output",
            title: created.name,
            outputId: created.id,
          }),
        ).unwrap();
        placed = true;
      } catch {
        placed = false;
      }
    }
    setState({ status: "pinned", placed });
  }, [pin, state.status, listLoaded, dispatch, scope.kind, scope.id, userId, dashboardOwnerId]);

  return { state, pin: run };
}
