// HEL-525 (420-D) -- mirrors the backend's `AgentMemoryEntryResponse`
// (`AgentMemoryProtocol.scala`, HEL-478 / 420-B) field-for-field. `kind` is
// the wire string form (`fact` | `goal` | `preference-note` at time of
// writing, per `schemas/agent-memory.schema.json`'s enum) but is typed as a
// plain `string` here, matching the backend response type's own `String`
// field -- this UI only ever displays `kind`, it never branches on its
// value, so a narrower union would add no safety.

export interface AgentMemoryEntry {
  id: string;
  kind: string;
  content: string;
  createdAt: string;
  lastUsedAt: string | null;
}
