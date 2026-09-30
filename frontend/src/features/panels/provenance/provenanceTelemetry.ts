export type ProvenanceVariant = "authenticated" | "public";

export interface ProvenanceOpenedEvent {
  panelId: string;
  variant: ProvenanceVariant;
}

/** HEL-1207 — the single typed hook point for the `provenance_opened` telemetry event. Intentionally
 *  a no-op: HEL-1208 fills it in once the telemetry pipeline exists. Called exactly once per popover
 *  open; nothing else in the provenance UI logs. */
export function onProvenanceOpened(evt: ProvenanceOpenedEvent): void {
  void evt;
}
