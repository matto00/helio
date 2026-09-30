import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { encodeDefaultValue, isValidRawValue } from "../state/viewerControlValues";
import type { OutputControlSpec } from "../types/panel";

/** design.md D2 — `?p.<panelId>.<controlId>=<value>`, one flat query key per control (never a
 *  single JSON blob), so a pasted link is human-legible and a single control's change is a single
 *  param diff. */
function paramKey(panelId: string, controlId: string): string {
  return `p.${panelId}.${controlId}`;
}

export interface ViewerControlsResult {
  /** controlId -> the value CURRENTLY IN EFFECT: the URL's raw string when present and
   *  well-formed for that control's kind, else the author's own `defaultValue` (re-encoded to the
   *  same raw shape), else `undefined` (no filter for this control at all). */
  values: Record<string, string | undefined>;
  /** controlId -> the raw URL entry, or `undefined` when absent — distinct from `values` above,
   *  which already falls back to the default; a caller that needs to know "is this control
   *  showing an explicit override, or the author's default" (e.g. to enable/disable its own
   *  Clear affordance) reads this instead. */
  urlValues: Record<string, string | undefined>;
  /** Sets `controlId`'s URL entry to `raw` — a same-tick `replace` (never a new history entry;
   *  every control change is a refinement of the SAME view, not a new page). */
  setValue: (controlId: string, raw: string) => void;
  /** Removes `controlId`'s URL entry entirely, reverting it to the author's `defaultValue` (or
   *  "no filter" if none is set) — spec.md's "Clearing a control returns to the author's default". */
  clearValue: (controlId: string) => void;
}

/** design.md D2 (task 4.2) — holds a viewer's per-panel control selection in the page URL's query
 *  string, scoped by panel AND control id. Per-viewer, ephemeral, NEVER written to panel config
 *  (ticket's own "Scope" section) — every read/write here is `useSearchParams`, the router's own
 *  URL-backed state, so reload and a pasted link reproduce a set selection for free, and every
 *  render path (desktop grid, mobile stack, fullscreen, detail modal, public viewer) that calls
 *  this hook for the SAME `panelId` shares one source of truth by construction — there is no
 *  separate per-component state to keep in sync. */
export function useViewerControls(
  panelId: string,
  controls: OutputControlSpec[],
): ViewerControlsResult {
  const [searchParams, setSearchParams] = useSearchParams();

  const urlValues = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const control of controls) {
      const raw = searchParams.get(paramKey(panelId, control.id));
      map[control.id] = raw ?? undefined;
    }
    return map;
    // `searchParams.toString()` — not `searchParams` itself — is the real dependency:
    // `useSearchParams` returns a fresh `URLSearchParams` instance on every render regardless of
    // whether the query string actually changed, which would otherwise defeat this memo entirely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString(), panelId, controls]);

  const setValue = useCallback(
    (controlId: string, raw: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(paramKey(panelId, controlId), raw);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, panelId],
  );

  const clearValue = useCallback(
    (controlId: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(paramKey(panelId, controlId));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, panelId],
  );

  const values = useMemo(() => {
    const map: Record<string, string | undefined> = {};
    for (const control of controls) {
      const raw = urlValues[control.id];
      map[control.id] =
        raw !== undefined && isValidRawValue(control.kind, raw) ? raw : encodeDefaultValue(control);
    }
    return map;
  }, [urlValues, controls]);

  return { values, urlValues, setValue, clearValue };
}
