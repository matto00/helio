import { useMemo, useRef } from "react";

import { useCreateDashboardAction } from "../dashboards/hooks/useCreateDashboardAction";
import { useCreatePanelAction } from "../panels/hooks/useCreatePanelAction";
import { useCreatePipelineAction } from "../pipelines/hooks/useCreatePipelineAction";
import { useAddSourceAction } from "../sources/hooks/useAddSourceAction";
import { ADD_SOURCE_MODAL_ARIA_LABEL } from "../sources/ui/AddSourceModal";
import { useCommandActions } from "./hooks";
import { buildCreateActions } from "./model/builtInActions";
import type { CreateActionResult } from "../dashboards/hooks/useCreateDashboardAction";

/** evaluation-1.md CR2 — moved here from the shared `useAddSourceAction` seam, so ONLY the
 * palette's own call site (the one entry point this ticket adds) gets the nested-modal
 * collision guard, and every other consumer of that seam (`SourcesPage`'s button, the sources
 * empty state) keeps its exact pre-existing behavior. Reads the modal's accessible name from the
 * exported constant rather than a re-typed literal, so renaming the label can't silently turn
 * this into a no-op. WHAT THIS PROVES (paired with the DOM-presence unit test in
 * `CreateCommandActions.test.tsx` and the real-browser case in
 * `e2e/hel516-palette-quick-create.spec.ts`): running "Add source" while ANY `AddSourceModal`
 * instance is already open in the DOM — whether the shell-mounted one or a nested one rendered
 * from `CreatePipelineModal`/`AddRootModal`'s own local state (design.md Decision 7) — is a
 * no-op rather than a second dialog. WHAT IT CANNOT PROVE: the reverse ordering (opening a
 * nested instance while the shell one is already open), since that path never goes through this
 * seam at all. */
export function isAddSourceModalAlreadyOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(`dialog[open][aria-label="${ADD_SOURCE_MODAL_ARIA_LABEL}"]`) !== null
  );
}

/** HEL-516 design.md Decision 4 — registers the palette's "Create" section. Calls all four
 * HEL-548 seams UNCONDITIONALLY at this component's top level (Rules of Hooks — a seam is a
 * hook and cannot be called inside `run()`), following the working prior art in
 * `shared/chrome/usePickerSelection.ts:3-9,41-46` rather than inventing a new pattern. Writes no
 * creation logic of its own: each action's `run` is exactly the seam's own `cta.onClick`.
 * Rendered unconditionally inside `AppShell`, alongside `BuiltInCommandActions` (`command-action-
 * registry` spec).
 *
 * evaluation-1.md CR1 — none of the four seams memoize their returned `CreateActionResult` (a
 * fresh object every render), so memoizing on THOSE objects' identity (the original shape here)
 * never actually hit: `useMemo` re-ran on every render, `useCommandActions`'s register/dispose
 * effect re-ran on every render, and each dispose+re-register cycle reshuffled the palette's
 * section order non-deterministically (measured: `Navigation,General,Create` and
 * `Create,Navigation,General` both occurred across otherwise-identical boots).
 *
 * Fix (chosen over extending the seams themselves): keep a ref to each seam's LATEST result,
 * updated on every render (cheap, synchronous, no effect), and memoize the actions array on the
 * PRIMITIVE values that actually determine its shape — each action's `label` and (for panel
 * only) `disabled`. `run` reads through the ref, so it always calls the current `cta.onClick`
 * without needing the array to be rebuilt when only the callback's closure changed. This keeps
 * the fix local to the palette's own consumption of the seams (their four existing consumers —
 * `usePickerSelection`, the sources/pipelines/panels empty states — are UNCHANGED, since the
 * seams' own return shape and call contract are untouched) rather than changing a shared surface
 * to fix one caller's memoization bug. */
export function CreateCommandActions() {
  const createDashboardAction = useCreateDashboardAction();
  const addSourceAction = useAddSourceAction();
  const createPipelineAction = useCreatePipelineAction();
  const createPanelAction = useCreatePanelAction();

  const dashboardRef = useRef<CreateActionResult>(createDashboardAction);
  dashboardRef.current = createDashboardAction;
  const sourceRef = useRef<CreateActionResult>(addSourceAction);
  sourceRef.current = addSourceAction;
  const pipelineRef = useRef<CreateActionResult>(createPipelineAction);
  pipelineRef.current = createPipelineAction;
  const panelRef = useRef<CreateActionResult>(createPanelAction);
  panelRef.current = createPanelAction;

  const actions = useMemo(
    () =>
      buildCreateActions(
        { cta: { ...dashboardRef.current.cta, onClick: () => dashboardRef.current.cta.onClick() } },
        {
          cta: {
            ...sourceRef.current.cta,
            onClick: () => {
              if (isAddSourceModalAlreadyOpen()) return;
              sourceRef.current.cta.onClick();
            },
          },
        },
        { cta: { ...pipelineRef.current.cta, onClick: () => pipelineRef.current.cta.onClick() } },
        { cta: { ...panelRef.current.cta, onClick: () => panelRef.current.cta.onClick() } },
      ),
    // This deps array is DELIBERATELY primitives only (evaluation-1.md CR1), read through the
    // refs above rather than named directly in the callback: rebuilding this array on every
    // render's fresh `cta.onClick` identity is exactly the churn that caused the
    // nondeterministic section-order bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      createDashboardAction.cta.label,
      addSourceAction.cta.label,
      createPipelineAction.cta.label,
      createPanelAction.cta.label,
      createPanelAction.cta.disabled,
    ],
  );

  useCommandActions(actions);

  return null;
}
