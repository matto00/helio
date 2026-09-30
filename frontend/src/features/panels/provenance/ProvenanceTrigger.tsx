import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import { Info } from "lucide-react";

import { usePortalPopover, type PortalPopoverPos } from "../../../hooks/usePortalPopover";
import { IconButton } from "../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import "./ProvenanceTrigger.css";
import { fetchOutputProvenance, fetchPublicProvenance, type Provenance } from "./provenanceService";
import { subscribeToPipelineTerminal } from "../services/pipelineRunFanout";
import {
  getCachedProvenance,
  invalidateProvenance,
  outputProvenanceKey,
  publicProvenanceKey,
  subscribeProvenance,
} from "./provenanceCache";
import { onProvenanceOpened, type ProvenanceVariant } from "./provenanceTelemetry";
import { ProvenancePopover } from "./ProvenancePopover";
import { useProvenance } from "./useProvenance";

const POPOVER_MAX_WIDTH = 360;
const VIEWPORT_MARGIN = 8;
/** Below this much room under the trigger, open upward instead. */
const MIN_ROOM_BELOW = 320;

export interface ProvenanceTriggerProps {
  panelId: string;
  panelTitle?: string;
  outputId: string;
  variant: ProvenanceVariant;
  /** Public variant only. */
  dashboardId?: string;
  /** Public variant only — the share token the public endpoint authorizes with. */
  token?: string;
  /** When set, renders the "Invalid data" badge as a second opener of the SAME popover, landing
   *  on its Checks section (HEL-1207 A4). */
  invalidBadge?: boolean;
  className?: string;
}

function computePos(rect: DOMRect): PortalPopoverPos {
  const width = Math.min(POPOVER_MAX_WIDTH, window.innerWidth - 40);
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN),
  );
  const roomBelow = window.innerHeight - rect.bottom;
  if (roomBelow < MIN_ROOM_BELOW && rect.top > roomBelow) {
    return { bottom: window.innerHeight - rect.top + VIEWPORT_MARGIN, left, width };
  }
  return { top: rect.bottom + VIEWPORT_MARGIN, left, width };
}

/** HEL-1207 — the shared provenance trigger: one component per render path (desktop card footer,
 *  mobile stack header, public viewer row, fullscreen/detail modal), owning open state, the lazy
 *  cached read and the popover. Event isolation (A2): its own click/keydown never bubble to the
 *  host card / mobile item / modal. */
export function ProvenanceTrigger({
  panelId,
  panelTitle,
  outputId,
  variant,
  dashboardId,
  token,
  invalidBadge = false,
  className,
}: ProvenanceTriggerProps) {
  const { triggerRef, isOpen, panelPos, handleOpen, close } = usePortalPopover<HTMLButtonElement>();
  const [focusChecks, setFocusChecks] = useState(false);
  const [container, setContainer] = useState<HTMLElement>(() => document.body);
  /** Whichever control opened the popover (icon or badge) — focus returns there on close. */
  const openerRef = useRef<HTMLElement | null>(null);

  const isPublic = variant === "public";
  const key =
    isPublic && dashboardId
      ? publicProvenanceKey(dashboardId, panelId)
      : outputProvenanceKey(outputId);
  const fetcher = useCallback(
    (): Promise<Provenance> =>
      isPublic && dashboardId
        ? fetchPublicProvenance(dashboardId, panelId, token ?? "")
        : fetchOutputProvenance(outputId),
    [isPublic, dashboardId, panelId, token, outputId],
  );
  const state = useProvenance(key, fetcher, isOpen);

  // A cached chain goes stale when its pipeline next succeeds or fails: evict so the next open
  // refetches. Subscribes only once a chain is loaded (nothing to go stale before that; the fan-out
  // baselines its first observation without firing) and only for the authenticated variant.
  // Read from the cache (not the popover state, which is idle while closed): the subscription must
  // outlive the popover, since the staleness happens while it is closed.
  const loadedPipelineId = useSyncExternalStore(
    subscribeProvenance,
    () => getCachedProvenance(key)?.pipeline.id,
  );
  useEffect(() => {
    if (isPublic || !loadedPipelineId) return;
    return subscribeToPipelineTerminal(loadedPipelineId, () => invalidateProvenance(key));
  }, [isPublic, loadedPipelineId, key]);

  const open = useCallback(
    (checks: boolean) => {
      setFocusChecks(checks);
      handleOpen(computePos);
      onProvenanceOpened({ panelId, variant });
    },
    [handleOpen, panelId, variant],
  );

  function toggle(event: MouseEvent<HTMLElement>, checks: boolean) {
    event.stopPropagation();
    if (isOpen) {
      close();
      return;
    }
    openerRef.current = event.currentTarget;
    // Inside a native `<dialog>` Modal the popover must portal INTO the dialog (top layer + its
    // focus scope); elsewhere it goes to <body>. Resolved here, at open time, not during render.
    setContainer(event.currentTarget.closest("dialog") ?? document.body);
    open(checks);
  }
  const stopKey = (event: KeyboardEvent<HTMLElement>) => event.stopPropagation();

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

  return (
    <span
      className={["provenance-trigger", className].filter(Boolean).join(" ")}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={stopKey}
    >
      <IconButton
        ref={triggerRef}
        icon={<Info aria-hidden="true" size={ICON_SIZE.sm} />}
        variant="ghost"
        size="xs"
        className="provenance-trigger__btn"
        aria-label="Data provenance"
        title="Data provenance"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={(e) => toggle(e, false)}
      />
      {invalidBadge && (
        <button
          type="button"
          className="panel-grid-card__type-badge panel-grid-card__type-badge--invalid provenance-trigger__badge"
          title="The latest pipeline run for this panel's data failed an assertion rule"
          aria-label="Data checks failed - view provenance"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={(e) => toggle(e, true)}
        >
          Invalid data
        </button>
      )}
      {isOpen && panelPos ? (
        <ProvenancePopover
          label={panelTitle ? `Data provenance for ${panelTitle}` : "Data provenance"}
          variant={variant}
          pos={panelPos}
          state={state}
          focusChecks={focusChecks}
          pipelineHref={pipelineHref}
          container={container}
          onClose={handleClose}
        />
      ) : null}
    </span>
  );
}
