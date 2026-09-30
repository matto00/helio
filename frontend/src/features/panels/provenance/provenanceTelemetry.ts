import { track } from "../../telemetry/track";

export type ProvenanceVariant = "authenticated" | "public";

export interface ProvenanceOpenedEvent {
  panelId: string;
  variant: ProvenanceVariant;
}

/** The single typed hook point for the `provenance_opened` telemetry event; called exactly once
 *  per popover open, nothing else in the provenance UI logs. The public share view is
 *  unauthenticated and `POST /api/events` requires a session, so nothing is sent there. The event
 *  carries no properties (the server allow-list defines none), so panel identity never leaves. */
export function onProvenanceOpened(evt: ProvenanceOpenedEvent): void {
  if (evt.variant === "public") return;
  track("provenance_opened", {});
}
