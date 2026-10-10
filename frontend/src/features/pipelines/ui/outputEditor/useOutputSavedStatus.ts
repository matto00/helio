// The saved-Output lookups behind the editor's delete warning and the never-materialized banner
// (extracted verbatim from `OutputEditorSheet.tsx`). Both refetch on every open of an existing
// Output and are `null` while unknown/loading, or whenever creating.

import { useEffect, useState } from "react";

import type { Output, OutputPanelPlacement } from "../../types/output";
import { getOutputRows, listOutputPanels } from "../../services/outputService";

export function useOutputSavedStatus(open: boolean, isCreate: boolean, output: Output | null) {
  const [placements, setPlacements] = useState<OutputPanelPlacement[] | null>(null);
  // HEL-946 Bug C(2) -- `null` while unknown/loading, `false` when the
  // saved Output has never been materialized by a successful run (so a
  // dashboard panel bound to it currently shows "No data available"),
  // `true` once materialized (a stored-empty result is a legitimate empty
  // result, not a warning). Only meaningful for an EXISTING Output -- a
  // brand-new one has no saved rows to check yet.
  const [neverMaterialized, setNeverMaterialized] = useState<boolean | null>(null);

  // task 5.7 -- placements fetched fresh on every open (safety-critical for
  // the delete-warning count, design.md decision 9).
  useEffect(() => {
    if (!open || isCreate || !output) {
      // Moved verbatim: closing/creating must drop the previous Output's status before any refetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlacements(null);
      return;
    }
    let cancelled = false;
    void listOutputPanels(output.id).then((result) => {
      if (!cancelled) setPlacements(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open, isCreate, output]);

  // HEL-946 Bug C(2) -- fetch the SAVED row-materialization status (distinct
  // from the live preview below, which re-runs the node fresh every time and
  // so never reflects whether a real pipeline run has ever persisted a
  // snapshot for this node). One row is enough to know `materialized`.
  useEffect(() => {
    if (!open || isCreate || !output) {
      // Moved verbatim: closing/creating must drop the previous Output's status before any refetch.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNeverMaterialized(null);
      return;
    }
    let cancelled = false;
    void getOutputRows(output.id, 0, 1).then((result) => {
      if (!cancelled) setNeverMaterialized(!result.materialized);
    });
    return () => {
      cancelled = true;
    };
  }, [open, isCreate, output]);

  return { placements, neverMaterialized };
}
