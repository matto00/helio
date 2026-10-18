// useStepDeepLink -- HEL-1668 D1: the page-level, one-shot owner of the initial `?step=` deep link. The page stays
// mounted across the phone/desktop layout switch, so it (not a layout) decides the deep link's fate: it captures the
// initial value at mount and consumes it at the first steps load, whichever layout is showing. Only a phone layout
// at that moment opens the step's sheet; a later desktop -> phone switch (a resize or rotation) never pops a sheet.

import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { STEP_PARAM } from "./useStepSelection";

export interface StepDeepLink {
  /** True once the first steps load has passed: the phone layout may then keep `?step=` in sync with its sheet. */
  consumed: boolean;
  /** The raw `?step=` value the phone layout should open, set only for a phone layout at the first steps load. */
  step: string | null;
  /** Called by the phone layout once it has opened `step`, so a later layout remount cannot reopen it. */
  clear: () => void;
}

export function useStepDeepLink(stepsLoaded: boolean, isPhone: boolean): StepDeepLink {
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => searchParams.get(STEP_PARAM));
  const [state, setState] = useState<{ consumed: boolean; step: string | null }>({
    consumed: false,
    step: null,
  });
  if (stepsLoaded && !state.consumed) setState({ consumed: true, step: isPhone ? initial : null });
  const clear = useCallback(
    () => setState((prev) => (prev.step === null ? prev : { ...prev, step: null })),
    [],
  );
  return { consumed: state.consumed, step: state.step, clear };
}
