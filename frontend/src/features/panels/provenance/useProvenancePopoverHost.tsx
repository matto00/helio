import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { usePortalPopover, type PortalPopoverPos } from "../../../hooks/usePortalPopover";
import { fitPanelVertically, readBottomInset, VIEWPORT_MARGIN } from "../../../shared/ui/panelFit";
import { subscribeToPipelineTerminal } from "../services/pipelineRunFanout";
import { getCachedProvenance, invalidateProvenance, subscribeProvenance } from "./provenanceCache";
import { onProvenanceOpened, type ProvenanceVariant } from "./provenanceTelemetry";
import type { Provenance } from "./provenanceService";
import { ProvenancePopover } from "./ProvenancePopover";
import { useProvenance } from "./useProvenance";
import { getPublishedComparison, subscribeComparisons } from "../history/metricComparisonStore";

const POPOVER_MAX_WIDTH = 360;
/** Gap between the trigger and the popover. */
const TRIGGER_GAP = 8;
/** The CSS design cap (`ProvenancePopover.css`: `min(70vh, 480px)`), mirrored so the inline `maxHeight` never exceeds it. */
const POPOVER_MAX_HEIGHT = 480;

/** Where the mounted popover sits against its trigger so all of it is reachable (HEL-1756): below the trigger when it
 *  fits, above when that side has more room, else capped to the roomier side so it scrolls inside itself. Horizontally
 *  it keeps an 8px margin on both sides. With no layout (jsdom) it keeps the preferred side, uncapped. */
function placeProvenance(panel: HTMLElement, trigger: DOMRect): PortalPopoverPos {
  const width = Math.min(POPOVER_MAX_WIDTH, window.innerWidth - 40);
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(trigger.left, window.innerWidth - width - VIEWPORT_MARGIN),
  );
  const chrome = panel.offsetHeight - panel.clientHeight;
  const natural = panel.scrollHeight === 0 ? 0 : panel.scrollHeight + chrome;
  const fit = fitPanelVertically(trigger, natural, window.innerHeight, {
    bottomInset: readBottomInset(panel),
    gap: TRIGGER_GAP,
    cap: Math.min(0.7 * window.innerHeight, POPOVER_MAX_HEIGHT),
    prefer: "below",
  });
  const maxHeight = Number.isFinite(fit.maxHeight) ? fit.maxHeight : undefined;
  return fit.side === "above"
    ? { bottom: fit.bottom, left, width, maxHeight }
    : { top: fit.top, left, width, maxHeight };
}

export interface ProvenancePopoverHostOptions {
  variant: ProvenanceVariant;
  /** The panel the telemetry event and the comparison lookup are keyed by. */
  panelId: string;
  /** The `provenanceCache` key of the chain this popover shows. */
  cacheKey: string;
  fetcher: () => Promise<Provenance>;
  /** The dialog's accessible name. */
  label: string;
  /** The Output the "open pipeline" link targets (authenticated only). */
  outputId: string;
  /** Key of the published metric comparison to show, or `null` for none (a citation chip has no panel of its own). */
  comparisonKey: string | null;
}

export interface ProvenancePopoverHost {
  /** Attach to the anchor element the popover is positioned against and focus returns to. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  isOpen: boolean;
  /** Toggle from a click on `event.currentTarget`; `checks` lands focus on the Checks section. Stops propagation. */
  toggle: (event: MouseEvent<HTMLElement>, checks: boolean) => void;
  /** The popover to render next to the anchor, or `null` while closed. */
  popover: ReactNode;
}

/** HEL-1207 / HEL-1744 D6 -- the open state, the lazy cached read and the popover of one provenance anchor, extracted from
 *  `ProvenanceTrigger` so a citation chip opens the very same popover with the same placement (HEL-1756), focus, Tab trap,
 *  Escape and focus-return behaviour. */
export function useProvenancePopoverHost({
  variant,
  panelId,
  cacheKey,
  fetcher,
  label,
  outputId,
  comparisonKey,
}: ProvenancePopoverHostOptions): ProvenancePopoverHost {
  const { triggerRef, panelRef, isOpen, placed, panelPos, handleOpen, close, reposition } =
    usePortalPopover<HTMLButtonElement>({ place: placeProvenance });
  const [focusChecks, setFocusChecks] = useState(false);
  const [container, setContainer] = useState<HTMLElement>(() => document.body);
  /** Whichever control opened the popover (icon or badge) — focus returns there on close. */
  const openerRef = useRef<HTMLElement | null>(null);
  const isPublic = variant === "public";

  const state = useProvenance(cacheKey, fetcher, isOpen);
  // HEL-1275 design.md D5 — the comparison the panel body resolved (null when hidden/absent).
  const comparison = useSyncExternalStore(subscribeComparisons, () =>
    comparisonKey === null ? null : getPublishedComparison(comparisonKey),
  );

  // A cached chain goes stale when its pipeline next succeeds or fails: evict so the next open
  // refetches. Subscribes only once a chain is loaded (nothing to go stale before that; the fan-out
  // baselines its first observation without firing) and only for the authenticated variant.
  // Read from the cache (not the popover state, which is idle while closed): the subscription must
  // outlive the popover, since the staleness happens while it is closed.
  const loadedPipelineId = useSyncExternalStore(
    subscribeProvenance,
    () => getCachedProvenance(cacheKey)?.pipeline.id,
  );
  useEffect(() => {
    if (isPublic || !loadedPipelineId) return;
    return subscribeToPipelineTerminal(loadedPipelineId, () => invalidateProvenance(cacheKey));
  }, [isPublic, loadedPipelineId, cacheKey]);

  const toggle = useCallback(
    (event: MouseEvent<HTMLElement>, checks: boolean) => {
      event.stopPropagation();
      if (isOpen) {
        close();
        return;
      }
      openerRef.current = event.currentTarget;
      // Inside a native `<dialog>` Modal the popover must portal INTO the dialog (top layer + its
      // focus scope); elsewhere it goes to <body>. Resolved here, at open time, not during render.
      setContainer(event.currentTarget.closest("dialog") ?? document.body);
      setFocusChecks(checks);
      handleOpen();
      onProvenanceOpened({ panelId, variant });
    },
    [isOpen, close, handleOpen, panelId, variant],
  );

  const handleClose = useCallback(() => {
    close();
    // The Invalid-data badge can unmount while the popover is open; fall back to the icon.
    const opener = openerRef.current;
    (opener?.isConnected ? opener : triggerRef.current)?.focus();
  }, [close, triggerRef]);

  const pipelineHref =
    !isPublic && state.status === "ready" && state.data.pipeline.id
      ? `/pipelines/${state.data.pipeline.id}?outputId=${outputId}`
      : null;

  const popover =
    isOpen && panelPos ? (
      <ProvenancePopover
        label={label}
        variant={variant}
        pos={panelPos}
        placed={placed}
        panelRef={panelRef}
        reposition={reposition}
        state={state}
        comparison={comparison}
        focusChecks={focusChecks}
        pipelineHref={pipelineHref}
        container={container}
        onClose={handleClose}
      />
    ) : null;

  return { triggerRef, isOpen, toggle, popover };
}
